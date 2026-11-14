"""SQL fact-check of what Claude quotes: every number and date it reports must exist in the Wikipedia passage.

Numbers and dates were extracted once from every passage, without any LLM, into chunk_number and chunk_date
(pipeline/extract_values.py). The same extractor reads Claude's quote; one query then confirms each value
is stored for that passage. A value Claude misread or invented is reported as not found.
"""
from __future__ import annotations

from pipeline.extract_values import dates_in, numbers_in

from . import config, db

HINT = f"/*+ MAX_EXECUTION_TIME({config.QUERY_TIMEOUT_MS}) */"

CHECK_SQL = f"""SELECT {HINT} chunk_id, 'n' AS kind, CAST(n AS CHAR) AS v FROM chunk_number WHERE chunk_id IN %(ids)s
UNION ALL
SELECT chunk_id, 'd', CAST(d AS CHAR) FROM chunk_date WHERE chunk_id IN %(ids)s"""


def check_many(items: list[tuple[int, str, str]]) -> tuple[list[dict], float]:
    """items: (chunk_id, lang, quote) → per item {"values": [{surface, value, kind, found}], "status"}.
    status: 'checked' (all found), 'mismatch' (one not found), 'none' (no number or date to check)."""
    ids = tuple({cid for cid, _, _ in items if cid is not None})
    stored: dict[int, set[tuple[str, str]]] = {}
    t = 0.0
    if ids:
        with db.pool.cursor() as cur:
            rows, t = db.timed(cur, CHECK_SQL, {"ids": ids})
        for r in rows:
            stored.setdefault(r["chunk_id"], set()).add((r["kind"], r["v"]))
    out = []
    for cid, lang, quote in items:
        have = stored.get(cid, set())
        values = [{"surface": s, "value": n, "kind": "number", "found": ("n", str(n)) in have} for n, s in numbers_in(quote or "")]
        values += [{"surface": s, "value": d.isoformat(), "kind": "date", "found": ("d", d.isoformat()) in have}
                   for d, s in dates_in(quote or "", lang)] if lang in ("fi", "sv", "en") else []
        status = "none" if not values else ("checked" if all(v["found"] for v in values) else "mismatch")
        out.append({"values": values, "status": status})
    return out, t


SQL_SHOWN = CHECK_SQL.replace("%(ids)s", "(<the passages Claude quoted>)")
