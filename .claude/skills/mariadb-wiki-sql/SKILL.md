---
name: mariadb-wiki-sql
description: Règles et gabarits SQL du projet Wikipédia × MariaDB 12.3 (vecteurs, recherche hybride RRF, tables versionnées, bitemporel, chargement en masse). À utiliser AVANT d'écrire, modifier ou optimiser toute requête SQL, tout schéma, index, script de chargement ou réglage MariaDB de ce projet, et pour diagnostiquer une requête lente.
---

# SQL MariaDB du projet — règles, gabarits, méthode

Cible : **MariaDB 12.3 LTS** (image `mariadb:12.3`), port 3309. Specs : `SPECS.md`.
Légende : **[V]** vérifié dans la doc · **[I]** déduit, à confirmer par `ANALYZE` · **[U]** non vérifié, tester.

**Articulation avec le skill officiel `mariadb-query-optimization`** (installé à côté, copie du commit 5895ef8 de https://github.com/MariaDB/skills) : il couvre l'optimisation générale (préfixe gauche, index couvrants, histogrammes, pagination par curseur, switches et hints). **Ce skill-ci prime pour ce projet** : il suppose 11.8, nous sommes en **12.3** (hints 12.x disponibles), et il ne traite ni les vecteurs, ni le RRF, ni les SVT.

Repris du skill officiel et appliqués ici :
- **`ANALYZE TABLE` après chaque chargement en masse** (histogrammes à jour, sinon mauvais plans).
- **Garde-fous sur toutes les requêtes déclenchées par l'utilisateur** : hint `/*+ MAX_EXECUTION_TIME(2000) */` (12.0+) ou `LIMIT … ROWS EXAMINED n` (spécifique MariaDB ; renvoie un résultat partiel + avertissement → à signaler dans l'UI).
- **Tester l'utilité d'un index sans le supprimer** : `ALTER TABLE t ALTER INDEX idx IGNORED;` (pas `INVISIBLE`).

Complément possible (non installé) : MCP `bytebase/dbhub` avec `explain_sql`, connecté avec un **utilisateur en lecture seule** : https://github.com/bytebase/dbhub

## 0. Méthode obligatoire (pour toute requête « chaude » de l'app)

1. Écrire la requête avec les gabarits ci-dessous.
2. `ANALYZE FORMAT=JSON <requête>` (⚠️ **exécute** la requête : jamais sur un UPDATE/DELETE réel). Lire `r_rows`, `r_filtered`, `r_total_time_ms`, `r_engine_stats.pages_accessed`. [V]
3. Contrôle croisé : `FLUSH STATUS; <requête>; SHOW SESSION STATUS LIKE 'Handler_read%';` — un gros `Handler_read_rnd_next` = scan complet. **`EXPLAIN` peut nommer l'index vectoriel alors que la requête lit 22 000 lignes** (constaté par le starter RAG).
4. Critère : lignes lues ≈ lignes utiles × petit facteur. Sinon, corriger avant de proposer un index.
5. Archiver le JSON dans `perf/<nom_requete>.json` + la latence p50/p95 dans `perf/RESULTS.md` (sert au tableau du README, critère « scalabilité » du jury).

Erreurs fréquentes des LLM sur MariaDB : ce n'est **pas** MySQL 8. `ANALYZE SELECT` / `ANALYZE FORMAT=JSON` (pas `EXPLAIN ANALYZE`), pas de `FORMAT=TREE`, index `IGNORED` (pas `INVISIBLE`), collation `utf8mb4_uca1400_ai_ci` (pas `utf8mb4_0900_ai_ci`), pagination par curseur (pas `OFFSET` profond).

## 1. Vecteurs (HNSW)

- L'index n'est utilisé **que** pour `ORDER BY VEC_DISTANCE_COSINE(col, @q) LIMIT n` **ASC**, directement sur la table indexée, avec **la même distance que l'index** (cosine ici). Toute autre forme (`WHERE dist < x`, expression autour de la distance, autre fonction, `ROW_NUMBER() OVER (ORDER BY VEC_DISTANCE…)`) = scan complet. [V]
- Réglages fournis par MariaDB : `VECTOR INDEX (embedding) M=16 DISTANCE=cosine` + `SET mhnsw_ef_search = 80;` (session). Un `LIMIT` plus grand agit comme un `ef` plus grand. [V]
- **`mhnsw_max_cache_size` = 16 MB par défaut : beaucoup trop petit.** 150 k chunks × 1024 × 4 o ≈ 600 MB. Mettre **2G** (global). [V]
- `WHERE` est appliqué **après** l'index → moins de k résultats possibles. **Sur-échantillonner puis filtrer dehors.** [V]
- Index construit ligne par ligne à l'insertion (pas de build en masse plus rapide documenté). [V] Ajouter l'index après chargement : gain non prouvé [U] → mesurer.
- Pas de table partitionnée avec index vectoriel ; 1 index vectoriel par table ; colonne `NOT NULL`. [V]
- `INFORMATION_SCHEMA.VECTOR_INDEXES` n'existe qu'à partir de 13.1 (absent en 12.3). [V]

