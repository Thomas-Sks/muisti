"""Text processing: Markdown chunking (dataset S), Snowball stemming (fi/sv/en), wikitext cleaning (dataset M).

The wikitext cleaner is adapted from MariaDB's mariadb-system-versioning-wikipedia (history.py, MIT licence,
Robert Silén / MariaDB Foundation).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

import snowballstemmer

# ── Stemming ────────────────────────────────────────────────────────────────────
# InnoDB FULLTEXT has no stemming: "Suomi", "Suomen", "Suomessa" are three different words.
# We index a stemmed copy of every passage and stem the query the same way.

_STEMMERS = {"fi": "finnish", "sv": "swedish", "en": "english"}
_WORD = re.compile(r"\w+", re.UNICODE)


@lru_cache(maxsize=3)
def _stemmer(lang: str):
    return snowballstemmer.stemmer(_STEMMERS[lang])


def stem_text(text: str, lang: str) -> str:
    """Lower-cased, stemmed tokens joined by spaces (what goes into chunk.text_stem)."""
    words = [w.lower() for w in _WORD.findall(text)]
    return " ".join(_stemmer(lang).stemWords(words))


# Function words removed from QUERIES only (the index keeps every word: innodb_ft_enable_stopword=OFF).
QUERY_STOPWORDS = set("""
the a an of in on at to for from by with and or but is was were are be been who what when where which why how
did does do that this these those it its as into about than then there their his her he she they them we you
not no yes can could would should will shall may might has have had
och i på av för till med som att det den de en ett är var vem vad när var hur vilken vilket inte om har hade
från eller men så sin sitt sina han hon
ja on oli ovat olivat kuka mikä mitä milloin missä miksi miten kun että se ne hän he joka jotka tai mutta
ei kanssa sekä myös vuonna vuoden
""".split())


def stem_query_terms(query: str) -> list[str]:
    """Stems of every query word in all three languages (the question's language is unknown, and
    names/years are shared). Function words and tokens shorter than innodb_ft_min_token_size (3)
    are dropped."""
    words = [w.lower() for w in _WORD.findall(query) if w.lower() not in QUERY_STOPWORDS]
    terms: set[str] = set()
    for lang in _STEMMERS:
        terms.update(_stemmer(lang).stemWords(words))
    return sorted(t for t in terms if len(t) >= 3)


def boolean_query(query: str) -> str:
    """MATCH ... AGAINST (... IN BOOLEAN MODE) string: any stem may match (OR), quoted safely."""
    terms = stem_query_terms(query)
    # Only word characters reach this point (\w+), so no boolean operators can be injected.
    return " ".join(terms)


# ── Chunking (dataset S: clean Markdown) ────────────────────────────────────────

SKIP_SECTIONS = {
    # fi
    "lähteet", "viitteet", "kirjallisuutta", "aiheesta muualla", "katso myös", "lisätietoja",
    "kirjallisuus", "ulkoiset linkit", "aiheesta muuallla",
    # sv
    "källor", "noter", "referenser", "se även", "externa länkar", "litteratur", "vidare läsning",
    # en
    "references", "see also", "external links", "further reading", "notes", "bibliography", "sources",
    "citations", "footnotes",
}

TARGET_WORDS = 180      # a passage short enough to quote, long enough to answer a question
MAX_WORDS = 260
MIN_WORDS = 25
MAX_CHARS = 4000        # hard cap: some "words" are huge strings without spaces (data, URLs, tables)


@dataclass(frozen=True)
class Chunk:
    idx: int
    section: str | None
    text: str


def _split_long(paragraph: str) -> list[str]:
    """Split one very long paragraph on sentence boundaries; a "sentence" without punctuation that is
    still too long (lists, tables) is cut by words, so no passage exceeds MAX_WORDS."""
    sentences = []
    for s in re.split(r"(?<=[.!?])\s+", paragraph):
        words = s.split()
        if len(words) > MAX_WORDS:
            sentences.extend(" ".join(words[i:i + TARGET_WORDS]) for i in range(0, len(words), TARGET_WORDS))
        else:
            sentences.append(s)
    out, cur, n = [], [], 0
    for s in sentences:
        w = len(s.split())
        if cur and n + w > MAX_WORDS:
            out.append(" ".join(cur))
            cur, n = [], 0
        cur.append(s)
        n += w
    if cur:
        out.append(" ".join(cur))
    return out


def chunk_markdown(title: str, markdown: str) -> list[Chunk]:
    """Cut an article into passages along its headings, then paragraphs (~180 words each).
    Reference/link sections are skipped. Every passage keeps the heading path it sits under."""
    sections: list[tuple[str | None, list[str]]] = [(None, [])]
    path: list[str] = []
    for line in markdown.split("\n"):
        h = re.match(r"^(#{1,6})\s+(.*?)\s*#*$", line)
        if h:
            level, name = len(h.group(1)), h.group(2).strip()
            if level == 1:          # the article title itself
                continue
            path = path[: level - 2] + [name]
            sections.append((" › ".join(path), []))
        else:
            sections[-1][1].append(line)

    chunks: list[Chunk] = []
    for section, lines in sections:
        if section and section.split(" › ")[0].strip().lower() in SKIP_SECTIONS:
            continue
        paragraphs = [p.strip() for p in "\n".join(lines).split("\n") if p.strip()]
        pieces: list[str] = []
        for p in paragraphs:
            pieces.extend(_split_long(p) if len(p.split()) > MAX_WORDS else [p])
        cur, n = [], 0
        for p in pieces:
            w = len(p.split())
            if cur and n + w > TARGET_WORDS:
                chunks.append(Chunk(len(chunks), section, "\n".join(cur)))
                cur, n = [], 0
            cur.append(p)
            n += w
        if cur:
            if n < MIN_WORDS and chunks and chunks[-1].section == section:
                last = chunks.pop()
                chunks.append(Chunk(last.idx, section, last.text + "\n" + "\n".join(cur)))
            elif n >= MIN_WORDS or not chunks:
                chunks.append(Chunk(len(chunks), section, "\n".join(cur)))
    # Enforce the character cap and renumber.
    out: list[Chunk] = []
    for c in chunks:
        for i in range(0, len(c.text), MAX_CHARS):
            out.append(Chunk(len(out), c.section, c.text[i:i + MAX_CHARS]))
    return out


def embedding_input(title: str, section: str | None, text: str) -> str:
    """What the model reads for one passage: the title and heading give it context."""
    head = f"{title} — {section}" if section else title
    return f"{head}\n{text}"


# ── Wikitext → readable blocks (dataset M: raw wikitext of old versions) ────────

def _drop_nested(text: str, start: str, end: str) -> str:
    out, depth, i, n = [], 0, 0, len(text)
    ls, le = len(start), len(end)
    while i < n:
        if text.startswith(start, i):
            depth += 1
            i += ls
        elif depth and text.startswith(end, i):
            depth -= 1
            i += le
        else:
            if not depth:
                out.append(text[i])
            i += 1
    return "".join(out)


_FILE_LINK = re.compile(
    r"\[\[(?:Tiedosto|Kuva|File|Image|Luokka|Category):[^\[\]]*(?:\[\[[^\]]*\]\][^\[\]]*)*\]\]", re.I)


def clean_wikitext(wikitext: str) -> list[tuple[str, str]]:
    """Wikitext → [(kind, text)] with kind 'h' (heading), 'li' or 'p'. Templates, tables and references
    are dropped; links become their visible words. Not MediaWiki's parser: good enough to read and diff."""
    t = re.sub(r"<!--.*?-->", "", wikitext, flags=re.S)
    t = re.sub(r"<ref[^>/]*/>", "", t)
    t = re.sub(r"<ref[^>]*>.*?</ref>", "", t, flags=re.S)
    t = _drop_nested(t, "{{", "}}")
    t = _drop_nested(t, "{|", "|}")
    t = _FILE_LINK.sub("", t)
    t = re.sub(r"\[\[([^\]|]*)\|([^\]]*)\]\]", r"\2", t)
    t = re.sub(r"\[\[([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[https?://\S+ ([^\]]*)\]", r"\1", t)
    t = re.sub(r"\[https?://\S+\]", "", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("'''", "").replace("''", "").replace("&nbsp;", " ").replace("&ndash;", "–")
    blocks: list[tuple[str, str]] = []
    for line in t.split("\n"):
        line = line.strip()
        if not line:
            continue
        heading = re.match(r"^(=+)\s*(.*?)\s*=+$", line)
        if heading:
            blocks.append(("h", heading.group(2)))
        elif line[0] in "*#":
            blocks.append(("li", line.lstrip("*#: ")))
        elif line[0] not in "|!:;{}":
            blocks.append(("p", line))
    return blocks


def wikitext_to_markdown(wikitext: str, title: str) -> str:
    """Cleaned wikitext as Markdown, so old versions can go through chunk_markdown()."""
    out = [f"# {title}"]
    for kind, text in clean_wikitext(wikitext):
        out.append(f"## {text}" if kind == "h" else f"- {text}" if kind == "li" else text)
    return "\n".join(out)
