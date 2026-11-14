"""Muisti HTTP API (FastAPI). Run:  uv run uvicorn backend.api:app --port 8000"""
from __future__ import annotations

import logging
import time
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config, db, insights, search as search_mod, timemachine, wars as wars_mod

log = logging.getLogger("muisti")
app = FastAPI(title="Muisti: Wikipedia that remembers", version="0.2.0")


@app.on_event("startup")
def _warm_up() -> None:
    """Load the embedding model once at startup, so the first searches don't race to load it."""
    from .embed import embed_one
    embed_one("warm up")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


class SearchIn(BaseModel):
    q: str = Field(min_length=2, max_length=500)
    mode: Literal["vector", "keyword", "hybrid"] = "hybrid"
    lang: Literal["fi", "sv", "en"] | None = None
    limit: int = Field(30, ge=1, le=100)


@app.get("/api/health")
def health() -> dict:
    with db.pool.cursor() as cur:
        cur.execute("SELECT VERSION() AS v")
        version = cur.fetchone()["v"]
    return {"status": "ok", "mariadb": version}


_stats_cache: tuple[float, dict] | None = None


@app.get("/api/stats")
def stats() -> dict:
    """Dataset sizes, straight from MariaDB (shown on the landing page)."""
    q = {
        "articles_by_lang": "SELECT lang, COUNT(*) AS n FROM article GROUP BY lang",
        "passages": "SELECT COUNT(*) AS n FROM chunk",
        "passage_vectors": "SELECT COUNT(*) AS n FROM chunk_vector",
        "article_vectors": "SELECT COUNT(*) AS n FROM article_vector",
        "topics_all_three": """SELECT COUNT(*) AS n FROM (SELECT wikidata_id FROM article
                               WHERE wikidata_id IS NOT NULL GROUP BY wikidata_id HAVING COUNT(DISTINCT lang) = 3) t""",
        "history_articles": "SELECT COUNT(*) AS n FROM article_history",
        "versions": "SELECT COUNT(*) AS n FROM revision",
        "history_range": "SELECT MIN(ts) AS first, MAX(ts) AS last FROM revision",
    }
    global _stats_cache
    if _stats_cache and time.monotonic() - _stats_cache[0] < 600:      # counts change only on reload
        return _stats_cache[1]
    out = {}
    with db.pool.cursor() as cur:
        for k, sql in q.items():
            cur.execute(sql.replace("SELECT ", f"SELECT /*+ MAX_EXECUTION_TIME({config.QUERY_TIMEOUT_MS}) */ ", 1))
            rows = cur.fetchall()
            if k == "articles_by_lang":
                out[k] = {r["lang"]: r["n"] for r in rows}
            elif k == "history_range":
                out[k] = {kk: (vv.isoformat() if vv else None) for kk, vv in rows[0].items()}
            else:
                out[k] = rows[0]["n"]
    _stats_cache = (time.monotonic(), out)
    return out


@app.post("/api/search")
def search(body: SearchIn) -> dict:
    r = search_mod.search(body.q, body.mode, body.lang, body.limit)
    return {"query": r.query, "mode": r.mode, "groups": r.groups, "passages": r.passages,
            "sql": r.sql, "timings": r.timings}


@app.get("/api/articles")
def articles(prefix: str = Query(min_length=1, max_length=100)) -> list[dict]:
    return timemachine.find_articles(prefix)


@app.get("/api/articles/{page_id}/timeline")
def timeline(page_id: int) -> dict:
    t = timemachine.timeline(page_id)
    if t is None:
        raise HTTPException(404, "article not in the history dataset")
    return t


@app.get("/api/articles/{page_id}/as-of")
def as_of(page_id: int, ts: str = Query(..., description="YYYY[-MM[-DD[THH:MM[:SS]]]] UTC")) -> dict:
    try:
        r = timemachine.as_of(page_id, ts)
    except ValueError:
        raise HTTPException(422, "bad timestamp")
    if r is None:
        raise HTTPException(404, "no version at that time")
    return r


@app.get("/api/articles/{page_id}/diff")
def diff(page_id: int, ts_from: str = Query(..., alias="from"), ts_to: str = Query(..., alias="to")) -> dict:
    try:
        r = timemachine.diff(page_id, ts_from, ts_to)
    except ValueError:
        raise HTTPException(422, "bad timestamp")
    if r is None:
        raise HTTPException(404, "no version at one of those times")
    return r


@app.get("/api/editors/controversial")
def controversial(y0: int = Query(2003, ge=2001, le=2026), y1: int = Query(2026, ge=2001, le=2026),
                  limit: int = Query(25, ge=1, le=100)) -> dict:
    return timemachine.controversial(y0, y1, limit)


@app.get("/api/articles/{page_id}/facts")
def facts(page_id: int) -> dict:
    return insights.facts(page_id)


