import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, ArrowUpRight, History, Search, Sparkles } from "lucide-react";
import clsx from "clsx";
import { api, api2, type Group, type Lang, type Mode, type Passage, type PastResult } from "../api";
import { Card, ErrorBox, Highlight, LANG_NAME, LangBadge, Segmented, Spinner, SqlPanel, displayText, fmtDate } from "../ui";

const EXAMPLES: { q: string; note: string }[] = [
  { q: "Which peace treaty ended the Winter War?", note: "English question → Finnish & Swedish sources" },
  { q: "Qui était président de la Finlande de 1956 à 1982 ?", note: "French, a language not in the dataset at all" },
  { q: "Vem ledde de vita i inbördeskriget 1918?", note: "Swedish" },
  { q: "Mitä tapahtui Tampereen taistelussa?", note: "Finnish" },
];

// Measured on the 37 official test questions (perf/EVAL.md): Meaning = best top-1/top-5, Hybrid = best top-10.
const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "vector", label: "Meaning", hint: "MariaDB vector index (HNSW, cosine) over bge-m3 passage embeddings. Best precision (81% top-5)" },
  { value: "hybrid", label: "Hybrid", hint: "Vector + stemmed full-text, weighted Reciprocal Rank Fusion in one SQL statement. Best recall (92% top-10)" },
  { value: "keyword", label: "Keywords", hint: "InnoDB FULLTEXT over Snowball-stemmed text" },
];

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  // Only known values are honoured; anything else typed into the URL falls back to the default.
  const mode: Mode = (["vector", "hybrid", "keyword"] as const).find((m) => m === params.get("mode")) ?? "vector";
  const lang: Lang | null = (["fi", "sv", "en"] as const).find((l) => l === params.get("lang")) ?? null;
  const year = [2006, 2010, 2014, 2018, 2022].find((y) => String(y) === params.get("year")) ?? null;
  const [draft, setDraft] = useState(q);
  const [shown, setShown] = useState(10);

  const set = (patch: Record<string, string | null>) => {
    setShown(10);
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    setParams(next);
  };

  const result = useQuery({
    queryKey: ["search", q, mode, lang],
    queryFn: () => api.search(q, mode, lang),
    enabled: q.trim().length >= 2 && !year,
    staleTime: Infinity,
  });
  const past = useQuery({
    queryKey: ["past", q, year],
    queryFn: () => api2.searchPast(q, year!),
    enabled: q.trim().length >= 2 && !!year,
    staleTime: Infinity,
  });

  return (
    <div className="space-y-6">
      <div className="mx-auto max-w-3xl pt-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Ask Wikipedia in your language.</h1>
        <p className="mt-3 text-[15px] text-ink-2">
          Get the exact passages that answer, from Finnish, Swedish and English Wikipedia, each one linked to the
          revision it was quoted from. No generated text.
        </p>
      </div>

      <form className="mx-auto max-w-3xl" onSubmit={(e) => { e.preventDefault(); if (draft.trim().length >= 2) set({ q: draft.trim() }); }}>
        <div className="flex items-center gap-2 rounded-2xl border border-line-strong bg-surface-1 p-2 shadow-sm focus-within:border-accent">
          <Search className="ml-2 size-5 shrink-0 text-ink-3" />
          <input value={draft} maxLength={300} onChange={(e) => setDraft(e.target.value)} autoFocus
            placeholder="e.g. Which peace treaty ended the Winter War?"
            className="min-w-0 flex-1 bg-transparent px-1 py-2 text-[15px] text-ink outline-none placeholder:text-ink-3"
            aria-label="Question" />
          <button type="submit" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            Search
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
          <Segmented label="Search mode" value={mode} onChange={(v) => set({ mode: v })} options={MODES} />
          {!year && <Segmented<"all" | Lang> label="Language of sources" value={lang ?? "all"}
            onChange={(v) => set({ lang: v === "all" ? null : v })}
            options={[{ value: "all", label: "All languages" }, { value: "fi", label: "FI" }, { value: "sv", label: "SV" }, { value: "en", label: "EN" }]} />}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-ink-3"><History className="size-3.5" /> Search the Wikipedia of</span>
          <Segmented<string> label="Search in time" value={year ? String(year) : "now"}
            onChange={(v) => set({ year: v === "now" ? null : v })}
            options={[{ value: "now", label: "Today" }, ...["2006", "2010", "2014", "2018", "2022"].map((y) => ({ value: y, label: y, hint: `Finnish Wikipedia as it stood on 1 January ${y} (most edited articles)` }))]} />
        </div>
      </form>

      {!q && (
        <div className="mx-auto grid max-w-3xl gap-2 sm:grid-cols-2">
          {EXAMPLES.map((e) => (
            <button key={e.q} onClick={() => { setDraft(e.q); set({ q: e.q }); }}
              className="rounded-xl border border-line bg-surface-1 p-3 text-left transition-colors hover:border-accent">
              <div className="text-sm font-medium text-ink">{e.q}</div>
              <div className="mt-1 text-xs text-ink-3">{e.note}</div>
            </button>
          ))}
        </div>
      )}

      {year && past.isFetching && <Spinner label={`Searching Finnish Wikipedia as of 1 January ${year}`} />}
      {year && past.error && <ErrorBox error={past.error} />}
      {year && past.data && !past.isFetching && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            <p className="text-xs text-ink-3">What Finnish Wikipedia said on <b className="text-ink">1 January {year}</b>, next to the closest passage of the same article today.</p>
            {past.data.results.length === 0 && <Card><p className="p-5 text-sm text-ink-2">No passage from {year} matched.</p></Card>}
            {past.data.results.map((r) => <PastCard key={r.snap_chunk_id} r={r} query={q} />)}
          </div>
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <SqlPanel title="Vector search in yearly snapshots" sql={past.data.sql} timings={[{ label: "SQL", ms: past.data.timings.search_ms }]} />
            <SqlPanel title="Closest passage today (exact, per article)" sql={past.data.sql_now} timings={[{ label: "SQL", ms: past.data.timings.now_ms }]} />
          </aside>
        </div>
      )}
      {!year && result.isFetching && <Spinner label="Searching 122,351 passages" />}
      {!year && result.error && <ErrorBox error={result.error} />}
      {!year && result.data && !result.isFetching && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            <div className="flex items-baseline justify-between text-xs text-ink-3">
              <span><b className="text-ink">{result.data.groups.length}</b> topics · {result.data.passages.length} passages</span>
              <span>ranked by {MODES.find((m) => m.value === result.data.mode)?.label.toLowerCase()}</span>
            </div>
            {result.data.groups.length === 0 && (
              <Card><p className="p-5 text-sm text-ink-2">Wikipedia does not say. No passage matched.</p></Card>
            )}
            {result.data.groups.slice(0, shown).map((g, i) => <ResultCard key={g.key} group={g} rank={i + 1} query={result.data.query} />)}
            {result.data.groups.length > shown && (
              <div className="text-center">
                <button onClick={() => setShown(shown + 10)} className="rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-sm text-ink-2 hover:text-ink">
                  More results ({result.data.groups.length - shown} more topics)
                </button>
              </div>
            )}
          </div>
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <Card title="How this was found">
              <div className="space-y-3 p-5 text-sm text-ink-2">
                <Step n={1} title="Embed the question" detail={`bge-m3 on GPU · ${result.data.timings.embed_ms.toFixed(0)} ms`} />
                <Step n={2} title="One SQL statement" detail={`HNSW vector index + FULLTEXT, RRF fusion · ${result.data.timings.sql_ms.toFixed(1)} ms`} />
                <Step n={3} title="Group by Wikidata topic" detail="fi / sv / en versions of a topic = one result" />
              </div>
            </Card>
            <SqlPanel sql={result.data.sql}
              timings={[{ label: "SQL", ms: result.data.timings.sql_ms }]} />
            <p className="flex items-start gap-2 px-1 text-xs text-ink-3">
              <Sparkles className="mt-0.5 size-3.5 shrink-0" />
              V = rank in the vector branch, K = rank in the full-text branch. A passage found by both ranks highest.
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}

