"""What an edit war was actually about.

For one article and year, every revert between two named editors is replayed from the system-versioned
history: the version just before the revert vs the revert itself. The word-level difference is the text
being fought over. Reverts that toggle the same text back and forth are grouped into one "dispute".
"""
from __future__ import annotations

import difflib
import hashlib
import re
from functools import lru_cache

from . import config, db
from .textproc import clean_wikitext
from .timemachine import _iso

HINT = f"/*+ MAX_EXECUTION_TIME({config.QUERY_TIMEOUT_MS}) */"
CONTEXT_WORDS = 10
MAX_EVENTS = 60

WARS_SQL = f"""SELECT {HINT} w.page_id, h.title, w.year, w.controversy_m, w.mutual_pairs, w.named_reverts, w.edits, w.editors
FROM edit_war_year w
JOIN article_history h ON h.page_id = w.page_id
WHERE w.controversy_m > 0
ORDER BY w.controversy_m DESC, w.named_reverts DESC
LIMIT %(limit)s"""

EVENTS_SQL = f"""SELECT {HINT} r.rev_id, r.ts, r.user, r.reverted_user, r.comment,
       (SELECT p.ts FROM revision p WHERE p.page_id = r.page_id AND p.ts < r.ts ORDER BY p.ts DESC LIMIT 1) AS prev_ts
FROM revision r
WHERE r.page_id = %(page_id)s AND r.is_revert AND NOT r.anonymous AND NOT r.reverted_anonymous
  AND r.user <> r.reverted_user
  AND r.ts >= %(y0)s AND r.ts < %(y1)s
ORDER BY r.ts
LIMIT {MAX_EVENTS}"""

# Both versions of a revert in one read of the history, via KEY timeline (page_id, row_start, ...).
TEXTS_SQL = f"""SELECT {HINT} row_start, text FROM article_history FOR SYSTEM_TIME ALL
WHERE page_id = %(page_id)s AND row_start IN (%(a)s, %(b)s)"""

_MARKUP = [(re.compile(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]"), r"\1"), (re.compile(r"'''?"), ""),
           (re.compile(r"<[^>]+>"), " "), (re.compile(r"\{\{|\}\}"), " "), (re.compile(r"\s+"), " ")]


_WORDY = re.compile(r"[^\W_]{2,}", re.UNICODE)


def _plain(s: str) -> str:
    for rx, rep in _MARKUP:
        s = rx.sub(rep, s)
    return s.strip()


def _paragraphs(wikitext: str) -> list[str]:
    return [t for _, t in clean_wikitext(wikitext)]


def _hunks(old: str, new: str, max_hunks: int = 3) -> list[dict]:
    """Word-level changes between two versions, each with a few words of context."""
    a, b = _paragraphs(old), _paragraphs(new)
    if a == b:                       # the fight was in templates / infobox / links: compare raw lines
        a = [_plain(x) for x in old.split("\n") if x.strip()]
        b = [_plain(x) for x in new.split("\n") if x.strip()]
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == "equal":
            continue
        wa, wb = " ".join(a[i1:i2]).split(), " ".join(b[j1:j2]).split()
        for op2, x1, x2, y1, y2 in difflib.SequenceMatcher(None, wa, wb, autojunk=False).get_opcodes():
            if op2 == "equal":
                continue
            if not _WORDY.search(" ".join(wa[x1:x2]) + " ".join(wb[y1:y2])):
                continue                 # punctuation left over from stripped markup, e.g. "()" vs "(, )"
            out.append({
                "before": " ".join(wa[max(0, x1 - CONTEXT_WORDS):x1]),
                "removed": " ".join(wa[x1:x2])[:400],
                "added": " ".join(wb[y1:y2])[:400],
                "after": " ".join(wa[x2:x2 + CONTEXT_WORDS]),
            })
            if len(out) >= max_hunks:
                return out
    return out


def _dispute_key(h: dict) -> str:
    """Same text toggled in either direction -> same key."""
    # the first 60 characters of each side: the same sentence with a slightly different tail is one dispute
    pair = sorted([h["removed"].strip().lower()[:60], h["added"].strip().lower()[:60]])
    return hashlib.sha1("\x00".join(pair).encode()).hexdigest()[:16]


def wars(limit: int = 20) -> dict:
    with db.pool.cursor() as cur:
        rows, t = db.timed(cur, WARS_SQL, {"limit": limit})
    for r in rows:
        r["controversy_m"] = float(r["controversy_m"])
    return {"wars": rows, "sql": WARS_SQL.replace("%(limit)s", str(limit)), "timings": {"sql_ms": round(t, 2)}}


@lru_cache(maxsize=256)
def war(page_id: int, year: int) -> dict | None:
    params = {"page_id": page_id, "y0": f"{year}-01-01 00:00:00", "y1": f"{year + 1}-01-01 00:00:00"}
    with db.pool.cursor() as cur:
        title_rows, _ = db.timed(cur, "SELECT title FROM article_history WHERE page_id = %(page_id)s", params)
        if not title_rows:
            return None
        events, t_events = db.timed(cur, EVENTS_SQL, params)
        t_texts = 0.0
        for e in events:
            if e["prev_ts"] is None:
                e["hunks"] = []
                continue
            texts, tt = db.timed(cur, TEXTS_SQL, {"page_id": page_id, "a": e["prev_ts"], "b": e["ts"]})
            t_texts += tt
            by_ts = {r["row_start"]: r["text"] for r in texts}
            old, new = by_ts.get(e["prev_ts"], ""), by_ts.get(e["ts"], "")
            e["hunks"] = _hunks(old, new)

    disputes: dict[str, dict] = {}
    for e in events:
        if not e["hunks"]:
            continue
        h = e["hunks"][0]
        d = disputes.setdefault(_dispute_key(h), {"hunk": h, "events": [], "editors": set()})
        d["hunk"] = h                         # keep the latest orientation: what the last revert did
        d["events"].append(e)
        d["editors"].update(x for x in (e["user"], e["reverted_user"]) if x)

    out = []
    for key, d in disputes.items():
        ev = d["events"]
        out.append({
            "key": key, "toggles": len(ev), "editors": sorted(d["editors"]),
            "first": _iso(ev[0]["ts"]), "last": _iso(ev[-1]["ts"]), "hunk": d["hunk"],
            "final_rev": ev[-1]["rev_id"],
            "events": [{"rev_id": x["rev_id"], "ts": _iso(x["ts"]), "user": x["user"],
                        "reverted_user": x["reverted_user"], "comment": x["comment"]} for x in ev],
        })
    out.sort(key=lambda d: (-d["toggles"], d["first"]))
    return {
        "page_id": page_id, "title": title_rows[0]["title"], "year": year,
        "reverts": len(events), "disputes": out,
        "sql": EVENTS_SQL.replace("%(page_id)s", str(page_id)).replace("%(y0)s", f"'{params['y0']}'")
                         .replace("%(y1)s", f"'{params['y1']}'"),
        "sql_texts": TEXTS_SQL,
        "timings": {"events_ms": round(t_events, 2), "texts_ms": round(t_texts, 2)},
    }
