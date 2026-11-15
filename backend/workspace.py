"""The editor workspace: the text of one edition, and every problem found, anchored to its exact sentence.

Nothing is computed with an LLM here: the issues come from results already stored in `analysis` (facts,
wording, contradictions, missing-content summaries), from SQL (stale facts, alignment, figure checks), and
the editor's decisions are kept in the system-versioned table `issue_status`.
"""
from __future__ import annotations

import json
import re

from . import config, db

HINT = f"/*+ MAX_EXECUTION_TIME({config.QUERY_TIMEOUT_MS}) */"
NOWHERE = 0.55        # closest passage in the target farther than this: a subject the target does not cover

STATUS_DDL = """CREATE TABLE IF NOT EXISTS issue_status (
  wikidata_id VARCHAR(16)  NOT NULL,
  lang        CHAR(2)      NOT NULL,
  issue_id    VARCHAR(190) NOT NULL,
  status      ENUM('open','fixed','dismissed') NOT NULL DEFAULT 'open',
  note        VARCHAR(500) NULL,
  PRIMARY KEY (wikidata_id, lang, issue_id)
) WITH SYSTEM VERSIONING"""

STATUS_SQL = f"SELECT {HINT} issue_id, status, note FROM issue_status WHERE wikidata_id = %(qid)s AND lang = %(lang)s"
STATUS_PUT_SQL = """INSERT INTO issue_status (wikidata_id, lang, issue_id, status, note) VALUES (%s, %s, %s, %s, %s)
ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note)"""
# Every decision ever taken on this article's issues, from the system-versioned history.
STATUS_HISTORY_SQL = f"""SELECT {HINT} issue_id, status, note, row_start AS changed_at
FROM issue_status FOR SYSTEM_TIME ALL
WHERE wikidata_id = %(qid)s AND lang = %(lang)s
ORDER BY row_start DESC LIMIT 100"""

_ensured = False


def _ensure() -> None:
    global _ensured
    if not _ensured:
        with db.pool.cursor() as cur:
            cur.execute(STATUS_DDL)
        _ensured = True


def _span(text: str, quote: str | None, exact: bool = False) -> tuple[int, int] | None:
    """Where the quote sits in the passage, tolerant to spacing and case. If one word differs (a quote copied
    with a slip), the longest run of at least 4 consecutive quote words found verbatim is used instead."""
    if not quote or not text:
        return None
    words = re.findall(r"\w+", quote, re.U)
    if not words:
        return None
    def find(ws):
        m = re.search(r"\W+".join(re.escape(w) for w in ws), text, re.I | re.U)
        return (m.start(), m.end()) if m else None
    if (sp := find(words)) or exact:
        return sp
    for n in range(len(words) - 1, 3, -1):           # longest verbatim run first
        for k in range(0, len(words) - n + 1):
            if (sp := find(words[k:k + n])):
                return sp
    return None


def _locate(quote: str | None, preferred: int | None, texts: dict[int, str]) -> tuple[int, int, int] | None:
    """(chunk_id, start, end) of a quote: in the passage the analysis paired it with, else anywhere in the article."""
    if not quote:
        return None
    order = ([preferred] if preferred in texts else []) + [c for c in texts if c != preferred]
    for c in order:                                  # partial matches only in the paired passage
        if (sp := _span(texts[c], quote, exact=c != preferred)):
            return c, sp[0], sp[1]
    return None


def _cached(cur, kind: str, key: str, rk: str) -> dict | None:
    cur.execute("SELECT result FROM analysis WHERE kind = %s AND wikidata_id = %s AND rev_key = %s", (kind, key, rk))
    row = cur.fetchone()
    return json.loads(row["result"]) if row else None


