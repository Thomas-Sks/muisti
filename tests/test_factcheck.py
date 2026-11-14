"""Figures quoted by Claude are checked against the values extracted from the Wikipedia passage."""
from backend import db, factcheck


def _chunk_with(lang: str, page_id: int, needle: str) -> int:
    with db.pool.cursor() as cur:
        cur.execute("SELECT chunk_id FROM chunk WHERE lang = %s AND page_id = %s AND text LIKE %s LIMIT 1",
                    (lang, page_id, f"%{needle}%"))
        return cur.fetchone()["chunk_id"]


def test_real_figure_is_found_and_invented_one_is_not():
    cid = _chunk_with("fi", 1150, "38 000 uhria")
    (ok, bad, none), _ = factcheck.check_many([
        (cid, "fi", "Kaikkiaan sisällissota vaati noin 38 000 uhria."),
        (cid, "fi", "Kaikkiaan sisällissota vaati noin 39 500 uhria."),
        (cid, "fi", "Sota päättyi."),
    ])
    assert ok["status"] == "checked"
    assert bad["status"] == "mismatch" and not bad["values"][0]["found"]
    assert none["status"] == "none"
