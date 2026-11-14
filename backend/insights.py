"""Differentiating views: bitemporal facts, meaning drift, search in the past, cross-language gaps.

As much as possible happens in SQL: bitemporal filters, VEC_DISTANCE_COSINE between yearly snapshots,
vector search over snapshot passages. Only the cross-language alignment (a small n×m similarity matrix
for one topic) is done in numpy.
"""
from __future__ import annotations

import numpy as np

from . import config, db
from .embed import embed_one
from .timemachine import _rows, _ts, like_escape

HINT = f"/*+ MAX_EXECUTION_TIME({config.QUERY_TIMEOUT_MS}) */"

# ── Bitemporal facts ────────────────────────────────────────────────────────────

FACT_HISTORY_SQL = f"""SELECT {HINT} field, value, num, rev_id, valid_from, valid_to, valid_known, row_start, row_end
FROM fact FOR SYSTEM_TIME ALL
WHERE page_id = %(page_id)s
ORDER BY field, row_start"""

# What did Wikipedia state at moment `said_at` about the period that includes `event_date`?
BITEMPORAL_SQL = f"""SELECT {HINT} field, value, num, rev_id, valid_from, valid_to, row_start, row_end
FROM fact FOR SYSTEM_TIME AS OF TIMESTAMP %(said_at)s
WHERE page_id = %(page_id)s
  AND valid_from <= %(event_date)s AND valid_to > %(event_date)s
ORDER BY field"""

MOST_REVISED_SQL = f"""SELECT {HINT} f.page_id, h.title, f.field,
       COUNT(*) AS versions, COUNT(DISTINCT f.num) AS distinct_numbers,
       MIN(f.num) AS min_num, MAX(f.num) AS max_num,
       MIN(f.row_start) AS first_stated, MAX(f.row_start) AS last_changed
FROM fact FOR SYSTEM_TIME ALL AS f
JOIN article_history h ON h.page_id = f.page_id
WHERE f.field IN ('tappiot1', 'tappiot2', 'vahvuus1', 'vahvuus2')
GROUP BY f.page_id, h.title, f.field
HAVING COUNT(DISTINCT f.num) > 1
ORDER BY versions DESC
LIMIT %(limit)s"""

FIELD_LABEL = {
    "päivämäärä": "Date", "paikka": "Place", "tulos": "Result", "osapuoli1": "Side 1", "osapuoli2": "Side 2",
    "komentaja1": "Commanders, side 1", "komentaja2": "Commanders, side 2", "vahvuus1": "Strength, side 1",
    "vahvuus2": "Strength, side 2", "tappiot1": "Casualties, side 1", "tappiot2": "Casualties, side 2",
}


def facts(page_id: int) -> dict:
    with db.pool.cursor() as cur:
        rows, t = db.timed(cur, FACT_HISTORY_SQL, {"page_id": page_id})
    fields: dict[str, dict] = {}
    for r in _rows(rows):
        f = fields.setdefault(r["field"], {"field": r["field"], "label": FIELD_LABEL.get(r["field"], r["field"]), "runs": []})
        f["runs"].append(r)
    for f in fields.values():
        f["changes"] = len(f["runs"]) - 1
        f["current"] = f["runs"][-1]["value"] if f["runs"] and f["runs"][-1]["row_end"][:4] > "2100" else None
    order = list(FIELD_LABEL)
    return {"fields": sorted(fields.values(), key=lambda f: order.index(f["field"]) if f["field"] in order else 99),
            "sql": FACT_HISTORY_SQL.replace("%(page_id)s", str(page_id)), "timings": {"sql_ms": round(t, 2)}}


def bitemporal(page_id: int, said_at: str, event_date: str) -> dict:
    said = _ts(said_at)
    ev = _ts(event_date)[:10]
    with db.pool.cursor() as cur:
        rows, t = db.timed(cur, BITEMPORAL_SQL, {"page_id": page_id, "said_at": said, "event_date": ev})
    for r in rows:
        r["label"] = FIELD_LABEL.get(r["field"], r["field"])
    return {"said_at": said, "event_date": ev, "facts": _rows(rows),
            "sql": BITEMPORAL_SQL.replace("%(said_at)s", f"'{said}'").replace("%(event_date)s", f"'{ev}'")
                   .replace("%(page_id)s", str(page_id)),
            "timings": {"sql_ms": round(t, 2)}}


