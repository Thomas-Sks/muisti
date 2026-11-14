"""Time travel over the system-versioned article_history table (dataset M).

Every query is shown in the UI with its time. Timelines and analytics read the precomputed
`revision` / `edit_war_year` tables (history never changes), never the compressed text.
"""
from __future__ import annotations

import difflib
import re
from datetime import datetime

from . import config, db
from .textproc import clean_wikitext

HINT = f"/*+ MAX_EXECUTION_TIME({config.QUERY_TIMEOUT_MS}) */"

AS_OF_SQL = f"""SELECT {HINT} page_id, title, rev_id, parent_id, user, anonymous, comment, len, text,
       row_start, row_end
FROM article_history FOR SYSTEM_TIME AS OF TIMESTAMP %(ts)s
WHERE page_id = %(page_id)s"""

NEIGHBOURS_SQL = f"""SELECT {HINT}
  (SELECT ts FROM revision WHERE page_id = %(page_id)s AND ts < %(start)s ORDER BY ts DESC LIMIT 1) AS prev_ts,
  (SELECT ts FROM revision WHERE page_id = %(page_id)s AND ts > %(start)s ORDER BY ts LIMIT 1) AS next_ts,
  (SELECT COUNT(*) FROM revision WHERE page_id = %(page_id)s AND ts <= %(start)s) AS version_no,
  (SELECT COUNT(*) FROM revision WHERE page_id = %(page_id)s) AS versions"""

MONTHLY_SQL = f"""SELECT {HINT} DATE_FORMAT(ts, '%%Y-%%m') AS month,
       COUNT(*) AS edits,
       SUM(is_revert) AS reverts,
       SUM(is_revert AND NOT anonymous AND NOT reverted_anonymous) AS named_reverts,
       SUM(anonymous) AS anonymous_edits,
       COUNT(DISTINCT user) AS editors,
       MAX(len) AS len
FROM revision
WHERE page_id = %(page_id)s
GROUP BY month
ORDER BY month"""

YEARLY_WAR_SQL = f"""SELECT {HINT} year, edits, editors, reverts, named_reverts, mutual_pairs, controversy_m
FROM edit_war_year WHERE page_id = %(page_id)s ORDER BY year"""

REVERTS_SQL = f"""SELECT {HINT} rev_id, ts, user, anonymous, reverted_user, reverted_anonymous, comment, delta
FROM revision
WHERE page_id = %(page_id)s AND is_revert
ORDER BY ts DESC
LIMIT 50"""

TOP_EDITORS_SQL = f"""SELECT {HINT} user, anonymous, COUNT(*) AS edits, SUM(is_revert) AS reverts,
       MIN(ts) AS first_edit, MAX(ts) AS last_edit
FROM revision WHERE page_id = %(page_id)s
GROUP BY user, anonymous
ORDER BY edits DESC
LIMIT 12"""

ARTICLE_LOOKUP_SQL = f"""SELECT {HINT} h.page_id, h.title, h.len, h.row_start AS last_edit,
       (SELECT COUNT(*) FROM revision r WHERE r.page_id = h.page_id) AS versions,
       (SELECT MIN(ts) FROM revision r WHERE r.page_id = h.page_id) AS first_edit
FROM article_history h
WHERE h.page_id = %(page_id)s"""

# article_controversy holds one row per article with history and its revision count (edits): no COUNT per match.
TITLE_SEARCH_SQL = f"""SELECT {HINT} page_id, title, edits AS versions
FROM article_controversy
WHERE title LIKE %(prefix)s
ORDER BY edits DESC
LIMIT 12"""

CONTROVERSIAL_SQL = f"""SELECT {HINT} page_id, title, controversy_m, mutual_pairs, named_reverts, reverts, edits, peak_year
FROM article_controversy
ORDER BY controversy_m DESC, named_reverts DESC
LIMIT %(limit)s"""