function Step({ n, title, detail }: { n: number; title: string; detail: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">{n}</span>
      <div><div className="font-medium text-ink">{title}</div><div className="text-xs text-ink-3">{detail}</div></div>
    </div>
  );
}

function ResultCard({ group, rank, query }: { group: Group; rank: number; query: string }) {
  const langs = (["fi", "sv", "en"] as Lang[]).filter((l) => group.by_lang[l]);
  const [active, setActive] = useState<Lang>(group.best.lang);
  const p = group.by_lang[active] ?? group.best;
  return (
    <Card className="overflow-hidden">
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="tabular text-xs font-semibold text-ink-3">#{rank}</span>
          <h3 className="text-[15px] font-semibold text-ink">{p.title}</h3>
          {p.section && <span className="truncate text-xs text-ink-3">› {p.section}</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {langs.map((l) => (
            <button key={l} onClick={() => setActive(l)} aria-pressed={active === l}
              className={clsx("rounded-md", active === l ? "ring-2 ring-accent" : "opacity-70 hover:opacity-100")}>
              <LangBadge lang={l} />
            </button>
          ))}
          <RankChips p={p} />
        </div>
        <blockquote className="mt-3 border-l-2 pl-3 text-[14px] leading-relaxed text-ink-2" style={{ borderColor: `var(--series-${["fi", "sv", "en"].indexOf(p.lang) + 1})` }}>
          <Highlight text={clip(displayText(p.text), 900)} query={query} />
        </blockquote>
      </div>
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-surface-2/50 px-5 py-2.5 text-xs text-ink-3">
        <span>{LANG_NAME[p.lang]} Wikipedia · revision <span className="tabular font-mono">{p.rev_id}</span> · {fmtDate(p.date_modified)}</span>
        <a href={p.oldid_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
          Cited revision <ArrowUpRight className="size-3" />
        </a>
        {p.lang === "fi" && (
          <Link to={`/time/${p.page_id}`} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
            <History className="size-3" /> See how it changed
          </Link>
        )}
      </footer>
    </Card>
  );
}

function RankChips({ p }: { p: Passage }) {
  return (
    <span className="ml-auto flex items-center gap-1 font-mono text-[11px] text-ink-3">
      {p.v_rank != null && <span className="rounded bg-surface-2 px-1.5 py-0.5" title="Rank in the vector (meaning) branch">V{p.v_rank}</span>}
      {p.k_rank != null && <span className="rounded bg-surface-2 px-1.5 py-0.5" title="Rank in the full-text branch">K{p.k_rank}</span>}
      {p.distance != null && <span className="rounded bg-surface-2 px-1.5 py-0.5" title="Cosine distance">d={p.distance.toFixed(3)}</span>}
    </span>
  );
}

const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n) + "…" : t);

