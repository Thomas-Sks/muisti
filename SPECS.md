# Specs — Outil Wikipédia sur MariaDB (Junction 2026, défi MariaDB)

> ## État au 2026-11-14 (construit et mesuré — détails dans README.md, perf/EVAL.md, perf/RESULTS.md)
> | ID | Statut | Preuve |
> |---|---|---|
> | F1 passages cross-langue | ✅ | 122 351 passages vectorisés ; top-5 **81 %** vs 76 % (starter, reproduit) |
> | F2 hybride RRF + finnois raciné | ✅ (nuancé) | RRF pondéré 0,35 : top-10 **92 %** vs 86 % ; à poids égal il dégradait (70 %) → mode par défaut = vecteur |
> | F3 réponse extractive citée | ✅ partiel | passages exacts + `?oldid=` ; pas de synthèse LLM (pas de clé API) |
> | F4 time machine jeu M complet | ✅ | 862 076 versions, vraies dates, `AS OF` p50 3,4 ms |
> | F5 « que disait Wikipédia en 2010 » | ✅ | snapshots 200 articles × 23 ans ; recherche par année + passage d'aujourd'hui |
> | F6 bitemporel | ✅ | table `fact` (PERIOD FOR + SYSTEM VERSIONING, WITHOUT OVERLAPS), 4 484 faits ; vandalisme 256 875 du 10/04/2007 |
> | F9 angles morts fi/sv/en | ✅ | seuil calibré 0,40 |
> | F10 guerres d'édition + dérive | ✅ | M de Sumi en SQL, dérive par VEC_DISTANCE_COSINE |
> | F16 échelle S/M/L | ✅ partiel | L chargé (568 416 articles, FULLTEXT p50 86 ms) ; pas de vecteurs sur L |
> | F7 origine d'une phrase | ✅ | recherche dichotomique FOR SYSTEM_TIME + bge-m3, 3–9 s, détecte la reformulation |
> | F19 LLM vs Wikipédia | ✅ | onglet « AI vs Wikipedia » : claude-sonnet-5-5 répond de mémoire, chaque affirmation vérifiée contre les passages MariaDB |
> | F8 contradictions | ✅ à la demande | onglet « Wikipedia vs itself » : vecteurs stockés → index HNSW (~70 ms), Sonnet juge les paires (~12 s) ; ex. fin de la guerre civile 15 vs 16 mai 1918 |
> | Edit wars (refonte) | ✅ | les mots disputés de chaque guerre (retirés / remis, N allers-retours, résumés d'édition) |
> | F11–F15, F17, F18 | ❌ non construits | bonus P2 |


> Objectif : **réaliser toutes les specs ci-dessous et qu'elles fonctionnent**, mesurées.
> Chaque fonctionnalité a un ID, la fonction MariaDB qu'elle exploite et des **critères d'acceptation** vérifiables.
> Rédigé le 2026-11-14 à partir de 7 recherches web (sous-agents) et de la lecture des 3 dépôts fournis.

---

## 0. Pitch en une phrase

**« Le Wikipédia qui se souvient »** : poser une question dans sa langue, obtenir des **passages cités** (pas de texte inventé) du Wikipédia finnois,
puis voyager dans le temps — *« que disait Wikipédia en 2015 sur 1918, qu'est-ce qui a changé, qui l'a changé, et est-ce contesté ? »* —
le tout en SQL dans MariaDB (vecteurs + tables versionnées + périodes applicatives = **bitemporel**).

Pistes du défi couvertes : **RAG + SVT (« BOTH »)**, explicitement valorisée par le jury.

---

## 1. Ce que les starters fournissent déjà (NE PAS refaire — partir de là)

Les trois dépôts officiels (Robert Silén, MariaDB Foundation, oct. 2026) :

| Dépôt | Ce qu'il fait déjà | Ce qu'il marque « à faire » (= notre terrain) |
|---|---|---|
| [mariadb-wikipedia-datasets](https://github.com/MariaDB/mariadb-wikipedia-datasets) | Jeux **S** (19 285 fi + 4 921 sv + 5 254 en, Markdown propre, **vecteurs bge-m3 1024d par article**, arbre de catégories, `wikidata_id`), **M** (862 076 versions de 19 742 articles fi, 2003→oct. 2026, wikitext brut, user/comment/sha1), **L** (568 416 articles fi, sans vecteurs) | — |
| [mariadb-vector-wikipedia-rag](https://github.com/MariaDB/mariadb-vector-wikipedia-rag) | Recherche sémantique **cross-langue** fi/sv/en (top-5 = 76 %, top-10 = 86 % sur 37 questions ; FULLTEXT : 16 % / 41 %), filtre langue + catégorie (CTE récursive), page Flask, index tuné `M=16`, `mhnsw_ef_search=80` | **Hybrid search (RRF)**, **chunks**, **« Ask » (réponse sourcée)**, 1 résultat par topic (`wikidata_id`), préférence de langue, nouveau modèle d'embedding |
| [mariadb-system-versioning-wikipedia](https://github.com/MariaDB/mariadb-system-versioning-wikipedia) | « Time Machine » : table `WITH SYSTEM VERSIONING` avec vraies dates Wikipédia (`system_versioning_insert_history`), `AS OF`, timeline SVG, reverts (sha1 + `LAG`), diff entre deux dates, distinction revert anonyme / entre utilisateurs nommés — **50 articles seulement** | **Les ~19 750 articles**, **chargement depuis les Parquet du jeu M**, **« Step 7 : combiner avec le RAG »** (un vecteur par article par an), bitemporel (option « c » écartée par eux) |

### Faiblesses mesurées par les starters (= nos gains démontrables)
- **Un vecteur par article trouve le sujet, pas le fait** : *« Qui était président de 1956 à 1982 ? »* ne trouve pas Kekkonen dans le top 10 ; 3/5 questions sur les présidents ratées ; *« Qui dirigeait la Finlande pendant la guerre d'Hiver »* renvoie la guerre, pas les dirigeants.
- **290 articles tronqués** (> 8 192 tokens), dont les plus importants (*Talvisota*).
- **FULLTEXT sans racinisation finnoise** : chaque forme fléchie est un mot différent.
- **Filtre catégorie large = 2 s** (l'index vectoriel n'est plus utilisé).
- **Requête « à plat » = 50 ms au lieu de 1 ms** (il faut une sous-requête pour que l'index serve).
- **La plupart des reverts sont du nettoyage de vandalisme**, pas des guerres d'édition.

> **Règle d'or** : chaque feature doit **battre un chiffre du starter** ou **faire ce qu'il marque « à faire »**. Le jury connaît ces dépôts (même auteur que les mentors).

---

## 2. Stack et contraintes techniques

- **MariaDB `mariadb:12.3`** (LTS jusqu'en juin 2029, image testée par les starters en 12.3.3). Ports : RAG starter = 3307, SVT starter = 3308 → **nous : une seule base sur 3309** contenant les deux.
- **Embeddings** : bge-m3 (1024d) via Ollama, **le même modèle pour les questions** (les vecteurs S en dépendent). Débit mesuré : ~100 articles/min sur Mac M4 → **budget chunks à vérifier sur notre machine (GPU ?)**.
- **LLM** (pour la génération contrainte/extraction/jugement) : Claude (API) — à confirmer ; jamais en génération libre visible par l'utilisateur sans citation.
- **Backend** : Python (repartir de `common.py` des starters). **Front** : à décider (Flask + HTMX comme les starters, ou un front plus riche pour la démo).

### Réglages donnés par MariaDB (ne pas re-tuner, reprendre tels quels)
- `VECTOR INDEX (embedding) M=16 DISTANCE=cosine` et `SET mhnsw_ef_search = 80;` — valeurs fournies par l'équipe MariaDB (starter RAG). Avec les défauts (`M=6`, `ef_search=20`), seulement 79 % du vrai top 10 ; avec ces valeurs : 100 %, ~5 ms. À appliquer aussi à `chunk_vector` et `snapshot_chunk_vector` ; re-mesurer le rappel une fois avec les chunks (plus de vecteurs) pour confirmer.

### Limites MariaDB à respecter (vérifiées)
| Limite | Conséquence pour nous |
|---|---|
| Index vectoriel utilisé **seulement** pour `ORDER BY VEC_DISTANCE_*(col, const) LIMIT n` sur la table indexée | Toujours une sous-requête vectorielle, puis jointure |
| **1 index vectoriel par table**, colonne `NOT NULL`, **pas de tables partitionnées** | La table `article` du starter SVT est partitionnée BY SYSTEM_TIME → vecteurs des versions dans **une table séparée non partitionnée** |
| `WHERE` appliqué **après** l'index (post-filtre) | Prendre un `LIMIT` large (ex. 200) puis filtrer, ou filtre-d'abord pour petites catégories |
| SVT en `TIMESTAMP` : 1970 → 2038 | OK pour les révisions (2002+) ; **les dates historiques (1809, 1918) vont dans une période applicative `DATE`** |
| FULLTEXT sans racinisation finnoise ; pas de parser ngram | Colonne **lemmatisée** (Voikko / libvoikko, ou spaCy fi) indexée en FULLTEXT |
| Pas de `CREATE TEMPORARY TABLE` versionnée ; `TIMESTAMP ?` refuse une date nue ; paquets > 16 MB | Repris des leçons du starter SVT |
| **SVT + index vectoriel sur la même table : non vérifié** | **Test H+1** (voir §6). Plan B : table d'embeddings séparée liée à `(page_id, rev_id)` |
| Fonctions IA « in-database » : **Enterprise uniquement** | Embeddings et LLM hors base |

---

## 3. Fonctionnalités

Priorités : **P0** = socle indispensable à la démo · **P1** = différenciateurs (au moins 2 livrés) · **P2** = bonus si temps.

### P0 — Socle

#### F1. Recherche par passages (chunks) cross-langue
- **Quoi** : découper chaque article S (fi/sv/en) par section Markdown (~200–400 mots, chevauchement), un vecteur bge-m3 par chunk. La recherche renvoie **le passage**, pas l'article.
- **MariaDB** : table `chunk` + `chunk_vector` (`VECTOR(1024)`, `VECTOR INDEX M=16 DISTANCE=cosine`), sous-requête indexée.
- **Acceptation** :
  - [ ] Sur les **37 questions du starter** (`data/test-questions.tsv`), top-5 **> 76 %** et top-10 **> 86 %** (chiffres du starter battus) ; tableau avant/après dans le README.
  - [ ] *« Qui était président de 1956 à 1982 ? »* → Kekkonen dans le top 5.
  - [ ] Plus aucun article tronqué (les 290 sont couverts par chunks).
  - [ ] Latence recherche < 100 ms (hors embedding de la question).
  - [ ] Résultats regroupés par topic (`wikidata_id`) : fi/sv/en d'un même sujet = 1 carte.

#### F2. Recherche hybride FULLTEXT + vecteur (RRF), finnois lemmatisé
- **Quoi** : colonne `text_lemma` (texte lemmatisé fi) + `FULLTEXT`, fusion **RRF en un seul SQL** (CTE + fonctions de fenêtrage), 3 modes comparables : Keyword / Vector / Hybrid.
- **MariaDB** : `FULLTEXT`, `MATCH … AGAINST`, CTE, `ROW_NUMBER() OVER`, vecteurs. Doc officielle RRF.
- **Acceptation** :
  - [ ] Questions avec noms propres / années (sous-ensemble des 37 + 10 nouvelles) : hybrid ≥ meilleur des deux modes seuls.
  - [ ] Démonstration *« Suomi » trouve « Suomen » / « Suomessa »* grâce à la lemmatisation (absent du starter).
  - [ ] Le SQL complet est affiché sous les résultats.

#### F3. « Ask » — réponse **extractive** et citée (pas de résumé génératif)
- **Quoi** : réponse dans la langue de la question, composée de **citations exactes** des passages retrouvés (traduites si besoin, original affiché), chaque citation liée à `?oldid=<rev_id>`. Le LLM sélectionne/ordonne/traduit, il n'invente pas. Si aucun passage ne répond → « Wikipédia ne le dit pas ».
- **Pourquoi** : la WMF a suspendu ses résumés IA au 2ᵉ jour (juin 2025) face aux éditeurs ; en test de recherche sémantique, les lecteurs croyaient les résultats générés par IA. Le jury cite la NPOV vs vision du monde des LLM.
- **Acceptation** :
  - [ ] 100 % des phrases de la réponse sont rattachées à un chunk + `rev_id` (vérif automatique : chaque citation est une sous-chaîne du chunk source, ou sa traduction avec l'original affiché).
  - [ ] Question hors corpus → refus explicite, pas d'hallucination (10 questions pièges).
  - [ ] Fonctionne en fr, en, sv, fi.

#### F4. Time Machine à l'échelle (jeu M complet)
- **Quoi** : charger **les ~19 750 articles / 862 076 versions** depuis les Parquet M (le starter : 50 articles, chargement Parquet « à faire »), vraies dates via `system_versioning_insert_history`. Curseur temporel : l'article **tel qu'il était** à une date, diff entre deux dates.
- **MariaDB** : `WITH SYSTEM VERSIONING`, `FOR SYSTEM_TIME AS OF / BETWEEN / ALL`, `MEDIUMTEXT COMPRESSED`, `KEY (page_id, row_start)`, partitionnement `BY SYSTEM_TIME INTERVAL 1 YEAR`.
- **Acceptation** :
  - [ ] 862 076 versions chargées, temps de chargement et taille disque mesurés (prévision starter : 5–7 GB).
  - [ ] `AS OF` < 5 ms p95 sur un échantillon de 1 000 (article, date) aléatoires — tableau comme le starter, mais à l'échelle ×400.
  - [ ] Tests unitaires repris/adaptés de `test_history.py` passent.

#### F5. Pont RAG ↔ temps : « que disait Wikipédia en 2015 ? »
- **Quoi** : un vecteur (ou des chunks) par article **par an** (snapshot au 1er janvier, choix suggéré par le starter SVT). Une question + une date → passages tels qu'ils étaient à cette date, puis « ce qui a changé depuis » (diff du passage entre la date et aujourd'hui).
- **MariaDB** : table `snapshot_chunk_vector (page_id, year, chunk_idx, rev_id, embedding)` non partitionnée + `AS OF` pour le texte. **C'est le « Step 7 » que le starter n'a pas fait.**
- **Acceptation** :
  - [ ] Pour 20 articles phares (guerre civile, guerre d'Hiver, présidents…), snapshots 2005→2026 embarqués.
  - [ ] Requête démo : *« Comment Wikipédia appelait-il la guerre de 1918 en 2006 ? »* → passage de 2006 cité avec `rev_id`, + passage actuel, + diff.
  - [ ] Une seule requête SQL (ou deux, affichées) fait vecteur + `AS OF`.

### P1 — Différenciateurs (en livrer au moins deux)

#### F6. Questions bitemporelles : temps historique × temps Wikipédia ⭐ (le plus « MariaDB »)
- **Quoi** : extraire des articles des **affirmations datées** (« Pehr Evind Svinhufvud chef d'État 1917–1918 », « Grand-duché 1809–1917 ») dans une table `claim` qui a **deux temps** :
  - **temps de validité** (la période historique) → `PERIOD FOR valid_time (valid_from, valid_to)` en `DATE` ;
  - **temps de transaction** (quand Wikipédia l'affirmait) → `WITH SYSTEM VERSIONING` (dates réelles des révisions).
- Requêtes impossibles ailleurs : *« Qu'affirmait Wikipédia en 2012 sur qui gouvernait la Finlande en mars 1918 ? »* ; *« Quelles dates historiques ont été corrigées, et quand ? »*
- `UNIQUE (role, valid_time WITHOUT OVERLAPS)` → **MariaDB refuse deux chefs d'État simultanés** = détection de contradictions sans IA.
- **MariaDB** : bitemporel (doc officielle : `PERIOD FOR application_time` + `WITH SYSTEM VERSIONING` dans la même table), `FOR PORTION OF`, `WITHOUT OVERLAPS`, `JSON_TABLE` pour les infobox.
- **Acceptation** :
  - [ ] ≥ 500 affirmations datées extraites (infobox via `JSON_TABLE` + LLM sur texte) sur les articles phares, rejouées sur l'historique.
  - [ ] 3 requêtes bitemporelles démo exécutées et affichées avec leur SQL.
  - [ ] Au moins 1 contradiction réelle révélée par `WITHOUT OVERLAPS` (ou par comparaison inter-articles).

#### F7. Origine d'une affirmation, même reformulée (« blame sémantique »)
- **Quoi** : on sélectionne une phrase de l'article actuel → l'outil retrouve **la révision où l'idée est apparue**, même si le texte a été reformulé (WikiBlame / Who Wrote That? ne font que du mot à mot). Recherche dichotomique sur l'historique `AS OF` + similarité vectorielle phrase ↔ chunk.
- **Besoin** : n°4 du Community Wishlist 2017 (outil de blame).
- **Acceptation** :
  - [ ] Sur 20 phrases reformulées au moins une fois (vérité terrain manuelle), la bonne révision d'origine ≥ 70 %.
  - [ ] Affiche : révision, date, auteur (ou « anonyme »), résumé d'édition, lien `?oldid=`.
  - [ ] < 3 s par phrase.

#### F8. Détecteur de contradictions dans le corpus (inspiré de CLAIRE, Stanford 2025)
- **Quoi** : la recherche vectorielle trouve des paires de passages proches entre articles différents ; un LLM juge s'ils se contredisent (dates, bilans humains, noms). Liste à destination des éditeurs, avec liens.
- **Référence** : ~3,3 % des faits de en.wiki en contredisent d'autres ; +64,7 % d'incohérences trouvées par les éditeurs avec l'outil. Jamais livré en outil, jamais en finnois.
- **Acceptation** :
  - [ ] Sur les articles phares, ≥ 10 contradictions candidates, précision vérifiée à la main ≥ 50 %.
  - [ ] Chaque contradiction : les deux passages, leurs `rev_id`, et **depuis quand** elle existe (via `AS OF`).

#### F9. Angles morts entre éditions linguistiques (fi ↔ sv ↔ en) (inspiré d'InfoGap EMNLP 2024 / Ground News)
- **Quoi** : pour un même `wikidata_id`, aligner les chunks fi/sv/en par plus proche voisin vectoriel ; surligner ce qu'une langue dit et que les autres taisent. Le suédois compte particulièrement pour l'histoire finlandaise.
- **Données** : déjà dans S (2 919 sujets dans les 3 langues) — pas besoin d'API externe.
- **Acceptation** :
  - [ ] Vue côte à côte pour un sujet : passages alignés / présents seulement en fi / seulement en sv / seulement en en.
  - [ ] Classement des 2 919 sujets par « asymétrie » (part de chunks sans équivalent) — tableau pour les éditeurs.
  - [ ] Démo sur 1918 ou la guerre d'Hiver.

#### F10. Guerres d'édition vs nettoyage, et dérive de sens
- **Quoi** :
  - **Mesure de controverse M** (Sumi & Yasseri) calculée **en SQL** (fonctions de fenêtrage sur `FOR SYSTEM_TIME ALL`), par article et par année — en séparant reverts d'anonymes (vandalisme) et reverts entre utilisateurs nommés (le starter fait la distinction mais pas la mesure).
  - **Dérive sémantique** : distance cosinus entre snapshots annuels d'une même section (F5) → courbe « le sens de cette section a changé en 2009 ». Exemple fil rouge : *vapaussota* (« guerre de libération ») → *sisällissota* (« guerre civile »).
  - **Liste de suivi par changement de sens** : signaler les révisions dont la distance d'embedding au parent est forte (au lieu du nombre d'octets).
- **Acceptation** :
  - [ ] Classement des articles les plus controversés (M), cohérent avec les reverts du starter (*Talvisota* 328 reverts, *Suomen sisällissota* 3 357 versions).
  - [ ] Courbe de dérive pour ≥ 5 articles, avec lien vers les révisions des pics.
  - [ ] Heatmap articles × années.

#### F16. Passage à l'échelle sur les 3 jeux S → M → L (promu P1 : critère explicite du jury)
- **Quoi** : le même code tourne sur S, M **et L** (568 416 articles, mêmes colonnes que S). Le jury dit *« scalability across the provided datasets »* : il faut des chiffres sur les trois.
- **Comment** : charger L entier (texte + FULLTEXT lemmatisé) ; vecteurs sur L = un job GPU (des jours sur un portable) → **embarquer un échantillon croissant** (S, 50 k, 100 k, 250 k…) ou seulement le chapeau de chaque article, et tracer la latence et le rappel en fonction de la taille. M est couvert par F4.
- **Acceptation** :
  - [ ] L chargé, recherche FULLTEXT et hybride fonctionnelles sur 568 k articles.
  - [ ] Courbe latence p50/p95 et rappel@10 en fonction du nombre de vecteurs (au moins 3 tailles).
  - [ ] Temps de chargement et taille disque publiés pour S, M et L.
  - [ ] Chaque requête de l'app a son `ANALYZE FORMAT=JSON` archivé et lu (rows lues ≈ rows renvoyées, pas de full scan non voulu).

#### F19. « Ce que dit le LLM » vs « ce que dit Wikipédia » (NPOV)
- **Quoi** : pour une question, afficher côte à côte la réponse d'un LLM **sans** corpus et la réponse **citée** tirée de Wikipédia ; surligner les affirmations du LLM absentes de Wikipédia ou contredites par lui. Répond directement à l'insight du jury : la vision du monde d'un LLM peut différer de la NPOV de Wikipédia.
- **MariaDB** : recherche vectorielle de chaque affirmation du LLM dans les chunks (+ `AS OF` si on veut la comparer à une époque).
- **Acceptation** :
  - [ ] 10 questions démo avec le tableau « appuyé / non trouvé / contredit » pour chaque affirmation du LLM.
  - [ ] Au moins un exemple parlant sur un sujet sensible (1918, guerre de Continuation) dans la démo.

### P2 — Bonus

| ID | Feature | MariaDB | Acceptation minimale |
|---|---|---|---|
| F11 | **Phrases sans source** : repérer les « Lähde? » / affirmations non citées, proposer des passages d'autres articles qui pourraient les sourcer | FULLTEXT + VECTOR | Liste des 50 plus « à risque » sur les articles phares |
| F12 | **Carte** : événements géolocalisés (coordonnées d'infobox), *« à moins de 50 km de Tampere en 1918 »* = spatial + période applicative + vecteur en une requête | `POINT`, `SPATIAL INDEX`, `ST_Distance_Sphere` | 1 requête combinée démontrée + carte |
| F13 | **Six degrés de Mannerheim** : plus court chemin de liens entre deux articles, **y compris dans le graphe de liens d'une année passée** | `WITH RECURSIVE` + `AS OF` | Chemin trouvé < 1 s |
| F14 | **Durée de vie d'une affirmation** (heatmap façon blame : combien de temps chaque phrase a survécu) | SVT + fenêtrage | Heatmap sur 1 article |
| F15 | **Agent MCP** : notre propre serveur MCP (outils métier : recherche citée, article à une date, origine d'une phrase) sur la même API que le site. ⚠️ L'ancien `MariaDB/mcp` est **abandonné depuis le 2026-11-03** (remplacé par `mariadb-corporation/ai-plugins`) | MCP server | 1 démo enregistrée |
| F17 | **Quiz « qu'est-ce qui a changé ? »** entre deux époques | AS OF + VECTOR | 5 questions générées |
| F18 | **Badges de citation** façon scite (la source appuie / contredit / mentionne) | JSON | Sur 1 article |

---

## 4. Schéma SQL (ajouts aux schémas des starters)

```sql
-- Base unique (port 3309) = schéma RAG starter (article, article_vector, category_link, article_category)
--                          + schéma SVT starter (renommé article_history, versionné, partitionné)
--                          + ce qui suit.

-- F1/F2 : passages
CREATE TABLE chunk (
  lang CHAR(2) NOT NULL, page_id INT UNSIGNED NOT NULL, chunk_idx SMALLINT UNSIGNED NOT NULL,
  rev_id INT UNSIGNED NOT NULL, wikidata_id VARCHAR(20), section VARCHAR(255),
  text MEDIUMTEXT NOT NULL, text_lemma MEDIUMTEXT,          -- lemmatisé (fi) pour FULLTEXT
  PRIMARY KEY (lang, page_id, chunk_idx), KEY (wikidata_id),
  FULLTEXT (text_lemma)
) CHARACTER SET utf8mb4;

CREATE TABLE chunk_vector (
  lang CHAR(2) NOT NULL, page_id INT UNSIGNED NOT NULL, chunk_idx SMALLINT UNSIGNED NOT NULL,
  model VARCHAR(50) NOT NULL, embedding VECTOR(1024) NOT NULL,
  PRIMARY KEY (lang, page_id, chunk_idx),
  VECTOR INDEX (embedding) M=16 DISTANCE=cosine
);

-- F5/F10 : snapshots annuels (non partitionné : index vectoriel interdit sur table partitionnée)
CREATE TABLE snapshot_chunk_vector (
  page_id INT UNSIGNED NOT NULL, year SMALLINT NOT NULL, chunk_idx SMALLINT UNSIGNED NOT NULL,
  rev_id INT UNSIGNED NOT NULL, section VARCHAR(255), text MEDIUMTEXT NOT NULL,
  embedding VECTOR(1024) NOT NULL,
  PRIMARY KEY (page_id, year, chunk_idx),
  VECTOR INDEX (embedding) M=16 DISTANCE=cosine
) CHARACTER SET utf8mb4;

-- F6 : affirmations bitemporelles
CREATE TABLE claim (
  claim_id BIGINT UNSIGNED NOT NULL,
  subject VARCHAR(255) NOT NULL,           -- ex. 'Suomen valtionpäämies'
  predicate VARCHAR(100) NOT NULL,         -- ex. 'holder'
  object VARCHAR(255) NOT NULL,            -- ex. 'P. E. Svinhufvud'
  page_id INT UNSIGNED NOT NULL, rev_id INT UNSIGNED NOT NULL,
  valid_from DATE NOT NULL, valid_to DATE NOT NULL,
  PERIOD FOR valid_time (valid_from, valid_to),
  row_start TIMESTAMP(6) GENERATED ALWAYS AS ROW START INVISIBLE,
  row_end   TIMESTAMP(6) GENERATED ALWAYS AS ROW END INVISIBLE,
  PERIOD FOR SYSTEM_TIME (row_start, row_end),
  PRIMARY KEY (claim_id, valid_to, valid_from),
  UNIQUE (subject, predicate, valid_time WITHOUT OVERLAPS)   -- deux titulaires simultanés = refus
) CHARACTER SET utf8mb4 WITH SYSTEM VERSIONING;

-- Exemple de requête bitemporelle :
-- SELECT object FROM claim FOR SYSTEM_TIME AS OF TIMESTAMP '2012-01-01 00:00:00'
-- WHERE subject = 'Suomen valtionpäämies' AND valid_from <= '1918-03-15' AND valid_to > '1918-03-15';
```

> ⚠️ À valider en H+1 : syntaxe exacte de `WITHOUT OVERLAPS` combinée à SVT, et le chargement de `claim` avec `system_versioning_insert_history`.

---

## 5. Mesures à publier (le jury note « exécution technique et passage à l'échelle »)

Format des starters : tableau, machine, version MariaDB, méthode.

| Mesure | Référence starter | Cible |
|---|---|---|
| Top-5 / top-10 sur 37 questions | 76 % / 86 % (article entier) | > 85 % / > 92 % (chunks + hybrid) |
| Questions « présidents » | 2/5 | 5/5 |
| Latence recherche (hors embedding) | ~1–23 ms | < 100 ms avec chunks + RRF |
| Versions chargées en SVT | 31 848 (50 articles) | 862 076 (19 742 articles) |
| `AS OF` p95 | 0,04–0,65 ms (50 articles) | < 5 ms (19 742 articles) |
| Taille disque SVT | 1,2 GB | mesurée (prévision 5–7 GB) |
| Filtre catégorie large | 2 100 ms | < 300 ms (top-k large puis filtre) |
| Fidélité « Ask » | — | 100 % des phrases citées et vérifiées |

---

## 6. Risques — à tester dans la première heure

1. **Index vectoriel sur table versionnée** : `CREATE TABLE … VECTOR INDEX … WITH SYSTEM VERSIONING` (non partitionnée). Si refusé → tables de vecteurs séparées (déjà le design ci-dessus).
2. **Bitemporel + `WITHOUT OVERLAPS` + `system_versioning_insert_history`** sur `claim`.
3. **Débit d'embedding** sur notre machine : chunks S (~150 k) + snapshots (20 articles × 21 ans × N chunks). Si trop lent → restreindre les chunks aux fi + sujets dans les 3 langues, ou GPU cloud (UpCloud ?).
4. **Lemmatiseur finnois** (Voikko) installable ? Sinon spaCy `fi_core_news_*` ou racinisation Snowball finnoise en Python.
5. **Wikitext du jeu M** → texte propre : réutiliser `history.py` du starter SVT.
6. **Taille du jeu M en base** (5–7 GB) : disque + temps de chargement (prévoir la nuit).

---

## 7. Démo (3 minutes, fil rouge : 1918)

1. **Question en français** : *« Qui gouvernait la Finlande en mars 1918 ? »* → passages finnois/suédois cités, `rev_id`, SQL hybride affiché. (F1–F3)
2. **Curseur temporel** : la même réponse **en 2006** → l'article parlait de *vapaussota* ; diff jusqu'à aujourd'hui. (F4–F5)
3. **Bitemporel** : *« En 2012, qu'affirmait Wikipédia sur mars 1918 ? »* + une date historique corrigée, avec quand et par qui. (F6, F7)
4. **Pour les éditeurs** : courbe de dérive de sens + guerre d'édition sur *Suomen sisällissota* ; une contradiction entre deux articles ; un angle mort fi vs sv. (F8–F10)
5. **Chiffres** : tableau §5 — on bat le starter, à l'échelle du jeu M complet.

Message clé : *tout ça, c'est du SQL MariaDB — vecteurs, temps système, temps applicatif, CTE récursives, fenêtrage, FULLTEXT — dans une seule base.*

---

## 7 bis. Conformité au brief (vérifiée le 2026-11-14)

| Exigence du brief | Couvert par | État |
|---|---|---|
| Piste RAG : questions → réponses ancrées et citées | F1, F2, F3 | ✅ |
| Piste SVT : ce que disait un article à une date | F4 | ✅ |
| SVT : guerres d'édition | F10 | ✅ |
| SVT : comment le récit d'un événement a été réécrit | F5, F10 (dérive), F6 | ✅ |
| BOTH : « que disait Wikipédia en 2015, qu'est-ce qui a changé ? » | F5 (exemple du brief mot pour mot) | ✅ |
| Usage efficace et créatif de MariaDB | Hybride RRF en SQL, bitemporel, `WITHOUT OVERLAPS`, CTE récursives | ✅ |
| **Passage à l'échelle sur les jeux fournis (S, M, L)** | F4 (M complet), **F16 (L)** | ⚠️ était sous-traité (L en bonus) → **promu P1** |
| Utilité lecteurs | F1–F3, F5 | ✅ |
| Utilité éditeurs | F7–F11 | ✅ |
| Design et démo | PITCH.md | ✅ |
| Insight : vision du monde des LLM vs NPOV | F3 (extractif) + **F19 (comparaison explicite)** | ⚠️ était implicite → **F19 ajouté** |
| Insight : digérer / vérifier / faire confiance | F3 (vérifier), F7 (origine), timeline (digérer) | ✅ |
| Insight : fact-checking | F8 (contradictions), F19, F11 | ✅ |
| Insight : lacunes et points faibles de couverture | F9 (angles morts), F11 (sans source) | ✅ |
| Insight : comparer un article entre langues | F9 | ✅ |
| Insight : vues à une date, visualisations de changements | F4, F5, timeline | ✅ |
| Insight : guerres d'édition, détection de biais | F10, F9 | ✅ (le « biais » = cadrage dans le temps et entre langues) |
| Insight : analytique de l'historique d'édition | F10, F14 | ✅ |

**Point d'attention** : avec 19 fonctionnalités, le risque n'est plus d'en manquer, mais de s'éparpiller. Ordre de livraison strict : P0 → F16 → F6 → F19 → F10 → reste.

## 8. Contexte et arguments (sources)

- **Pourquoi pas une PR sur MediaWiki** : la recherche Wikipédia tourne sur CirrusSearch/OpenSearch, pas MariaDB ; contributions via Gerrit + revue sécurité + équipe WMF sponsor ; la WMF construit déjà sa recherche hybride (phase 1 testée en A/B sur Android en en/fr/pt/el, +7 % d'engagement, latence +117 %, **pas le finnois**). Route réaliste : **outil Toolforge** (ToolsDB = MariaDB) + gadget. — https://www.mediawiki.org/wiki/Readers/Information_Retrieval/Phase_1
- **Payload CMS** : pas de vecteurs natifs (plugin communautaire pgvector), multilingue = gestion des traductions, pas de recherche cross-langue, pas d'adaptateur MariaDB officiel. Seul le design « chunks + table d'embeddings versionnée + embed-on-save » est repris.
- **MariaDB vs pgvector** : 2,5–3,9× plus de QPS à rappel ≥ 0,95 (Mark Callaghan, 2025 et 2026). — https://smalldatum.blogspot.com/2026/02/mariadb-innovation-vector-index.html
- **Recherche hybride RRF** (doc officielle) : https://mariadb.com/docs/server/reference/sql-structure/vectors/optimizing-hybrid-search-query-with-reciprocal-rank-fusion-rrf
- **Bitemporel** : https://mariadb.com/docs/server/reference/sql-structure/temporal-tables/bitemporal-tables
- **Besoins communauté** : Community Wishlist (rubriques Recherche, Citations, Traduction, Patrouille — rien en développement sur sémantique/historique) https://meta.wikimedia.org/wiki/Community_Wishlist ; suspension des résumés IA https://www.engadget.com/ai/wikipedia-pauses-ai-summaries-after-editors-skewer-the-idea-200029490.html
- **Recherche académique** : CLAIRE https://arxiv.org/abs/2509.23233 · InfoGap https://arxiv.org/abs/2410.04282 · SIDE https://github.com/facebookresearch/side · controverse M https://arxiv.org/abs/1107.3689 · WikiWho (supporte fi) https://wikiwho.wmcloud.org/
- **Hackathons MariaDB précédents** : aucun gagnant n'a utilisé les SVT ni Wikipédia (Helsinki 2025 : recherche sémantique YouTube ; MCP server).
- **Contre-exemple pitch** : Grokipedia (xAI) réécrit par IA sans historique visible ; revue des suggestions arrêtée en avril 2026 avec 13 002 en attente. — https://www.lawfaremedia.org/article/grokipedia-stopped-reviewing-edits-in-april.-it-didn-t-tell-anyone
- **Licence** : texte Wikipédia CC BY-SA 4.0 → créditer et partager à l'identique ; code des starters MIT.