@app.get("/api/articles/{page_id}/facts/as-of")
def facts_as_of(page_id: int, said_at: str, event_date: str) -> dict:
    try:
        return insights.bitemporal(page_id, said_at, event_date)
    except ValueError:
        raise HTTPException(422, "bad date")


@app.get("/api/facts/most-revised")
def most_revised(limit: int = Query(20, ge=1, le=100)) -> dict:
    return insights.most_revised(limit)


@app.get("/api/articles/{page_id}/drift")
def drift(page_id: int) -> dict:
    return insights.drift(page_id)


class PastSearchIn(BaseModel):
    q: str = Field(min_length=2, max_length=500)
    year: int = Field(ge=2004, le=2026)


@app.post("/api/search/past")
def search_past(body: PastSearchIn) -> dict:
    return insights.search_past(body.q, body.year)


@app.get("/api/topics")
def topics(prefix: str = Query(min_length=2, max_length=100)) -> list[dict]:
    return insights.topics(prefix)


@app.get("/api/topics/{qid}/gaps")
def gaps(qid: str) -> dict:
    if not qid.startswith("Q") or not qid[1:].isdigit():
        raise HTTPException(422, "not a Wikidata id")
    g = insights.gaps(qid)
    if g is None:
        raise HTTPException(404, "unknown topic")
    return g


@app.get("/api/wars")
def wars(limit: int = Query(20, ge=1, le=50)) -> dict:
    return wars_mod.wars(limit)


@app.get("/api/wars/{page_id}/{year}")
def war(page_id: int, year: int) -> dict:
    if not 2001 <= year <= 2026:
        raise HTTPException(422, "year out of range")
    w = wars_mod.war(page_id, year)
    if w is None:
        raise HTTPException(404, "article not in the history dataset")
    return w


class CheckIn(BaseModel):
    q: str = Field(min_length=5, max_length=300)


@app.post("/api/check")
def check(body: CheckIn) -> dict:
    """F19: an LLM answers without sources; every claim is checked against Wikipedia passages in MariaDB."""
    import os
    import anthropic
    from . import llmcheck
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(503, "The AI check needs an Anthropic API key (ANTHROPIC_API_KEY in .env).")
    try:
        return llmcheck.check(body.q.strip())
    except anthropic.RateLimitError:
        raise HTTPException(429, "The AI service is busy right now. Try again in a minute.")
    except (anthropic.APIConnectionError, anthropic.APIStatusError) as e:
        log.warning("AI check failed: %s", e)
        raise HTTPException(502, "The AI service could not be reached. Try again.")
    except RuntimeError as e:
        raise HTTPException(422, str(e))


class OriginIn(BaseModel):
    text: str = Field(min_length=10, max_length=2000)
    upto: str | None = Field(None, max_length=19)


@app.post("/api/articles/{page_id}/origin")
def origin(page_id: int, body: OriginIn) -> dict:
    """F7: the first revision where this passage's idea appears (semantic blame over the history)."""
    from . import origin as origin_mod
    from .timemachine import _ts
    try:
        upto = _ts(body.upto) if body.upto else None
    except ValueError:
        raise HTTPException(422, "bad timestamp")
    r = origin_mod.trace(page_id, body.text, upto)
    if r is None:
        raise HTTPException(404, "article not in the history dataset")
    return r


@app.get("/api/contradictions/{lang}/{page_id}")
def contradictions(lang: Literal["fi", "sv", "en"], page_id: int) -> dict:
    """F8, on demand: passages of this article vs the closest passages of other articles, judged by Claude Sonnet."""
    import os
    import anthropic
    from . import contradictions as contra
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(503, "The contradiction check needs an Anthropic API key (ANTHROPIC_API_KEY in .env).")
    try:
        r = contra.find(lang, page_id)
    except anthropic.RateLimitError:
        raise HTTPException(429, "The AI service is busy right now. Try again in a minute.")
    except (anthropic.APIConnectionError, anthropic.APIStatusError) as e:
        log.warning("contradiction check failed: %s", e)
        raise HTTPException(502, "The AI service could not be reached. Try again.")
    except RuntimeError as e:
        raise HTTPException(422, str(e))
    if r is None:
        raise HTTPException(404, "article not in the dataset")
    return r


@app.get("/api/s-articles")
def s_articles(prefix: str = Query(min_length=2, max_length=100)) -> list[dict]:
    """Title search over dataset S (fi/sv/en) for the contradiction checker."""
    from .timemachine import like_escape
    with db.pool.cursor() as cur:
        cur.execute("""SELECT /*+ MAX_EXECUTION_TIME(3000) */ a.lang, a.page_id, a.title,
                              (SELECT COUNT(*) FROM chunk c WHERE c.lang = a.lang AND c.page_id = a.page_id) AS passages
                       FROM article a WHERE a.title LIKE %s ORDER BY a.text_len DESC LIMIT 12""",
                    (like_escape(prefix.strip()) + "%",))
        return list(cur.fetchall())


