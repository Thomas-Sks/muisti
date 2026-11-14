"""Load dataset L (all 568,416 Finnish Wikipedia articles) with a stemmed copy, then build FULLTEXT on it.

    uv run python -m pipeline.load_l

Shows that the keyword side of the search scales from 19k (S) to 568k (L) articles. Vectors for L are a
GPU job of days on a laptop and are not computed here. Stemming runs on all CPU cores.
"""
from __future__ import annotations

import os
from multiprocessing import Pool

import pyarrow.parquet as pq

from backend import config
from backend.textproc import stem_text
from pipeline.common import Timer, batched_insert, connect


def _stem(row):
    return (row["page_id"], row["wikidata_id"], row["title"][:255], row["text"], stem_text(row["title"] + " " + row["text"], "fi"))


def main() -> None:
    con = connect(autocommit=False)
    cur = con.cursor()
    cur.execute("SELECT page_id FROM article_l")
    done = {r["page_id"] for r in cur.fetchall()}            # resumable
    pf = pq.ParquetFile(config.DATA_RAW / "l" / "articles-fi.parquet")
    total = len(done)
    if total < pf.metadata.num_rows:
        with Timer("load + stem 568k articles"), Pool(max(2, os.cpu_count() - 4)) as pool:
            for batch in pf.iter_batches(batch_size=20000, columns=["page_id", "wikidata_id", "title", "text"]):
                todo = [r for r in batch.to_pylist() if r["page_id"] not in done]
                if not todo:
                    continue
                rows = pool.map(_stem, todo, chunksize=200)
                total += batched_insert(con, """INSERT IGNORE INTO article_l (page_id, wikidata_id, title, text, text_stem)
                                                VALUES (%s,%s,%s,%s,%s)""", rows)
                print(f"  {total} articles", flush=True)
    with Timer("FULLTEXT index on 568k stemmed articles"):
        cur.execute("ALTER TABLE article_l ADD FULLTEXT INDEX IF NOT EXISTS ft_l (title, text_stem)")
    cur.execute("ANALYZE TABLE article_l PERSISTENT FOR ALL")
    cur.fetchall()
    cur.execute("SELECT COUNT(*) AS n FROM article_l")
    print("article_l rows:", cur.fetchone()["n"])
    con.close()


if __name__ == "__main__":
    main()
