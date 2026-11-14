import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ArrowUpRight, Fingerprint, GitCompare, Search, UserRound } from "lucide-react";
import clsx from "clsx";
import { api, type AsOf, type Diff, type Timeline as TL } from "../api";
import Timeline from "../charts/Timeline";
import DriftCard from "../components/DriftCard";
import FactsCard from "../components/FactsCard";
import OriginPanel from "../components/OriginPanel";
import { Card, ErrorBox, Segmented, Spinner, SqlPanel, StatTile, fmtDate, nf } from "../ui";

const DEFAULT_PAGE = 1150;   // Suomen sisällissota, the most edited article of the dataset (3,357 versions)

/** Accepts YYYY, YYYY-MM, YYYY-MM-DD[THH:MM[:SS]] between 2001 and 2026; anything else is ignored. */
function validTs(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4})(-\d{2})?(-\d{2})?([T ]\d{2}:\d{2}(:\d{2})?)?$/.exec(v.trim());
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 2001 || year > 2026) return null;
  const d = new Date(v.length === 4 ? `${v}-01-01T00:00:00Z` : v.length === 7 ? `${v}-01T00:00:00Z` : v.length === 10 ? `${v}T00:00:00Z` : `${v.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : v.trim().replace(" ", "T");
}

const endOfMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0, 23, 59, 59));
  return d.toISOString().slice(0, 19);
};

export default function TimeMachinePage({ pageIdProp, embedded = false }: { pageIdProp?: number; embedded?: boolean } = {}) {
  const { pageId } = useParams();
  const id = pageIdProp ?? (/^\d{1,10}$/.test(pageId ?? "") ? Number(pageId) : DEFAULT_PAGE);
  const [params, setParams] = useSearchParams();
  const at = validTs(params.get("at"));
  const cmp = validTs(params.get("cmp"));
  const view = params.get("view") === "compare" || (params.get("view") !== "read" && cmp) ? "compare" : "read";

  const timeline = useQuery({ queryKey: ["timeline", id], queryFn: () => api.timeline(id) });
  const [traced, setTraced] = useState<{ text: string; upto: string | null } | null>(null);
  useEffect(() => setTraced(null), [id]);
  const lastTs = timeline.data?.article.last_edit?.slice(0, 19);
  const atTs = at ?? lastTs ?? null;
  const cmpTs = cmp ?? lastTs ?? null;

  const asOf = useQuery({
    queryKey: ["asof", id, atTs], queryFn: () => api.asOf(id, atTs!), enabled: !!atTs && view === "read",
    placeholderData: keepPreviousData,
  });
  const diff = useQuery({
    queryKey: ["diff", id, atTs, cmpTs], queryFn: () => api.diff(id, atTs!, cmpTs!),
    enabled: !!atTs && !!cmpTs && view === "compare", placeholderData: keepPreviousData,
  });

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-5">
      {!embedded && <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-accent">Time machine · system-versioned table</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{timeline.data?.article.title ?? (timeline.error ? "Article not found" : "…")}</h1>
        </div>
        <ArticlePicker />
      </div>}

      {timeline.error && <NotFound />}
      {timeline.isLoading && <Spinner label="Reading the edit history" />}
      {timeline.data && (
        <>
          <Card>
            <div className="grid grid-cols-2 gap-5 border-b border-line p-5 sm:grid-cols-5">
              <StatTile label="Versions" value={nf.format(timeline.data.article.versions)} />
              <StatTile label="First version" value={fmtDate(timeline.data.article.first_edit)} />
              <StatTile label="Reverts" value={nf.format(timeline.data.yearly.reduce((s, y) => s + y.reverts, 0))}
                hint={`${nf.format(timeline.data.yearly.reduce((s, y) => s + y.named_reverts, 0))} between named editors`} />
              <StatTile label="Edit-war peak" value={peakYear(timeline.data) ?? "none"} hint="highest controversy M" />
              <StatTile label="Size today" value={`${nf.format(Math.round(timeline.data.article.len / 1000))} kB`} hint="of wikitext" />
            </div>
            <div className="p-4 pb-3">
              <Timeline monthly={timeline.data.monthly}
                selected={atTs?.slice(0, 7) ?? null}
                compare={view === "compare" ? cmpTs?.slice(0, 7) : null}
                onPick={(month) => set({ at: endOfMonth(month) })} />
            </div>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented label="View" value={view} onChange={(v) => set({ view: v, cmp: v === "compare" ? (cmp ?? lastTs ?? null) : null })}
              options={[{ value: "read", label: "Read as of a date" }, { value: "compare", label: <span className="inline-flex items-center gap-1"><GitCompare className="size-3.5" />Compare two dates</span> }]} />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <DateField label={view === "compare" ? "From" : "As of"} value={atTs} onChange={(v) => set({ at: v })} />
              {view === "compare" && <DateField label="To" value={cmpTs} onChange={(v) => set({ cmp: v })} />}
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-4">
              {view === "read" && asOf.error && <ErrorBox error={asOf.error} />}
              {view === "read" && asOf.data && <ArticleView data={asOf.data} onGo={(ts) => set({ at: ts })} stale={asOf.isPlaceholderData}
                onTrace={(text) => setTraced({ text, upto: asOf.data!.version.row_start.slice(0, 19) })} />}
              {view === "compare" && diff.error && <ErrorBox error={diff.error} />}
              {view === "compare" && diff.data && <DiffView data={diff.data} stale={diff.isPlaceholderData} />}
              {(asOf.isLoading || diff.isLoading) && <Spinner label="Travelling" />}
            </div>
            <aside className="space-y-4">
              {traced && <OriginPanel pageId={id} text={traced.text} upto={traced.upto} onClose={() => setTraced(null)} />}
              {view === "read" && asOf.data && (
                <SqlPanel title="FOR SYSTEM_TIME AS OF" sql={asOf.data.sql}
                  timings={[{ label: "AS OF", ms: asOf.data.timings.as_of_ms }]} />
              )}
              <SqlPanel title="Edits per month (precomputed revisions)" sql={timeline.data.sql.monthly}
                timings={[{ label: "SQL", ms: timeline.data.timings.monthly_ms }]} />
              <Editors data={timeline.data} />
              <Reverts data={timeline.data} onGo={(ts) => set({ at: ts, view: "read", cmp: null })} />
            </aside>
          </div>
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <DriftCard pageId={id} onCompare={(from, to) => { set({ view: "compare", at: from, cmp: to }); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
            <FactsCard pageId={id} />
          </div>
        </>
      )}
    </div>
  );
}

function peakYear(t: TL) {
  const best = [...t.yearly].sort((a, b) => b.controversy_m - a.controversy_m || b.named_reverts - a.named_reverts)[0];
  return best && (best.controversy_m > 0 || best.named_reverts > 0) ? String(best.year) : null;
}

function DateField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string) => void }) {
  return (
    <label className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-1 px-2.5 py-1.5">
      <span className="text-xs text-ink-3">{label}</span>
      <input type="date" value={value?.slice(0, 10) ?? ""} min="2003-01-01" max="2026-10-01"
        onChange={(e) => { const v = e.target.value; if (v && v >= "2003-01-01" && v <= "2026-10-01") onChange(`${v}T23:59:59`); }}
        className="tabular bg-transparent text-sm text-ink outline-none" />
    </label>
  );
}

function ArticleView({ data, onGo, stale, onTrace }: { data: AsOf; onGo: (ts: string) => void; stale: boolean; onTrace: (text: string) => void }) {
  const v = data.version;
  const n = data.neighbours;
  return (
    <Card className={clsx("overflow-hidden transition-opacity", stale && "opacity-60")}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-2/50 px-5 py-3">
        <div className="min-w-0 text-xs text-ink-2">
          <div className="font-semibold text-ink">Version {nf.format(n.version_no)} of {nf.format(n.versions)} · saved {fmtDate(v.row_start, true)}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
            <span className="inline-flex items-center gap-1"><UserRound className="size-3" />{v.user ?? "unknown"}{v.anonymous ? " (anonymous)" : ""}</span>
            {v.comment && <span className="truncate italic text-ink-3">“{v.comment}”</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button disabled={!n.prev_ts} onClick={() => n.prev_ts && onGo(n.prev_ts.slice(0, 19).replace(" ", "T"))}
            className="rounded-md border border-line bg-surface-1 p-1.5 text-ink-2 hover:text-ink disabled:opacity-40" aria-label="Previous version">
            <ArrowLeft className="size-4" />
          </button>
          <button disabled={!n.next_ts} onClick={() => n.next_ts && onGo(n.next_ts.slice(0, 19).replace(" ", "T"))}
            className="rounded-md border border-line bg-surface-1 p-1.5 text-ink-2 hover:text-ink disabled:opacity-40" aria-label="Next version">
            <ArrowRight className="size-4" />
          </button>
          <a href={v.oldid_url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-1 px-2 py-1 text-xs font-medium text-accent hover:underline">
            rev {v.rev_id} <ArrowUpRight className="size-3" />
          </a>
        </div>
      </div>
      {data.notice && (
        <div className="border-b border-line bg-accent-soft px-5 py-2 text-xs font-medium text-accent">{data.notice}</div>
      )}
      <article className="max-h-[70vh] overflow-auto px-6 py-5 text-[14.5px] leading-relaxed text-ink-2">
        {data.blocks.map((b, i) =>
          b.kind === "h" ? <h3 key={i} className="mb-2 mt-5 text-base font-semibold text-ink first:mt-0">{b.text}</h3>
            : b.kind === "li" ? <p key={i} className="mb-1 pl-4 before:-ml-3 before:mr-2 before:content-['•']">{b.text}</p>
            : (
              <div key={i} className="group relative mb-3">
                <p>{b.text}</p>
                {b.text.split(" ").length >= 8 && (
                  <button onClick={() => onTrace(b.text)} title="Find the revision where this passage first appeared"
                    className="absolute -right-2 -top-2 hidden items-center gap-1 rounded-md border border-line bg-surface-1 px-2 py-0.5 text-[11px] font-medium text-accent shadow-sm group-hover:inline-flex">
                    <Fingerprint className="size-3" /> where did this come from?
                  </button>
                )}
              </div>
            ))}
      </article>
    </Card>
  );
}

function DiffView({ data, stale }: { data: Diff; stale: boolean }) {
  const s = data.stats;
  return (
    <Card className={clsx("overflow-hidden transition-opacity", stale && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line bg-surface-2/50 px-5 py-3 text-xs text-ink-2">
        <span><b className="text-ink">rev {data.from.rev_id}</b> ({fmtDate(data.from.row_start)}) → <b className="text-ink">rev {data.to.rev_id}</b> ({fmtDate(data.to.row_start)})</span>
        <span className="tabular">{s.unchanged} unchanged · <span className="text-[var(--ins-text)]">{s.added} added</span> · <span className="text-[var(--del-text)]">{s.removed} removed</span> · {s.changed} edited</span>
      </div>
      <article className="max-h-[70vh] space-y-2 overflow-auto px-6 py-5 text-[14px] leading-relaxed text-ink-2">
        {data.blocks.map((b, i) => {
          if (b.op === "same") return <div key={i} className="text-center text-[11px] text-ink-3">· · · {b.count} unchanged paragraph{b.count > 1 ? "s" : ""} · · ·</div>;
          if (b.op === "added") return <p key={i} className={clsx("rounded-md bg-[var(--ins-bg)] px-3 py-1.5 text-[var(--ins-text)]", b.kind === "h" && "font-semibold")}>{b.text}</p>;
          if (b.op === "removed") return <p key={i} className={clsx("rounded-md bg-[var(--del-bg)] px-3 py-1.5 text-[var(--del-text)] line-through decoration-1", b.kind === "h" && "font-semibold")}>{b.text}</p>;
          return (
            <p key={i} className="rounded-md border border-line px-3 py-1.5">
              {b.words.map((w, k) => w.op === "eq" ? <span key={k}>{w.text} </span>
                : w.op === "ins" ? <ins key={k} className="rounded bg-[var(--ins-bg)] px-0.5 text-[var(--ins-text)] no-underline">{w.text} </ins>
                : <del key={k} className="rounded bg-[var(--del-bg)] px-0.5 text-[var(--del-text)]">{w.text} </del>)}
            </p>
          );
        })}
      </article>
    </Card>
  );
}

function Editors({ data }: { data: TL }) {
  const max = Math.max(...data.editors.map((e) => e.edits), 1);
  return (
    <Card title="Most active editors" subtitle="from the precomputed revision table">
      <ul className="divide-y divide-line">
        {data.editors.slice(0, 8).map((e) => (
          <li key={`${e.user}-${e.anonymous}`} className="px-5 py-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium text-ink">{e.user ?? "unknown"}{e.anonymous ? <span className="ml-1 font-normal text-ink-3">anon.</span> : null}</span>
              <span className="tabular text-ink-2">{nf.format(e.edits)}</span>
            </div>
            <div className="mt-1 h-1 rounded-full bg-surface-2">
              <div className="h-1 rounded-full bg-[var(--series-1)]" style={{ width: `${(e.edits / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Reverts({ data, onGo }: { data: TL; onGo: (ts: string) => void }) {
  const named = data.reverts.filter((r) => !r.anonymous && !r.reverted_anonymous);
  const list = (named.length ? named : data.reverts).slice(0, 8);
  return (
    <Card title="Recent reverts between named editors" subtitle="click to read the article at that moment">
      {list.length === 0 && <p className="px-5 py-4 text-xs text-ink-3">None.</p>}
      <ul className="divide-y divide-line">
        {list.map((r) => (
          <li key={r.rev_id}>
            <button onClick={() => onGo(r.ts.slice(0, 19))} className="w-full px-5 py-2 text-left text-xs hover:bg-surface-2">
              <div className="flex justify-between gap-2"><b className="truncate text-ink">{r.user}</b><span className="tabular shrink-0 text-ink-3">{fmtDate(r.ts)}</span></div>
              <div className="truncate text-ink-3">undid {r.reverted_user ?? "?"}{r.comment ? `: ${r.comment}` : ""}</div>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ArticlePicker() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const hits = useQuery({ queryKey: ["articles", q], queryFn: () => api.articles(q), enabled: q.trim().length >= 2 });
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const items = useMemo(() => hits.data ?? [], [hits.data]);
  return (
    <div ref={box} className="relative w-full max-w-sm">
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-1 px-3 py-2 focus-within:border-accent">
        <Search className="size-4 text-ink-3" />
        <input value={q} onChange={(e) => { setQ(e.target.value.slice(0, 100)); setOpen(true); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" && items[0]) { setOpen(false); setQ(""); nav(`/time/${items[0].page_id}`); } if (e.key === "Escape") setOpen(false); }}
          placeholder="Find an article (e.g. Talvisota)" aria-label="Find an article"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3" />
      </div>
      {open && q.trim().length >= 2 && !hits.isFetching && items.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-ink-3 shadow-lg">
          No article in the history dataset starts with “{q.trim()}”. Try “Talvisota” or “Mannerheim”.
        </div>
      )}
      {open && items.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-line bg-surface-1 py-1 shadow-lg">
          {items.map((a) => (
            <li key={a.page_id}>
              <button onClick={() => { setOpen(false); setQ(""); nav(`/time/${a.page_id}`); }}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-2">
                <span className="truncate text-ink">{a.title}</span>
                <span className="tabular shrink-0 text-xs text-ink-3">{nf.format(a.versions)} versions</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const SUGGESTIONS = [
  { id: 1150, title: "Suomen sisällissota", note: "the 1918 civil war, 3,357 versions" },
  { id: 1256, title: "Talvisota", note: "the Winter War, casualty figures rewritten 56 times" },
  { id: 6021, title: "Carl Gustaf Emil Mannerheim", note: "2,400 versions" },
  { id: 1275, title: "Urho Kekkonen", note: "2,384 versions" },
];

function NotFound() {
  return (
    <Card title="This article is not in the history dataset" subtitle="the time machine covers the 19,742 Finnish articles on the history of Finland (dataset M)">
      <ul className="grid gap-px overflow-hidden bg-[var(--border)] sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <li key={s.id}>
            <Link to={`/time/${s.id}`} className="block bg-surface-1 px-5 py-3 hover:bg-surface-2">
              <div className="text-sm font-medium text-ink">{s.title}</div>
              <div className="text-xs text-ink-3">{s.note}</div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
