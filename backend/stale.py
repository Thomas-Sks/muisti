"""Stale facts: when did the Finnish article start saying what it says now?

For every fact on which the editions differ (backend/topics.py facts), the Finnish value is looked up in
the article's full revision history (system-versioned table `article_history`, dataset M):

1. One SQL statement reads the version current at the end of each year (Sequence engine seq_2003_to_2026
   joined to FOR SYSTEM_TIME ALL, KEY timeline) and tests the value with a PCRE REGEXP inside MariaDB:
   the text never leaves the server.
2. A binary search over the revisions of the year it appeared finds the exact edit (date, editor, comment).
3. The sentence just before that edit shows what the article said earlier.

A value unchanged for years while the other editions say something else is worth re-checking. No LLM.
"""
from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from . import config, db
from .textproc import clean_wikitext
from .timemachine import _iso

HINT = f"/*+ MAX_EXECUTION_TIME({config.QUERY_TIMEOUT_MS}) */"
YEAR0, YEAR1 = 2003, 2026
STALE_YEARS = 4
# between two words of the value in raw wikitext: spaces, punctuation, &nbsp;, link brackets, "[[target|"
SEP = r"(?:&nbsp;|\[\[[^\]|]{0,60}\||[^[:alnum:]]){1,12}"

YEARS_SQL = f"""SELECT {HINT} y.seq AS year, h.rev_id, h.row_start AS ts, h.text REGEXP %(rx)s AS present
FROM seq_{YEAR0}_to_{YEAR1} y
JOIN article_history FOR SYSTEM_TIME ALL h
  ON h.page_id = %(page_id)s
 AND h.row_start <= TIMESTAMP(CONCAT(y.seq, '-12-31 23:59:59'))
 AND h.row_end   >  TIMESTAMP(CONCAT(y.seq, '-12-31 23:59:59'))
ORDER BY y.seq"""

REVS_SQL = f"""SELECT {HINT} rev_id, ts, user, anonymous, comment FROM revision
WHERE page_id = %(page_id)s AND ts > %(t0)s AND ts <= %(t1)s ORDER BY ts"""

HAS_SQL = f"""SELECT {HINT} text REGEXP %(rx)s AS present FROM article_history FOR SYSTEM_TIME ALL
WHERE page_id = %(page_id)s AND row_start = %(ts)s"""

TEXT_SQL = f"""SELECT {HINT} text FROM article_history FOR SYSTEM_TIME ALL
WHERE page_id = %(page_id)s AND row_start = %(ts)s"""

_WORD = re.compile(r"\w+", re.U)


def value_regex(quote: str) -> str | None:
    """The words of the quote from its first number to the word after its last number, as a PCRE that
    tolerates wikitext between them. None if the quote has no number."""
    toks = _WORD.findall(quote)
    idx = [i for i, t in enumerate(toks) if any(ch.isdigit() for ch in t)]
    if not idx:
        return None
    a, b = idx[0], idx[-1] + 1
    if b < len(toks) and not toks[b].isdigit():
        b += 1                                       # one word after the number makes it distinctive
    span = toks[a:min(b, a + 8)]
    if len(span) == 1 and len(span[0]) < 4:
        return None                                  # a lone short number matches everywhere
    rx = SEP.join(re.escape(t) for t in span)
    return ("(?<![0-9])" if span[0][0].isdigit() else r"\b") + rx


def _sentence_like(text: str, quote: str) -> str | None:
    """The sentence of a version closest in words to the quote (to show what the article said before)."""
    q = {w.lower() for w in _WORD.findall(quote) if not w.isdigit()}
    best, score = None, 0.0
    for kind, para in clean_wikitext(text):
        if kind == "h":
            continue
        for s in re.split(r"(?<=[.!?])\s+(?=[A-ZÄÖÅ])", para):     # "3. huhtikuuta" is not a sentence end
            w = {x.lower() for x in _WORD.findall(s) if not x.isdigit()}
            if not w:
                continue
            j = len(q & w) / len(q | w)
            if j > score:
                best, score = s, j
    if best is None or score < 0.3 or _norm(best) == _norm(quote):
        return None
    return best


def _norm(s: str) -> str:
    return " ".join(_WORD.findall(s.lower()))


