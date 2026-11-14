import re

from backend.stale import value_regex


def _match(rx: str, text: str) -> bool:
    # PCRE classes used by MariaDB, approximated for Python's re
    return re.search(rx.replace("[^[:alnum:]]", r"[^\w]"), text) is not None


def test_regex_tolerates_wikitext_between_words():
    rx = value_regex("Kaikkiaan sisällissota vaati noin 38 000 uhria.")
    assert _match(rx, "vaati noin 38&nbsp;000 uhria.<ref>")
    assert not _match(rx, "vaati noin 37&nbsp;000 uhria.")


def test_regex_crosses_piped_links_and_dates():
    rx = value_regex("maihinnousu Hangossa 3. huhtikuuta 1918")
    assert _match(rx, "[[Hanko|Hangossa]] 3. huhtikuuta 1918")
    assert not _match(rx, "13. huhtikuuta 1918")


def test_no_number_means_nothing_to_trace():
    assert value_regex("Mannerheim johti valkoisia") is None
