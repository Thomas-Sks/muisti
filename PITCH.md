# Présentation, démo et livrables — Junction 2026, défi MariaDB

> Complément de [SPECS.md](SPECS.md). Ici : **comment on raconte le projet, comment on le montre, ce qu'on rend.**
> ⚠️ À vérifier sur place : format exact de soumission Junction 2026 (plateforme, durée de la vidéo, durée du pitch, finale sur scène ou non).

---

## 1. Le nom et la promesse

- **Nom de travail** : *Muisti* (« mémoire » en finnois) — ou *Wikipedia That Remembers*. Court, finnois, parle au jury.
- **Promesse (une phrase)** : *« Demandez à Wikipédia dans votre langue, obtenez des passages cités — et voyez ce qu'il disait hier, qui l'a changé, et si c'est contesté. »*
- **Pour qui** : les **lecteurs** (question → réponse vérifiable) et les **éditeurs** (dérive, guerres d'édition, contradictions, angles morts). Le jury a explicitement cité les deux.

---

## 2. Structure du pitch (3 min — adaptable à 2 ou 5)

| Temps | Bloc | Contenu | À l'écran |
|---|---|---|---|
| 0:00–0:20 | **Accroche** (faits réels, vérifiés dans le jeu M) | *« Le 10 avril 2007 à 15 h, Wikipédia affirmait que l'URSS avait perdu 256 875 hommes pendant la guerre d'Hiver. Une heure avant : 126 875. Ce chiffre a changé 56 fois en 20 ans. En 2023, quelqu'un a ajouté "ou guerre de libération" à la première phrase de l'article sur 1918 ; c'est reparti en 2024. Personne ne peut voir ça aujourd'hui. »* | La carte « Facts over time » de Talvisota, puis le diff 2022→2023 |
| 0:20–0:45 | **Problème** | 1) La recherche Wikipédia est par mots-clés : une question en anglais ne trouve pas un texte finnois (FULLTEXT : 16 % dans le top 5). 2) L'historique de 862 000 versions existe mais est illisible. 3) Les résumés IA ont été rejetés par les éditeurs en 2025 : il faut de l'IA **qui cite**, pas qui invente. | 3 chiffres, gros |
| 0:45–2:15 | **Démo live** | Le parcours du §3 | L'app |
| 2:15–2:40 | **Sous le capot** | *« Tout ça, c'est du SQL MariaDB, dans une seule base. »* Une requête qui fait vecteur + `FOR SYSTEM_TIME AS OF` + période historique. | Slide « une requête » + schéma des fonctions MariaDB utilisées |
| 2:40–2:55 | **Chiffres** | On bat le starter : top-5 76 % → X %, 50 articles → 19 742 articles / 862 076 versions, `AS OF` en X ms. | Tableau avant/après |
| 2:55–3:00 | **Suite** | Hébergeable sur Toolforge (MariaDB chez Wikimedia), proposable à l'équipe Recherche de la WMF pour le finnois, qu'elle ne couvre pas. | Logo + URL du repo |

**Règle** : la démo prend la moitié du temps. Le jury note « design and demo quality ».

---

## 3. Parcours de démo (fil rouge : 1918)

Chaque étape montre **une** fonction MariaDB. Le panneau « SQL » est repliable et visible à chaque étape : le jury est fait de gens de MariaDB, ils veulent voir les requêtes.

1. **Poser une question en français** — *« Qui gouvernait la Finlande en mars 1918 ? »*
   → passages finnois et suédois cités, traduits, chaque phrase liée à sa révision Wikipédia. Bouton « voir la source ».
   *MariaDB : recherche hybride FULLTEXT + VECTOR, fusion RRF en un SQL.*
2. **Basculer la recherche sur « Wikipedia of 2010 »**
   → les passages tels qu'ils étaient au 1er janvier 2010, à côté du passage le plus proche aujourd'hui ; lien vers le diff complet.
   *MariaDB : `FOR SYSTEM_TIME AS OF`.*
