"""Cross-language passage search: vector, keyword (stemmed FULLTEXT) and hybrid (RRF), all in SQL.

Query shapes follow .claude/skills/mariadb-wiki-sql/SKILL.md:
- the vector branch is `ORDER BY VEC_DISTANCE_COSINE(embedding, <const>) LIMIT n` directly on the
  indexed table, inside a derived table (otherwise MariaDB scans every row);
- each branch is capped at its own top N before fusion;
- filters (language) are applied after over-fetching, because MariaDB post-filters vector results.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

from . import config, db
from .embed import embed_one
from .textproc import boolean_query

RRF_K = 60
BRANCH_N = 100          # candidates per branch before fusion
KEYWORD_WEIGHT = 0.35   # weighted RRF: full-text counts less. Sweep on the 37 official questions: 0.35 -> best hit@10 (92%)
HINT = f"/*+ MAX_EXECUTION_TIME({config.QUERY_TIMEOUT_MS}) */"

VECTOR_BRANCH = """
  SELECT chunk_id, ROW_NUMBER() OVER (ORDER BY d) AS r, d
  FROM (SELECT chunk_id, VEC_DISTANCE_COSINE(embedding, VEC_FromText(%(q_vec)s)) AS d
        FROM chunk_vector
        ORDER BY d
        LIMIT {n}) x"""

KEYWORD_BRANCH = """
  SELECT chunk_id, ROW_NUMBER() OVER (ORDER BY s DESC) AS r, s
  FROM (SELECT chunk_id, MATCH(text_stem) AGAINST (%(q_terms)s IN BOOLEAN MODE) AS s
        FROM chunk
        WHERE MATCH(text_stem) AGAINST (%(q_terms)s IN BOOLEAN MODE)
        ORDER BY s DESC
        LIMIT {n}) y"""

DISPLAY = """
SELECT c.chunk_id, c.lang, c.page_id, c.chunk_idx, c.section, c.text,
       a.title, a.url, a.rev_id, a.wikidata_id, a.date_modified,
       f.score, f.v_rank, f.k_rank, f.distance
FROM fused f
JOIN chunk c   ON c.chunk_id = f.chunk_id
JOIN article a ON a.lang = c.lang AND a.page_id = c.page_id
{lang_filter}
ORDER BY f.score DESC
LIMIT %(limit)s"""


def build_sql(mode: str, lang: str | None, kw_weight: float = KEYWORD_WEIGHT) -> str:
    lang_filter = "WHERE c.lang = %(lang)s" if lang else ""
    if mode == "vector":
        fused = f"""fused AS (SELECT chunk_id, 1.0 / ({RRF_K} + r) AS score, r AS v_rank,
                            CAST(NULL AS UNSIGNED) AS k_rank, d AS distance FROM v)"""
        ctes = f"WITH v AS ({VECTOR_BRANCH.format(n=BRANCH_N)}),\n{fused}"
    elif mode == "keyword":
        fused = f"""fused AS (SELECT chunk_id, 1.0 / ({RRF_K} + r) AS score, CAST(NULL AS UNSIGNED) AS v_rank,
                            r AS k_rank, CAST(NULL AS DOUBLE) AS distance FROM k)"""
        ctes = f"WITH k AS ({KEYWORD_BRANCH.format(n=BRANCH_N)}),\n{fused}"
    elif mode == "hybrid":
        fused = f"""fused AS (
  SELECT chunk_id, SUM(IF(src = 'v', 1.0, {kw_weight:.3f}) / ({RRF_K} + r)) AS score,
         MAX(IF(src = 'v', r, NULL)) AS v_rank, MAX(IF(src = 'k', r, NULL)) AS k_rank,
         MAX(d) AS distance
  FROM (SELECT chunk_id, r, d, 'v' AS src FROM v
        UNION ALL
        SELECT chunk_id, r, NULL, 'k' FROM k) u
  GROUP BY chunk_id)"""
        ctes = (f"WITH v AS ({VECTOR_BRANCH.format(n=BRANCH_N)}),\n"
                f"k AS ({KEYWORD_BRANCH.format(n=BRANCH_N)}),\n{fused}")
    else:
        raise ValueError(f"unknown mode {mode!r}")
    return ctes + DISPLAY.replace("SELECT c.chunk_id", f"SELECT {HINT} c.chunk_id", 1).format(lang_filter=lang_filter)


@dataclass
class SearchResult:
    query: str
    mode: str
    passages: list[dict]
    groups: list[dict]
    sql: str
    timings: dict = field(default_factory=dict)


def _group(passages: list[dict]) -> list[dict]:
    """One card per topic: fi/sv/en passages about the same Wikidata item count as one result."""
    groups: dict[str, dict] = {}
    for p in passages:
        key = p["wikidata_id"] or f"{p['lang']}:{p['page_id']}"
        g = groups.get(key)
        if g is None:
            g = groups[key] = {"key": key, "wikidata_id": p["wikidata_id"], "score": p["score"],
                               "best": p, "by_lang": {}}
        g["by_lang"].setdefault(p["lang"], p)
    return sorted(groups.values(), key=lambda g: -g["score"])


def search(query: str, mode: str = "hybrid", lang: str | None = None, limit: int = 30) -> SearchResult:
    query = query.strip()
    t0 = time.perf_counter()
    q_vec = db.vec_literal(embed_one(query)) if mode in ("vector", "hybrid") else None
    t_embed = (time.perf_counter() - t0) * 1000
    q_terms = boolean_query(query) if mode in ("keyword", "hybrid") else None
    if mode == "keyword" and not q_terms:
        return SearchResult(query, mode, [], [], "", {"embed_ms": 0, "sql_ms": 0})
    if mode == "hybrid" and not q_terms:
        mode = "vector"          # nothing to match by keyword (e.g. only short words)
    sql = build_sql(mode, lang)
    params = {"q_vec": q_vec, "q_terms": q_terms, "lang": lang, "limit": limit}
    with db.pool.cursor() as cur:
        rows, t_sql = db.timed(cur, sql, params)
    for r in rows:
        r["score"] = float(r["score"])
        r["distance"] = float(r["distance"]) if r["distance"] is not None else None
        r["oldid_url"] = f"https://{r['lang']}.wikipedia.org/?oldid={r['rev_id']}"
        if r["date_modified"] is not None:
            r["date_modified"] = r["date_modified"].isoformat()
    shown = sql.replace("%(q_vec)s", "VEC_FromText('[…1024 floats…]')").replace(
        "%(q_terms)s", repr(q_terms or "")).replace("%(lang)s", repr(lang)).replace("%(limit)s", str(limit))
    return SearchResult(query, mode, rows, _group(rows), shown,
                        {"embed_ms": round(t_embed, 1), "sql_ms": round(t_sql, 1)})
