-- Muisti — one MariaDB 12.3 database for cited cross-language search and Wikipedia time travel.
-- Rules and query templates: .claude/skills/mariadb-wiki-sql/SKILL.md
-- Every table keeps Wikipedia's own page_id / rev_id, so every result links back:
--   https://<lang>.wikipedia.org/?curid=<page_id>   or   ?oldid=<rev_id>

SET time_zone = '+00:00';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. NOW — dataset S (History of Finland, fi/sv/en, current text)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS article (
  lang          CHAR(2)      NOT NULL,
  page_id       INT UNSIGNED NOT NULL,
  rev_id        INT UNSIGNED NOT NULL,
  wikidata_id   VARCHAR(20),
  title         VARCHAR(255) NOT NULL,
  url           VARCHAR(500) NOT NULL,
  date_modified DATETIME,
  text          MEDIUMTEXT   NOT NULL,
  PRIMARY KEY (lang, page_id),
  KEY wikidata (wikidata_id, lang),
  KEY title (title)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;

-- One vector per article (ready-made bge-m3 vectors from dataset S).
CREATE TABLE IF NOT EXISTS article_vector (
  lang       CHAR(2)      NOT NULL,
  page_id    INT UNSIGNED NOT NULL,
  model      VARCHAR(50)  NOT NULL,
  truncated  BOOL         NOT NULL,
  embedding  VECTOR(1024) NOT NULL,
  PRIMARY KEY (lang, page_id),
  VECTOR INDEX (embedding) M=16 DISTANCE=cosine          -- values given by MariaDB (starter)
);

CREATE TABLE IF NOT EXISTS category_link (
  parent VARCHAR(255) NOT NULL,
  child  VARCHAR(255) NOT NULL,
  PRIMARY KEY (parent, child),
  KEY child (child)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS article_category (
  lang     CHAR(2)      NOT NULL,
  page_id  INT UNSIGNED NOT NULL,
  category VARCHAR(255) NOT NULL,
  PRIMARY KEY (lang, page_id, category),
  KEY category (category, lang, page_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;

-- Passages: one row per section piece. text_stem = Snowball-stemmed text (fi/sv/en),
-- so FULLTEXT matches inflected Finnish forms (Suomi / Suomen / Suomessa -> suom).
CREATE TABLE IF NOT EXISTS chunk (
  chunk_id   INT UNSIGNED      NOT NULL,
  lang       CHAR(2)           NOT NULL,
  page_id    INT UNSIGNED      NOT NULL,
  chunk_idx  SMALLINT UNSIGNED NOT NULL,
  section    VARCHAR(255),
  text       TEXT              NOT NULL,
  text_stem  TEXT              NOT NULL,
  PRIMARY KEY (chunk_id),
  UNIQUE KEY page_chunk (lang, page_id, chunk_idx)
  -- FULLTEXT (text_stem) is added AFTER the bulk load (much faster): db/indexes.sql
) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS chunk_vector (
  chunk_id   INT UNSIGNED NOT NULL,
  embedding  VECTOR(1024) NOT NULL,
  PRIMARY KEY (chunk_id),
  VECTOR INDEX (embedding) M=16 DISTANCE=cosine
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. EVERY VERSION — dataset M (862,076 versions, 2002 → 2026), system-versioned
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per article = what Wikipedia shows today. Every earlier version is a history row
-- written with Wikipedia's real edit time (system_versioning_insert_history), so
-- FOR SYSTEM_TIME AS OF '2015-06-01' = what Wikipedia showed on 1 June 2015.

CREATE TABLE IF NOT EXISTS article_history (
  page_id    INT UNSIGNED NOT NULL,
  title      VARCHAR(255) NOT NULL,
  rev_id     INT UNSIGNED NOT NULL,
  parent_id  INT UNSIGNED,
  user       VARCHAR(255),
  anonymous  BOOL NOT NULL DEFAULT 0,
  comment    TEXT,
  minor      BOOL NOT NULL DEFAULT 0,
  sha1       CHAR(31),
  len        INT UNSIGNED,
  text       MEDIUMTEXT COMPRESSED NOT NULL,
  row_start  TIMESTAMP(6) GENERATED ALWAYS AS ROW START INVISIBLE,
  row_end    TIMESTAMP(6) GENERATED ALWAYS AS ROW END INVISIBLE,
  PERIOD FOR SYSTEM_TIME (row_start, row_end),
  PRIMARY KEY (page_id),
  -- MariaDB's own history index is ordered by row_end; "AS OF <old date>" needs row_start.
  -- Covering for timelines: never touches the COMPRESSED text.
  KEY timeline (page_id, row_start, rev_id, len, sha1, anonymous, minor)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci
  WITH SYSTEM VERSIONING
  PARTITION BY SYSTEM_TIME INTERVAL 1 YEAR STARTS '2002-01-01 00:00:00' AUTO PARTITIONS 26;

-- Precomputed once from the history (history never changes): one row per version.
CREATE TABLE IF NOT EXISTS revision (
  page_id      INT UNSIGNED NOT NULL,
  rev_id       INT UNSIGNED NOT NULL,
  ts           TIMESTAMP(6) NOT NULL,
  user         VARCHAR(255),
  anonymous    BOOL NOT NULL,
  minor        BOOL NOT NULL,
  len          INT UNSIGNED,
  delta        INT,
  sha1         CHAR(31),
  comment      VARCHAR(500),
  is_revert    BOOL NOT NULL DEFAULT 0,   -- text equals an earlier version, not the previous one
  reverted_user VARCHAR(255),             -- whose edit was undone (previous version's editor)
  reverted_anonymous BOOL NOT NULL DEFAULT 0,
  PRIMARY KEY (page_id, ts, rev_id),
  UNIQUE KEY rev (rev_id),
  KEY reverts (page_id, is_revert, ts)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;

-- Edit-war metrics per article and year (Sumi et al. controversy M + simple counts).
CREATE TABLE IF NOT EXISTS edit_war_year (
  page_id         INT UNSIGNED NOT NULL,
  year            SMALLINT     NOT NULL,
  edits           INT UNSIGNED NOT NULL,
  editors         INT UNSIGNED NOT NULL,
  reverts         INT UNSIGNED NOT NULL,
  named_reverts   INT UNSIGNED NOT NULL,   -- named user undoing another named user
  mutual_pairs    INT UNSIGNED NOT NULL,   -- pairs of editors who reverted each other
  controversy_m   DOUBLE       NOT NULL,
  PRIMARY KEY (page_id, year),
  KEY hot (year, controversy_m)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. MEANING OVER TIME — yearly snapshots of selected articles, embedded
-- ─────────────────────────────────────────────────────────────────────────────
-- Not partitioned: MariaDB refuses a VECTOR INDEX on a partitioned table (tested: ERROR 1506).

CREATE TABLE IF NOT EXISTS snapshot (
  page_id   INT UNSIGNED NOT NULL,
  year      SMALLINT     NOT NULL,      -- state on 1 January of that year (and "now" = 9999)
  rev_id    INT UNSIGNED NOT NULL,
  ts        TIMESTAMP(6) NOT NULL,      -- when that version was saved
  len       INT UNSIGNED NOT NULL,
  embedding VECTOR(1024) NOT NULL,      -- whole cleaned article
  PRIMARY KEY (page_id, year)
);

CREATE TABLE IF NOT EXISTS snapshot_chunk (
  snap_chunk_id INT UNSIGNED      NOT NULL,
  page_id       INT UNSIGNED      NOT NULL,
  year          SMALLINT          NOT NULL,
  rev_id        INT UNSIGNED      NOT NULL,
  chunk_idx     SMALLINT UNSIGNED NOT NULL,
  section       VARCHAR(255),
  text          TEXT              NOT NULL,
  embedding     VECTOR(1024)      NOT NULL,
  PRIMARY KEY (snap_chunk_id),
  UNIQUE KEY page_year_chunk (page_id, year, chunk_idx),
  VECTOR INDEX (embedding) M=16 DISTANCE=cosine
) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. BITEMPORAL FACTS — history time (application period) × Wikipedia time (system period)
-- ─────────────────────────────────────────────────────────────────────────────
-- Facts parsed from infoboxes in every version (no LLM): e.g. a war's dates and casualties,
-- a person's term of office. valid_time = when it was true in history (DATE, pre-1970 ok);
-- system time = when Wikipedia stated it (real revision times). Tested: tests/sql/h1_bitemporal.sql

CREATE TABLE IF NOT EXISTS fact (
  fact_id     BIGINT UNSIGNED NOT NULL,
  page_id     INT UNSIGNED    NOT NULL,
  field       VARCHAR(64)     NOT NULL,      -- infobox parameter, e.g. 'tappiot1'
  value       VARCHAR(1000)   NOT NULL,      -- cleaned value as stated
  num         BIGINT          NULL,          -- first number in the value (e.g. casualties), for charts
  rev_id      INT UNSIGNED    NOT NULL,      -- first revision stating it
  valid_from  DATE            NOT NULL,
  valid_to    DATE            NOT NULL,
  valid_known BOOL            NOT NULL DEFAULT 1,   -- 0: event dates could not be parsed (whole range)
  PERIOD FOR valid_time (valid_from, valid_to),
  row_start   TIMESTAMP(6) GENERATED ALWAYS AS ROW START INVISIBLE,
  row_end     TIMESTAMP(6) GENERATED ALWAYS AS ROW END INVISIBLE,
  PERIOD FOR SYSTEM_TIME (row_start, row_end),
  PRIMARY KEY (fact_id),
  UNIQUE KEY one_value (page_id, field, valid_time WITHOUT OVERLAPS),
  KEY by_field (field, page_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci
  WITH SYSTEM VERSIONING;

-- Snapshot moments: the state of each article on 1 January of each year.
CREATE TABLE IF NOT EXISTS snapshot_year (
  year SMALLINT NOT NULL PRIMARY KEY,
  t    TIMESTAMP(6) NOT NULL
);
INSERT IGNORE INTO snapshot_year (year, t)
WITH RECURSIVE y AS (SELECT 2004 AS year UNION ALL SELECT year + 1 FROM y WHERE year < 2026)
SELECT year, TIMESTAMP(CONCAT(year, '-01-01 00:00:00')) FROM y;

-- Per-article totals for the edit-war ranking (precomputed by db/analytics.sql).
CREATE TABLE IF NOT EXISTS article_controversy (
  page_id        INT UNSIGNED NOT NULL PRIMARY KEY,
  title          VARCHAR(255) NOT NULL,
  controversy_m  DOUBLE       NOT NULL,
  mutual_pairs   INT UNSIGNED NOT NULL,
  named_reverts  INT UNSIGNED NOT NULL,
  reverts        INT UNSIGNED NOT NULL,
  edits          INT UNSIGNED NOT NULL,
  peak_year      SMALLINT,
  KEY ranking (controversy_m, named_reverts)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;

-- 4. SCALE — dataset L (all 568,416 Finnish articles, current text): stemmed full-text at Wikipedia scale.
CREATE TABLE IF NOT EXISTS article_l (
  page_id     INT UNSIGNED NOT NULL PRIMARY KEY,
  wikidata_id VARCHAR(20),
  title       VARCHAR(255) NOT NULL,
  text        MEDIUMTEXT COMPRESSED NOT NULL,
  text_stem   MEDIUMTEXT NOT NULL,
  KEY title (title)
  -- FULLTEXT (title, text_stem) added after the load: pipeline/load_l.py
) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;

-- 5. WRITER WORKSPACE — AI analyses computed on demand and stored (never precomputed in advance).
-- Keyed by the revisions of the articles analysed: when an article changes, rev_key changes and the
-- analysis is recomputed on the next visit.
CREATE TABLE IF NOT EXISTS analysis (
  kind         VARCHAR(32)  NOT NULL,           -- 'framing', 'facts', ...
  wikidata_id  VARCHAR(20)  NOT NULL,
  rev_key      VARCHAR(255) NOT NULL,           -- e.g. 'en:1307003624|fi:23498098|sv:5998123'
  model        VARCHAR(64)  NOT NULL,
  result       JSON         NOT NULL,
  input_tokens  INT UNSIGNED,
  output_tokens INT UNSIGNED,
  seconds      DECIMAL(6,1),
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (kind, wikidata_id, rev_key),
  CHECK (JSON_VALID(result))
) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;
