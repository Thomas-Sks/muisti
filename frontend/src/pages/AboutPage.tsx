import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity, ArrowRight, Clock, Database, Fingerprint, GitCompare, History, Languages, Layers, Scale,
  Search, ShieldCheck, Sparkles, TriangleAlert, type LucideIcon,
} from "lucide-react";
import { api } from "../api";
import { Card, StatTile, nf } from "../ui";

// Everything on this page is measured on this machine or read live from MariaDB
// (see README.md, perf/EVAL.md and perf/RESULTS.md for the full numbers and method).

const EDGES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Database, title: "One database does everything",
    text: "Vector search, full-text search, time travel, application-time periods, window functions and recursive CTEs: all in MariaDB 12.3, all in SQL. No separate vector store, nothing to keep in sync." },
  { icon: Layers, title: "Both tracks, plus bitemporal",
    text: "RAG and system-versioned tables combined, plus a table with two time axes: when something happened in history and when Wikipedia said it. One query answers “what did Wikipedia say on 10 April 2007 about January 1940?”." },
  { icon: Scale, title: "Better than the official baseline",
    text: "On the 37 official test questions, passages reach 81 % top-5 (starter: 76 %, reproduced exactly) and hybrid search 92 % top-10 (starter: 86 %)." },
  { icon: Clock, title: "The whole history, not a sample",
    text: "All 862,076 versions of 19,742 articles (2003–2026) with their real edit times. The starter loaded 50 articles. Plus all 568,416 articles of dataset L for full-text at Wikipedia scale." },
  { icon: ShieldCheck, title: "Every word is traceable",
    text: "No generated summaries: answers are exact passages, each linked to the revision it was quoted from. AI is only used to check claims against quoted Wikipedia text, never to write the content." },
  { icon: Sparkles, title: "Real findings, reproducible",
    text: "A vandalised casualty figure, a war end date that differs between articles, an edit war over a birth date during a presidential campaign: all found by the tool in the real data, not scripted." },
];

type Feature = {
  icon: LucideIcon; name: string; to: string; who: string; what: string; how: string[]; numbers: string; mariadb: string[];
};

