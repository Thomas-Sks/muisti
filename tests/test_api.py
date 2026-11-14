"""End-to-end tests against the real MariaDB with the real datasets loaded."""
from fastapi.testclient import TestClient

from backend.api import app

client = TestClient(app)


def test_health_reports_mariadb_12_3():
    r = client.get("/api/health").json()
    assert r["status"] == "ok" and r["mariadb"].startswith("12.3")


def test_stats_match_the_datasets():
    s = client.get("/api/stats").json()
    assert s["articles_by_lang"] == {"fi": 19285, "sv": 4921, "en": 5254}
    assert s["passages"] == 122351
    assert s["article_vectors"] == 29460


def test_cross_language_search_finds_finnish_sources_for_english_question():
    r = client.post("/api/search", json={"q": "Which peace treaty ended the Winter War?", "mode": "vector"}).json()
    titles = [g["best"]["title"] for g in r["groups"][:5]]
    assert any("Moskovan rauha" in t or "Moscow Peace" in t or "Moskvafreden" in t for t in titles), titles
    assert r["timings"]["sql_ms"] < 500


def test_french_question_reaches_kekkonen():
    r = client.post("/api/search", json={"q": "Qui était président de la Finlande de 1956 à 1982 ?", "mode": "hybrid"}).json()
    titles = [g["best"]["title"] for g in r["groups"][:5]]
    assert any("Kekkonen" in t for t in titles), titles


def test_every_passage_links_to_its_revision():
    r = client.post("/api/search", json={"q": "Tampereen taistelu 1918", "mode": "hybrid"}).json()
    assert r["passages"]
    for p in r["passages"]:
        assert p["oldid_url"].endswith(f"?oldid={p['rev_id']}")
        assert p["text"]


def test_language_filter_returns_only_that_language():
    r = client.post("/api/search", json={"q": "Mannerheim", "mode": "hybrid", "lang": "sv"}).json()
    assert r["passages"] and all(p["lang"] == "sv" for p in r["passages"])


def test_keyword_mode_with_only_stopwords_returns_empty_not_error():
    r = client.post("/api/search", json={"q": "the of in", "mode": "keyword"})
    assert r.status_code == 200 and r.json()["passages"] == []


def test_as_of_returns_the_version_current_at_that_time():
    r = client.get("/api/articles/1150/as-of", params={"ts": "2010-06-01"}).json()
    v = r["version"]
    assert v["row_start"] <= "2010-06-01T00:00:00" < v["row_end"]
    assert r["blocks"] and r["neighbours"]["versions"] == 3357


def test_as_of_before_the_article_existed_returns_first_version_with_notice():
    r = client.get("/api/articles/1150/as-of", params={"ts": "2002-01-01"}).json()
    assert r["notice"] and r["version"]["row_start"].startswith("2003-08-26")


def test_unknown_article_is_404_and_wildcards_are_literal():
    assert client.get("/api/articles/999999999/timeline").status_code == 404
    assert client.get("/api/articles", params={"prefix": "%"}).json() == []


def test_edit_war_shows_the_disputed_words():
    top = client.get("/api/wars").json()["wars"][0]
    w = client.get(f"/api/wars/{top['page_id']}/{top['year']}").json()
    assert w["disputes"] and w["disputes"][0]["toggles"] >= 2
    h = w["disputes"][0]["hunk"]
    assert h["removed"] or h["added"]


def test_bad_timestamp_is_422():
    assert client.get("/api/articles/1150/as-of", params={"ts": "yesterday"}).status_code == 422


def test_timeline_counts_every_version():
    t = client.get("/api/articles/1150/timeline").json()
    assert sum(m["edits"] for m in t["monthly"]) == 3357
    assert t["article"]["versions"] == 3357


def test_diff_finds_the_2023_lead_change_on_the_civil_war_article():
    d = client.get("/api/articles/1150/diff", params={"from": "2022-12-31", "to": "2023-12-31"}).json()
    inserted = " ".join(w["text"] for b in d["blocks"] if b["op"] == "changed" for w in b["words"] if w["op"] == "ins")
    added = " ".join(b["text"] for b in d["blocks"] if b["op"] == "added")
    assert "vapaussota" in (inserted + added).lower()


def test_controversial_ranking_is_sorted():
    c = client.get("/api/editors/controversial").json()
    ms = [a["controversy_m"] for a in c["articles"]]
    assert ms == sorted(ms, reverse=True) and len(ms) == 25
