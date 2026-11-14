"""Writer workspace: topic search, overview, stored tone & framing analysis (no LLM call in tests)."""
from fastapi.testclient import TestClient

from backend.api import app

client = TestClient(app)


def test_topic_search_finds_the_topic_in_any_language():
    for q in ("Finnish civil war", "sisällissota", "inbördeskriget", "Qui a gagné la guerre civile finlandaise ?"):
        topics = client.get("/api/topics/search", params={"q": q}).json()["topics"]
        assert any(t["wikidata_id"] == "Q211855" for t in topics[:3]), (q, [t["title"] for t in topics[:3]])


def test_topic_search_puts_comparable_topics_first_and_escapes_wildcards():
    topics = client.get("/api/topics/search", params={"q": "Mannerheim"}).json()["topics"]
    flags = [t["comparable"] for t in topics]
    assert flags == sorted(flags, reverse=True)
    assert client.get("/api/topics/search", params={"q": "%%"}).status_code == 200


def test_topic_overview_lists_the_three_editions_and_history():
    t = client.get("/api/topic/Q211855").json()
    assert [a["lang"] for a in t["articles"]] == ["fi", "sv", "en"]
    assert t["history"]["versions"] == 3357


def test_topic_validation():
    assert client.get("/api/topic/XYZ").status_code == 422
    assert client.get("/api/topic/Q99999999").status_code == 404


def test_stored_framing_analysis_is_served_and_quotes_are_checked():
    f = client.get("/api/topic/Q211855/framing", params={"cached_only": 1}).json()
    assert f["available"] and f["cached"], "run the analysis once in the app first"
    assert f["differences"] and f["groups"]
    for d in f["differences"]:
        assert d["kind"] in {"loaded_wording", "agency_blame", "certainty", "naming", "emphasis"}
        assert all(isinstance(q["verified"], bool) and q["translation"] for q in d["quotes"])
    assert sum(q["verified"] for d in f["differences"] for q in d["quotes"]) >= 0.8 * sum(len(d["quotes"]) for d in f["differences"])


def test_stored_facts_comparison_has_statuses_and_checked_quotes():
    f = client.get("/api/topic/Q211855/facts", params={"cached_only": 1}).json()
    assert f["available"] and f["cached"], "run the facts comparison once first"
    assert f["counts"]["differ"] >= 1
    statuses = [x["status"] for x in f["facts"]]
    assert statuses == sorted(statuses, key=lambda s: {"differ": 0, "missing": 1, "agree": 2}[s])
    vals = [v for x in f["facts"] for v in x["values"]]
    assert sum(v["verified"] for v in vals) >= 0.8 * len(vals)


def test_translate_unknown_passage_is_404():
    assert client.post("/api/passages/999999999/translate").status_code == 404
