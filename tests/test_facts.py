from datetime import date

from pipeline.facts import first_number, infobox, parse_dates


def test_first_number_handles_thousands_separators():
    assert first_number("126,875–270,000 kuoli") == 126875
    assert first_number("26 662 kuoli") == 26662
    assert first_number("26 662 kuoli") == 26662
    assert first_number("1,5 miljoonaa") == 1
    assert first_number("noin 250 000 miestä") == 250000


def test_parse_dates_inherits_year_and_falls_back():
    assert parse_dates("27. tammikuuta – 15. toukokuuta 1918") == (date(1918, 1, 27), date(1918, 5, 16), True)
    assert parse_dates("kesä–heinäkuu 1944") == (date(1944, 1, 1), date(1945, 1, 1), True)
    assert parse_dates(None)[2] is False


def test_infobox_strips_refs_and_markup():
    box = infobox("{{Taistelu\n| tappiot1 = [[26 662]] kuoli<ref>lähde</ref><br />39 886 haavoittui\n}}")
    assert box == {"tappiot1": "26 662 kuoli 39 886 haavoittui"}
