"""Extract dates and numbers from every passage (fi / sv / en) into MariaDB, once, without any LLM.

    uv run python -m pipeline.extract_values

chunk_date(chunk_id, d DATE, precision, surface): "15. toukokuuta 1918", "15 maj 1918", "15 May 1918",
"May 15, 1918" all become 1918-05-15. A day without a year inherits the next (or previous) year written
near it ("27. tammikuuta – 15. toukokuuta 1918").
chunk_number(chunk_id, n BIGINT, surface): counts such as "36 640", "36,640", "126 875" (years excluded).

The comparisons between languages are then done in SQL (backend/sqlfacts.py).
"""
from __future__ import annotations

import re
from datetime import date

from pipeline.common import Timer, batched_insert, connect

MONTHS = {
    "fi": ["tammikuu", "helmikuu", "maaliskuu", "huhtikuu", "toukokuu", "kesäkuu", "heinäkuu", "elokuu",
           "syyskuu", "lokakuu", "marraskuu", "joulukuu"],
    "sv": ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober",
           "november", "december"],
    "en": ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
           "november", "december"],
}
YEAR = r"(1[0-9]{3}|20[0-2][0-9])"
PATTERNS = {
    # 15. toukokuuta 1918 · 15. toukokuuta (year later)
    "fi": [re.compile(r"\b(\d{1,2})\.\s*(" + "|".join(m + "ta" for m in MONTHS["fi"]) + r")\b(?:\s+" + YEAR + r")?", re.I)],
    # 15 maj 1918 · den 15 maj
    "sv": [re.compile(r"\b(\d{1,2})\s+(" + "|".join(MONTHS["sv"]) + r")\b(?:\s+" + YEAR + r")?", re.I)],
    # 15 May 1918 · May 15, 1918
    "en": [re.compile(r"\b(\d{1,2})\s+(" + "|".join(MONTHS["en"]) + r")\b(?:,?\s+" + YEAR + r")?", re.I),
           re.compile(r"\b(" + "|".join(MONTHS["en"]) + r")\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+" + YEAR + r")?", re.I)],
}
NUMBER = re.compile(r"(?<![\d.,])(\d{1,3}(?:[   ,]\d{3})+|\d{3,})(?![\d.,]*\d)")
ANY_YEAR = re.compile(r"\b" + YEAR + r"\b")


def month_index(lang: str, word: str) -> int:
    w = word.lower()
    if lang == "fi":
        w = w[:-2]                                    # toukokuuta -> toukokuu
    return MONTHS[lang].index(w) + 1


def dates_in(text: str, lang: str) -> list[tuple[date, str]]:
    found = []
    for rx in PATTERNS[lang]:
        for m in rx.finditer(text):
            g = m.groups()
            if lang == "en" and not g[0].isdigit():   # "May 15, 1918"
                month_word, day, year = g[0], g[1], g[2]
            else:
                day, month_word, year = g[0], g[1], g[2]
            if year is None:                          # inherit the next year written soon after, else the last one before
                ahead = ANY_YEAR.search(text, m.end(), m.end() + 60)
                behind = list(ANY_YEAR.finditer(text, max(0, m.start() - 300), m.start()))
                year = ahead.group(1) if ahead else (behind[-1].group(1) if behind else None)
            if year is None:
                continue
            try:
                found.append((date(int(year), month_index(lang, month_word), int(day)), m.group(0)))
            except ValueError:
                continue
    return found


def numbers_in(text: str) -> list[tuple[int, str]]:
    out = []
    for m in NUMBER.finditer(text):
        raw = m.group(1)
        n = int(re.sub(r"\D", "", raw))
        if re.fullmatch(YEAR, raw) or n < 100 or n > 10**10:
            continue
        out.append((n, raw))
    return out


DDL = """
CREATE TABLE IF NOT EXISTS chunk_date (
  chunk_id  INT UNSIGNED NOT NULL,
  d         DATE         NOT NULL,
  surface   VARCHAR(80)  NOT NULL,
  PRIMARY KEY (chunk_id, d, surface),
  KEY by_date (d)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;
CREATE TABLE IF NOT EXISTS chunk_number (
  chunk_id  INT UNSIGNED NOT NULL,
  n         BIGINT       NOT NULL,
  surface   VARCHAR(40)  NOT NULL,
  PRIMARY KEY (chunk_id, n, surface)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;
"""


def main() -> None:
    con = connect(autocommit=False)
    cur = con.cursor()
    for stmt in filter(str.strip, DDL.split(";")):
        cur.execute(stmt)
    cur.execute("TRUNCATE TABLE chunk_date")
    cur.execute("TRUNCATE TABLE chunk_number")
    with Timer("extract dates and numbers from 122k passages"):
        cur.execute("SELECT chunk_id, lang, text FROM chunk")
        rows = cur.fetchall()
        dates, nums = set(), set()
        for r in rows:
            for d, s in dates_in(r["text"], r["lang"]):
                dates.add((r["chunk_id"], d, s[:80]))
            for n, s in numbers_in(r["text"]):
                nums.add((r["chunk_id"], n, s[:40]))
        batched_insert(con, "INSERT IGNORE INTO chunk_date (chunk_id, d, surface) VALUES (%s,%s,%s)", list(dates))
        batched_insert(con, "INSERT IGNORE INTO chunk_number (chunk_id, n, surface) VALUES (%s,%s,%s)", list(nums))
    cur.execute("ANALYZE TABLE chunk_date, chunk_number")
    cur.fetchall()
    cur.execute("SELECT COUNT(*) n FROM chunk_date")
    print("dates:", cur.fetchone()["n"])
    cur.execute("SELECT COUNT(*) n FROM chunk_number")
    print("numbers:", cur.fetchone()["n"])
    con.close()


if __name__ == "__main__":
    main()
