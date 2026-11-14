import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ArrowUpRight, CircleCheck, Loader2, Search, TriangleAlert } from "lucide-react";
import { api6, type ContraPassage, type Contradictions, type Lang } from "../api";
import { Card, ErrorBox, LangBadge, SqlPanel, displayText } from "../ui";
import { sideDiff } from "../diff";

const SUGGESTIONS: { lang: Lang; page_id: number; title: string }[] = [
  { lang: "fi", page_id: 1150, title: "Suomen sisällissota" },
  { lang: "fi", page_id: 1256, title: "Talvisota" },
  { lang: "fi", page_id: 440, title: "Jatkosota" },
];

export default function ContradictionsPanel() {
  const [params, setParams] = useSearchParams();
  const lang = (["fi", "sv", "en"] as const).find((l) => l === params.get("lang")) ?? null;
  const page = /^\d{1,10}$/.test(params.get("page") ?? "") ? Number(params.get("page")) : null;
  const [q, setQ] = useState("");
  const hits = useQuery({ queryKey: ["s-articles", q], queryFn: () => api6.sArticles(q), enabled: q.trim().length >= 2 });
  const run = useQuery({
    queryKey: ["contradictions", lang, page], queryFn: () => api6.contradictions(lang!, page!),
    enabled: !!lang && !!page, staleTime: Infinity, retry: false,
  });
  const pick = (l: Lang, p: number) => { setQ(""); setParams({ tab: "self", lang: l, page: String(p) }); };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <p className="mx-auto max-w-3xl text-center text-[15px] text-ink-2">
        Pick an article. Its factual passages (with dates or numbers) are matched in MariaDB to the closest passages of
        other articles, in any language; Claude Sonnet then flags pairs that cannot both be true. Computed on demand.
      </p>
      <div className="relative mx-auto max-w-xl">
        <div className="flex items-center gap-2 rounded-2xl border border-line-strong bg-surface-1 p-2 shadow-sm focus-within:border-accent">
          <Search className="ml-2 size-5 shrink-0 text-ink-3" />
          <input value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} aria-label="Find an article"
            onKeyDown={(e) => { const h = hits.data?.[0]; if (e.key === "Enter" && h) pick(h.lang, h.page_id); }}
            placeholder="Find an article (fi, sv or en), e.g. Talvisota"
            className="min-w-0 flex-1 bg-transparent px-1 py-2 text-[15px] text-ink outline-none placeholder:text-ink-3" />
        </div>
        {q.trim().length >= 2 && hits.data && (
          <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-line bg-surface-1 py-1 shadow-lg">
            {hits.data.length === 0 && <li className="px-3 py-2 text-sm text-ink-3">No article starts with “{q.trim()}”.</li>}
            {hits.data.map((h) => (
              <li key={`${h.lang}-${h.page_id}`}>
                <button onClick={() => pick(h.lang, h.page_id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-2">
                  <LangBadge lang={h.lang} size="xs" /> <span className="truncate text-ink">{h.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-ink-3">{h.passages} passages</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!page && <FeaturedExample onRun={() => pick("fi", 1150)} />}
      {!page && (
        <div className="flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s.page_id} onClick={() => pick(s.lang, s.page_id)}
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-1 px-3 py-2 text-sm text-ink hover:border-accent">
              <LangBadge lang={s.lang} size="xs" /> {s.title}
            </button>
          ))}
        </div>
      )}

      {run.isFetching && (
        <Card className="mx-auto max-w-xl">
          <p className="flex items-center gap-2 p-5 text-sm text-ink-2">
            <Loader2 className="size-4 animate-spin text-accent" /> Matching passages in MariaDB, then checking pairs with Claude Sonnet… (about 15 seconds)
          </p>
        </Card>
      )}
      {run.error && <ErrorBox error={run.error} />}
      {run.data && !run.isFetching && (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 p-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><LangBadge lang={run.data.article.lang} />
                  <h2 className="truncate text-lg font-semibold text-ink">{run.data.article.title}</h2></div>
                <p className="mt-1 text-sm text-ink-2">
                  <b className="text-ink">{run.data.pairs_checked}</b> pairs of close passages checked ·{" "}
                  <b className="text-ink">{run.data.contradictions.length}</b> possible contradiction{run.data.contradictions.length === 1 ? "" : "s"}
                </p>
              </div>
              <span className="ml-auto text-xs text-ink-3">MariaDB {Math.round(run.data.timings.mariadb_ms)} ms · {run.data.model} {run.data.timings.llm_s}s</span>
            </div>
          </Card>
          {run.data.contradictions.length === 0 && (
            <Card><p className="flex items-center gap-2 p-5 text-sm text-ink-2"><CircleCheck className="size-4 text-[#0ca30c]" /> No conflicting facts found between this article and the closest passages of other articles.</p></Card>
          )}
          {run.data.contradictions.map((c, i) => <ContradictionCard key={i} c={c} />)}
          <SqlPanel title="Closest passages of other articles (HNSW index, stored vector as the query)" sql={run.data.sql}
            timings={[{ label: "SQL total", ms: run.data.timings.mariadb_ms }]} />
        </>
      )}
    </div>
  );
}

const LANG_LABEL: Record<Lang, string> = { fi: "Finnish", sv: "Swedish", en: "English" };

function Marked({ text, other }: { text: string; other: string }) {
  if (!other) return <>{text}</>;
  return <>{sideDiff(text, other).map((t, k) => t.diff
    ? <mark key={k} className="rounded bg-[color-mix(in_oklab,var(--critical)_16%,transparent)] px-0.5 font-semibold text-ink">{t.w} </mark>
    : <span key={k}>{t.w} </span>)}</>;
}

function Side({ label, p, quote, quoteEn, otherQuote, otherEn, fallback, border }: {
  label: string; p: ContraPassage; quote: string; quoteEn: string; otherQuote: string; otherEn: string; fallback: string; border?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={border ? "border-t border-line p-5 md:border-l md:border-t-0" : "p-5"}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span className="font-medium uppercase tracking-wide">{label}</span>
        <LangBadge lang={p.lang} size="xs" /> <span className="font-medium text-ink">{p.title}</span>
      </div>
      <p className="mt-2 text-[16px] leading-relaxed text-ink">
        {quoteEn ? <Marked text={quoteEn} other={otherEn} /> : fallback}
      </p>
      {quote && p.lang !== "en" && (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide">Original ({LANG_LABEL[p.lang]}):</span>
          <Marked text={quote} other={otherQuote} />
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <button onClick={() => setOpen(!open)} className="font-medium text-ink-2 hover:text-ink">{open ? "Hide" : "Show"} the full passage</button>
        <a href={p.oldid_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
          revision {p.rev_id} <ArrowUpRight className="size-3" />
        </a>
      </div>
      {open && (
        <p className="mt-2 rounded-lg border border-line bg-surface-2/40 p-3 text-[13px] leading-relaxed text-ink-2">
          {p.section && <span className="mb-1 block text-[11px] text-ink-3">{p.section}</span>}
          {displayText(p.text)}
        </p>
      )}
    </div>
  );
}

// A real case found by this check (passages and revisions verified in the database, dataset S, August 2025).
const EXAMPLE = {
  topic: "When did the Finnish Civil War end?",
  a: { title: "Suomen sisällissota", rev: 23498098, date: "15 May 1918", dateFi: "15. toukokuuta 1918",
       en: "The Finnish Civil War was fought between the forces led by the Senate of Finland and the People’s Delegation from 27 January to 15 May 1918.",
       fi: "Suomen sisällissota käytiin Suomen senaatin ja Suomen kansanvaltuuskunnan johtamien joukkojen välillä 27. tammikuuta – 15. toukokuuta 1918." },
  b: { title: "Itsenäisen Suomen historia", also: "Suomen poliittinen historia", rev: 23419370, rev2: 23421475, date: "16 May 1918", dateFi: "16. toukokuuta 1918",
       en: "The war was fought between the forces led by the Senate of Finland, i.e. the government, and the People’s Delegation from 27 January to 16 May 1918.",
       fi: "Sota käytiin Suomen senaatin eli hallituksen ja Suomen kansanvaltuuskunnan johtamien joukkojen välillä 27. tammikuuta – 16. toukokuuta 1918." },
};

function Hl({ text, needle }: { text: string; needle: string }) {
  const i = text.indexOf(needle);
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="rounded bg-[color-mix(in_oklab,var(--critical)_16%,transparent)] px-0.5 font-semibold text-ink">{needle}</mark>{text.slice(i + needle.length)}</>;
}

function FeaturedExample({ onRun }: { onRun: () => void }) {
  const e = EXAMPLE;
  const link = (rev: number) => `https://fi.wikipedia.org/?oldid=${rev}`;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-5">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-[var(--critical)]" aria-hidden />
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-accent">Real example found by this check</div>
            <p className="mt-0.5 text-[17px] font-semibold text-ink">{e.topic}</p>
            <p className="mt-1 text-sm text-ink-2">Three Finnish Wikipedia articles describe the same war with the same sentence, but not the same end date.</p>
          </div>
        </div>
        <button onClick={onRun} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">Run the check live</button>
      </div>
      <div className="grid md:grid-cols-2">
        <div className="p-5">
          <div className="flex items-center gap-2 text-xs text-ink-3"><span className="font-medium uppercase tracking-wide">One article says</span><LangBadge lang="fi" size="xs" /><span className="font-medium text-ink">{e.a.title}</span></div>
          <p className="mt-2 text-[16px] leading-relaxed text-ink"><Hl text={e.a.en} needle={e.a.date} /></p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-3"><span className="mr-1 text-[11px] font-medium uppercase tracking-wide">Original (Finnish):</span><Hl text={e.a.fi} needle={e.a.dateFi} /></p>
          <a href={link(e.a.rev)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">revision {e.a.rev} <ArrowUpRight className="size-3" /></a>
        </div>
        <div className="border-t border-line p-5 md:border-l md:border-t-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3"><span className="font-medium uppercase tracking-wide">Two others say</span><LangBadge lang="fi" size="xs" /><span className="font-medium text-ink">{e.b.title}</span><span>and</span><span className="font-medium text-ink">{e.b.also}</span></div>
          <p className="mt-2 text-[16px] leading-relaxed text-ink"><Hl text={e.b.en} needle={e.b.date} /></p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-3"><span className="mr-1 text-[11px] font-medium uppercase tracking-wide">Original (Finnish):</span><Hl text={e.b.fi} needle={e.b.dateFi} /></p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <a href={link(e.b.rev)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">revision {e.b.rev} <ArrowUpRight className="size-3" /></a>
            <a href={link(e.b.rev2)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">revision {e.b.rev2} <ArrowUpRight className="size-3" /></a>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function ContradictionCard({ c, labelA = "This article says", labelB = "Another article says" }: {
  c: Contradictions["contradictions"][number]; labelA?: string; labelB?: string;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 border-b border-line p-5">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-[var(--critical)]" aria-hidden />
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Possible contradiction: review both passages</div>
          <p className="mt-0.5 text-[15px] font-medium text-ink">{c.topic}</p>
          <p className="mt-1 text-sm text-ink-2">{c.explanation}</p>
          <Provenance c={c} />
        </div>
      </div>
      <div className="grid md:grid-cols-2">
        <Side label={labelA} p={c.a} quote={c.quote_a} quoteEn={c.quote_a_en} otherQuote={c.quote_b} otherEn={c.quote_b_en} fallback={c.value_a} />
        <Side label={labelB} p={c.b} quote={c.quote_b} quoteEn={c.quote_b_en} otherQuote={c.quote_a} otherEn={c.quote_a_en} fallback={c.value_b} border />
      </div>
    </Card>
  );
}

/** Where the finding comes from: dates found in SQL and confirmed by Claude, or figures found by Claude and checked in SQL. */
function Provenance({ c }: { c: Contradictions["contradictions"][number] }) {
  if (c.kind === "date") return (
    <p className="mt-2 inline-flex flex-wrap items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-[11px] text-ink-2">
      <b className="font-semibold text-ink">Found in MariaDB</b> same anchor date, dates {c.days} day{c.days === 1 ? "" : "s"} apart
      <span className="text-ink-3">·</span> <b className="font-semibold text-ink">confirmed by Claude</b>
    </p>
  );
  if (c.kind === "number" && c.sql_check) {
    const vals = [...c.sql_check.a.values, ...c.sql_check.b.values].filter((v) => v.kind === "number");
    return (
      <p className="mt-2 inline-flex flex-wrap items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-[11px] text-ink-2">
        <b className="font-semibold text-ink">Found by Claude</b> <span className="text-ink-3">·</span>
        <b className="font-semibold text-ink">figures checked in MariaDB</b> against the Wikipedia text:
        {vals.length === 0 ? <span>no figure to check</span> : vals.map((v, i) => (
          <span key={i} className={v.found ? "tabular text-success" : "tabular text-[var(--critical)]"}>{v.surface} {v.found ? "✓" : "✗"}</span>
        ))}
      </p>
    );
  }
  return null;
}