```sql
-- Gabarit : recherche vectorielle + jointure (sous-requête = index utilisé)
SET mhnsw_ef_search = 80;
SELECT c.lang, c.page_id, c.chunk_idx, c.text, v.d
FROM (SELECT lang, page_id, chunk_idx, VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) AS d
      FROM chunk_vector ORDER BY d LIMIT 20) v
JOIN chunk c USING (lang, page_id, chunk_idx)
ORDER BY v.d;

-- Gabarit : filtre (langue, catégorie, page) = sur-échantillonnage puis filtre
SELECT * FROM (SELECT lang, page_id, chunk_idx, VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) AS d
               FROM chunk_vector ORDER BY d LIMIT 300) t
WHERE t.lang = 'sv'
ORDER BY d LIMIT 20;
-- Petite catégorie (< ~500 articles) : filtrer D'ABORD (scan exact rapide, cf. starter : 14 ms).
-- Grande catégorie : sur-échantillonner (le filtre d'abord coûte 2 s sur tout le corpus).
```

## 2. Recherche hybride (RRF)

- Chaque branche est **plafonnée à son top N dans sa propre table dérivée**, puis fusion. [I]
- `IN BOOLEAN MODE` ne trie pas → `ORDER BY score DESC` explicite. [V]
- FULLTEXT sur `text_lemma` (finnois lemmatisé). `innodb_ft_enable_stopword=OFF` (la liste par défaut est anglaise), `innodb_ft_min_token_size=3` (redémarrage requis). [V]
- Créer le FULLTEXT **après** le chargement (« beaucoup plus rapide »). [V]

```sql
WITH v AS (
  SELECT lang, page_id, chunk_idx, ROW_NUMBER() OVER (ORDER BY d) AS r
  FROM (SELECT lang, page_id, chunk_idx, VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) AS d
        FROM chunk_vector ORDER BY d LIMIT 100) x),
f AS (
  SELECT lang, page_id, chunk_idx, ROW_NUMBER() OVER (ORDER BY s DESC) AS r
  FROM (SELECT lang, page_id, chunk_idx, MATCH(text_lemma) AGAINST (? IN BOOLEAN MODE) AS s
        FROM chunk WHERE MATCH(text_lemma) AGAINST (? IN BOOLEAN MODE)
        ORDER BY s DESC LIMIT 100) y)
SELECT lang, page_id, chunk_idx, SUM(1 / (60 + r)) AS score
FROM (SELECT * FROM v UNION ALL SELECT * FROM f) u
GROUP BY lang, page_id, chunk_idx
ORDER BY score DESC
LIMIT 10;
```

## 3. Tables versionnées (862 076 versions)

- Les requêtes sur l'**état actuel** ne lisent qu'une partition (avec `PARTITION BY SYSTEM_TIME`). [V]
- Une version est rangée dans la partition de l'année où elle **a cessé** d'être courante (`row_end`) → `AS OF` ancien lit presque toutes les partitions. Vérifier avec `EXPLAIN PARTITIONS`. Le partitionnement sert à **gérer la croissance**, pas à accélérer (mesuré par le starter). [V]/[I]
- **`KEY (page_id, row_start)` obligatoire** : l'index d'historique natif est trié par `row_end` (« AS OF 2005 » parcourait toutes les versions postérieures). Mesuré : 0,65 → 0,23 ms. [V starter]
- Pour les timelines : index **couvrant** `(page_id, row_start, sha1, len, user)` → on ne touche jamais au `MEDIUMTEXT COMPRESSED`. **Jamais `SELECT *` sous `FOR SYSTEM_TIME ALL`.** [I]
- L'historique ne change pas → **précalculer une fois** (reverts, métriques de guerre d'édition par article×année, dérive) dans des tables ordinaires. Ne pas relancer des fenêtrages sur 862 k lignes à chaque requête HTTP. [I]
- Chaque fonction de fenêtrage = un tri ; l'index ne l'évite pas. Mêmes `PARTITION BY`/`ORDER BY` pour `LAG` et `MIN` → un seul tri. Filtrer sur un résultat de fenêtrage = table dérivée. [V]
- `TIMESTAMP ?` en requête préparée exige `'YYYY-MM-DD HH:MM:SS'` (date nue refusée). `SET time_zone='+00:00'` partout. [V starter]

```sql
-- Article à une date
SELECT title, rev_id, user, text
FROM article_history FOR SYSTEM_TIME AS OF TIMESTAMP ?
WHERE page_id = ?;

-- Timeline sans toucher au texte (index couvrant)
SELECT rev_id, row_start, user, sha1, len
FROM article_history FOR SYSTEM_TIME ALL
WHERE page_id = ? ORDER BY row_start;

-- Précalcul des reverts, une fois, après chargement
CREATE TABLE rev_flags AS
SELECT page_id, rev_id, row_start, user,
       sha1 <> LAG(sha1) OVER w AND MIN(row_start) OVER (PARTITION BY page_id, sha1) < row_start AS is_revert
FROM article_history FOR SYSTEM_TIME ALL
WINDOW w AS (PARTITION BY page_id ORDER BY row_start);

-- Snapshots annuels en UNE passe (AS OF n'accepte qu'une constante)
SELECT h.page_id, y.t, h.rev_id
FROM article_history FOR SYSTEM_TIME ALL h
JOIN snapshot_years y ON h.row_start <= y.t AND h.row_end > y.t
WHERE h.page_id IN (...);
```

