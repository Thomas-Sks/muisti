import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, ChevronDown, History, MessageSquareText, Repeat2, Users } from "lucide-react";
import clsx from "clsx";
import { api, api2, api3, type Controversial, type Dispute, type WarSummary } from "../api";
import { useWidth } from "../charts/useWidth";
import { Card, ErrorBox, Spinner, SqlPanel, fmtDate, nf } from "../ui";

const Y0 = 2003;
const Y1 = 2026;
const RAMP = ["var(--seq-100)", "var(--seq-200)", "var(--seq-300)", "var(--seq-400)", "var(--seq-500)", "var(--seq-600)", "var(--seq-700)"];

export default function RadarPage() {
  const [params, setParams] = useSearchParams();
  const wars = useQuery({ queryKey: ["wars"], queryFn: api3.wars });
  const selected = useMemo(() => {
    const m = /^(\d+)-(\d{4})$/.exec(params.get("war") ?? "");
    if (m) return { page_id: Number(m[1]), year: Number(m[2]) };
    const first = wars.data?.wars[0];
    return first ? { page_id: first.page_id, year: first.year } : null;
  }, [params, wars.data]);
  const select = (page_id: number, year: number) => {
    setParams({ war: `${page_id}-${year}` }, { replace: true });
    document.getElementById("war-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-wide text-accent">For editors · edit-history analytics</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Edit wars: what were they fighting about?</h1>
        <p className="mt-2 text-[15px] text-ink-2">
          When two editors keep undoing each other’s changes, that is an edit war. Pick one: Muisti replays the
          revisions from the system-versioned history and shows the exact words that went back and forth.
        </p>
      </div>

      {wars.isLoading && <Spinner label="Finding the edit wars" />}
      {wars.error && <ErrorBox error={wars.error} />}
      {wars.data && selected && (
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <WarList wars={wars.data.wars} selected={selected} onSelect={select} />
          <div id="war-detail" className="min-w-0 scroll-mt-20">
            <WarDetail pageId={selected.page_id} year={selected.year} />
          </div>
        </div>
      )}

      <MostRevised />
      <HeatmapCard onSelect={select} />
    </div>
  );
}

function WarList({ wars, selected, onSelect }: {
  wars: WarSummary[]; selected: { page_id: number; year: number }; onSelect: (p: number, y: number) => void;
}) {
  const max = Math.max(...wars.map((w) => w.controversy_m), 1);
  return (
    <Card title="The 20 biggest edit wars" subtitle="ranked by mutual reverting (controversy M)">
      <ul className="max-h-[680px] divide-y divide-line overflow-auto">
        {wars.map((w) => {
          const active = w.page_id === selected.page_id && w.year === selected.year;
          return (
            <li key={`${w.page_id}-${w.year}`}>
              <button onClick={() => onSelect(w.page_id, w.year)} aria-pressed={active}
                className={clsx("w-full px-4 py-2.5 text-left transition-colors", active ? "bg-accent-soft" : "hover:bg-surface-2")}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={clsx("truncate text-sm font-medium", active ? "text-accent" : "text-ink")}>{w.title}</span>
                  <span className="tabular shrink-0 text-xs text-ink-3">{w.year}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1 flex-1 rounded-full bg-surface-2">
                    <div className="h-1 rounded-full bg-[var(--series-1)]" style={{ width: `${(w.controversy_m / max) * 100}%` }} />
                  </div>
                  <span className="tabular shrink-0 text-[11px] text-ink-3">{w.named_reverts} reverts</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function WarDetail({ pageId, year }: { pageId: number; year: number }) {
  const war = useQuery({ queryKey: ["war", pageId, year], queryFn: () => api3.war(pageId, year), retry: false });
  const [all, setAll] = useState(false);
  const [, setParams] = useSearchParams();
  if (war.isLoading) return <Card><div className="px-5"><Spinner label="Replaying the reverts from the history" /></div></Card>;
  if (war.error) return (
    <Card>
      <div className="p-5 text-sm text-ink-2">
        No edit war found for this article and year.{" "}
        <button className="font-medium text-accent hover:underline" onClick={() => setParams({}, { replace: true })}>Show the biggest one</button>
        {" "}or pick one from the list.
      </div>
    </Card>
  );
  if (!war.data) return null;
  const w = war.data;
  const shown = all ? w.disputes : w.disputes.slice(0, 5);
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 className="text-xl font-semibold text-ink">{w.title} <span className="tabular font-normal text-ink-3">· {w.year}</span></h2>
            <p className="mt-1 text-sm text-ink-2">
              <b className="text-ink">{w.reverts}</b> reverts between named editors, about <b className="text-ink">{w.disputes.length}</b> different pieces of text.
            </p>
          </div>
          <Link to={`/time/${pageId}?view=compare&at=${year}-01-01T00:00:00&cmp=${year}-12-31T23:59:59`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-sm font-medium text-accent hover:bg-surface-2">
            <History className="size-4" /> Compare 1 Jan → 31 Dec {year}
          </Link>
        </div>
      </Card>
      {w.disputes.length === 0 && (
        <Card><p className="p-5 text-sm text-ink-2">These reverts changed templates or formatting only. No readable text was disputed.</p></Card>
      )}
      {shown.map((d, i) => <DisputeCard key={d.key} d={d} rank={i + 1} />)}
      {w.disputes.length > 5 && (
        <div className="text-center">
          <button onClick={() => setAll(!all)} className="rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-sm text-ink-2 hover:text-ink">
            {all ? "Show fewer" : `Show all ${w.disputes.length} disputed passages`}
          </button>
        </div>
      )}
      <SqlPanel title="Reverts of that year, replayed from the system-versioned history"
        sql={`${w.sql.trim()}\n\n-- then, for each revert, both versions in one read:\n${w.sql_texts.trim()}`}
        timings={[{ label: "reverts", ms: w.timings.events_ms }, { label: "texts", ms: w.timings.texts_ms }]} />
    </div>
  );
}

function DisputeCard({ d, rank }: { d: Dispute; rank: number }) {
  const [open, setOpen] = useState(false);
  const h = d.hunk;
  const reasons = d.events.map((e) => e.comment).filter((c): c is string => !!c && !/^Kumottu muokkaus|^Hylättiin/.test(c));
  const sameDay = d.first.slice(0, 10) === d.last.slice(0, 10);
  return (
    <Card className="overflow-hidden">
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
          <span className="tabular font-semibold text-ink-3">#{rank}</span>
          <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 font-semibold text-accent">
            <Repeat2 className="size-3.5" /> changed back and forth {d.toggles}×
          </span>
          <span className="tabular">{sameDay ? fmtDate(d.first) : `${fmtDate(d.first)} – ${fmtDate(d.last)}`}</span>
          <span className="inline-flex items-center gap-1"><Users className="size-3.5" /> {d.editors.length} editors</span>
        </div>

        <blockquote className="rounded-lg border border-line bg-surface-2/40 px-4 py-3 text-[15px] leading-relaxed text-ink-2">
          {h.before && <span>… {h.before} </span>}
          {h.removed && <del className="rounded bg-[var(--del-bg)] px-1 text-[var(--del-text)] decoration-2">{h.removed}</del>}
          {h.removed && h.added && " "}
          {h.added && <ins className="rounded bg-[var(--ins-bg)] px-1 text-[var(--ins-text)] no-underline">{h.added}</ins>}
          {h.after && <span> {h.after} …</span>}
        </blockquote>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
          {h.removed && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-[var(--del-bg)] ring-1 ring-[var(--del-text)]/30" />taken out by the last revert</span>}
          {h.added && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-[var(--ins-bg)] ring-1 ring-[var(--ins-text)]/30" />put back by the last revert</span>}
        </div>

        {reasons.length > 0 && (
          <p className="flex items-start gap-2 text-sm text-ink-2">
            <MessageSquareText className="mt-0.5 size-4 shrink-0 text-ink-3" />
            <span>Edit summaries: {reasons.slice(0, 3).map((r, i) => <q key={i} className="mr-2 italic">{r.slice(0, 90)}</q>)}</span>
          </p>
        )}
      </div>
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center justify-between border-t border-line bg-surface-2/50 px-5 py-2 text-xs font-medium text-ink-2 hover:text-ink">
        Who undid whom, and when ({d.events.length})
        <ChevronDown className={clsx("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ol className="divide-y divide-line text-xs">
          {d.events.map((e) => (
            <li key={e.rev_id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-5 py-2">
              <span className="tabular w-36 shrink-0 text-ink-3">{fmtDate(e.ts, true)}</span>
              <span><b className="text-ink">{e.user}</b> <span className="text-ink-3">undid</span> <b className="text-ink">{e.reverted_user}</b></span>
              {e.comment && <span className="truncate italic text-ink-3" title={e.comment}>“{e.comment.slice(0, 80)}”</span>}
              <a href={`https://fi.wikipedia.org/?diff=${e.rev_id}`} target="_blank" rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-accent hover:underline">diff on Wikipedia <ArrowUpRight className="size-3" /></a>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function MostRevised() {
  const q = useQuery({ queryKey: ["most-revised"], queryFn: api2.mostRevised });
  if (!q.data) return null;
  return (
    <Card title="Most rewritten numbers" subtitle="casualty and strength figures in war infoboxes, replayed over every version (bitemporal fact table) · click to see the history">
      <div className="grid gap-px overflow-hidden bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-3">
        {q.data.facts.slice(0, 6).map((f) => (
          <Link key={`${f.page_id}-${f.field}`} to={`/time/${f.page_id}`} className="bg-surface-1 p-4 hover:bg-surface-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{f.label}</div>
            <div className="mt-0.5 truncate text-[15px] font-semibold text-ink">{f.title}</div>
            <div className="tabular mt-2 text-sm text-ink-2">
              stated <b className="text-ink">{f.distinct_numbers}</b> different ways over <b className="text-ink">{f.versions}</b> versions
            </div>
            <div className="tabular text-xs text-ink-3">from {nf.format(f.min_num)} to {nf.format(f.max_num)} · last changed {fmtDate(f.last_changed)}</div>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function HeatmapCard({ onSelect }: { onSelect: (p: number, y: number) => void }) {
  const q = useQuery({ queryKey: ["controversial", Y0, Y1], queryFn: () => api.controversial(Y0, Y1) });
  if (!q.data) return null;
  return (
    <Card title="When did the fights happen?" subtitle="the 25 most contested articles by year · darker = more mutual reverting · click a coloured cell to open that war">
      <Heatmap data={q.data} onSelect={onSelect} />
    </Card>
  );
}

function Heatmap({ data, onSelect }: { data: Controversial; onSelect: (p: number, y: number) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ row: number; year: number } | null>(null);
  const years = useMemo(() => Array.from({ length: Y1 - Y0 + 1 }, (_, i) => Y0 + i), []);
  const cells = useMemo(() => {
    const m = new Map<string, Controversial["heatmap"][number]>();
    for (const h of data.heatmap) m.set(`${h.page_id}:${h.year}`, h);
    return m;
  }, [data.heatmap]);
  const maxM = Math.max(1, ...data.heatmap.map((h) => h.controversy_m));
  const level = (v: number) => (v <= 0 ? -1 : Math.min(RAMP.length - 1, Math.floor((Math.log1p(v) / Math.log1p(maxM)) * RAMP.length)));
  const labelW = Math.min(200, width * 0.3);
  const cellW = (width - labelW - 24) / years.length;
  const cellH = 20;
  const H = data.articles.length * cellH + 24;
  const hv = hover ? cells.get(`${data.articles[hover.row].page_id}:${hover.year}`) : null;
  return (
    <div ref={ref} className="relative px-5 py-4">
      <svg width={Math.max(0, width - 40)} height={H} role="img" aria-label="Controversy per article and year">
        {data.articles.map((a, r) => (
          <g key={a.page_id} transform={`translate(0,${r * cellH})`}>
            <text x={labelW - 10} y={cellH / 2} dy="0.32em" textAnchor="end" className="fill-[var(--text-secondary)] text-[11px]">
              {a.title.length > 28 ? a.title.slice(0, 27) + "…" : a.title}
            </text>
            {years.map((y, c) => {
              const h = cells.get(`${a.page_id}:${y}`);
              const lv = h ? level(h.controversy_m) : -1;
              return (
                <rect key={y} x={labelW + c * cellW + 1} y={1} width={Math.max(1, cellW - 2)} height={cellH - 2} rx={3}
                  fill={lv < 0 ? (h && h.edits > 0 ? "var(--surface-2)" : "transparent") : RAMP[lv]}
                  stroke={hover && hover.row === r && hover.year === y ? "var(--text-primary)" : "none"} strokeWidth={1.5}
                  style={{ cursor: lv >= 0 ? "pointer" : "default" }}
                  onClick={() => lv >= 0 && onSelect(a.page_id, y)}
                  onMouseEnter={() => setHover({ row: r, year: y })} onMouseLeave={() => setHover(null)} />
              );
            })}
          </g>
        ))}
        {years.filter((y) => y % 2 === 1).map((y) => (
          <text key={y} x={labelW + (y - Y0) * cellW + cellW / 2} y={data.articles.length * cellH + 16} textAnchor="middle"
            className="tabular fill-[var(--text-muted)] text-[10px]">{y}</text>
        ))}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute z-10 w-56 rounded-lg border border-line bg-surface-1 p-2.5 text-xs shadow-lg"
          style={{ left: Math.min(width - 240, labelW + (hover.year - Y0) * cellW + 30), top: hover.row * cellH + 30 }}>
          <div className="font-semibold text-ink">{data.articles[hover.row].title} · {hover.year}</div>
          {hv ? (
            <div className="mt-1 space-y-0.5 text-ink-2">
              <div className="flex justify-between"><span>Reverts between named editors</span><b className="tabular text-ink">{hv.named_reverts}</b></div>
              <div className="flex justify-between"><span>Edits</span><b className="tabular text-ink">{hv.edits}</b></div>
              {hv.controversy_m > 0 && <div className="mt-1 text-[11px] text-accent">click to see what they fought over</div>}
            </div>
          ) : <div className="mt-1 text-ink-3">No edits that year.</div>}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-3" style={{ marginLeft: labelW }}>
        <span>calm</span>
        {RAMP.map((c) => <span key={c} className="h-2.5 w-5 rounded-sm" style={{ background: c }} />)}
        <span>fierce</span>
        <span className="ml-3 h-2.5 w-5 rounded-sm bg-surface-2" /> <span>edited, no mutual reverts</span>
      </div>
    </div>
  );
}
