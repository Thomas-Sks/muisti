"""Embed every passage (chunk) with bge-m3 on the GPU and store it in chunk_vector.

    uv run python -m pipeline.embed_chunks            # all passages not embedded yet
    uv run python -m pipeline.embed_chunks --limit 2000

"Has a row in chunk_vector" = "is embedded", so the job can stop and restart at any time and search
works meanwhile on whatever is committed. Passages are embedded sorted by length (less padding).
"""
from __future__ import annotations

import argparse
import time

from backend.embed import embed
from backend.textproc import embedding_input
from pipeline.common import Timer, connect

READ = 4096      # passages fetched per round
BATCH = 64       # passages per GPU batch


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    con = connect(autocommit=False)
    cur = con.cursor()
    cur.execute("""SELECT COUNT(*) AS n FROM chunk c LEFT JOIN chunk_vector v USING (chunk_id)
                   WHERE v.chunk_id IS NULL""")
    todo = cur.fetchone()["n"]
    print(f"passages to embed: {todo}")
    done = 0
    t0 = time.perf_counter()
    with Timer("embed passages"):
        while True:
            cur.execute("""SELECT c.chunk_id, c.section, c.text, a.title
                           FROM chunk c
                           JOIN article a ON a.lang = c.lang AND a.page_id = c.page_id
                           LEFT JOIN chunk_vector v ON v.chunk_id = c.chunk_id
                           WHERE v.chunk_id IS NULL
                           ORDER BY c.chunk_id
                           LIMIT %s""", (READ,))
            rows = cur.fetchall()
            if not rows:
                break
            rows.sort(key=lambda r: len(r["text"]))
            vecs = embed([embedding_input(r["title"], r["section"], r["text"]) for r in rows],
                         batch_size=BATCH, max_length=512)
            cur.executemany("INSERT INTO chunk_vector (chunk_id, embedding) VALUES (%s, %s)",
                            [(r["chunk_id"], v.tobytes()) for r, v in zip(rows, vecs)])
            con.commit()
            done += len(rows)
            rate = done / (time.perf_counter() - t0)
            print(f"  {done}/{todo}  {rate:.0f} passages/s  ETA {(todo - done) / max(rate, 1e-9) / 60:.1f} min", flush=True)
            if args.limit and done >= args.limit:
                break
    con.close()


if __name__ == "__main__":
    main()