## 4. Bitemporel (`claim`)

- `WITHOUT OVERLAPS` doit être sur une `PRIMARY KEY`/`UNIQUE` → c'est aussi un index utilisable. `FOR PORTION OF` exige des bornes constantes. Les deux colonnes de période : même type, `NOT NULL`. [V]
- Dates historiques (avant 1970) **uniquement** en période applicative `DATE` ; le temps système est en `TIMESTAMP` (1970–2038). [V]

```sql
SELECT object, rev_id
FROM claim FOR SYSTEM_TIME AS OF TIMESTAMP '2012-01-01 00:00:00'
WHERE subject = ? AND predicate = ?
  AND valid_from <= '1918-03-15' AND valid_to > '1918-03-15';
```

## 5. Chargement en masse

- Le plus rapide : `LOAD DATA LOCAL INFILE` ; sinon INSERT multi-lignes **par taille** (≤ 8 MB par lot, cf. starter) sous `max_allowed_packet`. [V]
- Pendant le chargement : `SET unique_checks=0, foreign_key_checks=0;` `innodb_flush_log_at_trx_commit=2`, `innodb_log_file_size=2G` (dynamique depuis 10.9), optionnel `innodb_doublewrite=fast`. **Remettre les valeurs durables après.** [V]
- Index secondaires et FULLTEXT **après** le chargement ; augmenter `innodb_sort_buffer_size` et `innodb_ft_sort_pll_degree`. [V]
- Historique : `SET system_versioning_insert_history=1;` puis `INSERT … (…, row_start, row_end)` ; deux éditions dans la même seconde → +1 µs à la seconde (starter). Le bon routage vers les partitions `INTERVAL` : [U] → vérifier par `EXPLAIN PARTITIONS` / `information_schema.PARTITIONS`.

## 6. CTE et tables dérivées

- Les conditions sont poussées dans les dérivées/CTE avec `GROUP BY`/`DISTINCT`/fenêtrage (`condition_pushdown_for_derived=on`) → filtrer sur les colonnes de `PARTITION BY`/`GROUP BY`. [V]
- CTE récursive : `CAST(... AS VARCHAR(255))` dans la partie d'ancrage (sinon « Data too long »). `max_recursive_iterations` = 1000 par défaut. [V]
- Indices d'optimiseur 12.x : `JOIN_ORDER`, `QB_NAME` (12.0), `INDEX`/`NO_INDEX`, `[NO_]DERIVED_CONDITION_PUSHDOWN` (12.1). En dernier recours seulement. [V]

## 7. Configuration serveur (Docker)

```ini
[mariadb]
innodb_buffer_pool_size=6G        # hôte 16 GB ; 14G sur 32 GB
innodb_log_file_size=2G
innodb_log_buffer_size=64M
innodb_flush_log_at_trx_commit=1  # 2 pendant les chargements
innodb_ft_min_token_size=3
innodb_ft_enable_stopword=OFF
innodb_ft_sort_pll_degree=4
mhnsw_max_cache_size=2G
max_allowed_packet=256M
performance_schema=ON             # OFF par défaut
log_slow_query=1
log_slow_query_time=0.5
log_slow_verbosity=query_plan,explain,engine
```
Limite mémoire Docker > buffer pool + cache vectoriel + ~2G. Tailles = estimation [U] ; le buffer pool peut aller jusqu'à ~80 % de la RAM. [V]
Repérer les scans : `sys.schema_tables_with_full_table_scans` (nécessite `performance_schema=ON`).

## Sources
- ANALYZE FORMAT=JSON : https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/analyze-and-explain-statements/analyze-format-json
- Vecteurs : https://mariadb.com/docs/server/reference/sql-structure/vectors/vector-overview · variables : https://mariadb.com/docs/server/reference/sql-structure/vectors/vector-system-variables
- RRF : https://mariadb.com/docs/server/reference/sql-structure/vectors/optimizing-hybrid-search-query-with-reciprocal-rank-fusion-rrf
- FULLTEXT : https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/optimization-and-indexes/full-text-indexes/full-text-index-overview
- SVT : https://mariadb.com/docs/server/reference/sql-structure/temporal-tables/system-versioned-tables · périodes applicatives : https://mariadb.com/docs/server/reference/sql-structure/temporal-tables/application-time-periods
- Chargement : https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/query-optimizations/how-to-quickly-insert-data-into-mariadb
- Fenêtrage : https://mariadb.com/docs/server/reference/sql-functions/special-functions/window-functions/window-functions-overview
- Pushdown : https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/query-optimizations/optimizations-for-derived-tables/condition-pushdown-into-derived-table-optimization
- Starters (mesures de référence) : https://github.com/MariaDB/mariadb-vector-wikipedia-rag · https://github.com/MariaDB/mariadb-system-versioning-wikipedia
