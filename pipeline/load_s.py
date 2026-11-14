"""Load dataset S (History of Finland, fi/sv/en, current text) into MariaDB.

    uv run python -m pipeline.load_s            # schema, articles, vectors, categories, passages

Creates the schema, loads 29,460 articles with their ready-made bge-m3 vectors and the category tree,
then cuts every article into passages (chunk) with a stemmed copy for FULLTEXT. Passage vectors are
computed by pipeline.embed_chunks (GPU). Safe to run again: existing rows are kept (INSERT IGNORE).
"""
from __future__ import annotations

import csv

import numpy as np
import pyarrow.parquet as pq

from backend import config
from backend.textproc import chunk_markdown, stem_text
from pipeline.common import ROOT, Timer, batched_insert, connect, run_sql_file

S = config.DATA_RAW / "s"
LANGS = ("fi", "sv", "en")


def main() -> None:
    with Timer("schema"):
        run_sql_file(ROOT / "db" / "schema.sql")
    con = connect(autocommit=False)
    cur = con.cursor()
    cur.execute("SET unique_checks = 0, foreign_key_checks = 0")

    with Timer("articles"):
        for lang in LANGS:
            t = pq.read_table(S / f"articles-{lang}.parquet").to_pylist()
            n = batched_insert(con, """INSERT IGNORE INTO article
                (lang, page_id, rev_id, wikidata_id, title, url, date_modified, text)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                ((r["lang"], r["page_id"], r["rev_id"], r["wikidata_id"], r["title"], r["url"],
                  (r["date_modified"] or "")[:19].replace("T", " ") or None, r["text"]) for r in t))
            print(f"  {lang}: {n} articles")

    with Timer("article vectors (ready-made bge-m3)"):
        for lang in LANGS:
            t = pq.read_table(S / f"vectors-bge-m3-{lang}.parquet")
            emb = np.asarray(t.column("embedding").combine_chunks().values.to_numpy(zero_copy_only=False),
                             dtype=np.float32).reshape(-1, config.EMBED_DIM)
            rows = ((lang, int(pid), config.MODEL_TAG, bool(tr), emb[i].tobytes())
                    for i, (pid, tr) in enumerate(zip(t.column("page_id").to_pylist(),
                                                      t.column("truncated").to_pylist())))
            n = batched_insert(con, """INSERT IGNORE INTO article_vector (lang, page_id, model, truncated, embedding)
                                       VALUES (%s,%s,%s,%s,%s)""", rows, max_bytes=4_000_000)
            print(f"  {lang}: {n} vectors")

    with Timer("categories"):
        with open(S / "category-links-fi.tsv", encoding="utf-8") as f:
            batched_insert(con, "INSERT IGNORE INTO category_link (parent, child) VALUES (%s,%s)",
                           ((r["parent"], r["child"]) for r in csv.DictReader(f, delimiter="\t")))
        cur.execute("SELECT page_id FROM article WHERE lang = 'fi'")
        finnish = {r["page_id"] for r in cur.fetchall()}
        with open(S / "article-categories-fi.tsv", encoding="utf-8") as f:
            batched_insert(con, "INSERT IGNORE INTO article_category (lang, page_id, category) VALUES ('fi',%s,%s)",
                           ((int(r["page_id"]), r["category"]) for r in csv.DictReader(f, delimiter="\t")
                            if int(r["page_id"]) in finnish))
        # Swedish and English articles inherit the categories of the Finnish article on the same topic.
        cur.execute("""INSERT IGNORE INTO article_category (lang, page_id, category)
                       SELECT o.lang, o.page_id, c.category
                       FROM article_category c
                       JOIN article fi ON fi.lang = 'fi' AND fi.page_id = c.page_id
                       JOIN article o  ON o.wikidata_id = fi.wikidata_id AND o.lang <> 'fi'
                       WHERE c.lang = 'fi'""")
        con.commit()

    with Timer("passages (chunk + stem)"):
        # Passages are rebuilt from scratch until some are embedded (chunk_id must then stay stable).
        cur.execute("SELECT COUNT(*) AS n FROM chunk_vector")
        if cur.fetchone()["n"]:
            print("  passages already embedded: keeping them")
            articles, next_id, done = [], 0, set()
        else:
            cur.execute("TRUNCATE TABLE chunk")
            next_id, done = 1, set()
        if next_id:
            cur.execute("SELECT lang, page_id, title, text FROM article ORDER BY lang, page_id")
            articles = cur.fetchall()

        def rows():
            nonlocal next_id
            for a in articles:
                if (a["lang"], a["page_id"]) in done:
                    continue
                for c in chunk_markdown(a["title"], a["text"]):
                    yield (next_id, a["lang"], a["page_id"], c.idx, (c.section or "")[:255] or None,
                           c.text, stem_text(c.text, a["lang"]))
                    next_id += 1

        n = batched_insert(con, """INSERT INTO chunk (chunk_id, lang, page_id, chunk_idx, section, text, text_stem)
                                   VALUES (%s,%s,%s,%s,%s,%s,%s)""", rows())
        print(f"  {n} passages")

    cur.execute("SET unique_checks = 1, foreign_key_checks = 1")
    for table in ("article", "article_vector", "chunk", "category_link", "article_category"):
        cur.execute(f"SELECT COUNT(*) AS n FROM {table}")
        print(f"  {table}: {cur.fetchone()['n']} rows")
    con.close()


if __name__ == "__main__":
    main()
