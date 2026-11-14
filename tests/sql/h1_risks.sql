-- H+1 risk tests (SPECS.md §6). Run on a scratch schema.
DROP DATABASE IF EXISTS h1; CREATE DATABASE h1; USE h1;
SET time_zone = '+00:00';

-- R1: vector index on a system-versioned (non-partitioned) table
CREATE TABLE r1 (id INT PRIMARY KEY, v VECTOR(3) NOT NULL, VECTOR INDEX (v) M=16 DISTANCE=cosine)
  WITH SYSTEM VERSIONING;
INSERT INTO r1 VALUES (1, VEC_FromText('[1,0,0]')), (2, VEC_FromText('[0,1,0]'));
UPDATE r1 SET v = VEC_FromText('[0,0,1]') WHERE id = 2;
SELECT 'R1 current' t, id, VEC_ToText(v) FROM r1 ORDER BY VEC_DISTANCE_COSINE(v, VEC_FromText('[0,0,1]')) LIMIT 2;
SELECT 'R1 history rows' t, COUNT(*) FROM r1 FOR SYSTEM_TIME ALL;

-- R2: vector index on a table partitioned BY SYSTEM_TIME (expected to fail)
CREATE TABLE r2 (id INT PRIMARY KEY, v VECTOR(3) NOT NULL, VECTOR INDEX (v))
  WITH SYSTEM VERSIONING PARTITION BY SYSTEM_TIME INTERVAL 1 YEAR STARTS '2002-01-01' AUTO PARTITIONS 3;