def _compare_marks(f: dict | None, w: dict | None, lang: str, other: str, texts: dict[str, dict[int, str]]) -> dict:
    """Highlights for the side-by-side view: a fact that differs is marked in both columns, a fact one edition
    leaves out only in the column that states it, a wording difference in both. `key` links the two sides."""
    out = {lang: [], other: []}

    def put(side: str, chunk: int | None, quote: str | None, **m) -> None:
        loc = _locate(quote, chunk, texts[side])
        if loc:
            out[side].append({"chunk_id": loc[0], "start": loc[1], "end": loc[2], **m})

    for i, x in enumerate((f or {}).get("facts") or []):
        if x["status"] == "agree":
            continue
        grp = f["groups"][x["group_index"]]
        vals = {v["lang"]: v for v in x["values"]}
        a, b = vals.get(lang), vals.get(other)
        if a and b and x["status"] == "differ":
            for side, v in ((lang, a), (other, b)):
                put(side, (grp.get(side) or {}).get("chunk_id"), v["quote"], key=f"fact:{i}", type="differ",
                    title=x["subject"], value=v.get("value"), vs=(b if side == lang else a).get("value"))
        elif (a or b) and not (a and b):
            side, v, absent = (lang, a, other) if a else (other, b, lang)
            if absent in x.get("missing_in", []) or x["status"] == "missing":
                put(side, (grp.get(side) or {}).get("chunk_id"), v["quote"], key=f"fact:{i}", type="only",
                    title=x["subject"], value=v.get("value"), vs=None)
    for i, d in enumerate((w or {}).get("differences") or []):
        grp = w["groups"][d["group_index"]]
        sides = {q["lang"]: q for q in d["quotes"] if q["lang"] in (lang, other)}
        if len(sides) == 2:
            for side, q in sides.items():
                put(side, (grp.get(side) or {}).get("chunk_id"), q["quote"], key=f"wording:{i}", type="wording",
                    title=d["title"], value=None, vs=None)
    return out


