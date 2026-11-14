-- Secondary indexes created AFTER bulk loads (FULLTEXT builds much faster on a full table).
-- Then fresh statistics/histograms for the optimizer (official skill: ANALYZE TABLE after bulk inserts).
ALTER TABLE chunk ADD FULLTEXT INDEX IF NOT EXISTS ft_stem (text_stem);
ANALYZE TABLE article, article_vector, chunk, chunk_vector, category_link, article_category PERSISTENT FOR ALL;
