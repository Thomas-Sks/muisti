# Editor UI redesign (jury feedback, 13 h before the demo)

**Question:** how might an editor, opening an article, see the problems *in their own text* and handle them
one by one without leaving it?

## Decisions

- The article opens in **reading mode**: full text of the chosen edition, section by section, problems
  highlighted in the exact sentence.
- **Issue cards in the margin, facing their sentence** (Google Docs comments). Selecting a card highlights
  the sentence and the reverse. Filters by type, progress "n / N handled".
- Issue types: facts that differ or are missing (Facts), wording (Wording), contradictions with other
  articles (SQL dates + Claude, Claude figures + SQL check), stale Finnish facts (history), missing content
  (placed at the section where it would go).
- Each issue has a **status** (open / fixed / not a problem) stored in MariaDB in a **system-versioned
  table**: who dismissed what and when stays queryable.
- **Compare languages** switch: read-only, two columns aligned passage by passage (alignment in SQL with
  vector distances); gaps = missing content; each section links to the real Wikipedia editor.
- **Edit**: the real Wikipedia editor cannot be embedded (`X-Frame-Options: DENY`). Edit links open
  Wikipedia at the section. Optional if time allows: Finnish wikitext editor (@bhsd/codemirror-mediawiki,
  same highlighting as Wikipedia's source editor) with our highlights and an attribution summary.
- Tabs: **Article** (default) · **Facts table** (kept; a row opens the sentence in Article) · **Related
  articles** · **History**.

## Build order (≈ 11 h + 2 h buffer)

1. Backend: article text, unified issues list from stored analyses, issue status table (SVT), SQL alignment. ~2 h
2. Article tab: highlighted text, margin cards aligned to sentences, filters, statuses. ~3.5 h
3. Compare mode: two aligned columns, read-only, edit links. ~2 h
4. Header switches, tabs, facts table click-through. ~1 h
5. Optional: Finnish wikitext editor. ~2 h
6. Polish, precompute demo topics, README. ~1.5 h

## Ideas kept for later

Facts age as git-blame annotations ("since 2014"), minimap of the three articles, J/K keyboard navigation,
interlinear compare mode, quick-fix actions (insert translated passage with attribution into a draft).
