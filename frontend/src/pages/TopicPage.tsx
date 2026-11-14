import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight, BadgeCheck, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, FilePlus2, Loader2, Megaphone, RefreshCw,
  Scale, History,
} from "lucide-react";
import clsx from "clsx";
import {
  api, api2, wapi, wapi2, wapi3, wapi5, type Fact, type StaleItem, type FactsResult, type Framing, type FramingDiff, type FramingPassage, type Lang,
  type TopicOverview,
} from "../api";
import { ArticleLinks, Button, CopyButton, ErrorBox, LANG_NAME, LangBadge, Message, Segmented, Spinner, SqlPanel, Tabs, displayText, fmtDate, nf } from "../ui";
import { attribution, mineFirst, talkNote, useEditingLang, wiki } from "../wiki";
import TimeMachinePage from "./TimeMachinePage";
import { WarDetail } from "./RadarPage";
import RelatedMap from "../components/RelatedMap";
import WorkspaceView from "../components/Workspace";

const LANGS: Lang[] = ["fi", "sv", "en"];
type Tab = "article" | "summary" | "facts" | "wording" | "missing" | "related" | "history";
type Arts = Partial<Record<Lang, TopicOverview["articles"][number]>>;

const KIND_LABEL: Record<FramingDiff["kind"], string> = {
  loaded_wording: "Loaded wording", agency_blame: "Blame", certainty: "Certainty", naming: "Naming", emphasis: "Emphasis",
};
const KIND_HELP: Record<FramingDiff["kind"], string> = {
  loaded_wording: "Emotionally loaded or evaluative words for the same act.",
  agency_blame: "Who is presented as aggressor, victim, liberator or responsible.",
  certainty: "Stated as fact in one edition, hedged or attributed in another.",
  naming: "Different names for the event, the groups or places.",
  emphasis: "Central in one edition, minimised or left out in another.",
};

export default function TopicPage() {
  const { qid = "" } = useParams();
  const valid = /^Q\d{1,18}$/.test(qid);
  const [params, setParams] = useSearchParams();
  const tab: Tab = (["article", "summary", "facts", "wording", "missing", "related", "history"] as const).find((t) => t === params.get("tab")) ?? "article";
  const compare = (["fi", "sv", "en"] as const).find((l) => l === params.get("compare")) ?? null;
  const setCompare = (l: Lang | null) => setParams((p) => { const n = new URLSearchParams(p); if (l) n.set("compare", l); else n.delete("compare"); n.set("tab", "article"); return n; }, { replace: true });
  const setTab = (t: Tab) => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); return n; }, { replace: true });
  const topic = useQuery({ queryKey: ["topic", qid], queryFn: () => wapi.topic(qid), enabled: valid, retry: false });
  const available = (topic.data?.articles ?? []).map((a) => a.lang);
  const [mine, setMine] = useEditingLang(available);
  const comparable = available.length >= 2;
  const [run, setRun] = useState(false);
  const factsStored = useQuery({ queryKey: ["facts", qid, "stored"], queryFn: () => wapi2.facts(qid, { cachedOnly: true }), enabled: valid && comparable });
  const framingStored = useQuery({ queryKey: ["framing", qid, "stored"], queryFn: () => wapi.framing(qid, { cachedOnly: true }), enabled: valid && comparable });
  const factsPending = factsStored.data?.pending === true;
  const framingPending = framingStored.data?.pending === true;
  const factsLive = useQuery({ queryKey: ["facts", qid, "live"], queryFn: () => wapi2.facts(qid), enabled: valid && comparable && (run || tab === "facts") && factsPending, staleTime: Infinity, retry: false });
  const framingLive = useQuery({ queryKey: ["framing", qid, "live"], queryFn: () => wapi.framing(qid), enabled: valid && comparable && (run || tab === "wording") && framingPending, staleTime: Infinity, retry: false });
  const facts = factsPending ? factsLive : factsStored;
  const framing = framingPending ? framingLive : framingStored;
  useEffect(() => setRun(false), [qid]);

  if (!valid || topic.error) return <NotFound />;
  if (topic.isLoading || !topic.data) return <Spinner label="Opening the topic" />;
  const t = topic.data;
  const arts: Arts = Object.fromEntries(t.articles.map((a) => [a.lang, a]));
  const title = (arts.en ?? t.articles[0]).title;
  const mapArt = arts[mine] ?? t.articles[0];
  const fd = facts.data?.available ? facts.data : null;
  const wd = framing.data?.available && !framing.data.pending ? framing.data : null;
  const cards = [...mineFirst(mine, available), ...LANGS.filter((l) => !available.includes(l))];

  return (
    <div className="space-y-5">
      <header className="rounded-xl border border-line px-5 pb-5 pt-4 shadow-sm" style={{ background: "var(--hero)" }}>
        <div className="text-xs text-ink-3"><Link to="/" className="text-accent hover:underline">Topics</Link><span className="mx-1.5">/</span>{title}</div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <h1 className="serif text-[30px] leading-tight text-ink-strong">{title}</h1>
          {comparable && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-ink-2">Article to improve</span>
              <Segmented<Lang> label="Article to improve" value={mine} onChange={setMine}
                options={t.articles.map((a) => ({ value: a.lang, label: <span className="inline-flex items-center gap-1.5"><LangBadge lang={a.lang} size="xs" />{LANG_NAME[a.lang]}</span> }))} />
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          {cards.map((l) => {
            const a = arts[l];
            return a ? (
              <span key={l} className={clsx("inline-flex items-center gap-1.5 text-sm", l === mine ? "font-semibold text-ink" : "text-ink-2")}>
                <LangBadge lang={l} size="xs" />{a.title}
                <span className="tabular text-xs font-normal text-ink-3">{nf.format(Math.round(a.len / 1000))} kB</span>
                <a href={wiki.edit(l, a.title)} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent hover:underline">edit</a>
              </span>
            ) : <span key={l} className="inline-flex items-center gap-1.5 text-sm text-ink-3"><LangBadge lang={l} size="xs" />no article</span>;
          })}
          {comparable && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-semibold text-ink-2">Compare with</span>
              <Segmented<string> label="Compare with" value={compare ?? "off"} onChange={(v) => setCompare(v === "off" ? null : v as Lang)}
                options={[{ value: "off", label: "Off" }, ...t.articles.filter((x) => x.lang !== mine).map((x) => ({ value: x.lang, label: <span className="inline-flex items-center gap-1.5"><LangBadge lang={x.lang} size="xs" />{LANG_NAME[x.lang]}</span> }))]} />
            </div>
          )}
        </div>
      </header>

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: "article", label: `${LANG_NAME[mine]} article` },
        { value: "facts", label: "Facts table", count: fd?.facts?.length ?? null, disabled: !comparable },
        { value: "related", label: "Related articles", disabled: !mapArt },
        { value: "history", label: "History", disabled: !arts.fi || !t.history },
      ]} />

      {!comparable && <Message>This topic exists in one language only, so there is nothing to compare. Its history is available if it is a Finnish article.</Message>}

      {tab === "article" && <WorkspaceView qid={qid} lang={mine} compare={compare && compare !== mine ? compare : null} />}
      {tab === "summary" && comparable && (
        <Summary mine={mine} arts={arts} facts={fd} framing={wd} onTab={setTab} history={t.history}
          loading={facts.isFetching || framing.isFetching}
          needsRun={factsPending && framingPending && !run} onRun={() => setRun(true)}
          error={facts.error ?? framing.error} />
      )}
      {tab === "facts" && comparable && (facts.isFetching ? <Working what="Comparing facts across the editions" /> : facts.error ? <ErrorBox error={facts.error} /> : fd ? <FactsView qid={qid} f={fd} mine={mine} arts={arts} /> : facts.data && !facts.data.available ? <Message>{facts.data.reason}</Message> : null)}
      {tab === "wording" && comparable && (framing.isFetching ? <Working what="Comparing wording, blame, certainty and naming" /> : framing.error ? <ErrorBox error={framing.error} /> : wd ? <WordingView qid={qid} f={wd} mine={mine} /> : framing.data && !framing.data.available ? <Message>{framing.data.reason}</Message> : null)}
      {tab === "missing" && comparable && <MissingView qid={qid} mine={mine} />}
      {tab === "related" && mapArt && <RelatedMap key={`${mapArt.lang}:${mapArt.page_id}`} lang={mapArt.lang} pageId={mapArt.page_id} />}
      {tab === "history" && arts.fi && t.history && <HistoryView pageId={arts.fi.page_id} />}
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-2xl space-y-3 pt-8">
      <Message kind="warning">This topic is not in the dataset (History of Finland, in Finnish, Swedish and English Wikipedia).</Message>
      <Link to="/" className="text-sm font-semibold text-accent hover:underline">Search for a topic</Link>
    </div>
  );
}