def trace_value(page_id: int, quote: str) -> dict:
    rx = value_regex(quote)
    if rx is None:
        return {"traceable": False, "reason": "No number or date to look for."}
    t0 = time.perf_counter()
    with db.pool.cursor() as cur:
        cur.execute("SET time_zone = '+00:00'")
        years, t_years = db.timed(cur, YEARS_SQL, {"rx": rx, "page_id": page_id})
        strip = [{"year": y["year"], "present": bool(y["present"])} for y in years]
        if not years or not years[-1]["present"]:
            return {"traceable": False, "strip": strip, "regex": rx,
                    "reason": "The value is not in the latest Finnish revision in its exact wording."}
        # start of the last continuous run of years with the value
        k = len(years) - 1
        while k > 0 and years[k - 1]["present"]:
            k -= 1
        changes = sum(1 for i in range(1, len(years)) if years[i]["present"] != years[i - 1]["present"])
        before_ts = years[k - 1]["ts"] if k > 0 else datetime(2001, 1, 1)
        revs, _ = db.timed(cur, REVS_SQL, {"page_id": page_id, "t0": before_ts, "t1": years[k]["ts"]})
        # binary search: first revision of that window that has the value (absent at before_ts, present at the end)
        lo, hi, steps = 0, len(revs) - 1, 0
        while lo < hi:
            mid = (lo + hi) // 2
            cur.execute(HAS_SQL, {"rx": rx, "page_id": page_id, "ts": revs[mid]["ts"]})
            steps += 1
            if cur.fetchone()["present"]:
                hi = mid
            else:
                lo = mid + 1
        first = revs[lo] if revs else None
        before = None
        if first and k > 0:
            prev_ts = revs[lo - 1]["ts"] if lo > 0 else before_ts
            cur.execute(TEXT_SQL, {"page_id": page_id, "ts": prev_ts})
            row = cur.fetchone()
            before = _sentence_like(row["text"], quote) if row else None
    since = first["ts"] if first else years[k]["ts"]
    age = (datetime.now(timezone.utc).replace(tzinfo=None) - since).days / 365.25
    return {
        "traceable": True, "regex": rx, "strip": strip, "changes": changes,
        "since": _iso(since), "years_unchanged": round(age, 1), "stale": age >= STALE_YEARS,
        "first_in_history": k == 0,
        "edit": first and {"rev_id": first["rev_id"], "user": None if first["anonymous"] else first["user"],
                           "anonymous": bool(first["anonymous"]), "comment": first["comment"],
                           "diff_url": f"https://fi.wikipedia.org/?diff={first['rev_id']}"},
        "before": before, "search_steps": steps,
        "timings": {"years_sql_ms": round(t_years, 1), "total_ms": round((time.perf_counter() - t0) * 1000, 1)},
    }


CACHE_GET = "SELECT result FROM analysis WHERE kind = 'stale' AND wikidata_id = %s AND rev_key = %s"
CACHE_PUT = """INSERT INTO analysis (kind, wikidata_id, rev_key, model, result, input_tokens, output_tokens, seconds)
VALUES ('stale', %s, %s, 'sql', %s, NULL, NULL, %s)"""


def stale_facts(qid: str, refresh: bool = False) -> dict | None:
    from . import topics
    f = topics.facts(qid, cached_only=True)
    if f is None:
        return None
    if not f.get("available") or f.get("pending"):
        return {"available": False, "reason": "Compare the facts first: this check works on the facts that differ."}
    with db.pool.cursor() as cur:
        cur.execute("SELECT page_id, rev_id FROM article WHERE wikidata_id = %s AND lang = 'fi'", (qid,))
        fi = cur.fetchone()
        if not fi:
            return {"available": False, "reason": "There is no Finnish article for this topic."}
        cur.execute("SELECT COUNT(*) AS n FROM revision WHERE page_id = %s", (fi["page_id"],))
        if not cur.fetchone()["n"]:
            return {"available": False, "reason": "The history of this Finnish article is not in the dataset."}
        rk = f"fi:{fi['rev_id']}:{len(f['facts'])}:v2"
        if not refresh:
            cur.execute(CACHE_GET, (qid, rk))
            hit = cur.fetchone()
            if hit:
                return json.loads(hit["result"]) | {"cached": True}
    todo = []
    for fi_idx, x in enumerate(f["facts"]):
        v = next((v for v in x["values"] if v["lang"] == "fi" and v.get("verified")), None)
        if x["status"] == "differ" and v:
            todo.append((x | {"fact_index": fi_idx}, v))
    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=4) as ex:
        traces = list(ex.map(lambda xv: trace_value(fi["page_id"], xv[1]["quote"]), todo))
    items = [{"fact_index": x["fact_index"], "group_index": x["group_index"], "subject": x["subject"], "value": v["value"], "quote": v["quote"],
              "others": [{"lang": o["lang"], "value": o["value"]} for o in x["values"] if o["lang"] != "fi"], **t}
             for (x, v), t in zip(todo, traces)]
    items.sort(key=lambda i: (not i.get("stale", False), -(i.get("years_unchanged") or 0)))
    result = {"available": True, "page_id": fi["page_id"], "items": items, "stale_years": STALE_YEARS,
              "sql": YEARS_SQL.replace("%(rx)s", "<value as a PCRE>").replace("%(page_id)s", str(fi["page_id"])),
              "timings": {"total_s": round(time.perf_counter() - t0, 2)}}
    with db.pool.cursor() as cur:
        cur.execute(CACHE_PUT, (qid, rk, json.dumps(result, ensure_ascii=False, default=str), result["timings"]["total_s"]))
    return result | {"cached": False}
