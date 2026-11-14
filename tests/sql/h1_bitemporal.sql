USE h1; SET time_zone = '+00:00';
-- R3: bitemporal claim table: application period (DATE, pre-1970 ok) + system versioning,
--     WITHOUT OVERLAPS, and backdated history via system_versioning_insert_history.
CREATE TABLE claim (
  claim_id BIGINT UNSIGNED NOT NULL,
  subject VARCHAR(100) NOT NULL, predicate VARCHAR(50) NOT NULL, object VARCHAR(100) NOT NULL,
  rev_id INT UNSIGNED NOT NULL,
  valid_from DATE NOT NULL, valid_to DATE NOT NULL,
  PERIOD FOR valid_time (valid_from, valid_to),
  row_start TIMESTAMP(6) GENERATED ALWAYS AS ROW START INVISIBLE,
  row_end   TIMESTAMP(6) GENERATED ALWAYS AS ROW END INVISIBLE,
  PERIOD FOR SYSTEM_TIME (row_start, row_end),
  PRIMARY KEY (claim_id),
  UNIQUE KEY one_holder (subject, predicate, valid_time WITHOUT OVERLAPS)
) WITH SYSTEM VERSIONING;

SET system_versioning_insert_history = 1;
-- What the article claimed from 2006 to 2012 (history row) ...
INSERT INTO claim (claim_id, subject, predicate, object, rev_id, valid_from, valid_to, row_start, row_end)
VALUES (1, 'Suomen valtionhoitaja', 'holder', 'P. E. Svinhufvud', 100, '1918-05-18', '1918-12-12',
        '2006-03-01 10:00:00', '2012-06-01 09:00:00');
-- ... and what it claims since 2012 (current row, corrected date)
INSERT INTO claim (claim_id, subject, predicate, object, rev_id, valid_from, valid_to, row_start)
VALUES (2, 'Suomen valtionhoitaja', 'holder', 'P. E. Svinhufvud', 200, '1918-05-18', '1918-12-12',
        '2012-06-01 09:00:00');
SET system_versioning_insert_history = 0;

SELECT 'R3 asof 2008' t, claim_id, rev_id, valid_from, valid_to FROM claim
  FOR SYSTEM_TIME AS OF TIMESTAMP '2008-01-01 00:00:00'
  WHERE subject = 'Suomen valtionhoitaja' AND valid_from <= '1918-07-01' AND valid_to > '1918-07-01';
SELECT 'R3 now' t, claim_id, rev_id FROM claim
  WHERE subject = 'Suomen valtionhoitaja' AND valid_from <= '1918-07-01' AND valid_to > '1918-07-01';

-- R4: overlapping holder must be refused
INSERT INTO claim (claim_id, subject, predicate, object, rev_id, valid_from, valid_to)
VALUES (3, 'Suomen valtionhoitaja', 'holder', 'C. G. E. Mannerheim', 300, '1918-11-01', '1919-07-27');
SELECT 'R4 after refused insert' t, COUNT(*) FROM claim;
-- R5: adjacent period accepted
INSERT INTO claim (claim_id, subject, predicate, object, rev_id, valid_from, valid_to)
VALUES (4, 'Suomen valtionhoitaja', 'holder', 'C. G. E. Mannerheim', 300, '1918-12-12', '1919-07-27');
SELECT 'R5 holders' t, object, valid_from, valid_to FROM claim ORDER BY valid_from;
