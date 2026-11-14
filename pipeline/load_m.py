"""Load dataset M (every version of 19,742 Finnish articles, 2003 → 2026) into the system-versioned table.

    uv run python -m pipeline.load_m                 # all 862,076 versions
    uv run python -m pipeline.load_m --pages 1150 1256   # only some articles (tests, demos)

Each version is written with Wikipedia's real edit time (SET system_versioning_insert_history = 1):
a version's row_end is the next version's row_start; the current version only gets a start, so
MariaDB keeps it current. FOR SYSTEM_TIME AS OF '2015-06-01' then means "what Wikipedia showed".

Memory stays bounded: Parquet is read batch by batch and one article's versions at a time (the files
are sorted by page, oldest version first). Resumable: articles already loaded are skipped.
"""
from __future__ import annotations

import argparse
import glob
from datetime import timedelta

import pyarrow.parquet as pq

from backend import config
from pipeline.common import Timer, connect

COLUMNS = ["page_id", "title", "rev_id", "parent_id", "timestamp", "user", "anonymous",
           "comment", "minor", "sha1", "bytes", "text"]
MAX_BATCH_BYTES = 8_000_000      # below the 16 MB default packet even with escaping

INSERT_HISTORY = """INSERT INTO article_history
  (page_id, title, rev_id, parent_id, user, anonymous, comment, minor, sha1, len, text, row_start, row_end)
  VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"""
INSERT_CURRENT = """INSERT INTO article_history
  (page_id, title, rev_id, parent_id, user, anonymous, comment, minor, sha1, len, text, row_start)
  VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"""


def page_versions(path: str, wanted: set[int] | None):
    """Yield (page_id, [versions oldest first]) from one Parquet file, one article at a time."""
    current_id, buf = None, []
    pf = pq.ParquetFile(path)
    for batch in pf.iter_batches(batch_size=2000, columns=COLUMNS):
        for r in batch.to_pylist():
            if wanted is not None and r["page_id"] not in wanted:
                continue
            if r["page_id"] != current_id:
                if buf:
                    yield current_id, buf
                current_id, buf = r["page_id"], []
            buf.append(r)
    if buf:
        yield current_id, buf


def rows_for(versions: list[dict]):
    """History rows (with row_end) and the current row (without), ordered, with distinct start times."""
    versions.sort(key=lambda v: (v["timestamp"], v["rev_id"]))
    times = []
    for v in versions:
        t = v["timestamp"].replace(tzinfo=None)          # UTC; sessions run with time_zone = '+00:00'
        if times and t <= times[-1]:
            t = times[-1] + timedelta(microseconds=1)     # two edits in the same millisecond
        times.append(t)
    out = []
    for i, v in enumerate(versions):
        base = (v["page_id"], v["title"], v["rev_id"], v["parent_id"], (v["user"] or "")[:255] or None,
                bool(v["anonymous"]), v["comment"], bool(v["minor"]), v["sha1"], v["bytes"], v["text"] or "",
                times[i])
        out.append(base + (times[i + 1],) if i + 1 < len(versions) else base)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, nargs="*", help="only these page_ids")
    args = ap.parse_args()
    wanted = set(args.pages) if args.pages else None

    con = connect(autocommit=False)
    cur = con.cursor()
    cur.execute("SET system_versioning_insert_history = 1")
    cur.execute("SET unique_checks = 0")
    cur.execute("SELECT page_id FROM article_history")
    done = {r["page_id"] for r in cur.fetchall()}
    print(f"already loaded: {len(done)} articles")

    total_versions = total_pages = 0
    files = sorted(glob.glob(str(config.DATA_RAW / "m" / "versions-*.parquet")))
    with Timer(f"load {len(files)} files"):
        for path in files:
            n_file = 0
            with Timer(path.rsplit("/", 1)[-1]):
                hist_batch, cur_batch, size = [], [], 0

                def flush():
                    nonlocal hist_batch, cur_batch, size
                    if hist_batch:
                        cur.executemany(INSERT_HISTORY, hist_batch)
                    if cur_batch:
                        cur.executemany(INSERT_CURRENT, cur_batch)
                    con.commit()
                    hist_batch, cur_batch, size = [], [], 0

                for page_id, versions in page_versions(path, wanted):
                    if page_id in done:
                        continue
                    rows = rows_for(versions)
                    # One article's versions always go in together with its current row, so a
                    # stopped load never leaves an article half-written.
                    for r in rows:
                        (hist_batch if len(r) == 13 else cur_batch).append(r)
                        size += len(r[10]) * 2 + 512
                        if size > MAX_BATCH_BYTES and len(r) == 12:
                            flush()
                    if size > MAX_BATCH_BYTES:
                        flush()
                    done.add(page_id)
                    total_pages += 1
                    total_versions += len(rows)
                    n_file += len(rows)
                flush()
            print(f"  {n_file} versions; total {total_versions} versions / {total_pages} articles", flush=True)

    cur.execute("SET system_versioning_insert_history = 0")
    cur.execute("SELECT COUNT(*) AS n FROM article_history FOR SYSTEM_TIME ALL")
    print("rows in article_history (all versions):", cur.fetchone()["n"])
    con.close()


if __name__ == "__main__":
    main()