def build(qid: str, lang: str) -> dict | None:
    from . import topics
    from .insights import COVERED, gaps
    _ensure()
    g = gaps(qid)
    if g is None or lang not in g["languages"]:
        return None
    arts = {a["lang"]: a for a in g["articles"]}
    me = arts[lang]
    passages = [{"chunk_id": p["chunk_id"], "chunk_idx": p["chunk_idx"], "section": p["section"], "text": p["text"]}
                for p in g["languages"][lang]["passages"]]
    by_chunk = {p["chunk_id"]: p for p in passages}
    by_idx = {p["chunk_idx"]: p for p in passages}
    issues: list[dict] = []

    my_texts = {p["chunk_id"]: p["text"] for p in passages}

    def anchor(chunk_id: int | None, quote: str | None) -> dict:
        loc = _locate(quote, chunk_id, my_texts)
        if loc:
            return {"chunk_id": loc[0], "start": loc[1], "end": loc[2]}
        return {"chunk_id": chunk_id if chunk_id in by_chunk else None, "start": None, "end": None}

    # Facts that differ, or that this edition leaves out (Claude compares; figures checked in SQL; Finnish history).
    f = topics.facts(qid, cached_only=True)
    stale_by_fact = {}
    if f and f.get("facts") and lang == "fi":
        with db.pool.cursor() as cur:
            cur.execute("SELECT result FROM analysis WHERE kind = 'stale' AND wikidata_id = %s ORDER BY created_at DESC LIMIT 1", (qid,))
            row = cur.fetchone()
        if row:
            stale_by_fact = {i["fact_index"]: i for i in json.loads(row["result"]).get("items", []) if "fact_index" in i}
    for i, x in enumerate((f or {}).get("facts") or []):
        if x["status"] == "agree":
            continue
        mine = next((v for v in x["values"] if v["lang"] == lang), None)
        grp = f["groups"][x["group_index"]]
        chunk = (grp.get(lang) or {}).get("chunk_id")
        if x["status"] == "missing" and lang not in x["missing_in"]:
            continue
        absent = mine is None or lang in x.get("missing_in", [])     # this edition gives no value at all
        issues.append({"id": f"fact:{i}", "type": "fact", "severity": "medium" if absent else "high",
                       "title": x["subject"], "status_label": "Not stated here" if absent else "Differs",
                       "provenance": "claude+sql", **anchor(chunk, mine["quote"] if mine else None),
                       "detail": {**x, "history": stale_by_fact.get(i), "group": grp}})

    # Wording and framing (Claude; quotes verified).
    w = topics.framing(qid, cached_only=True)
    for i, d in enumerate((w or {}).get("differences") or []):
        grp = w["groups"][d["group_index"]]
        q = next((qt for qt in d["quotes"] if qt["lang"] == lang), None)
        chunk = (grp.get(lang) or {}).get("chunk_id")
        if chunk is None:
            continue
        issues.append({"id": f"wording:{i}", "type": "wording", "severity": d["severity"], "title": d["title"],
                       "status_label": d["kind"].replace("_", " "), "provenance": "claude",
                       **anchor(chunk, q["quote"] if q else None), "detail": {**d, "group": grp}})

    # Contradictions with other articles (dates: SQL then Claude; figures: Claude then SQL).
    with db.pool.cursor() as cur:
        c = _cached(cur, "contra2", f"{lang}:{me['page_id']}", f"{lang}:{me['rev_id']}")
        miss = _cached(cur, f"missing2:{lang}", qid, topics._rev_key(g["articles"]))
    if c:                                              # other articles only; other editions are in the facts
        from .datecontra import split_same_topic
        c = split_same_topic(c, lang, me["page_id"])
    for i, x in enumerate((c or {}).get("contradictions") or []):
        issues.append({"id": f"contra:{x.get('kind', 'date')}:{x['b']['chunk_id']}:{x['value_a']}"[:190], "type": "contradiction",
                       "severity": "high", "title": x["topic"], "status_label": f"vs {x['b']['title']}",
                       "provenance": "sql+claude" if x.get("kind") == "date" else "claude+sql",
                       **anchor(x["a"]["chunk_id"], x["quote_a"]), "detail": x})

    # Content of the other editions with no equivalent here, placed after the closest passage of this edition.
    summaries = (miss or {}).get("summaries", {})
    for other, data in g["languages"].items():
        if other == lang:
            continue
        for p in data["passages"]:
            m = p["matches"].get(lang)
            if not m or m["distance"] <= COVERED:
                continue
            near = by_idx.get(m["chunk_idx"]) if m["distance"] <= NOWHERE else None
            issues.append({"id": f"missing:{p['chunk_id']}", "type": "missing", "severity": "low",
                           "title": summaries.get(str(p["chunk_id"])) or (p["section"] or "Passage"),
                           "status_label": f"Only in {other}", "provenance": "sql",
                           "chunk_id": near["chunk_id"] if near else None, "start": None, "end": None,
                           "detail": {"lang": other, "chunk_id": p["chunk_id"], "section": p["section"], "text": p["text"],
                                      "distance": m["distance"], "article": arts[other]}})

    with db.pool.cursor() as cur:
        rows, _ = db.timed(cur, STATUS_SQL, {"qid": qid, "lang": lang})
    status = {r["issue_id"]: {"status": r["status"], "note": r["note"]} for r in rows}
    order = {p["chunk_id"]: k for k, p in enumerate(passages)}
    issues.sort(key=lambda x: (order.get(x["chunk_id"], 10**6), x["start"] or 0))
    return {
        "wikidata_id": qid, "lang": lang, "article": me, "articles": list(arts.values()),
        "passages": passages, "issues": issues, "status": status,
        "pending": {"facts": not (f and f.get("facts")), "wording": not (w and w.get("differences") is not None),
                    "contradictions": c is None, "summaries": miss is None},
        "other_passages": {o: [{"chunk_id": p["chunk_id"], "chunk_idx": p["chunk_idx"], "section": p["section"], "text": p["text"],
                                "match_idx": (p["matches"].get(lang) or {}).get("chunk_idx"),
                                "distance": (p["matches"].get(lang) or {}).get("distance")}
                               for p in d["passages"]] for o, d in g["languages"].items() if o != lang},
        "covered": COVERED,
        "compare": {o: _compare_marks(f, w, lang, o, {lang: my_texts, o: {p["chunk_id"]: p["text"] for p in d["passages"]}})
                    for o, d in g["languages"].items() if o != lang},
    }


def set_status(qid: str, lang: str, issue_id: str, status: str, note: str | None) -> None:
    _ensure()
    with db.pool.cursor() as cur:
        cur.execute(STATUS_PUT_SQL, (qid, lang, issue_id[:190], status, (note or None) and note[:500]))


def status_history(qid: str, lang: str) -> dict:
    _ensure()
    with db.pool.cursor() as cur:
        rows, t = db.timed(cur, STATUS_HISTORY_SQL, {"qid": qid, "lang": lang})
    for r in rows:
        r["changed_at"] = r["changed_at"].isoformat()
    return {"history": rows, "sql": STATUS_HISTORY_SQL.replace("%(qid)s", repr(qid)).replace("%(lang)s", repr(lang)),
            "timings": {"sql_ms": round(t, 2)}}