# ── Writer workspace ────────────────────────────────────────────────────────────

def _qid(qid: str) -> str:
    if not (qid.startswith("Q") and qid[1:].isdigit() and len(qid) <= 20):
        raise HTTPException(422, "not a Wikidata id")
    return qid


@app.get("/api/topics/search")
def topics_search(q: str = Query(min_length=2, max_length=200)) -> dict:
    from . import topics as topics_mod
    return topics_mod.search_topics(q)


@app.get("/api/topic/{qid}")
def topic(qid: str) -> dict:
    from . import topics as topics_mod
    r = topics_mod.overview(_qid(qid))
    if r is None:
        raise HTTPException(404, "unknown topic")
    return r


@app.get("/api/topic/{qid}/framing")
def topic_framing(qid: str, refresh: bool = False, cached_only: bool = False) -> dict:
    """Tone & framing across fi/sv/en. Computed on demand by Claude Sonnet, stored in MariaDB per revision set."""
    import os
    import anthropic
    from . import topics as topics_mod
    qid = _qid(qid)
    if not cached_only and not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(503, "The framing analysis needs an Anthropic API key (ANTHROPIC_API_KEY in .env).")
    try:
        r = topics_mod.framing(qid, refresh=refresh, cached_only=cached_only)
    except anthropic.RateLimitError:
        raise HTTPException(429, "The AI service is busy right now. Try again in a minute.")
    except (anthropic.APIConnectionError, anthropic.APIStatusError) as e:
        log.warning("framing failed: %s", e)
        raise HTTPException(502, "The AI service could not be reached. Try again.")
    except RuntimeError as e:
        raise HTTPException(422, str(e))
    if r is None:
        raise HTTPException(404, "unknown topic")
    return r



def _ai_call(fn):
    """Shared error mapping for on-demand Claude Sonnet analyses."""
    import os
    import anthropic
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(503, "This analysis needs an Anthropic API key (ANTHROPIC_API_KEY in .env).")
    try:
        return fn()
    except anthropic.RateLimitError:
        raise HTTPException(429, "The AI service is busy right now. Try again in a minute.")
    except (anthropic.APIConnectionError, anthropic.APIStatusError) as e:
        log.warning("AI analysis failed: %s", e)
        raise HTTPException(502, "The AI service could not be reached. Try again.")
    except RuntimeError as e:
        raise HTTPException(422, str(e))


@app.get("/api/topic/{qid}/facts")
def topic_facts(qid: str, refresh: bool = False, cached_only: bool = False) -> dict:
    """Facts compared across fi/sv/en (agree / differ / missing). On demand, stored per revision set."""
    from . import topics as topics_mod
    qid = _qid(qid)
    r = topics_mod.facts(qid, refresh, True) if cached_only else _ai_call(lambda: topics_mod.facts(qid, refresh))
    if r is None:
        raise HTTPException(404, "unknown topic")
    return r


@app.post("/api/passages/{chunk_id}/translate")
def translate(chunk_id: int) -> dict:
    from . import topics as topics_mod
    r = _ai_call(lambda: topics_mod.translate_passage(chunk_id))
    if r is None:
        raise HTTPException(404, "unknown passage")
    return r



@app.get("/api/topic/{qid}/missing")
def topic_missing(qid: str, target: Literal["fi", "sv", "en"]) -> dict:
    """One-line English summaries of what the other editions say and the target article doesn't."""
    from . import topics as topics_mod
    qid = _qid(qid)
    r = _ai_call(lambda: topics_mod.missing_summaries(qid, target))
    if r is None:
        raise HTTPException(404, "unknown topic or language")
    return r



@app.get("/api/related/{lang}/{page_id}")
def related(lang: Literal["fi", "sv", "en"], page_id: int, limit: int = Query(10, ge=1, le=20)) -> dict:
    """Articles closest in meaning to this one (same language), for the related-articles map."""
    from . import topics as topics_mod
    r = topics_mod.related(lang, page_id, limit)
    if r is None:
        raise HTTPException(404, "unknown article")
    return r


@app.get("/api/contradictions-stored/{lang}/{page_id}")
def contradictions_stored(lang: Literal["fi", "sv", "en"], page_id: int, refresh: bool = False) -> dict:
    """Possible contradictions between this article and others, stored in MariaDB per revision."""
    from . import topics as topics_mod
    r = _ai_call(lambda: topics_mod.contradictions_stored(lang, page_id, refresh))
    if r is None:
        raise HTTPException(404, "unknown article")
    return r



@app.get("/api/topic/{qid}/stale")
def topic_stale(qid: str, refresh: bool = False) -> dict:
    """For each fact that differs, when the Finnish article started saying its value (revision history)."""
    from . import stale
    r = stale.stale_facts(_qid(qid), refresh)
    if r is None:
        raise HTTPException(404, "unknown topic")
    return r
