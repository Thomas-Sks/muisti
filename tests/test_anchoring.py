"""Anchoring quotes in the article text (no database needed)."""
from backend.workspace import _locate, _span

T = "Iltapäivään mennessä neuvostoliittolaiset saivatkin aikaan ratkaisevaksi muodostuneen läpimurron Summassa."


def test_span_tolerates_spacing_and_case():
    assert _span("Hello big world here", "big  WORLD") == (6, 15)


def test_span_falls_back_to_longest_verbatim_run_when_one_word_differs():
    sp = _span(T, "Iltapäivään mennessä neuvostoliittolaiset saivatkin aikaisi ratkaisevaksi muodostuneen läpimurron Summassa.")
    assert sp is not None and T[sp[0]:sp[1]].startswith("Iltapäivään mennessä neuvostoliittolaiset saivatkin")


def test_exact_mode_refuses_partial_matches():
    assert _span(T, "saivatkin aikaisi ratkaisevaksi muodostuneen läpimurron", exact=True) is None


def test_locate_finds_quote_in_another_passage_of_the_article():
    assert _locate("puhdas kostotoimi", 1, {1: "ei mitään", 2: "ne olivatkin puhdas kostotoimi."}) == (2, 13, 30)


def test_locate_uses_partial_matches_only_in_the_paired_passage():
    assert _locate("ratkaisevaksi muodostuneen läpimurron Summassa", 1,
                   {1: "zzz", 2: "ratkaisevaksi muodostuneen läpimurron Lähteellä"}) is None
