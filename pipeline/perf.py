"""Measure every hot query of the app (SKILL.md §0): ANALYZE FORMAT=JSON archived in perf/, latency p50/p95
over varied inputs, rows read vs rows returned. Writes perf/RESULTS.md (numbers for the README).

    uv run python -m pipeline.perf
"""
from __future__ import annotations

import json
import random
import statistics
import time
from pathlib import Path

from backend import db, search, timemachine
from backend.embed import embed
from pipeline.common import ROOT, connect

OUT = ROOT / "perf"
QUESTIONS = [
    "Which peace treaty ended the Winter War?", "Who was the president of Finland from 1956 to 1982?",
    "Vem ledde de vita i inbördeskriget 1918?", "Mitä tapahtui Tampereen taistelussa?",
    "Qui a dirigé la Finlande pendant la guerre d'Hiver ?", "When did Finland join the European Union?",
    "Lapuan liike ja Mäntsälän kapina", "Grand Duchy of Finland autonomy under Russia",
    "Suomen itsenäisyysjulistus 1917", "Karelian evacuees after the Continuation War",
    "Finlands språkstrid", "Kekkonen and the Soviet Union", "Prison camps after the civil war",
    "Turun palo 1827", "Helsingin olympialaiset 1952", "Paavo Nurmi", "Kalevala and national romanticism",
    "Jääkäriliike Saksassa", "Moscow Armistice 1944", "Women's suffrage in Finland 1906",
]


def pct(values: list[float], p: float) -> float:
    values = sorted(values)
    k = (len(values) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(values) - 1)
    return values[lo] + (values[hi] - values[lo]) * (k - lo)


def analyze(cur, sql: str, params: dict, name: str) -> dict:
    cur.execute("ANALYZE FORMAT=JSON " + sql, params)
    plan = json.loads(list(cur.fetchone().values())[0])
    (OUT / f"{name}.json").write_text(json.dumps(plan, indent=2))
    return plan


def time_runs(cur, sql: str, param_sets: list[dict]) -> tuple[list[float], int]:
    times, rows = [], 0
    for p in param_sets:
        t0 = time.perf_counter()
        cur.execute(sql, p)
        rows = len(cur.fetchall())
        times.append((time.perf_counter() - t0) * 1000)
    return times, rows


def main() -> None:
    OUT.mkdir(exist_ok=True)
    con = connect()
    cur = con.cursor()
    results = []

    vecs = embed(QUESTIONS, batch_size=16, max_length=512)
    from backend.textproc import boolean_query
    for mode in ("vector", "keyword", "hybrid"):
        sql = search.build_sql(mode, None)
        params = [{"q_vec": db.vec_literal(v), "q_terms": boolean_query(q) or "x", "lang": None, "limit": 40}
                  for q, v in zip(QUESTIONS, vecs)]
        time_runs(cur, sql, params[:3])                     # warm-up
        times, n = time_runs(cur, sql, params)
        analyze(cur, sql, params[0], f"search_{mode}")
        results.append((f"search · {mode}", len(params), times, n))

    # Scale: the same stemmed FULLTEXT query on dataset L (568,416 articles) vs passages of S.
    l_sql = """SELECT page_id, title, MATCH(title, text_stem) AGAINST (%(q_terms)s IN BOOLEAN MODE) AS s
               FROM article_l WHERE MATCH(title, text_stem) AGAINST (%(q_terms)s IN BOOLEAN MODE)
               ORDER BY s DESC LIMIT 20"""
    l_params = [{"q_terms": boolean_query(q) or "x"} for q in QUESTIONS]
    time_runs(cur, l_sql, l_params[:3])
    times, n = time_runs(cur, l_sql, l_params)
    analyze(cur, l_sql, l_params[0], "fulltext_dataset_L")
    results.append(("FULLTEXT · dataset L (568,416 articles)", len(l_params), times, n))

    cur.execute("SELECT page_id FROM article_history ORDER BY RAND(42) LIMIT 200")
    pages = [r["page_id"] for r in cur.fetchall()]
    rnd = random.Random(7)
    as_of_params = [{"page_id": p, "ts": f"{rnd.randint(2004, 2026)}-{rnd.randint(1, 12):02d}-15 12:00:00"} for p in pages]
    time_runs(cur, timemachine.AS_OF_SQL, as_of_params[:20])
    times, n = time_runs(cur, timemachine.AS_OF_SQL, as_of_params)
    analyze(cur, timemachine.AS_OF_SQL, {"page_id": 1150, "ts": "2005-06-01 00:00:00"}, "as_of_old_date")
    results.append(("AS OF (random article × date)", len(as_of_params), times, n))

    for name, sql in (("timeline monthly", timemachine.MONTHLY_SQL), ("edit-war years", timemachine.YEARLY_WAR_SQL)):
        times, n = time_runs(cur, sql, [{"page_id": p} for p in pages[:100]])
        analyze(cur, sql, {"page_id": 1150}, name.replace(" ", "_").replace("-", "_"))
        results.append((name, 100, times, n))

    times, n = time_runs(cur, timemachine.CONTROVERSIAL_SQL, [{"limit": 25}] * 10)
    analyze(cur, timemachine.CONTROVERSIAL_SQL, {"limit": 25}, "controversial")
    results.append(("controversy ranking (19,742 articles)", 10, times, n))

    cur.execute("SELECT VERSION() AS v")
    version = cur.fetchone()["v"]
    cur.execute("SELECT COUNT(*) AS n FROM revision")
    versions = cur.fetchone()["n"]
    cur.execute("SELECT COUNT(*) AS n FROM chunk_vector")
    vectors = cur.fetchone()["n"]
    lines = [
        "# Query performance", "",
        f"MariaDB {version} in Docker · {vectors:,} passage vectors · {versions:,} versions · "
        f"`mhnsw_ef_search=80`, `M=16`. Laptop: 12 cores, 15 GB RAM. Generated by `pipeline/perf.py`; "
        "each query's `ANALYZE FORMAT=JSON` is in this folder.", "",
        "| Query | Runs | p50 ms | p95 ms | max ms | rows returned (last run) |",
        "|---|---|---|---|---|---|",
    ]
    for name, runs, times, n in results:
        lines.append(f"| {name} | {runs} | {statistics.median(times):.2f} | {pct(times, 0.95):.2f} | {max(times):.2f} | {n} |")
    (OUT / "RESULTS.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    con.close()


if __name__ == "__main__":
    main()