3. **Question bitemporelle** — *« En 2012, qu'affirmait Wikipédia sur mars 1918 ? »*
   → une date ou un nom corrigé depuis, avec qui l'a corrigé et quand.
   *MariaDB : période applicative + versionnage système dans la même table.*
4. **Cliquer sur une phrase** → « d'où vient cette affirmation ? » → la révision d'origine, même si la phrase a été reformulée depuis.
   *MariaDB : historique + similarité vectorielle.*
5. **Basculer en vue éditeur**
   → courbe de dérive de sens et heatmap des guerres d'édition sur *Suomen sisällissota* ; une contradiction entre deux articles ; un angle mort finnois vs suédois.
   *MariaDB : fonctions de fenêtrage, CTE, vecteurs entre langues.*

**Moment « wow » à soigner** : la requête bitemporelle (« que disait Wikipédia le 10 avril 2007 sur janvier 1940 ? » → 256 875) et le diff 2022→2023 de *Suomen sisällissota* où « tai Suomen vapaussota » apparaît en vert.

> ⚠️ Correction (2026-11-14, vérifiée sur les données) : l'idée « l'article est passé de *vapaussota* à *sisällissota* » est **fausse** — il s'appelle *Suomen sisällissota* depuis 2003. Ne pas la raconter. Utiliser les faits réels ci-dessus, et le classement des guerres d'édition (n°1 : *Pekka Haavisto* en 2012, année de sa candidature présidentielle ; n°3 : *Ilkka Kanerva* en 2008).

---

## 3 bis. Format du produit : site web d'abord, MCP en bonus

- **Site web = le produit.** Le jury note le design et la démo, et les utilisateurs visés (lecteurs, éditeurs) sont des humains. Le curseur temporel, la timeline et le diff ne se montrent bien que visuellement.
- **Une seule API backend** (Python) qui fait toutes les requêtes MariaDB. Le site l'appelle ; le MCP l'appellera aussi. Rien n'est codé deux fois.
- **MCP = couche fine en fin de hackathon (2–3 h max)**, qui expose les mêmes fonctions comme outils : `search_cited(question, lang, as_of?)`, `article_as_of(title, date)`, `claim_origin(sentence)`, `what_changed(title, from, to)`. Démo de 20 s : Claude interroge « le Wikipédia qui se souvient » et cite des révisions. Argument : *nos outils servent aussi aux agents IA, sans halluciner.*
- **Ne pas faire un MCP seul** : pas d'interface, démo peu visuelle, et les lecteurs de Wikipédia n'utilisent pas d'agent.
- MariaDB fournit déjà un accès SQL brut aux agents (ancien `MariaDB/mcp`, abandonné le 2026-11-03, remplacé par `mariadb-corporation/ai-plugins`) : le nôtre se distingue par des outils métier (citations, temps), pas par l'accès à la base.

## 4. L'interface (3 écrans, pas plus)

1. **Demander** : une barre de question, langue détectée, réponse citée, cartes de sources regroupées par sujet (fi/sv/en ensemble), curseur temporel en haut.
2. **Article dans le temps** : l'article à une date, la timeline (éditions par mois, annulations en rouge, guerres d'édition ombrées), le diff, la courbe de dérive de sens.
3. **Tableau de bord éditeurs** : articles les plus contestés, contradictions, angles morts entre langues, phrases sans source.

Partout : panneau « SQL » repliable + temps d'exécution affiché (ex. « 4,2 ms »). C'est notre signature.

---

## 5. Sécuriser la démo live

