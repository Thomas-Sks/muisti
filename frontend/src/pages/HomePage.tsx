import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, FilePlus2, History, Loader2, Megaphone, Scale, Search } from "lucide-react";
import clsx from "clsx";
import { wapi, wapi2, type Lang, type TopicHitW } from "../api";
import { ErrorBox, LangBadge, nf } from "../ui";
import WordGlobe from "../components/WordGlobe";

const LANGS: Lang[] = ["fi", "sv", "en"];
const DEMO = "Q211855";   // Finnish Civil War: analyses stored, used for the live examples below
const START = [
  { qid: "Q211855", title: "Finnish Civil War", note: "1918" },
  { qid: "Q134949", title: "Winter War", note: "1939–1940" },
  { qid: "Q122100", title: "Continuation War", note: "1941–1944" },
  { qid: "Q152306", title: "Carl Gustaf Emil Mannerheim", note: "person" },
  { qid: "Q1412941", title: "Lapua Movement", note: "1929–1932" },
];

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export default function HomePage() {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(params.get("q") ?? "");
  const q = useDebounced(draft.trim(), 300);
  const nav = useNavigate();
  useEffect(() => { setParams(q ? { q } : {}, { replace: true }); }, [q, setParams]);
  const results = useQuery({ queryKey: ["topic-search", q], queryFn: () => wapi.search(q), enabled: q.length >= 2, staleTime: 60_000 });
  const first = results.data?.topics.find((t) => t.comparable);

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-line px-5 pb-8 pt-8 shadow-sm" style={{ background: "var(--hero)" }}>
      <div className="mx-auto grid max-w-6xl items-center gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
      <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex gap-1.5">{LANGS.map((l) => <LangBadge key={l} lang={l} />)}</div>
        <h1 className="serif text-[32px] leading-tight text-ink-strong">
          Compare a topic across Finnish, Swedish and English Wikipedia.
        </h1>
        <p className="max-w-3xl text-[15px] leading-relaxed text-ink-2">
          Muisti helps Wikipedia editors see where language editions disagree: facts that differ, wording that takes
          sides, and content missing from one language. Every finding is quoted, translated into English and linked to
          the revision it comes from.
        </p>
      </section>

      <form onSubmit={(e) => { e.preventDefault(); if (first?.wikidata_id) nav(`/topic/${first.wikidata_id}`); }}>
        <label className="mb-1 block text-xs font-semibold text-ink-2" htmlFor="topic-search">Search a topic, in any language</label>
        <div className="flex h-12 items-center gap-2 rounded-lg border border-line-input bg-surface-1 px-4 shadow-sm focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
          <Search className="size-4 shrink-0 text-ink-3" />
          <input id="topic-search" value={draft} maxLength={200} autoFocus onChange={(e) => setDraft(e.target.value)}
            placeholder="Winter War, sisällissota, Mannerheim…" aria-label="Search a topic"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3" />
          {results.isFetching && <Loader2 className="size-4 animate-spin text-ink-3" />}
        </div>
      </form>

      </div>
      <div className="hidden justify-center lg:flex"><WordGlobe size={440} /></div>
      </div>
      </div>
      <div className="mx-auto max-w-4xl space-y-8">
      {results.error && <ErrorBox error={results.error} />}

      {q.length >= 2 && results.data && <Results topics={results.data.topics} query={q} />}

      {q.length < 2 && (
        <>
          <WhatYouGet />
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Start with</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface-1 shadow-sm">
              {START.map((s) => (
                <li key={s.qid}>
                  <Link to={`/topic/${s.qid}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <span className="text-sm font-medium text-accent">{s.title}</span>
                    <span className="text-xs text-ink-3">{s.note}</span>
                    <span className="ml-auto flex gap-1">{LANGS.map((l) => <LangBadge key={l} lang={l} size="xs" />)}</span>
                    <ChevronRight className="size-4 text-ink-3" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      </div>
    </div>
  );
}

function Results({ topics, query }: { topics: TopicHitW[]; query: string }) {
  if (topics.length === 0) return <p className="text-sm text-ink-2">No topic matches “{query}”.</p>;
  return (
    <table className="w-full border-collapse overflow-hidden rounded-lg border border-line bg-surface-1 text-sm shadow-sm">
      <thead>
        <tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold text-ink-2">
          <th className="px-4 py-2">Topic</th>
          {LANGS.map((l) => <th key={l} className="border-l border-line px-3 py-2"><LangBadge lang={l} size="xs" /></th>)}
          <th className="w-24 border-l border-line px-3 py-2" />
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {topics.map((t) => (
          <tr key={t.wikidata_id ?? t.title} className={clsx(t.comparable ? "hover:bg-surface-2" : "text-ink-3")}>
            <td className="px-4 py-2 font-medium">
              {t.comparable && t.wikidata_id ? <Link to={`/topic/${t.wikidata_id}`} className="text-accent hover:underline">{t.title}</Link> : t.title}
            </td>
            {LANGS.map((l) => {
              const a = t.languages[l];
              return (
                <td key={l} className="max-w-48 border-l border-line px-3 py-2 text-xs">
                  {a ? <><div className="truncate text-ink">{a.title}</div>{a.len ? <div className="tabular text-ink-3">{nf.format(Math.round(a.len / 1000))} kB</div> : null}</>
                     : <span className="text-ink-3">none</span>}
                </td>
              );
            })}
            <td className="border-l border-line px-3 py-2 text-right text-xs">
              {t.comparable && t.wikidata_id ? <Link to={`/topic/${t.wikidata_id}`} className="font-semibold text-accent hover:underline">Compare</Link>
                                             : <span>1 language</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What an editor gets, with real findings read from the stored analyses of the demo topic. */
function WhatYouGet() {
  const facts = useQuery({ queryKey: ["facts-demo"], queryFn: () => wapi2.facts(DEMO, { cachedOnly: true }), staleTime: 300_000 });
  const framing = useQuery({ queryKey: ["framing-demo"], queryFn: () => wapi.framing(DEMO, { cachedOnly: true }), staleTime: 300_000 });
  const fact = facts.data?.facts?.find((f) => f.status === "differ");
  const frame = framing.data?.differences?.find((d) => d.kind === "loaded_wording") ?? framing.data?.differences?.[0];
  const rows: { title: string; text: string; example?: string; tab: string; icon: typeof Scale; tone: string }[] = [
    { title: "Facts that differ", tab: "facts", icon: Scale, tone: "bg-warning-soft text-warning",
      text: "Dates, numbers, people and outcomes compared across the three editions: which agree, which conflict, which are missing.",
      example: fact ? `${fact.subject}: ${fact.values.map((v) => `${v.value} (${v.lang.toUpperCase()})`).join(" vs ")}` : undefined },
    { title: "Wording that takes sides", tab: "wording", icon: Megaphone, tone: "bg-[#f1ecfe] text-[#5b3fc4]",
      text: "Loaded words, who is blamed, what is stated as certain or hedged, how events and groups are named.",
      example: frame ? frame.quotes.filter((x, i, all) => all.findIndex((y) => y.lang === x.lang) === i)
        .map((x) => `“${x.translation}” (${x.lang.toUpperCase()})`).slice(0, 2).join(" vs ") : undefined },
    { title: "Content missing from one language", tab: "missing", icon: FilePlus2, tone: "bg-fi-soft text-fi",
      text: "Passages one edition has and the others don’t, translated, with the revision to cite when you add them." },
    { title: "How the article changed", tab: "history", icon: History, tone: "bg-en-soft text-en",
      text: "Every version since 2003 for Finnish articles: read any date, see what editors fought over and where each sentence came from." },
  ];
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">What you get for a topic</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface-1 shadow-sm">
        {rows.map((r) => (
          <li key={r.title} className="grid gap-1 px-4 py-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-6">
            <div className="flex items-center gap-2.5 text-sm font-semibold text-ink"><span className={clsx("flex size-7 items-center justify-center rounded-md", r.tone)}><r.icon className="size-4" /></span>{r.title}</div>
            <div className="min-w-0 text-sm text-ink-2">
              {r.text}
              {r.example && (
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[13px]">
                  <span className="text-xs text-ink-3">Finnish Civil War:</span>
                  <span className="text-ink">{r.example}</span>
                  <Link to={`/topic/${DEMO}?tab=${r.tab}`} className="text-xs font-semibold text-accent hover:underline">See it</Link>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
