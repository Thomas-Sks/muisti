-- Precomputed edit-history analytics. History never changes, so these run ONCE after load_m
-- (window functions over 862k rows on every HTTP request would not scale). See SKILL.md §3.
SET time_zone = '+00:00';

-- 1. One row per version, with size change and revert detection, in one pass of window functions.
--    A revert = text (sha1) differs from the previous version but equals an earlier one.
--    Both windows share PARTITION BY page_id ORDER BY row_start -> one sort.
TRUNCATE TABLE revision;
INSERT INTO revision (page_id, rev_id, ts, user, anonymous, minor, len, delta, sha1, comment,
                      is_revert, reverted_user, reverted_anonymous)
SELECT page_id, rev_id, row_start, user, anonymous, minor, len,
       CAST(len AS SIGNED) - CAST(COALESCE(prev_len, 0) AS SIGNED),
       sha1, LEFT(comment, 500),
       is_revert,
       IF(is_revert, prev_user, NULL),
       IF(is_revert, COALESCE(prev_anon, 0), 0)
FROM (
  SELECT page_id, rev_id, row_start, user, anonymous, minor, len, sha1, comment,
         LAG(len)       OVER w AS prev_len,
         LAG(user)      OVER w AS prev_user,
         LAG(anonymous) OVER w AS prev_anon,
         COALESCE(sha1 <> LAG(sha1) OVER w
                  AND MIN(row_start) OVER (PARTITION BY page_id, sha1) < row_start, 0) AS is_revert
  FROM article_history FOR SYSTEM_TIME ALL
  WINDOW w AS (PARTITION BY page_id ORDER BY row_start)
) v;

-- 2. Edit wars per article and year: controversy measure M (Sumi, Yasseri et al. 2011,
--    arXiv:1107.3689). Mutual reverts = two named editors who reverted each other.
--    M = E * (sum over mutual pairs of min(N_a, N_b) - the largest such term), where N = the
--    editor's edits that year and E = number of editors in mutual pairs. Anonymous-vandalism
--    cleanup is excluded: it is not a war.
TRUNCATE TABLE edit_war_year;
INSERT INTO edit_war_year (page_id, year, edits, editors, reverts, named_reverts, mutual_pairs, controversy_m)
WITH r AS (
  SELECT page_id, YEAR(ts) AS y, user AS a, reverted_user AS b
  FROM revision
  WHERE is_revert AND NOT anonymous AND NOT reverted_anonymous
    AND reverted_user IS NOT NULL AND user <> reverted_user
),
pairs AS (
  SELECT DISTINCT r1.page_id, r1.y, LEAST(r1.a, r1.b) AS u1, GREATEST(r1.a, r1.b) AS u2
  FROM r r1 JOIN r r2 ON r2.page_id = r1.page_id AND r2.y = r1.y AND r2.a = r1.b AND r2.b = r1.a
),
n AS (
  SELECT page_id, YEAR(ts) AS y, user, COUNT(*) AS edits
  FROM revision GROUP BY page_id, YEAR(ts), user
),
w AS (
  SELECT p.page_id, p.y, p.u1, p.u2, LEAST(n1.edits, n2.edits) AS w
  FROM pairs p
  JOIN n n1 ON n1.page_id = p.page_id AND n1.y = p.y AND n1.user = p.u1
  JOIN n n2 ON n2.page_id = p.page_id AND n2.y = p.y AND n2.user = p.u2
),
e AS (
  SELECT page_id, y, COUNT(DISTINCT u) AS editors_in_war
  FROM (SELECT page_id, y, u1 AS u FROM pairs UNION ALL SELECT page_id, y, u2 FROM pairs) x
  GROUP BY page_id, y
),
m AS (
  SELECT w.page_id, w.y, COUNT(*) AS mutual_pairs,
         e.editors_in_war * (SUM(w.w) - MAX(w.w)) AS controversy_m
  FROM w JOIN e ON e.page_id = w.page_id AND e.y = w.y
  GROUP BY w.page_id, w.y, e.editors_in_war
),
base AS (
  SELECT page_id, YEAR(ts) AS y, COUNT(*) AS edits, COUNT(DISTINCT user) AS editors,
         SUM(is_revert) AS reverts,
         SUM(is_revert AND NOT anonymous AND NOT reverted_anonymous) AS named_reverts
  FROM revision GROUP BY page_id, YEAR(ts)
)
SELECT b.page_id, b.y, b.edits, b.editors, b.reverts, b.named_reverts,
       COALESCE(m.mutual_pairs, 0), COALESCE(m.controversy_m, 0)
FROM base b LEFT JOIN m ON m.page_id = b.page_id AND m.y = b.y;

ANALYZE TABLE revision, edit_war_year PERSISTENT FOR ALL;

-- 3. Per-article totals, so the ranking page reads 25 rows from an index instead of aggregating 172k.
TRUNCATE TABLE article_controversy;
INSERT INTO article_controversy (page_id, title, controversy_m, mutual_pairs, named_reverts, reverts, edits, peak_year)
SELECT w.page_id, h.title, SUM(w.controversy_m), SUM(w.mutual_pairs), SUM(w.named_reverts), SUM(w.reverts), SUM(w.edits),
       (SELECT x.year FROM edit_war_year x WHERE x.page_id = w.page_id
        ORDER BY x.controversy_m DESC, x.named_reverts DESC LIMIT 1)
FROM edit_war_year w JOIN article_history h ON h.page_id = w.page_id
GROUP BY w.page_id, h.title;
ANALYZE TABLE article_controversy PERSISTENT FOR ALL;
