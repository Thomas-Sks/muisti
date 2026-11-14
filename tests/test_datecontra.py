"""The SQL stage of the contradiction check is deterministic: same data, same candidates."""
from datetime import date

from backend import datecontra


def test_finds_the_known_end_date_contradiction():
    cands, _ = datecontra.candidates("fi", 1150)          # Suomen sisällissota
    pairs = {(c["b"]["title"], c["date_a"], c["date_b"]) for c in cands}
    assert ("Itsenäisen Suomen historia", date(1918, 5, 15), date(1918, 5, 16)) in pairs
    assert ("History of Finland (1917–present)", date(1918, 5, 15), date(1918, 5, 16)) in pairs


def test_candidates_are_reproducible_and_bounded():
    a, _ = datecontra.candidates("fi", 1150)
    b, _ = datecontra.candidates("fi", 1150)
    key = lambda cs: [(c["ca"], c["cb"], c["date_a"], c["date_b"]) for c in cs]
    assert key(a) == key(b)
    assert len(a) <= datecontra.MAX_CANDIDATES
    assert all(1 <= c["days"] <= datecontra.MAX_DAYS for c in a)


def test_timelines_are_excluded():
    cands, _ = datecontra.candidates("fi", 1150)
    assert all("aikajana" not in c["b"]["title"] for c in cands)
