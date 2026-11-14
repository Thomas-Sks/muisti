"""MariaDB access: a small connection pool over PyMySQL, UTC sessions, dict rows."""
from __future__ import annotations

import queue
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterator

import pymysql
import pymysql.cursors

from . import config


def connect(autocommit: bool = True, **extra: Any) -> pymysql.connections.Connection:
    con = pymysql.connect(
        host=config.DB_HOST, port=config.DB_PORT, user=config.DB_USER, password=config.DB_PASSWORD,
        database=config.DB_NAME, charset="utf8mb4", autocommit=autocommit,
        cursorclass=pymysql.cursors.DictCursor, **extra,
    )
    with con.cursor() as cur:
        cur.execute("SET time_zone = '+00:00'")
        cur.execute(f"SET mhnsw_ef_search = {int(config.EF_SEARCH)}")
    return con


class Pool:
    def __init__(self, size: int = 8) -> None:
        self._q: queue.LifoQueue = queue.LifoQueue(maxsize=size)
        self._size = size
        self._made = 0
        self._lock = threading.Lock()

    def _get(self) -> pymysql.connections.Connection:
        try:
            con = self._q.get_nowait()
        except queue.Empty:
            with self._lock:
                if self._made < self._size:
                    self._made += 1
                    return connect()
            con = self._q.get(timeout=10)
        try:
            con.ping()
        except pymysql.MySQLError:
            con = connect()          # a dead pooled connection is replaced, not reconnected
        return con

    @contextmanager
    def cursor(self) -> Iterator[pymysql.cursors.DictCursor]:
        con = self._get()
        try:
            with con.cursor() as cur:
                yield cur
        finally:
            self._q.put(con)


pool = Pool()


def timed(cur, sql: str, params: Any = None) -> tuple[list[dict], float]:
    """Run a query, return (rows, milliseconds). The UI shows both the SQL and the time."""
    t0 = time.perf_counter()
    cur.execute(sql, params)
    rows = cur.fetchall()
    return list(rows), (time.perf_counter() - t0) * 1000


def vec_literal(v) -> str:
    """A vector as the text VEC_FromText() expects: '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{float(x):.6g}" for x in v) + "]"