HEATMAP_SQL = f"""SELECT {HINT} w.page_id, w.year, w.controversy_m, w.named_reverts, w.edits
FROM edit_war_year w
WHERE w.page_id IN ({{ids}})
ORDER BY w.page_id, w.year"""


def _ts(value: str) -> str:
    """'2015', '2015-06', '2015-06-01', '2015-06-01T12:00' -> 'YYYY-MM-DD HH:MM:SS' (TIMESTAMP ? refuses bare dates)."""
    v = value.strip().replace("T", " ")
    if re.fullmatch(r"\d{4}", v):
        v += "-01-01"
    elif re.fullmatch(r"\d{4}-\d{2}", v):
        v += "-01"
    v += {10: " 00:00:00", 16: ":00"}.get(len(v), "")
    datetime.strptime(v[:19], "%Y-%m-%d %H:%M:%S")      # validates
    return v[:19]


def like_escape(s: str) -> str:
    """User text inside LIKE: % and _ are literal characters, not wildcards."""
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else v


def _rows(rows):
    return [{k: _iso(v) for k, v in r.items()} for r in rows]


def as_of(page_id: int, ts: str) -> dict | None:
    """The version current at `ts`. Before the article existed, the first version is returned with a
    notice instead of an error (None only when the article is not in the dataset at all)."""
    ts = _ts(ts)
    notice = None
    with db.pool.cursor() as cur:
        rows, t_sql = db.timed(cur, AS_OF_SQL, {"ts": ts, "page_id": page_id})
        if not rows:
            first, _ = db.timed(cur, "SELECT MIN(ts) AS first FROM revision WHERE page_id = %(page_id)s", {"page_id": page_id})
            if not first or first[0]["first"] is None:
                return None
            notice = f"The article did not exist yet on {ts[:10]}; showing its first version."
            rows, t_sql = db.timed(cur, AS_OF_SQL, {"ts": first[0]["first"], "page_id": page_id})
            if not rows:
                return None
        v = rows[0]
        nb, t_nb = db.timed(cur, NEIGHBOURS_SQL, {"page_id": page_id, "start": v["row_start"]})
    blocks = clean_wikitext(v.pop("text"))
    return {
        "requested": ts,
        "notice": notice,
        "version": _rows([v])[0] | {"oldid_url": f"https://fi.wikipedia.org/?oldid={v['rev_id']}"},
        "neighbours": _rows(nb)[0],
        "blocks": [{"kind": k, "text": t} for k, t in blocks],
        "sql": AS_OF_SQL.replace("%(ts)s", f"'{ts}'").replace("%(page_id)s", str(page_id)),
        "timings": {"as_of_ms": round(t_sql, 2), "neighbours_ms": round(t_nb, 2)},
    }


def _words_diff(a: str, b: str) -> list[dict]:
    wa, wb = a.split(), b.split()
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, wa, wb, autojunk=False).get_opcodes():
        if op == "equal":
            out.append({"op": "eq", "text": " ".join(wa[i1:i2])})
        else:
            if i2 > i1:
                out.append({"op": "del", "text": " ".join(wa[i1:i2])})
            if j2 > j1:
                out.append({"op": "ins", "text": " ".join(wb[j1:j2])})
    return out


