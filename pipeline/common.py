"""Helpers shared by the loading scripts."""
from __future__ import annotations

import time
from pathlib import Path

import pymysql
from pymysql.constants import CLIENT

from backend import config
from backend.db import connect

ROOT = config.ROOT


def run_sql_file(path: Path) -> None:
    """Execute a .sql file with several statements (schema, indexes)."""
    con = pymysql.connect(host=config.DB_HOST, port=config.DB_PORT, user=config.DB_USER,
                          password=config.DB_PASSWORD, database=config.DB_NAME, charset="utf8mb4",
                          client_flag=CLIENT.MULTI_STATEMENTS, autocommit=True)
    with con.cursor() as cur:
        cur.execute(path.read_text())
        while cur.nextset():
            pass
    con.close()


def batched_insert(con, sql: str, rows, max_bytes: int = 8_000_000, size_of=None) -> int:
    """executemany in batches limited by size (the starter hit the 16 MB packet limit by row count)."""
    size_of = size_of or (lambda r: sum(len(x) if isinstance(x, (str, bytes)) else 8 for x in r))
    batch, size, n = [], 0, 0
    with con.cursor() as cur:
        for r in rows:
            s = size_of(r)
            if batch and size + s > max_bytes:
                cur.executemany(sql, batch)
                con.commit()
                n += len(batch)
                batch, size = [], 0
            batch.append(r)
            size += s
        if batch:
            cur.executemany(sql, batch)
            con.commit()
            n += len(batch)
    return n


class Timer:
    def __init__(self, label: str) -> None:
        self.label = label

    def __enter__(self):
        self.t0 = time.perf_counter()
        print(f"▶ {self.label} ...", flush=True)
        return self

    def __exit__(self, *exc):
        print(f"✔ {self.label}: {time.perf_counter() - self.t0:.1f} s", flush=True)
