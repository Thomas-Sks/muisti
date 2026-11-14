"""Differentiating features, against the real data."""
from fastapi.testclient import TestClient

from backend.api import app

client = TestClient(app)


def test_bitemporal_query_sees_the_april_2007_vandalised_casualty_figure():
    during = client.get("/api/articles/1256/facts/as-of", params={"said_at": "2007-04-10T15:00", "event_date": "1940-01-01"}).json()
    before = client.get("/api/articles/1256/facts/as-of", params={"said_at": "2007-04-10T14:00", "event_date": "1940-01-01"}).json()
    soviet = lambda r: next(f["num"] for f in r["facts"] if f["field"] == "tappiot2")
    assert soviet(during) == 256875 and soviet(before) == 126875


def test_bitemporal_query_outside_the_war_period_returns_nothing_dated():
    r = client.get("/api/articles/1256/facts/as-of", params={"said_at": "2015-01-01", "event_date": "1950-01-01"}).json()
    assert all(f["field"] != "tappiot2" for f in r["facts"])


def test_fact_history_is_contiguous_and_ordered():
    f = client.get("/api/articles/1256/facts").json()
    field = next(x for x in f["fields"] if x["field"] == "tappiot2")
    starts = [r["row_start"] for r in field["runs"]]
    assert starts == sorted(starts) and field["changes"] >= 50
    assert all(r["row_start"] < r["row_end"] for r in field["runs"])


def test_most_revised_numbers_are_led_by_winter_war_casualties():
    r = client.get("/api/facts/most-revised").json()
    top = r["facts"][0]
    assert top["title"] == "Talvisota" and top["field"] == "tappiot2"


def test_cross_language_gaps_cover_all_three_languages():
    g = client.get("/api/topics/Q134949/gaps").json()
    assert set(g["languages"]) == {"fi", "sv", "en"}
    for lang, d in g["languages"].items():
        assert d["total"] > 0 and 0 <= d["unique"] < d["total"]
        assert all(set(p["matches"]) == {"fi", "sv", "en"} - {lang} for p in d["passages"])


def test_gaps_rejects_bad_ids():
    assert client.get("/api/topics/DROP%20TABLE/gaps").status_code == 422


def test_drift_distances_are_valid_cosine_distances():
    d = client.get("/api/articles/1150/drift").json()
    assert len(d["years"]) >= 10
    assert all(0 <= y["d_now"] <= 2 for y in d["years"])


def test_search_in_2010_returns_2010_passages_with_today_counterpart():
    r = client.post("/api/search/past", json={"q": "Tampereen taistelu", "year": 2010}).json()
    assert r["results"] and all(x["year"] == 2010 for x in r["results"])
    assert any(x["now"] for x in r["results"])


def test_ai_check_validates_input_without_calling_the_model():
    assert client.post("/api/check", json={"q": "hi"}).status_code == 422
    assert client.post("/api/check", json={"q": "x" * 301}).status_code == 422


def test_origin_finds_the_reworded_first_version():
    now = client.get("/api/articles/1150/as-of", params={"ts": "2026-10-01"}).json()
    para = next(b["text"] for b in now["blocks"] if b["kind"] == "p" and "Vastapalvelukseksi" in b["text"])
    r = client.post("/api/articles/1150/origin", json={"text": para}).json()
    assert r["found"] and r["origin"]["ts"].startswith("2008-05-17") and r["reworded"]


def test_origin_of_text_not_in_the_article():
    r = client.post("/api/articles/1150/origin", json={"text": "Paavo Nurmi voitti olympiakultaa juoksussa Pariisissa."}).json()
    assert r["found"] is False


def test_contradictions_validate_language_and_unknown_article():
    assert client.get("/api/contradictions/de/1256").status_code == 422
    assert client.get("/api/s-articles", params={"prefix": "%%"}).json() == []
    assert client.get("/api/s-articles", params={"prefix": "%"}).status_code == 422