function Working({ what }: { what: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-1 px-4 py-3 text-sm text-ink-2 shadow-sm">
      <Loader2 className="size-4 animate-spin text-accent" /> {what}… The first analysis of these revisions takes about 20 seconds; it is then stored.
    </div>
  );
}

function AnalysisMeta({ r, onRefresh }: { r: FactsResult | Framing; onRefresh: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 text-xs text-ink-3">
      <span>{r.cached ? `Analysed ${fmtDate(r.computed_at)}` : `Analysed now (${r.seconds}s)`} with {r.model}, from the current revisions.</span>
      <button onClick={onRefresh} className="inline-flex items-center gap-1 text-accent hover:underline"><RefreshCw className="size-3" /> Re-run</button>
    </div>
  );
}

function SentenceLink({ lang, title, quote, label = "Open at this sentence" }: { lang: Lang; title: string; quote: string; label?: string }) {
  return (
    <a href={wiki.sentence(lang, title, quote)} target="_blank" rel="noreferrer" title="Opens the live Wikipedia article scrolled to this sentence"
      className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-accent hover:underline">{label}<ArrowUpRight className="size-3" /></a>
  );
}

// ── To review (summary) ─────────────────────────────────────────────────────────

type Task = { icon: typeof Scale; tone: "amber" | "blue" | "violet"; title: string; detail: React.ReactNode; tab: Tab; link?: { lang: Lang; title: string; quote: string } };