const FEATURES: Feature[] = [
  { icon: Search, name: "Topics: find and open a topic", to: "/", who: "Editors",
    what: "One search box, any language. Each topic shows which editions exist (fi / sv / en), their size and titles; topics that can be compared come first.",
    how: [
      "Title matches, ranked by article size, plus meaning: the query is embedded (bge-m3) and matched against the 122,351 passage vectors, best passage per article.",
      "Results grouped by Wikidata id, so the three language versions of a topic are one row.",
    ],
    numbers: "~30–160 ms per search",
    mariadb: ["VECTOR INDEX over passages", "GROUP BY wikidata_id", "LIKE with escaped wildcards"] },
  { icon: Scale, name: "Facts compared", to: "/topic/Q211855?tab=facts", who: "Editors",
    what: "Dates, numbers, people, places and outcomes compared across the editions, marked as agreeing, differing or missing, with the exact sentences and their English translation.",
    how: [
      "Passages with dates or numbers are aligned across languages with the vectors stored in MariaDB (nearest neighbour, calibrated distance).",
      "Claude Sonnet compares the aligned groups and quotes each language verbatim; every quote is checked against the article text.",
      "Computed when an editor opens the topic, stored in MariaDB keyed by the article revisions, recomputed when an article changes.",
    ],
    numbers: "Finnish Civil War: 32 facts, 12 differ, 67/67 quotes verified",
    mariadb: ["stored passage vectors", "analysis table (JSON, keyed by revisions)"] },
  { icon: TriangleAlert, name: "Wording: tone and framing", to: "/topic/Q211855?tab=wording", who: "Editors",
    what: "How each edition tells the same events: loaded words, who is blamed, what is stated as certain or hedged, how events and groups are named, what is emphasised or left out.",
    how: [
      "The same alignment of passages across languages, then Claude Sonnet compares wording and quotes the loaded words.",
      "Shown as a list of findings with a detail panel: English translation, original wording with the loaded words highlighted, full passages on demand.",
    ],
    numbers: "Finnish Civil War: “mördades” (SV) and “verilöyly” (FI) where English says “Red Terror”",
    mariadb: ["stored passage vectors", "analysis table (JSON)"] },
  { icon: Languages, name: "Missing content", to: "/topic/Q211855?tab=missing", who: "Editors & translators",
    what: "For one topic, what each language edition says that the others don’t: every passage of the fi/sv/en articles matched to its nearest passage in the other two languages by meaning.",
    how: [
      "All passages and vectors of the three articles in one query; nearest neighbours across languages.",
      "Threshold calibrated on real data (cross-language median distance 0.31–0.35; above 0.40 = language-specific content).",
    ],
    numbers: "2,919 topics exist in all three languages",
    mariadb: ["VECTOR columns", "joins on wikidata_id"] },
  { icon: History, name: "Time machine", to: "/time", who: "Readers & editors",
    what: "Read any article as it stood on any day since 2003, step version by version, compare two dates word by word, and see its whole life on a timeline of edits and reverts.",
    how: [
      "Dataset M loaded into a system-versioned table with Wikipedia’s real edit times (system_versioning_insert_history).",
      "FOR SYSTEM_TIME AS OF reads the version current at a moment; an extra index on (page_id, row_start) makes old dates fast.",
      "Reverts detected in SQL (same text as an earlier version) with window functions, precomputed once.",
    ],
    numbers: "862,076 versions loaded in 16 min · AS OF p50 3.4 ms",
    mariadb: ["WITH SYSTEM VERSIONING", "FOR SYSTEM_TIME AS OF / ALL", "PARTITION BY SYSTEM_TIME", "COMPRESSED columns", "LAG / MIN OVER"] },
  { icon: Fingerprint, name: "Where did this passage come from?", to: "/time/1150", who: "Editors",
    what: "Click any paragraph: find the revision where its idea first appeared (even if it was worded differently then), with the author, the edit summary and the first wording diffed against today’s.",
    how: [
      "Binary search over the article’s versions (~12 steps for 3,000 versions), each read with FOR SYSTEM_TIME.",
      "At each step: exact match first, then meaning: the most word-overlapping paragraphs are embedded and compared (bge-m3).",
      "Wikipedia’s own blame tools match exact text and lose the trail at the first rewording.",
    ],
    numbers: "3–9 s per passage · detects rewording",
    mariadb: ["FOR SYSTEM_TIME ALL", "KEY timeline (page_id, row_start, …)"] },
  { icon: Clock, name: "Facts over time (bitemporal)", to: "/time/1256", who: "Editors & researchers",
    what: "Infobox facts (casualties, strengths, commanders, dates) replayed over every version. Ask what Wikipedia stated at any moment about any historical date.",
    how: [
      "Infobox templates parsed in every version of 286 war and battle articles (no AI).",
      "Each run of identical values becomes a row with system time = when Wikipedia stated it, and an application-time period = the battle’s own dates, parsed as they were at that time.",
      "WITHOUT OVERLAPS lets MariaDB itself refuse two values for the same period.",
    ],
    numbers: "4,484 fact versions · Soviet casualties of the Winter War stated 56 times",
    mariadb: ["PERIOD FOR valid_time", "WITH SYSTEM VERSIONING", "WITHOUT OVERLAPS", "system_versioning_insert_history"] },
  { icon: Activity, name: "Edit wars: what they fought about", to: "/radar", who: "Editors",
    what: "The biggest edit wars and the exact words that went back and forth: removed and put back, how many times, between whom, with the edit summaries and links to every diff.",
    how: [
      "Controversy M (Sumi, Yasseri et al. 2011) computed in SQL over all versions: pairs of named editors who reverted each other.",
      "For a war, each revert is replayed from the versioned table (the version before vs the revert) and word-diffed; reverts of the same text are grouped.",
      "Vandalism cleanup (undoing anonymous edits) is excluded: it is not a war.",
    ],
    numbers: "45,668 reverts, 13,211 between named editors · ranking 0.7 ms",
    mariadb: ["window functions", "CTEs", "FOR SYSTEM_TIME ALL", "precomputed tables"] },
  { icon: GitCompare, name: "Meaning drift & search in the past", to: "/ask?q=Tampereen%20taistelu%201918&year=2010", who: "Researchers",
    what: "See how far each year’s article is from today’s by meaning, find the biggest rewrite, and search the Wikipedia of 2006, 2010, 2014, 2018 or 2022 next to today’s passage.",
    how: [
      "Yearly snapshots of the 200 most edited articles, read in one pass (FOR SYSTEM_TIME ALL joined to the snapshot moments) and embedded.",
      "Drift = VEC_DISTANCE_COSINE between yearly snapshot vectors, computed in a SQL self-join.",
      "Past search over-fetches from the vector index then filters by year (MariaDB post-filters vector results).",
    ],
    numbers: "200 articles × 23 years embedded in 21 min",
    mariadb: ["VEC_DISTANCE_COSINE in SQL", "vector index on snapshots", "recursive CTE for snapshot moments"] },
  { icon: Search, name: "Ask: cross-language cited search", to: "/", who: "Readers",
    what: "Ask in any language (even French, absent from the data) and get the exact passages from Finnish, Swedish and English Wikipedia that answer, grouped by topic, each linked to its revision.",
    how: [
      "29,460 articles cut into 122,351 passages (~180 words, along headings, reference sections skipped).",
      "Each passage embedded with bge-m3 (multilingual, 1024 dims) on the GPU, with the same model as the dataset’s vectors (cosine ≥ 0.9997, tested).",
      "One SQL statement: HNSW vector search, or hybrid with stemmed FULLTEXT fused by weighted Reciprocal Rank Fusion.",
      "Results grouped by Wikidata id so the fi/sv/en versions of a topic count as one.",
    ],
    numbers: "81 % top-5 · 92 % top-10 (hybrid) · vector search p50 22 ms",
    mariadb: ["VECTOR(1024)", "VECTOR INDEX M=16 cosine", "VEC_DISTANCE_COSINE", "FULLTEXT", "CTE + ROW_NUMBER()"] },
];

