"""Yearly snapshots of the most edited articles, embedded: the bridge between time travel and search.

    uv run python -m pipeline.snapshots --top 200

For each article and each 1 January 2004–2026 (+ today), the version current at that moment is read
from the system-versioned table in ONE pass (FOR SYSTEM_TIME ALL joined to the snapshot moments),
cleaned, and embedded:
- snapshot: one vector per article-year (lead + first sections, 2,048 tokens) -> meaning drift;
- snapshot_chunk: passages for every 4th year + today -> "what did Wikipedia say in 2010?" search.
An unchanged version is embedded once and reused. Resumable per article.
"""
from __future__ import annotations

import argparse

from backend.embed import embed
from backend.textproc import chunk_markdown, embedding_input, wikitext_to_markdown
from pipeline.common import Timer, connect

NOW = 9999
CHUNK_YEARS = {2006, 2010, 2014, 2018, 2022, NOW}
KEY_PAGES = [1150, 1256, 440, 6021, 1275, 1069, 1137, 1187]   # civil war, winter war, continuation war, presidents

SNAP_SQL = """
SELECT y.year, h.rev_id, h.row_start, h.len, h.title, h.text
FROM article_history FOR SYSTEM_TIME ALL AS h
JOIN snapshot_year y ON h.row_start <= y.t AND h.row_end > y.t
WHERE h.page_id = %s
UNION ALL
SELECT 9999, rev_id, row_start, len, title, text FROM article_history WHERE page_id = %s
ORDER BY 1"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=200)
    args = ap.parse_args()
    con = connect(autocommit=False)
    cur = con.cursor()
    cur.execute("SELECT page_id FROM revision GROUP BY page_id ORDER BY COUNT(*) DESC LIMIT %s", (args.top,))
    pages = list(dict.fromkeys(KEY_PAGES + [r["page_id"] for r in cur.fetchall()]))
    cur.execute("SELECT DISTINCT page_id FROM snapshot")
    done = {r["page_id"] for r in cur.fetchall()}
    cur.execute("SELECT COALESCE(MAX(snap_chunk_id), 0) AS m FROM snapshot_chunk")
    next_chunk = cur.fetchone()["m"] + 1
    with Timer(f"snapshots of {len(pages)} articles"):
        for n, page_id in enumerate(pages, 1):
            if page_id in done:
                continue
            cur.execute(SNAP_SQL, (page_id, page_id))
            snaps = cur.fetchall()
            if not snaps:
                continue
            md_by_rev = {s["rev_id"]: wikitext_to_markdown(s["text"], s["title"]) for s in snaps}
            revs = list(md_by_rev)
            doc_vecs = dict(zip(revs, embed([md_by_rev[r] for r in revs], batch_size=4, max_length=2048)))
            cur.executemany("""INSERT INTO snapshot (page_id, year, rev_id, ts, len, embedding)
                               VALUES (%s,%s,%s,%s,%s,%s)""",
                            [(page_id, s["year"], s["rev_id"], s["row_start"], s["len"], doc_vecs[s["rev_id"]].tobytes())
                             for s in snaps])
            rows, texts = [], []
            for s in snaps:
                if s["year"] not in CHUNK_YEARS:
                    continue
                for c in chunk_markdown(s["title"], md_by_rev[s["rev_id"]]):
                    rows.append((page_id, s["year"], s["rev_id"], c.idx, (c.section or "")[:255] or None, c.text))
                    texts.append(embedding_input(s["title"], c.section, c.text))
            if rows:
                vecs = embed(texts, batch_size=64, max_length=512)
                cur.executemany("""INSERT INTO snapshot_chunk
                                   (snap_chunk_id, page_id, year, rev_id, chunk_idx, section, text, embedding)
                                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                                [(next_chunk + i, *r, v.tobytes()) for i, (r, v) in enumerate(zip(rows, vecs))])
                next_chunk += len(rows)
            con.commit()
            print(f"  {n}/{len(pages)} page {page_id}: {len(snaps)} snapshots, {len(set(revs))} distinct versions, {len(rows)} passages", flush=True)
    con.close()


if __name__ == "__main__":
    main()
