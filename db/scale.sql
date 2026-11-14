-- Indexes added after the SQL audit (ANALYZE FORMAT=JSON on every API query). Each line names the query it serves.
-- Idempotent: safe to re-run.

-- wars.py WARS_SQL: ORDER BY controversy_m DESC, named_reverts DESC LIMIT n read all 172k rows; now an index read.
ALTER TABLE edit_war_year ADD KEY IF NOT EXISTS ranking (controversy_m, named_reverts);

-- api.py /api/stats MIN(ts)/MAX(ts) over 862k revisions: answered from the index ends.
ALTER TABLE revision ADD KEY IF NOT EXISTS ts (ts);

-- topics.py overview: cached analyses of a topic looked up without `kind`.
ALTER TABLE analysis ADD KEY IF NOT EXISTS by_topic (wikidata_id, rev_key);

-- timemachine.py title search: prefix LIKE on the per-article summary (edits already counted there).
ALTER TABLE article_controversy ADD KEY IF NOT EXISTS title (title);

-- insights.py / topics.py topic search: title prefix and length without reading the article text.
ALTER TABLE article ADD COLUMN IF NOT EXISTS text_len INT UNSIGNED AS (LENGTH(text)) PERSISTENT,
                    ADD KEY IF NOT EXISTS title_qid (title, wikidata_id);

ANALYZE TABLE edit_war_year, revision, analysis, article_controversy, article PERSISTENT FOR ALL;