def most_revised(limit: int = 20) -> dict:
    with db.pool.cursor() as cur:
        rows, t = db.timed(cur, MOST_REVISED_SQL, {"limit": limit})
    for r in rows:
        r["label"] = FIELD_LABEL.get(r["field"], r["field"])
    return {"facts": _rows(rows), "sql": MOST_REVISED_SQL.replace("%(limit)s", str(limit)), "timings": {"sql_ms": round(t, 2)}}


# ── Meaning drift (yearly snapshots) ────────────────────────────────────────────

DRIFT_SQL = f"""SELECT {HINT} a.year, a.rev_id, a.ts, a.len,
       VEC_DISTANCE_COSINE(a.embedding, p.embedding) AS d_prev,
       VEC_DISTANCE_COSINE(a.embedding, n.embedding) AS d_now
FROM snapshot a
LEFT JOIN snapshot p ON p.page_id = a.page_id AND p.year = a.year - 1
JOIN snapshot n ON n.page_id = a.page_id AND n.year = 9999
WHERE a.page_id = %(page_id)s AND a.year < 9999
ORDER BY a.year"""


def drift(page_id: int) -> dict:
    with db.pool.cursor() as cur:
        rows, t = db.timed(cur, DRIFT_SQL, {"page_id": page_id})
    for r in rows:
        r["d_prev"] = float(r["d_prev"]) if r["d_prev"] is not None else None
        r["d_now"] = float(r["d_now"])
    return {"years": _rows(rows), "sql": DRIFT_SQL.replace("%(page_id)s", str(page_id)), "timings": {"sql_ms": round(t, 2)}}


# ── Search what Wikipedia said in a given year ──────────────────────────────────
# Over-fetch from the vector index, then filter on the year (MariaDB post-filters vector results).

PAST_SEARCH_SQL = f"""SELECT {HINT} s.snap_chunk_id, s.page_id, s.year, s.rev_id, s.section, s.text, h.title, x.d
FROM (SELECT snap_chunk_id, year, VEC_DISTANCE_COSINE(embedding, VEC_FromText(%(q_vec)s)) AS d
      FROM snapshot_chunk
      ORDER BY d
      LIMIT 400) x
JOIN snapshot_chunk s ON s.snap_chunk_id = x.snap_chunk_id
JOIN article_history h ON h.page_id = s.page_id
WHERE x.year = %(year)s
ORDER BY x.d
LIMIT %(limit)s"""

# The closest passage of the same article today. `ORDER BY d + 0` deliberately keeps MariaDB off the
# vector index (an expression is not the index's ORDER BY shape) so the WHERE on (page_id, year) uses
# the unique key and the result is exact over that article's ~100 passages.
NOW_COUNTERPART_SQL = f"""SELECT {HINT} snap_chunk_id, section, text, rev_id,
       VEC_DISTANCE_COSINE(embedding, (SELECT embedding FROM snapshot_chunk WHERE snap_chunk_id = %(id)s)) AS d
FROM snapshot_chunk
WHERE page_id = %(page_id)s AND year = 9999
ORDER BY d + 0
LIMIT 1"""


def search_past(query: str, year: int, limit: int = 8) -> dict:
    vec = db.vec_literal(embed_one(query))
    with db.pool.cursor() as cur:
        rows, t = db.timed(cur, PAST_SEARCH_SQL, {"q_vec": vec, "year": year, "limit": limit})
        t2 = 0.0
        for r in rows:
            now, tt = db.timed(cur, NOW_COUNTERPART_SQL, {"id": r["snap_chunk_id"], "page_id": r["page_id"]})
            t2 += tt
            r["now"] = now[0] if now else None
            if r["now"]:
                r["now"]["d"] = float(r["now"]["d"])
            r["d"] = float(r["d"])
            r["oldid_url"] = f"https://fi.wikipedia.org/?oldid={r['rev_id']}"
    shown = PAST_SEARCH_SQL.replace("%(q_vec)s", "VEC_FromText('[…1024 floats…]')").replace("%(year)s", str(year)).replace("%(limit)s", str(limit))
    return {"query": query, "year": year, "results": _rows(rows), "sql": shown, "sql_now": NOW_COUNTERPART_SQL,
            "timings": {"search_ms": round(t, 2), "now_ms": round(t2, 2)}}