function Summary({ mine, arts, facts, framing, onTab, history, loading, needsRun, onRun, error }: {
  mine: Lang; arts: Arts; facts: FactsResult | null; framing: Framing | null; onTab: (t: Tab) => void;
  history: TopicOverview["history"]; loading: boolean; needsRun: boolean; onRun: () => void; error: unknown;
}) {
  if (error) return <ErrorBox error={error} />;
  if (needsRun) return (
    <div className="rounded-lg border border-line bg-surface-1 p-5 shadow-sm">
      <p className="text-sm font-semibold text-ink">These revisions have not been compared yet.</p>
      <p className="mt-1 text-sm text-ink-2">Muisti aligns the passages that describe the same events in each language, then compares facts and wording. It takes about 30 seconds and is stored for everyone.</p>
      <div className="mt-3"><Button kind="primary" onClick={onRun}>Compare the editions</Button></div>
    </div>
  );
  if (loading && !facts && !framing) return <Working what="Comparing the editions" />;
  const groups = facts?.groups ?? [];
  const tasks: Task[] = [];
  for (const f of facts?.facts ?? []) {
    const my = f.values.find((v) => v.lang === mine);
    const others = f.values.filter((v) => v.lang !== mine);
    if (f.status === "differ" && my && others.length) {
      tasks.push({ icon: Scale, tone: "amber", tab: "facts", title: `Check: ${f.subject}`,
        detail: <>The {LANG_NAME[mine]} article says <b className="font-semibold text-ink">{my.value}</b>; {others.map((o, i) => <span key={o.lang}>{i > 0 && "; "}{LANG_NAME[o.lang]} says <b className="font-semibold text-ink">{o.value}</b></span>)}.</>,
        link: arts[mine] && { lang: mine, title: arts[mine]!.title, quote: my.quote } });
    } else if (!my && f.missing_in.includes(mine) && others.length) {
      const src = groups[f.group_index]?.[others[0].lang];
      tasks.push({ icon: FilePlus2, tone: "blue", tab: "facts", title: `Missing from the ${LANG_NAME[mine]} article: ${f.subject}`,
        detail: <>{others.map((o, i) => <span key={o.lang}>{i > 0 && "; "}{LANG_NAME[o.lang]}: <b className="font-semibold text-ink">{o.value}</b></span>)}.</>,
        link: src && { lang: others[0].lang, title: src.title, quote: others[0].quote } });
    }
  }
  for (const d of framing?.differences ?? []) {
    const q = d.quotes.find((x) => x.lang === mine);
    if (q && d.severity !== "low") {
      tasks.push({ icon: Megaphone, tone: "violet", tab: "wording", title: `Review wording: ${d.title}`,
        detail: <>The {LANG_NAME[mine]} article: “{q.translation}”</>, link: arts[mine] && { lang: mine, title: arts[mine]!.title, quote: q.quote } });
    }
  }
  const order = { amber: 0, violet: 1, blue: 2 };
  tasks.sort((a, b) => order[a.tone] - order[b.tone]);
  const tone = { amber: "bg-warning-soft text-warning", blue: "bg-fi-soft text-fi", violet: "bg-[#f1ecfe] text-[#5b3fc4]" };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="rounded-lg border border-line bg-surface-1 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">To review in the {LANG_NAME[mine]} article <span className="tabular font-normal text-ink-3">{tasks.length}</span></h2>
          <span className="text-xs text-ink-3">facts that differ, wording to check, facts it lacks</span>
        </div>
        {tasks.length === 0 ? <p className="flex items-center gap-2 px-4 py-4 text-sm text-ink-2"><CheckCircle2 className="size-4 text-success" /> Nothing to review: the {LANG_NAME[mine]} article agrees with the other editions on the facts compared.</p> : (
          <ul className="divide-y divide-line">
            {tasks.slice(0, 14).map((k, i) => (
              <li key={i} className="flex gap-3 px-4 py-3">
                <span className={clsx("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md", tone[k.tone])}><k.icon className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink">{k.title}</div>
                  <div className="mt-0.5 text-[13px] text-ink-2">{k.detail}</div>
                  <div className="mt-1 flex flex-wrap gap-x-4">
                    {k.link && <SentenceLink {...k.link} label={`Open in the ${LANG_NAME[k.link.lang]} article`} />}
                    <button onClick={() => onTab(k.tab)} className="text-xs font-medium text-accent hover:underline">Details</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <aside className="space-y-5">
        {framing?.overall && (
          <section className="rounded-lg border border-line bg-surface-1 p-4 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">In short</h2>
            <p className="serif mt-1.5 text-[15px] leading-relaxed text-ink">{framing.overall}</p>
          </section>
        )}
        {framing?.profiles && framing.profiles.length > 0 && (
          <section className="rounded-lg border border-line bg-surface-1 shadow-sm">
            <h2 className="border-b border-line px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-3">How each edition reads</h2>
            <ul className="divide-y divide-line">
              {mineFirst(mine, LANGS).map((l) => framing.profiles!.find((p) => p.lang === l)).filter(Boolean).map((p) => (
                <li key={p!.lang} className="px-4 py-2.5 text-[13px] leading-relaxed text-ink-2">
                  <div className="mb-1 flex items-center gap-2"><LangBadge lang={p!.lang} size="xs" /><span className="text-xs font-semibold text-ink">{LANG_NAME[p!.lang]}{p!.lang === mine ? " (to improve)" : ""}</span></div>
                  {p!.profile}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="rounded-lg border border-line bg-surface-1 shadow-sm">
          <h2 className="border-b border-line px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-3">At a glance</h2>
          <dl className="divide-y divide-line text-sm">
            <Row k="Facts compared" v={facts?.facts?.length ?? "n/a"} />
            <Row k="Facts that differ" v={facts?.counts?.differ ?? "n/a"} />
            <Row k="Wording differences" v={framing?.differences?.length ?? "n/a"} />
            {history && <Row k="Finnish versions since 2003" v={nf.format(history.versions)} />}
          </dl>
        </section>
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3 px-4 py-2"><dt className="text-ink-2">{k}</dt><dd className="tabular font-semibold text-ink">{v}</dd></div>;
}

function Impact({ level }: { level: "high" | "medium" | "low" }) {
  return (
    <span className={clsx("ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
      level === "high" ? "bg-destructive-soft text-destructive" : level === "medium" ? "bg-warning-soft text-warning" : "bg-surface-3 text-ink-2")}>
      {level === "high" ? "High" : level === "medium" ? "Medium" : "Low"}
    </span>
  );
}

// ── Facts ───────────────────────────────────────────────────────────────────────

const STATUS: Record<Fact["status"], { label: string; cls: string }> = {
  differ: { label: "Differs", cls: "bg-warning-soft text-warning" },
  missing: { label: "Missing", cls: "bg-fi-soft text-fi" },
  agree: { label: "Agrees", cls: "bg-success-soft text-success" },
};

function FactsView({ qid, f, mine, arts }: { qid: string; f: FactsResult; mine: Lang; arts: Arts }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Fact["status"] | "all">("differ");
  const [open, setOpen] = useState<number | null>(null);
  const rows = (f.facts ?? []).map((x, i) => ({ ...x, i })).filter((x) => filter === "all" || x.status === filter);
  const langs = mineFirst(mine, LANGS.filter((l) => (f.groups ?? []).some((g) => g[l])));
  const stale = useQuery({ queryKey: ["stale", qid, f.facts?.length], queryFn: () => wapi5.stale(qid), enabled: !!arts.fi && (f.counts?.differ ?? 0) > 0, staleTime: Infinity, retry: false });
  const byGroup = new Map((stale.data?.items ?? []).map((it) => [it.fact_index, it]));
  const old = (stale.data?.items ?? []).filter((it) => it.stale).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<Fact["status"] | "all"> label="Show" value={filter} onChange={(v) => { setFilter(v); setOpen(null); }} options={[
          { value: "differ", label: `Differ ${f.counts?.differ ?? 0}` },
          { value: "missing", label: `Missing ${f.counts?.missing ?? 0}` },
          { value: "agree", label: `Agree ${f.counts?.agree ?? 0}` },
          { value: "all", label: "All" },
        ]} />
        <AnalysisMeta r={f} onRefresh={async () => { await wapi2.facts(qid, { refresh: true }); qc.invalidateQueries({ queryKey: ["facts", qid] }); }} />
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface-1 shadow-sm">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold text-ink-2">
              <th className="w-[26%] px-3 py-2.5">Fact</th>
              {langs.map((l) => <th key={l} className="border-l border-line px-3 py-2.5">
                <span className="inline-flex items-center gap-1.5"><LangBadge lang={l} size="xs" />{LANG_NAME[l]}{l === mine ? " (to improve)" : ""}</span></th>)}
              <th className="w-28 border-l border-line px-3 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={langs.length + 2} className="px-3 py-4 text-ink-3">No facts in this category.</td></tr>}
            {rows.map((x) => (
              <FactRow key={x.i} x={x} langs={langs} mine={mine} arts={arts} group={f.groups?.[x.group_index] ?? {}}
                history={x.status === "differ" ? byGroup.get(x.i) : undefined}
                open={open === x.i} onToggle={() => setOpen(open === x.i ? null : x.i)} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-3">Click a row for the exact sentences, links to them on Wikipedia and a talk-page note. Every quote is checked against the article text.</p>
      {filter === "differ" && stale.data?.available && stale.data.sql && (
        <SqlPanel title={`Finnish history: ${old} of ${stale.data.items?.length ?? 0} differing values unchanged for ${stale.data.stale_years}+ years`}
          sql={stale.data.sql} timings={[{ label: "all facts", ms: (stale.data.timings?.total_s ?? 0) * 1000 }]} />
      )}
    </div>
  );
}

function fmtMonth(iso: string) {
  return new Date(iso + "Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** When the Finnish article started saying this value: one square per year, the edit, the earlier wording. */
function FinnishHistory({ h }: { h: StaleItem }) {
  if (!h.traceable) return <p className="text-xs text-ink-3">Finnish history: {h.reason}</p>;
  const others = h.others.map((o) => `${LANG_NAME[o.lang]} says ${o.value}`).join(", ");
  return (
    <div className="rounded-md border border-line bg-surface-2/60 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-2">
        <History className="size-3.5" /> When the Finnish article started saying “{h.value}”
        {h.stale && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">unchanged for {Math.floor(h.years_unchanged ?? 0)} years</span>}
      </div>
      <div className="mt-2 flex items-start gap-[3px]" aria-label="Years in which the Finnish article states this value">
        {h.strip?.map((y) => (
          <div key={y.year} className="flex flex-col items-center gap-0.5" title={`${y.year}: ${y.present ? "states this value" : "does not state it"}`}>
            <div className={clsx("h-4 w-4 rounded-[3px]", y.present ? "bg-[var(--lang-fi)]" : "border border-line bg-surface-1")} />
            <span className="tabular h-3 w-4 overflow-visible whitespace-nowrap text-[10px] leading-3 text-ink-3">{y.year % 5 === 0 || y.year === h.strip![0].year ? y.year : ""}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[13px] text-ink">
        {h.first_in_history ? "In the article since its first versions" : <>Added on <b>{fmtMonth(h.since!)}</b></>}
        {h.edit && <> by {h.edit.anonymous ? "an anonymous editor" : <b>{h.edit.user}</b>}{h.edit.comment ? <span className="text-ink-2"> (“{h.edit.comment}”)</span> : null} · <a href={h.edit.diff_url} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">see the edit</a></>}
      </p>
      {h.before && <p className="mt-1 text-[13px] text-ink-2">Before that edit: <span className="serif text-ink">“{h.before}”</span></p>}
      {others && <p className="mt-1 text-xs text-ink-3">Today the {others}.{h.stale ? " Worth checking whether the Finnish value is still current." : ""}</p>}
    </div>
  );
}

function FactRow({ x, langs, mine, arts, group, open, onToggle, history }: {
  x: Fact & { i: number }; langs: Lang[]; mine: Lang; arts: Arts; group: Partial<Record<Lang, FramingPassage>>; open: boolean; onToggle: () => void;
  history?: StaleItem;
}) {
  const note = talkNote(`${x.subject}: the language editions differ`,
    `Comparing the Finnish, Swedish and English articles, the editions do not agree on ${x.subject.toLowerCase()}:`,
    x.values.map((v) => ({ lang: v.lang, title: group[v.lang]?.title ?? arts[v.lang]?.title ?? "", rev: group[v.lang]?.rev_id ?? arts[v.lang]?.rev_id ?? 0, quote: v.quote, translation: v.translation })));
  return (
    <>
      <tr onClick={onToggle} className={clsx("cursor-pointer border-b border-line align-top", open ? "bg-accent-soft" : "hover:bg-surface-2")}>
        <td className="px-3 py-2.5">
          <div className="flex items-start gap-1.5"><ChevronRight className={clsx("mt-0.5 size-3.5 shrink-0 text-ink-3 transition-transform", open && "rotate-90")} /><span className="font-medium text-ink">{x.subject}</span></div>
        </td>
        {langs.map((l) => {
          const v = x.values.find((y) => y.lang === l);
          return (
            <td key={l} className={clsx("border-l border-line px-3 py-2.5", l === mine && "bg-[color-mix(in_oklab,var(--lang-fi-soft)_45%,transparent)]")}>
              {v ? <span className={clsx("text-ink", x.status === "differ" && "rounded bg-[color-mix(in_oklab,var(--diff-removed)_45%,transparent)] px-1")}>{v.value}</span>
                 : x.missing_in.includes(l) ? <span className="text-ink-3">not stated</span> : <span className="text-ink-3">·</span>}
              {l === "fi" && history?.traceable && history.since && (
                <div className={clsx("mt-1 flex items-center gap-1 text-[11px]", history.stale ? "font-medium text-warning" : "text-ink-3")}>
                  <History className="size-3" /> {history.first_in_history ? "since the first versions" : `since ${history.since.slice(0, 4)}`}
                </div>
              )}
            </td>
          );
        })}
        <td className="border-l border-line px-3 py-2.5">
          <span className={clsx("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS[x.status].cls)}>{STATUS[x.status].label}</span>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-line bg-surface-1">
          <td colSpan={langs.length + 2} className="px-4 py-3">
            {x.note && <p className="mb-2 text-sm text-ink-2">{x.note}</p>}
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-line">
                {mineFirst(mine, x.values.map((v) => v.lang)).map((l) => x.values.find((v) => v.lang === l)!).map((v) => {
                  const src = group[v.lang];
                  return (
                    <tr key={v.lang} className="align-top">
                      <td className="w-14 py-2"><LangBadge lang={v.lang} size="xs" /></td>
                      <td className="py-2 pr-4 text-ink">“{v.translation}”{v.lang !== "en" && <div className="serif mt-0.5 text-ink-3">{v.quote}</div>}</td>
                      <td className="w-56 py-2 text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          {src && <SentenceLink lang={v.lang} title={src.title} quote={v.quote} />}
                          {src && <a href={src.oldid_url} target="_blank" rel="noreferrer" className="text-xs text-ink-3 hover:underline">revision {src.rev_id}</a>}
                          {v.verified ? <span className="inline-flex items-center gap-1 text-[11px] text-success"><BadgeCheck className="size-3.5" />quoted verbatim</span> : <span className="text-[11px] text-ink-3">paraphrase</span>}
                          {v.sql_check?.status === "checked" && <span className="text-[11px] text-success" title="Every number and date of this quote is stored for this passage in MariaDB (chunk_number, chunk_date)">figures found in MariaDB: {v.sql_check.values.map((x) => x.surface).join(", ")}</span>}
                          {v.sql_check?.status === "mismatch" && <span className="text-[11px] text-[var(--critical)]">not in the passage: {v.sql_check.values.filter((x) => !x.found).map((x) => x.surface).join(", ")}</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {history && <div className="mt-3"><FinnishHistory h={history} /></div>}
            <div className="mt-2 flex flex-wrap gap-2"><CopyButton text={note} label="Copy talk-page note" /></div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Wording (tone & framing) ───────────────────────────────────────────────────

function WordingView({ qid, f, mine }: { qid: string; f: Framing; mine: Lang }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<FramingDiff["kind"] | "all">("all");
  const list = useMemo(() => (f.differences ?? []).map((d, i) => ({ ...d, i })).filter((d) => kind === "all" || d.kind === kind), [f, kind]);
  const [sel, setSel] = useState(0);
  useEffect(() => setSel(0), [kind]);
  const cur = list[Math.min(sel, list.length - 1)];
  const go = useCallback((delta: number) => setSel((s) => Math.max(0, Math.min(list.length - 1, s + delta))), [list.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); go(1); }
      if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); go(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);
  const kinds = (Object.keys(KIND_LABEL) as FramingDiff["kind"][]).filter((k) => (f.counts?.[k] ?? 0) > 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<FramingDiff["kind"] | "all"> label="Kind" value={kind} onChange={setKind}
          options={[{ value: "all", label: `All ${f.differences?.length ?? 0}` }, ...kinds.map((k) => ({ value: k, label: `${KIND_LABEL[k]} ${f.counts?.[k]}`, hint: KIND_HELP[k] }))]} />
        <AnalysisMeta r={f} onRefresh={async () => { await wapi.framing(qid, { refresh: true }); qc.invalidateQueries({ queryKey: ["framing", qid] }); }} />
      </div>
      {list.length === 0 ? <p className="text-sm text-ink-3">No differences of this kind.</p> : (
        <div className="grid min-h-[480px] overflow-hidden rounded-lg border border-line bg-surface-1 shadow-sm lg:grid-cols-[300px_minmax(0,1fr)]">
          <ul className="divide-y divide-line border-b border-line bg-surface-2/50 lg:border-b-0 lg:border-r">
            {list.map((d, k) => (
              <li key={d.i}>
                <button onClick={() => setSel(k)} aria-current={k === sel}
                  className={clsx("w-full border-l-[3px] px-3 py-2.5 text-left", k === sel ? "border-accent bg-surface-1" : "border-transparent hover:bg-surface-1")}>
                  <div className="flex items-center gap-2 text-xs text-ink-3">{KIND_LABEL[d.kind]}<Impact level={d.severity} /></div>
                  <div className={clsx("mt-0.5 text-sm", k === sel ? "font-semibold text-ink" : "text-ink")}>{d.title}</div>
                </button>
              </li>
            ))}
          </ul>
          {cur && <WordingDetail d={cur} mine={mine} group={f.groups?.[cur.group_index] ?? {}} index={Math.min(sel, list.length - 1)} total={list.length} onPrev={() => go(-1)} onNext={() => go(1)} />}
        </div>
      )}
      <p className="text-xs text-ink-3">Passages describing the same events are aligned across languages with the passage vectors stored in MariaDB; Claude Sonnet compares them and quotes the exact words. Treat findings as leads to review. Keys: J / K or ↓ / ↑.</p>
    </div>
  );
}

function WordingDetail({ d, mine, group, index, total, onPrev, onNext }: {
  d: FramingDiff; mine: Lang; group: Partial<Record<Lang, FramingPassage>>; index: number; total: number; onPrev: () => void; onNext: () => void;
}) {
  const [showPassages, setShowPassages] = useState(false);
  useEffect(() => setShowPassages(false), [d]);
  const quotes = mineFirst(mine, d.quotes.map((q) => q.lang)).map((l) => d.quotes.find((q) => q.lang === l)!);
  const note = talkNote(`Wording: ${d.title}`, `${d.explanation} The editions word it as follows:`,
    quotes.filter((q) => group[q.lang]).map((q) => ({ lang: q.lang, title: group[q.lang]!.title, rev: group[q.lang]!.rev_id, quote: q.quote, translation: q.translation })));
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-2 text-xs text-ink-3">
        <span>{KIND_LABEL[d.kind]} · {KIND_HELP[d.kind]}</span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="tabular mr-1">{index + 1} of {total}</span>
          <button onClick={onPrev} disabled={index === 0} className="rounded-md border border-line p-0.5 hover:bg-surface-2 disabled:opacity-40" aria-label="Previous difference"><ChevronLeft className="size-4" /></button>
          <button onClick={onNext} disabled={index === total - 1} className="rounded-md border border-line p-0.5 hover:bg-surface-2 disabled:opacity-40" aria-label="Next difference"><ChevronRight className="size-4" /></button>
        </span>
      </div>
      <div className="space-y-4 p-5">
        <div>
          <div className="flex items-start gap-3"><h3 className="text-[17px] font-semibold text-ink">{d.title}</h3><Impact level={d.severity} /></div>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">{d.explanation}</p>
        </div>
        <div className="space-y-2">
          {quotes.map((q) => {
            const src = group[q.lang];
            return (
              <div key={q.lang} className={clsx("rounded-lg border p-3", q.lang === mine ? "border-[color-mix(in_oklab,var(--accent)_35%,transparent)] bg-[color-mix(in_oklab,var(--accent-soft)_55%,transparent)]" : "border-line")}>
                <div className="flex items-center gap-2 text-xs">
                  <LangBadge lang={q.lang} size="xs" /><span className="font-semibold text-ink">{LANG_NAME[q.lang]}{q.lang === mine ? " (to improve)" : ""}</span>
                  {src && <span className="truncate text-ink-3">{src.title}</span>}
                  <span className="ml-auto flex items-center gap-3">
                    {src && <SentenceLink lang={q.lang} title={src.title} quote={q.quote} />}
                    {!q.verified && <span className="text-[11px] text-ink-3">paraphrase</span>}
                  </span>
                </div>
                <p className="mt-1.5 text-[15px] text-ink">“{q.translation}”</p>
                {(q.lang !== "en" || q.loaded_words.length > 0) && <p className="serif mt-1 text-[13px] text-ink-2"><Marked text={q.quote} words={q.loaded_words} /></p>}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CopyButton text={note} label="Copy talk-page note" />
          <button onClick={() => setShowPassages(!showPassages)} className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
            <ChevronDown className={clsx("size-3.5 transition-transform", showPassages && "rotate-180")} /> {showPassages ? "Hide" : "Show"} the full passages
          </button>
        </div>
        {showPassages && (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {mineFirst(mine, LANGS.filter((l) => group[l])).map((l) => {
              const p = group[l]!;
              const q = d.quotes.find((x) => x.lang === l);
              return (
                <div key={l} className="rounded-lg border border-line p-3 text-[13px] leading-relaxed text-ink-2">
                  <div className="mb-1.5 flex items-center gap-2 text-xs"><LangBadge lang={l} size="xs" /><span className="truncate font-semibold text-ink">{p.title}</span>
                    <a href={wiki.section(l, p.title, p.section)} target="_blank" rel="noreferrer" className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-accent hover:underline">section<ArrowUpRight className="size-3" /></a></div>
                  <div className="serif"><Marked text={displayText(p.text)} words={q ? [q.quote] : []} soft /></div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Marked({ text, words, soft }: { text: string; words: string[]; soft?: boolean }) {
  const ws = words.map((w) => w.trim()).filter((w) => w.length >= 2).sort((a, b) => b.length - a.length);
  if (!ws.length) return <>{text}</>;
  const re = new RegExp(`(${ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(re).map((p, i) => ws.some((w) => w.toLowerCase() === p.toLowerCase())
    ? <mark key={i} className={soft ? "rounded bg-[var(--mark)] text-ink" : "rounded bg-diff-removed px-0.5 text-ink"}>{p}</mark>
    : <span key={i}>{p}</span>)}</>;
}

// ── Missing content: placed in the outline of the article to improve (where it would go) ──

const NOWHERE = 0.55;   // closest passage in the target farther than this: a topic the target doesn't cover at all

function MissingView({ qid, mine }: { qid: string; mine: Lang }) {
  const gaps = useQuery({ queryKey: ["gaps", qid], queryFn: () => api2.gaps(qid) });
  const sums = useQuery({ queryKey: ["missing", qid, mine], queryFn: () => wapi3.missing(qid, mine), staleTime: Infinity, retry: false });
  const [from, setFrom] = useState<Lang | "all">("all");
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { setOpen(null); setFrom("all"); }, [mine]);
  if (gaps.isLoading) return <Spinner label="Aligning passages across languages" />;
  if (gaps.error) return <ErrorBox error={gaps.error} />;
  if (!gaps.data || !gaps.data.languages[mine]) return null;
  const g = gaps.data;
  const threshold = g.threshold;
  const others = LANGS.filter((l) => l !== mine && g.languages[l]);
  const missing = others.flatMap((l) => (g.languages[l]!.passages).filter((p) => (p.matches[mine]?.distance ?? 1) > threshold).map((p) => ({ lang: l, p })));
  const shown = missing.filter((m) => from === "all" || m.lang === from);
  const target = g.articles.find((a) => a.lang === mine)!;
  // Outline of the article to improve: its top-level sections, in order.
  const top = (sec: string | null) => (sec ?? "Introduction").split(" › ")[0];
  const outline: string[] = [];
  for (const p of g.languages[mine]!.passages) { const t = top(p.section); if (!outline.includes(t)) outline.push(t); }
  const where = (m: (typeof missing)[number]) => { const c = m.p.matches[mine]; return !c || c.distance > NOWHERE ? null : top(c.section); };
  const bySection = new Map<string | null, typeof missing>();
  for (const m of shown) { const k = where(m); bySection.set(k, [...(bySection.get(k) ?? []), m]); }
  const counts = Object.fromEntries(others.map((l) => [l, missing.filter((m) => m.lang === l).length]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          <b className="text-ink">{missing.length} pieces of information</b> written in the {others.map((l) => LANG_NAME[l]).join(" or ")} article
          have no equivalent in the <b className="text-ink">{LANG_NAME[mine]} article</b>. They are shown where they would fit in its outline.
        </p>
        <Segmented<Lang | "all"> label="Found in" value={from} onChange={(v) => { setFrom(v); setOpen(null); }}
          options={[{ value: "all", label: `All ${missing.length}` }, ...others.map((l) => ({ value: l, label: <span className="inline-flex items-center gap-1.5"><LangBadge lang={l} size="xs" />{LANG_NAME[l]} {counts[l]}</span> }))]} />
      </div>
      {sums.error && <Message kind="warning">One-line summaries are unavailable right now; the original passages are shown instead.</Message>}
      <div className="overflow-hidden rounded-lg border border-line bg-surface-1 shadow-sm">
        <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2.5 text-sm">
          <LangBadge lang={mine} /><span className="font-semibold text-ink">{target.title}</span><span className="text-ink-3">· outline of the {LANG_NAME[mine]} article</span>
          {sums.isFetching && <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink-3"><Loader2 className="size-3.5 animate-spin" /> Summarising in English…</span>}
        </div>
        <ol className="divide-y divide-line">
          {outline.map((sec, i) => {
            const items = bySection.get(sec) ?? [];
            return (
              <li key={sec} className={clsx("px-4 py-2", items.length === 0 && "text-ink-3")}>
                <div className="flex items-baseline gap-2 text-sm"><span className="tabular w-5 text-right text-xs text-ink-3">{i + 1}</span><span className={items.length ? "font-semibold text-ink" : ""}>{sums.data?.sections?.[sec] && mine !== "en" ? <>{sums.data.sections[sec]} <span className="font-normal text-ink-3">({sec})</span></> : sec}</span>
                  {items.length > 0 && <span className="rounded-full bg-fi-soft px-2 py-0.5 text-[11px] font-semibold text-fi">{items.length} to add here</span>}</div>
                {items.length > 0 && <ul className="mt-1.5 space-y-1 pl-7">{items.map((m) => <MissingItem key={m.p.chunk_id} m={m} mine={mine} target={target} summary={sums.data?.summaries[String(m.p.chunk_id)]} open={open === m.p.chunk_id} onToggle={() => setOpen(open === m.p.chunk_id ? null : m.p.chunk_id)} articles={g.articles} />)}</ul>}
              </li>
            );
          })}
          {(bySection.get(null) ?? []).length > 0 && (
            <li className="bg-warning-soft/40 px-4 py-2">
              <div className="flex items-baseline gap-2 text-sm"><span className="w-5" /><span className="font-semibold text-ink">Not covered anywhere in the {LANG_NAME[mine]} article</span>
                <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">{bySection.get(null)!.length} could need a new section</span></div>
              <ul className="mt-1.5 space-y-1 pl-7">{bySection.get(null)!.map((m) => <MissingItem key={m.p.chunk_id} m={m} mine={mine} target={target} summary={sums.data?.summaries[String(m.p.chunk_id)]} open={open === m.p.chunk_id} onToggle={() => setOpen(open === m.p.chunk_id ? null : m.p.chunk_id)} articles={g.articles} />)}</ul>
            </li>
          )}
        </ol>
      </div>
      <p className="text-xs text-ink-3">A passage counts as missing when nothing in the {LANG_NAME[mine]} article is close to it in meaning (passage vectors in MariaDB). Its place is the section holding the closest passage. Summaries by Claude Sonnet.</p>
    </div>
  );
}

function MissingItem({ m, mine, target, summary, open, onToggle, articles }: {
  m: { lang: Lang; p: { chunk_id: number; section: string | null; text: string } }; mine: Lang; target: { title: string; rev_id: number };
  summary?: string; open: boolean; onToggle: () => void; articles: { lang: Lang; title: string; rev_id: number }[];
}) {
  const src = articles.find((a) => a.lang === m.lang)!;
  return (
    <li className={clsx("rounded-md border", open ? "border-accent/50 bg-surface-1 shadow-sm" : "border-transparent hover:border-line hover:bg-surface-2")}>
      <button onClick={onToggle} className="flex w-full items-start gap-2 px-2 py-1.5 text-left">
        <FilePlus2 className="mt-0.5 size-4 shrink-0 text-fi" />
        <LangBadge lang={m.lang} size="xs" />
        <span className="min-w-0 flex-1 text-[13.5px] text-ink">{summary ?? <span className="serif text-ink-2">{displayText(m.p.text).slice(0, 140)}…</span>}</span>
        <ChevronDown className={clsx("mt-0.5 size-4 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && <MissingDetail lang={m.lang} mine={mine} section={m.p.section} text={m.p.text} chunkId={m.p.chunk_id} article={src} target={target} />}
    </li>
  );
}

function MissingDetail({ lang, mine, section, text, chunkId, article, target }: {
  lang: Lang; mine: Lang; section: string | null; text: string; chunkId: number;
  article: { title: string; rev_id: number }; target: { title: string; rev_id: number };
}) {
  const tr = useQuery({ queryKey: ["translate", chunkId], queryFn: () => wapi2.translate(chunkId), enabled: lang !== "en", staleTime: Infinity, retry: false });
  const firstWords = displayText(text).split(/\s+/).slice(0, 12).join(" ");
  return (
    <div className="space-y-3 border-t border-line px-3 pb-3 pt-2.5">
      <div className="text-xs text-ink-3">From the {LANG_NAME[lang]} article <span className="font-medium text-ink">{article.title}</span>, section “{section ?? "Introduction"}”</div>
      {lang !== "en" && (
        <div>
          <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">English translation</div>
          {tr.isFetching ? <span className="inline-flex items-center gap-2 text-sm text-ink-2"><Loader2 className="size-4 animate-spin" /> Translating…</span>
            : tr.error ? <ErrorBox error={tr.error} /> : tr.data ? <p className="text-[14px] leading-relaxed text-ink">{tr.data.translation}</p> : null}
        </div>
      )}
      <div>
        <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Original ({LANG_NAME[lang]})</div>
        <p className="serif whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{displayText(text)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a href={wiki.edit(mine, target.title)} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-xs font-semibold text-white hover:bg-accent-hover">Edit the {LANG_NAME[mine]} article <ArrowUpRight className="size-3" /></a>
        <CopyButton text={attribution(mine, lang, article.title, article.rev_id)} label="Copy attribution (edit summary)" />
        {tr.data && <CopyButton text={tr.data.translation} label="Copy translation" />}
        <SentenceLink lang={lang} title={article.title} quote={firstWords} label={`Source in the ${LANG_NAME[lang]} article`} />
      </div>
    </div>
  );
}

// ── History ─────────────────────────────────────────────────────────────────────

function HistoryView({ pageId }: { pageId: number }) {
  const tl = useQuery({ queryKey: ["timeline", pageId], queryFn: () => api.timeline(pageId) });
  const wars = (tl.data?.yearly ?? []).filter((y) => y.controversy_m > 0 || y.named_reverts >= 5).sort((a, b) => b.controversy_m - a.controversy_m || b.named_reverts - a.named_reverts).slice(0, 6);
  const [year, setYear] = useState<number | null>(null);
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">Edit wars on the Finnish article</h2>
        {tl.isLoading ? <Spinner label="Reading the history" /> : wars.length === 0 ? <p className="text-sm text-ink-3">No years with editors reverting each other.</p> : (
          <div className="max-w-3xl overflow-hidden rounded-lg border border-line bg-surface-1 shadow-sm">
            <table className="w-full border-collapse text-sm">
              <thead><tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold text-ink-2">
                <th className="px-3 py-2">Year</th><th className="border-l border-line px-3 py-2 text-right">Reverts between named editors</th>
                <th className="border-l border-line px-3 py-2 text-right">Edits</th><th className="border-l border-line px-3 py-2" />
              </tr></thead>
              <tbody className="divide-y divide-line">
                {wars.map((w) => (
                  <tr key={w.year} className={clsx(year === w.year ? "bg-accent-soft" : "hover:bg-surface-2")}>
                    <td className="tabular px-3 py-2 font-medium">{w.year}</td>
                    <td className="tabular border-l border-line px-3 py-2 text-right">{w.named_reverts}</td>
                    <td className="tabular border-l border-line px-3 py-2 text-right">{w.edits}</td>
                    <td className="border-l border-line px-3 py-2 text-right"><button onClick={() => setYear(year === w.year ? null : w.year)} className="text-xs font-semibold text-accent hover:underline">{year === w.year ? "Hide" : "What was disputed"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {year && <WarDetail pageId={pageId} year={year} />}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">The article over time</h2>
        <TimeMachinePage pageIdProp={pageId} embedded />
      </section>
    </div>
  );
}
