from backend.textproc import MAX_CHARS, MAX_WORDS, boolean_query, chunk_markdown, clean_wikitext, stem_text


def test_finnish_stemming_unifies_case_forms():
    assert len({stem_text(w, "fi") for w in ("Suomen", "Suomessa", "Suomeen", "Suomesta")}) == 1
    assert stem_text("presidentti presidentin", "fi").split()[0] == stem_text("presidentin", "fi")


def test_query_terms_drop_function_words_and_keep_years():
    q = boolean_query("Who was the president of Finland in 1918?")
    assert "1918" in q.split() and "the" not in q.split() and "who" not in q.split()


def test_boolean_query_cannot_inject_operators():
    assert set(boolean_query('+foo -bar "baz" (x) ~y *z')) <= set("abcdefghijklmnopqrstuvwxyzåäö0123456789_ ")


def test_chunks_respect_limits_and_skip_reference_sections():
    md = "# T\nIntro " + "sana " * 50 + "\n## Historia\n" + ("Lause on tässä. " * 400) + "\n## Lähteet\nviite\n"
    chunks = chunk_markdown("T", md)
    assert chunks and all(len(c.text.split()) <= MAX_WORDS + 30 and len(c.text) <= MAX_CHARS for c in chunks)
    assert [c.idx for c in chunks] == list(range(len(chunks)))
    assert not any("viite" in c.text for c in chunks)
    assert any(c.section == "Historia" for c in chunks)


def test_wikitext_cleaner_drops_templates_refs_and_keeps_link_words():
    blocks = clean_wikitext("{{Taistelu|nimi=X}}\n'''Talvisota''' oli [[sota]] [[Neuvostoliitto|Neuvostoliiton]] kanssa.<ref>lähde</ref>\n== Tausta ==")
    assert blocks == [("p", "Talvisota oli sota Neuvostoliiton kanssa."), ("h", "Tausta")]
