"""Bitemporal facts from battle/war infoboxes, replayed over every version (no LLM, real data).

    uv run python -m pipeline.facts

For every article whose infobox is {{Taistelu}} / {{Sotilaallinen konflikti}} (wars and battles), each
version's infobox is parsed. For each field (casualties, strengths, result, belligerents, commanders...)
every run of identical values becomes one row of the bitemporal `fact` table:
- system time  = when Wikipedia stated that value (real revision times, system_versioning_insert_history);
- valid time   = the battle's own dates, parsed from the infobox's date field *as it was at that time*.
"""
from __future__ import annotations

import re
from datetime import date

import mwparserfromhell as mw

from pipeline.common import Timer, connect

TEMPLATES = {"taistelu", "sotilaallinen konflikti", "infobox military conflict", "sota"}
FIELDS = ["päivämäärä", "paikka", "tulos", "osapuoli1", "osapuoli2", "komentaja1", "komentaja2",
          "vahvuus1", "vahvuus2", "tappiot1", "tappiot2"]
MONTHS = {"tammikuu": 1, "helmikuu": 2, "maaliskuu": 3, "huhtikuu": 4, "toukokuu": 5, "kesäkuu": 6,
          "heinäkuu": 7, "elokuu": 8, "syyskuu": 9, "lokakuu": 10, "marraskuu": 11, "joulukuu": 12}
INFOBOX_START = re.compile(r"\{\{\s*(Taistelu|Sotilaallinen konflikti|Infobox military conflict|Sota)\s*[|\n]", re.I)


def infobox(text: str) -> dict[str, str] | None:
    m = INFOBOX_START.search(text)
    if not m:
        return None
    depth, i = 0, m.start()
    while i < len(text) - 1:                       # find the matching }} quickly
        if text.startswith("{{", i):
            depth += 1
            i += 2
        elif text.startswith("}}", i):
            depth -= 1
            i += 2
            if depth == 0:
                break
        else:
            i += 1
    raw = text[m.start():i]
    raw = re.sub(r"<!--.*?-->", "", raw, flags=re.S)
    raw = re.sub(r"<ref[^>/]*/>", "", raw)
    raw = re.sub(r"<ref[^>]*>.*?</ref>", "", raw, flags=re.S)
    raw = re.sub(r"<br\s*/?>", " ", raw, flags=re.I)
    tpl = next(iter(mw.parse(raw).filter_templates(recursive=False)), None)
    if tpl is None:
        return None
    out = {}
    for p in tpl.params:
        name = str(p.name).strip().lower()
        if name in FIELDS:
            value = re.sub(r"\s+", " ", p.value.strip_code(normalize=True, collapse=True)).strip()
            if value:
                out[name] = value[:1000]
    return out


def first_number(value: str) -> int | None:
    # thousands separators seen in the data: space, no-break / narrow / thin space, comma ("126,875").
    # Exactly three digits must follow, so a Finnish decimal comma ("1,5 milj.") is not a separator.
    m = re.search(r"\d{1,3}(?:[ \u00a0\u202f\u2009,]\d{3})+(?!\d)|\d+", value)
    if not m:
        return None
    n = int(re.sub(r"\D", "", m.group(0)))
    return n if n < 10**12 else None


def parse_dates(value: str | None) -> tuple[date, date, bool]:
    """'30. marraskuuta 1939 – 13. maaliskuuta 1940' -> (1939-11-30, 1940-03-14, True). Falls back to whole
    years, then to an unknown range (valid_known = False)."""
    if not value:
        return date(1, 1, 1), date(9999, 12, 31), False
    found = []
    parts = re.findall(r"(\d{1,2})\.\s*([a-zäö]+?)ta\b(?:\s+(\d{3,4}))?", value.lower())
    year = None
    for d, mon, y in reversed(parts):             # "27. tammikuuta – 15. toukokuuta 1918": inherit the year
        year = int(y) if y else year
        if mon in MONTHS and year:
            try:
                found.append(date(year, MONTHS[mon], int(d)))
            except ValueError:
                pass
    if found:
        start, end = min(found), max(found)
        return start, date.fromordinal(end.toordinal() + 1), True
    years = [int(y) for y in re.findall(r"\b(1[0-9]{3}|20[0-2][0-9])\b", value)]
    if years:
        return date(min(years), 1, 1), date(max(years) + 1, 1, 1), True
    return date(1, 1, 1), date(9999, 12, 31), False


def main() -> None:
    con = connect(autocommit=False)
    cur = con.cursor()
    cur.execute("SET system_versioning_insert_history = 1")
    with Timer("find articles with a battle/war infobox"):
        cur.execute("""SELECT page_id, title FROM article_history
                       WHERE text LIKE '%{{Taistelu%' OR text LIKE '%{{Sotilaallinen konflikti%'
                          OR text LIKE '%{{Infobox military conflict%'""")
        pages = cur.fetchall()
    print(f"  {len(pages)} articles")
    cur.execute("SELECT DISTINCT page_id FROM fact")
    done = {r["page_id"] for r in cur.fetchall()}
    total = 0
    with Timer("replay infoboxes over every version"):
        for n, p in enumerate(pages, 1):
            if p["page_id"] in done:
                continue
            cur.execute("""SELECT rev_id, row_start, row_end, text FROM article_history FOR SYSTEM_TIME ALL
                           WHERE page_id = %s ORDER BY row_start""", (p["page_id"],))
            versions = cur.fetchall()
            states = []                                    # (rev_id, start, end, {field: value})
            for v in versions:
                box = infobox(v["text"]) or {}
                states.append((v["rev_id"], v["row_start"], v["row_end"], box))
            rows = []
            for fi, field in enumerate(FIELDS):
                fact_id = p["page_id"] * 100 + fi
                run = None                                 # [value, rev_id, start, end, date_value]
                for rev_id, start, end, box in states:
                    value = box.get(field)
                    if run and value == run[0]:
                        run[3] = end
                        continue
                    if run and run[0] is not None:
                        rows.append((fact_id, field, *run))
                    run = [value, rev_id, start, end, box.get("päivämäärä")]
                if run and run[0] is not None:
                    rows.append((fact_id, field, *run))
            hist, current = [], []
            for fact_id, field, value, rev_id, start, end, date_value in rows:
                vf, vt, known = parse_dates(date_value)
                num = first_number(value) if field.startswith(("tappiot", "vahvuus")) else None
                base = (fact_id, p["page_id"], field, value, num, rev_id, vf, vt, known, start)
                if end.year >= 2100:                       # still current: MariaDB gives it the open end
                    current.append(base)
                else:
                    hist.append(base + (end,))
            # One field may disappear from the infobox: its last run then has a real end (history row).
            cols = "fact_id, page_id, field, value, num, rev_id, valid_from, valid_to, valid_known, row_start"
            if hist:
                cur.executemany(f"INSERT INTO fact ({cols}, row_end) VALUES ({', '.join(['%s'] * 11)})", hist)
            if current:
                cur.executemany(f"INSERT INTO fact ({cols}) VALUES ({', '.join(['%s'] * 10)})", current)
            con.commit()
            total += len(rows)
            if n % 50 == 0 or p["page_id"] in (1256, 1150, 440):
                print(f"  {n}/{len(pages)} {p['title']}: {len(rows)} fact versions (total {total})", flush=True)
    cur.execute("SET system_versioning_insert_history = 0")
    cur.execute("SELECT COUNT(*) AS n FROM fact FOR SYSTEM_TIME ALL")
    print("fact rows (all system time):", cur.fetchone()["n"])
    con.close()


if __name__ == "__main__":
    main()
