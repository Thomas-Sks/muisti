"""F7 — Where did this sentence come from? A "semantic blame" over the system-versioned history.

Given a paragraph of an article, find the first revision in which its *idea* appears — even if it was
worded differently then. Wikipedia's own blame tools (WikiBlame, Who Wrote That?) match exact text and
lose the trail at the first rewording.

Binary search over the article's versions (~12 steps for 3,000 versions). Each step reads one version
with FOR SYSTEM_TIME (KEY timeline), cleans it, and checks whether any paragraph is the same text or
close in meaning (bge-m3 cosine similarity >= THRESHOLD). Assumes that once added, the idea stays — the
result is the earliest version from which it is continuously present.
"""
from __future__ import annotations

import time
from functools import lru_cache

import numpy as np

from . import config, db
from .embed import embed
from .textproc import clean_wikitext
from .timemachine import _iso

HINT = f"/*+ MAX_EXECUTION_TIME({config.QUERY_TIMEOUT_MS}) */"
THRESHOLD = 0.86
CANDIDATES = 24        # paragraphs embedded per step, after a word-overlap pre-filter

VERSIONS_SQL = f"""SELECT {HINT} rev_id, ts, user, anonymous, comment
FROM revision WHERE page_id = %(page_id)s AND ts <= %(upto)s ORDER BY ts"""

TEXT_SQL = f"""SELECT {HINT} text FROM article_history FOR SYSTEM_TIME ALL
WHERE page_id = %(page_id)s AND row_start = %(ts)s"""


def _norm(s: str) -> str:
    return " ".join(s.lower().split())


@lru_cache(maxsize=4096)
def _paragraphs(page_id: int, ts) -> tuple[str, ...]:
    with db.pool.cursor() as cur:
        cur.execute(TEXT_SQL, {"page_id": page_id, "ts": ts})
        row = cur.fetchone()
    return tuple(t for kind, t in clean_wikitext(row["text"]) if kind != "h" and len(t.split()) >= 4) if row else ()


def _best_match(page_id: int, ts, target: str, target_vec: np.ndarray) -> tuple[float, str | None]:
    paras = _paragraphs(page_id, ts)
    if not paras:
        return 0.0, None
    t = _norm(target)
    for p in paras:                                  # exact (normalised) text: no embedding needed
        if t and t in _norm(p):
            return 1.0, p
    # Lexical pre-filter: only the paragraphs sharing the most words with the target are embedded.
    tw = set(t.split())
    ranked = sorted(paras, key=lambda p: -len(tw & set(_norm(p).split())))[:CANDIDATES]
    vecs = embed(ranked, batch_size=32, max_length=256)
    sims = vecs @ target_vec
    i = int(sims.argmax())
    return float(sims[i]), ranked[i]


def trace(page_id: int, text: str, upto: str | None = None) -> dict | None:
    """upto: only consider versions saved up to this moment (default: all)."""
    t0 = time.perf_counter()
    target = text.strip()[:2000]
    target_vec = embed([target], batch_size=1, max_length=256)[0]
    with db.pool.cursor() as cur:
        versions, t_sql = db.timed(cur, VERSIONS_SQL, {"page_id": page_id, "upto": upto or "2106-01-01 00:00:00"})
    if not versions:
        return None
    steps = []

    def present(i: int) -> bool:
        sim, para = _best_match(page_id, versions[i]["ts"], target, target_vec)
        steps.append({"index": i, "ts": _iso(versions[i]["ts"]), "similarity": round(sim, 3)})
        return sim >= THRESHOLD

    hi = len(versions) - 1
    if not present(hi):
        return {"found": False, "page_id": page_id, "versions": len(versions), "steps": steps,
                "message": "This passage is not in the article at that time (nothing similar enough).",
                "timings": {"total_s": round(time.perf_counter() - t0, 2)}}
    lo = 0
    while lo < hi:                                   # first index where present
        mid = (lo + hi) // 2
        if present(mid):
            hi = mid
        else:
            lo = mid + 1
    v = versions[lo]
    sim, first_wording = _best_match(page_id, v["ts"], target, target_vec)
    return {
        "found": True, "page_id": page_id, "versions": len(versions), "version_no": lo + 1,
        "origin": {"rev_id": v["rev_id"], "ts": _iso(v["ts"]), "user": v["user"], "anonymous": bool(v["anonymous"]),
                   "comment": v["comment"], "diff_url": f"https://fi.wikipedia.org/?diff={v['rev_id']}",
                   "oldid_url": f"https://fi.wikipedia.org/?oldid={v['rev_id']}"},
        "first_wording": first_wording, "similarity": round(sim, 3), "reworded": sim < 0.999,
        "steps": steps,
        "sql": VERSIONS_SQL.replace("%(page_id)s", str(page_id)) + "\n\n-- then, at each binary-search step:\n" + TEXT_SQL,
        "timings": {"total_s": round(time.perf_counter() - t0, 2), "versions_ms": round(t_sql, 1)},
    }