const LIMITS = [
  "No vectors for dataset L (568k articles): days of GPU on a laptop. L demonstrates full-text scale.",
  "Yearly snapshots cover the 200 most edited articles, not all 19,742.",
  "The AI checks depend on the five passages retrieved per claim; flagged contradictions are candidates for an editor to review.",
  "Origin tracing assumes an idea, once added, stays; one removed and re-added is dated from its last continuous appearance.",
];

export default function AboutPage() {
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats, staleTime: 60_000 });
  const s = stats.data;
  return (
    <div className="space-y-10">
      <section className="mx-auto max-w-3xl pt-4 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-accent">How it works</p>
        <h1 className="serif mt-1 text-[32px] leading-tight text-ink-strong">Muisti: how it works</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
          A workspace for Wikipedia editors. Search a topic and compare its Finnish, Swedish and English articles: facts
          that differ, wording that takes sides, content missing from one language, and how the article changed over
          time. Every finding is quoted, translated and linked to its revision. Built for the Junction 2026 MariaDB
          challenge, covering both the RAG and the system-versioned tables tracks.
        </p>
      </section>

      <Card>
        <div className="grid grid-cols-2 gap-6 p-6 sm:grid-cols-4">
          <StatTile label="Articles (fi · sv · en)" value={s ? nf.format(Object.values(s.articles_by_lang).reduce((a, b) => a + b, 0)) : "…"} hint="dataset S" />
          <StatTile label="Passage vectors" value={s ? nf.format(s.passage_vectors) : "…"} hint="bge-m3, 1024 dims" />
          <StatTile label="Versions with real dates" value={s ? nf.format(s.versions) : "…"} hint="dataset M, 2003 – 2026" />
          <StatTile label="Articles for full-text scale" value="568,416" hint="dataset L" />
        </div>
      </Card>

      <section>
        <h2 className="text-xl font-semibold text-ink">Our edges</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {EDGES.map((e) => (
            <Card key={e.title}>
              <div className="p-5">
                <e.icon className="size-5 text-accent" aria-hidden />
                <h3 className="mt-3 text-[15px] font-semibold text-ink">{e.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{e.text}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-ink">Features: what they do and how we built them</h2>
        <div className="mt-4 space-y-4">
          {FEATURES.map((f) => (
            <Card key={f.name}>
              <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent"><f.icon className="size-4" /></span>
                    <h3 className="text-[16px] font-semibold text-ink">{f.name}</h3>
                  </div>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wide text-ink-3">For {f.who}</p>
                  <p className="mt-2 text-sm leading-relaxed text-ink-2">{f.what}</p>
                  <p className="tabular mt-3 text-sm font-medium text-ink">{f.numbers}</p>
                  <Link to={f.to} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Open it <ArrowRight className="size-4" /></Link>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-ink-3">How it works</div>
                  <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-ink-2">
                    {f.how.map((h) => <li key={h}>{h}</li>)}
                  </ol>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {f.mariadb.map((m) => (
                      <span key={m} className="rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-ink-2">{m}</span>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="Architecture">
          <pre className="overflow-auto p-5 font-mono text-[12px] leading-relaxed text-ink-2">{`Dataset S (fi/sv/en) ─► article · chunk ─► bge-m3 (GPU) ─► chunk_vector  (HNSW)
Dataset M (862k versions) ─► article_history  (SYSTEM VERSIONING, real dates)
        ├─► revision · edit_war_year · article_controversy  (window fns, CTEs)
        ├─► fact  (PERIOD FOR valid_time + SYSTEM VERSIONING)
        └─► snapshot · snapshot_chunk  (vectors per year)
Dataset L (568k) ─► article_l  (stemmed FULLTEXT)

React ─/api─► FastAPI ─► MariaDB 12.3      Claude Sonnet: fact checks only`}</pre>
        </Card>
        <Card title="Engineering">
          <ul className="space-y-2 p-5 text-sm text-ink-2">
            <li><b className="text-ink">36 automated tests</b> against the real database: search quality, AS OF correctness, bitemporal facts, edit wars, hostile input.</li>
            <li><b className="text-ink">Every hot query measured</b> with ANALYZE FORMAT=JSON (archived) and p50/p95 latencies; the vector index is verified to read 100 rows, not the table.</li>
            <li><b className="text-ink">MAX_EXECUTION_TIME</b> on every user-triggered query; LIKE wildcards escaped; invalid input answered with clear messages.</li>
            <li><b className="text-ink">Reproducible:</b> <span className="font-mono text-xs">make all</span> rebuilds everything from MariaDB’s official datasets, every step resumable.</li>
            <li><b className="text-ink">Text and vectors</b> derived from Wikipedia under CC BY-SA 4.0; code MIT.</li>
          </ul>
        </Card>
      </section>

      <Card title="Honest limits">
        <ul className="list-disc space-y-1.5 p-5 pl-10 text-sm text-ink-2">
          {LIMITS.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </Card>
    </div>
  );
}