- **Tout en local** (MariaDB + Ollama sur le portable), pas de dépendance au Wi-Fi sauf l'appel LLM.
- **Préchauffer** : Ollama met ~1,6 s à charger le modèle au premier appel → lancer une requête avant de monter sur scène.
- **Réponses LLM mises en cache** pour les questions de la démo (au cas où l'API est lente ou coupée) ; la recherche reste live.
- **Vidéo de secours** de la démo complète, prête à lancer si quoi que ce soit plante.
- **Scénario figé** : mêmes questions, même ordre, répétées au moins 5 fois. Un seul présentateur au clavier, un autre qui parle.
- **Base pré-chargée** : le chargement du jeu M (plusieurs GB) se fait la nuit, jamais pendant la démo.

---

## 6. Livrables

| Livrable | Contenu | Responsable |
|---|---|---|
| **Repo GitHub** | Code + README **au format des starters** (statut, « ce qu'on a trouvé », choix et pourquoi, tutoriel, tableaux de mesures, limites). Licence MIT pour le code, CC BY-SA pour les données dérivées. | |
| **README « Ce qu'on a trouvé »** | Comme les starters : les chiffres mesurés, y compris ce qui n'a **pas** marché. Le jury connaît ce style et l'apprécie. | |
| **Vidéo de démo** (~2 min, durée à vérifier) | Le parcours du §3, voix off, sous-titres anglais. Doit se comprendre sans le son. | |
| **Slides** (5–6) | Accroche, problème, démo (lien vidéo), une requête SQL, chiffres, suite. | |
| **Page de soumission** | Pitch en une phrase, captures, lien repo + vidéo, liste des fonctions MariaDB utilisées, mapping aux critères. | |
| **Démo en ligne** *(optionnel)* | Si le temps le permet, sur un serveur (crédits UpCloud ?). | |

---

## 7. Correspondance avec les critères du jury (une slide ou un paragraphe de soumission)

| Critère | Notre réponse en une ligne |
|---|---|
| Usage efficace et créatif du RAG et/ou des SVT | Les deux, plus le **bitemporel** : aucune équipe précédente ne l'a fait. |
| Exécution technique, passage à l'échelle | Jeu M complet (862 076 versions) au lieu de 50 articles ; tableau de mesures comme les starters. |
| Utilité réelle | Lecteurs : réponse citée dans leur langue. Éditeurs : outils qui répondent à des souhaits de la communauté (blame, citations, patrouille). |
| Design et démo | 3 écrans, un fil rouge (1918), un moment « wow » (le curseur temporel). |
| Ambition technique (bonus SVT / « BOTH ») | Piste « BOTH » + périodes applicatives + `WITHOUT OVERLAPS`. |

---

## 8. Questions probables du jury (préparer les réponses)

- **« Pourquoi pas pgvector / une base vectorielle dédiée ? »** → une seule base, une seule requête pour vecteur + temps + filtres ; benchmarks MariaDB plus rapides que pgvector (Mark Callaghan).
- **« Comment évitez-vous les hallucinations ? »** → réponse composée de citations vérifiées automatiquement contre le passage source ; refus explicite si rien ne répond.
- **« Est-ce que ça passe à l'échelle de tout Wikipédia ? »** → mesures sur M complet ; limite connue : chaque version est une copie complète → pour Wikipédia entier, stocker le texte une fois par version distincte (comme MediaWiki).
- **« Pourquoi des tables versionnées si une table de révisions est aussi rapide ? »** → simplicité et sécurité (aucun chemin de code ne peut oublier l'historique), et le bitemporel n'existe pas avec une table de révisions simple.
- **« Les limites de MariaDB que vous avez rencontrées ? »** → répondre franchement (post-filtrage, pas de racinisation finnoise, index vectoriel interdit sur table partitionnée) avec nos contournements. Ça montre la maîtrise.
- **« Comment ça arriverait dans Wikipédia ? »** → outil Toolforge + gadget ; pas de PR MediaWiki (la recherche tourne sur OpenSearch).

---

## 9. Répartition suggérée (à adapter à l'équipe)

- **Données & MariaDB** : chargement M, schéma, bitemporel, mesures.
- **RAG** : chunks, embeddings, hybride, « Ask » cité.
- **Analyses éditeurs** : guerres d'édition, dérive, contradictions, angles morts.
- **Front & démo** : les 3 écrans, panneau SQL, vidéo, slides.
- **Pitch** : une personne dédiée dès le samedi après-midi, répète le scénario.