def diff(page_id: int, ts_from: str, ts_to: str) -> dict | None:
    a, b = as_of(page_id, ts_from), as_of(page_id, ts_to)
    if not a or not b:
        return None
    pa = [x["text"] for x in a["blocks"]]
    pb = [x["text"] for x in b["blocks"]]
    kinds_b = [x["kind"] for x in b["blocks"]]
    kinds_a = [x["kind"] for x in a["blocks"]]
    out, stats = [], {"unchanged": 0, "changed": 0, "added": 0, "removed": 0}
    def similar(x: str, y: str) -> float:
        m = difflib.SequenceMatcher(None, x.split(), y.split(), autojunk=False)
        return m.ratio() if m.quick_ratio() > 0.5 else 0.0

    sm = difflib.SequenceMatcher(None, pa, pb, autojunk=False)
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            stats["unchanged"] += i2 - i1
            out.append({"op": "same", "count": i2 - i1, "kind": "p"})
            continue
        # Pair edited paragraphs in order: each new paragraph takes the most similar old one among the
        # next few (ratio > 0.5) -> word-level diff; old paragraphs skipped over were removed.
        i = i1
        for j in range(j1, j2):
            best, best_k = 0.0, None
            for k in range(i, min(i2, i + 6)):
                r = similar(pa[k], pb[j])
                if r > best:
                    best, best_k = r, k
            if best_k is not None and best > 0.5:
                for k in range(i, best_k):
                    stats["removed"] += 1
                    out.append({"op": "removed", "kind": kinds_a[k], "text": pa[k]})
                stats["changed"] += 1
                out.append({"op": "changed", "kind": kinds_b[j], "words": _words_diff(pa[best_k], pb[j])})
                i = best_k + 1
            else:
                stats["added"] += 1
                out.append({"op": "added", "kind": kinds_b[j], "text": pb[j]})
        for k in range(i, i2):
            stats["removed"] += 1
            out.append({"op": "removed", "kind": kinds_a[k], "text": pa[k]})
    return {"from": a["version"], "to": b["version"], "stats": stats, "blocks": out,
            "timings": {"from_ms": a["timings"]["as_of_ms"], "to_ms": b["timings"]["as_of_ms"]}}


def timeline(page_id: int) -> dict | None:
    p = {"page_id": page_id}
    with db.pool.cursor() as cur:
        info, t0 = db.timed(cur, ARTICLE_LOOKUP_SQL, p)
        if not info:
            return None
        monthly, t1 = db.timed(cur, MONTHLY_SQL, p)
        yearly, t2 = db.timed(cur, YEARLY_WAR_SQL, p)
        reverts, t3 = db.timed(cur, REVERTS_SQL, p)
        editors, t4 = db.timed(cur, TOP_EDITORS_SQL, p)
    for m in monthly:
        for k in ("edits", "reverts", "named_reverts", "anonymous_edits", "editors", "len"):
            m[k] = int(m[k] or 0)
    for y in yearly:
        y["controversy_m"] = float(y["controversy_m"])
    return {
        "article": _rows(info)[0],
        "monthly": monthly,
        "yearly": _rows(yearly),
        "reverts": _rows(reverts),
        "editors": _rows(editors),
        "sql": {"monthly": MONTHLY_SQL.replace("%%", "%").replace("%(page_id)s", str(page_id)),
                "yearly": YEARLY_WAR_SQL.replace("%(page_id)s", str(page_id))},
        "timings": {k: round(v, 2) for k, v in
                    {"lookup_ms": t0, "monthly_ms": t1, "yearly_ms": t2, "reverts_ms": t3, "editors_ms": t4}.items()},
    }


def find_articles(prefix: str) -> list[dict]:
    with db.pool.cursor() as cur:
        rows, _ = db.timed(cur, TITLE_SEARCH_SQL, {"prefix": like_escape(prefix.strip()) + "%"})
    return rows


def controversial(y0: int = 2003, y1: int = 2026, limit: int = 25) -> dict:
    with db.pool.cursor() as cur:
        rows, t = db.timed(cur, CONTROVERSIAL_SQL, {"limit": limit})
        ids = [r["page_id"] for r in rows]
        heat = []
        if ids:
            heat, _ = db.timed(cur, HEATMAP_SQL.format(ids=",".join(str(int(i)) for i in ids)))
    for r in rows:
        for k in ("controversy_m",):
            r[k] = float(r[k] or 0)
        for k in ("mutual_pairs", "named_reverts", "reverts", "edits"):
            r[k] = int(r[k] or 0)
    for h in heat:
        h["controversy_m"] = float(h["controversy_m"])
    return {"articles": rows, "heatmap": heat,
            "sql": CONTROVERSIAL_SQL.replace("%(limit)s", str(limit)),
            "timings": {"sql_ms": round(t, 2)}}