# ── Cross-language gaps for one topic ───────────────────────────────────────────

TOPIC_SQL = f"""SELECT {HINT} a.lang, a.page_id, a.title, a.url, a.rev_id
FROM article a WHERE a.wikidata_id = %(qid)s"""

TOPIC_CHUNKS_SQL = f"""SELECT {HINT} c.chunk_id, c.lang, c.chunk_idx, c.section, c.text, v.embedding
FROM chunk c JOIN chunk_vector v ON v.chunk_id = c.chunk_id
JOIN article a ON a.lang = c.lang AND a.page_id = c.page_id
WHERE a.wikidata_id = %(qid)s
ORDER BY c.lang, c.chunk_idx"""

# Matching topics first (scan of the narrow title_qid index, never the text), then their three editions.
TOPICS_SQL = f"""WITH m AS (SELECT DISTINCT wikidata_id FROM article WHERE title LIKE %(p)s AND wikidata_id IS NOT NULL)
SELECT {HINT} fi.wikidata_id, fi.title AS fi_title, sv.title AS sv_title, en.title AS en_title,
       fi.text_len AS fi_len, sv.text_len AS sv_len, en.text_len AS en_len
FROM m
JOIN article fi ON fi.wikidata_id = m.wikidata_id AND fi.lang = 'fi'
JOIN article sv ON sv.wikidata_id = m.wikidata_id AND sv.lang = 'sv'
JOIN article en ON en.wikidata_id = m.wikidata_id AND en.lang = 'en'
ORDER BY fi.text_len + sv.text_len + en.text_len DESC
LIMIT 15"""

COVERED = 0.40     # cosine distance above which a passage has no counterpart. Calibrated on Talvisota: cross-language median is 0.31-0.35; > 0.40 = language-specific content (medals, art, local detail)


def topics(prefix: str) -> list[dict]:
    with db.pool.cursor() as cur:
        rows, _ = db.timed(cur, TOPICS_SQL, {"p": f"%{like_escape(prefix.strip())}%"})
    return rows


def gaps(qid: str) -> dict | None:
    with db.pool.cursor() as cur:
        arts, t1 = db.timed(cur, TOPIC_SQL, {"qid": qid})
        if not arts:
            return None
        chunks, t2 = db.timed(cur, TOPIC_CHUNKS_SQL, {"qid": qid})
    by_lang: dict[str, list[dict]] = {}
    for c in chunks:
        c["vec"] = np.frombuffer(c.pop("embedding"), dtype=np.float32)
        by_lang.setdefault(c["lang"], []).append(c)
    langs = sorted(by_lang)
    out = {}
    for la in langs:
        items = []
        A = np.stack([c["vec"] for c in by_lang[la]])
        best = {}
        for lb in langs:
            if lb == la:
                continue
            B = np.stack([c["vec"] for c in by_lang[lb]])
            sim = A @ B.T
            j = sim.argmax(axis=1)
            best[lb] = [(1 - float(sim[i, j[i]]), by_lang[lb][j[i]]) for i in range(len(A))]
        for i, c in enumerate(by_lang[la]):
            matches = {lb: {"distance": round(d, 3), "chunk_idx": m["chunk_idx"], "section": m["section"],
                            "text": m["text"][:400]} for lb, (d, m) in ((lb, best[lb][i]) for lb in best)}
            items.append({"chunk_id": c["chunk_id"], "chunk_idx": c["chunk_idx"], "section": c["section"], "text": c["text"],
                          "matches": matches,
                          "only_here": all(m["distance"] > COVERED for m in matches.values()) if matches else False})
        out[la] = {"passages": items, "unique": sum(x["only_here"] for x in items), "total": len(items)}
    return {"wikidata_id": qid, "articles": arts, "languages": out, "threshold": COVERED,
            "sql": TOPIC_CHUNKS_SQL.replace("%(qid)s", repr(qid)), "timings": {"sql_ms": round(t1 + t2, 2)}}