function PastCard({ r, query }: { r: PastResult; query: string }) {
  const changed = r.now ? r.now.d > 0.08 : true;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <h3 className="text-[15px] font-semibold text-ink">{r.title}</h3>
        {r.section && <span className="truncate text-xs text-ink-3">› {r.section}</span>}
        <span className={clsx("ml-auto rounded-md px-1.5 py-0.5 text-[11px] font-medium",
          !r.now ? "bg-[var(--del-bg)] text-[var(--del-text)]" : changed ? "bg-accent-soft text-accent" : "bg-surface-2 text-ink-3")}>
          {!r.now ? "gone today" : changed ? `reworded since (d=${r.now.d.toFixed(2)})` : "still says this"}
        </span>
      </div>
      <div className="grid gap-0 md:grid-cols-[1fr_auto_1fr]">
        <div className="p-5">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{r.year} · rev {r.rev_id}</div>
          <p className="text-[13.5px] leading-relaxed text-ink-2"><Highlight text={clip(displayText(r.text), 600)} query={query} /></p>
          <a href={r.oldid_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">revision {r.rev_id} <ArrowUpRight className="size-3" /></a>
        </div>
        <div className="hidden items-center text-ink-3 md:flex"><ArrowRight className="size-4" /></div>
        <div className="border-t border-line bg-surface-2/40 p-5 md:border-l md:border-t-0">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Today{r.now ? ` · rev ${r.now.rev_id}` : ""}</div>
          <p className="text-[13.5px] leading-relaxed text-ink-2">{r.now ? <Highlight text={clip(displayText(r.now.text), 600)} query={query} /> : "Not in today’s article."}</p>
          <Link to={`/time/${r.page_id}?view=compare&at=${r.year}-01-01T00:00:00`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            <History className="size-3" /> full diff {r.year} → today
          </Link>
        </div>
      </div>
    </Card>
  );
}
