import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Clock3 } from "lucide-react";
import { api2, type FactField, type FactRun } from "../api";
import { useWidth } from "../charts/useWidth";
import { Card, Segmented, SqlPanel, fmtDate, nf } from "../ui";

// Bitemporal facts: how an infobox value (e.g. casualties) was stated by Wikipedia over time
// (system time), for an event with its own historical dates (application time).

const T0 = Date.UTC(2003, 0, 1);
const T1 = Date.UTC(2026, 9, 2);
const ms = (iso: string) => Date.parse(iso.endsWith("Z") ? iso : iso + "Z");

export default function FactsCard({ pageId }: { pageId: number }) {
  const facts = useQuery({ queryKey: ["facts", pageId], queryFn: () => api2.facts(pageId) });
  const numeric = useMemo(() => (facts.data?.fields ?? []).filter((f) => f.runs.some((r) => r.num != null)), [facts.data]);
  const [chosen, setChosen] = useState<string | null>(null);
  if (!facts.data || facts.data.fields.length === 0) return null;
  const field = numeric.find((f) => f.field === chosen) ?? [...numeric].sort((a, b) => b.changes - a.changes)[0];
  const dateField = facts.data.fields.find((f) => f.field === "päivämäärä");
  return (
    <Card title="Facts over time (bitemporal)" subtitle="infobox values replayed over every version · system time = when Wikipedia said it, valid time = when it happened">
      <div className="space-y-4 p-5">
        {field && (
          <>
            <Segmented label="Fact" value={field.field} onChange={setChosen}
              options={numeric.map((f) => ({ value: f.field, label: `${f.label} · ${f.changes}×` }))} />
            <StepChart field={field} />
          </>
        )}
        <BitemporalQuery pageId={pageId} defaultEvent={dateField?.runs[dateField.runs.length - 1]?.valid_from ?? "1940-01-01"}
          eventLabel={dateField?.current ?? undefined} />
        <SqlPanel title="Every stated value, all system time" sql={facts.data.sql} timings={[{ label: "SQL", ms: facts.data.timings.sql_ms }]} />
      </div>
    </Card>
  );
}

function StepChart({ field }: { field: FactField }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<FactRun | null>(null);
  const runs = field.runs.filter((r) => r.num != null);
  const H = 190, M = { t: 12, r: 16, b: 24, l: 64 };
  const iw = width - M.l - M.r, ih = H - M.t - M.b;
  const maxV = Math.max(...runs.map((r) => r.num!), 1);
  const x = (t: number) => ((Math.min(Math.max(t, T0), T1) - T0) / (T1 - T0)) * iw;
  const y = (v: number) => ih - (v / maxV) * ih;
  const years = [2004, 2008, 2012, 2016, 2020, 2024];
  return (
    <div ref={ref} className="relative">
      <svg width={width} height={H} role="img" aria-label={`${field.label} as stated over time`}>
        <g transform={`translate(${M.l},${M.t})`}>
          {[0, maxV / 2, maxV].map((v) => (
            <g key={v} transform={`translate(0,${y(v)})`}>
              <line x1={0} x2={iw} stroke="var(--grid)" />
              <text x={-8} dy="0.32em" textAnchor="end" className="tabular fill-[var(--text-muted)] text-[10px]">{nf.format(Math.round(v))}</text>
            </g>
          ))}
          {years.map((yr) => (
            <text key={yr} x={x(Date.UTC(yr, 0, 1))} y={ih + 18} textAnchor="middle" className="tabular fill-[var(--text-muted)] text-[10px]">{yr}</text>
          ))}
          {runs.map((r) => {
            const x0 = x(ms(r.row_start)), x1 = x(ms(r.row_end)), yy = y(r.num!);
            const short = ms(r.row_end) - ms(r.row_start) < 1000 * 60 * 60 * 24;     // lasted under a day
            return (
              <g key={r.row_start} onMouseEnter={() => setHover(r)} onMouseLeave={() => setHover(null)}>
                <line x1={x0} x2={Math.max(x1, x0 + 2)} y1={yy} y2={yy} stroke={short ? "var(--series-2)" : "var(--series-1)"} strokeWidth={hover === r ? 4 : 2.5} strokeLinecap="round" />
                <circle cx={x0} cy={yy} r={short ? 5 : 4} fill={short ? "var(--series-2)" : "var(--series-1)"} stroke="var(--surface-1)" strokeWidth={2} />
                <rect x={x0 - 4} y={yy - 8} width={Math.max(8, x1 - x0 + 8)} height={16} fill="transparent" />
              </g>
            );
          })}
        </g>
      </svg>
      {hover && (
        <div className="pointer-events-none absolute right-2 top-0 z-10 w-80 rounded-lg border border-line bg-surface-1 p-3 text-xs shadow-lg">
          <div className="font-semibold text-ink">{nf.format(hover.num!)}</div>
          <div className="mt-1 text-ink-2">“{hover.value.slice(0, 220)}”</div>
          <div className="mt-1.5 flex items-center gap-1 text-ink-3"><Clock3 className="size-3" />
            stated {fmtDate(hover.row_start, true)} → {hover.row_end.startsWith("2106") ? "today" : fmtDate(hover.row_end, true)}</div>
          <div className="text-ink-3">rev {hover.rev_id}</div>
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-x-4 pl-16 text-[11px] text-ink-2">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[var(--series-1)]" />value as stated (first number)</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[var(--series-2)]" />stood less than a day (often vandalism)</span>
      </div>
    </div>
  );
}

function BitemporalQuery({ pageId, defaultEvent, eventLabel }: { pageId: number; defaultEvent: string; eventLabel?: string }) {
  const [said, setSaid] = useState("2007-04-10T15:00");
  const [event, setEvent] = useState(defaultEvent);
  const q = useQuery({ queryKey: ["bitemporal", pageId, said, event], queryFn: () => api2.bitemporal(pageId, said, event) });
  return (
    <div className="rounded-lg border border-line bg-surface-2/40 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
        <span>What did Wikipedia say on</span>
        <input type="datetime-local" value={said} onChange={(e) => e.target.value && setSaid(e.target.value)}
          min="2003-01-01T00:00" max="2026-10-01T00:00"
          className="tabular rounded-md border border-line bg-surface-1 px-2 py-1 text-sm text-ink" aria-label="Wikipedia moment (system time)" />
        <span>about</span>
        <input type="date" value={event} onChange={(e) => e.target.value && setEvent(e.target.value)}
          className="tabular rounded-md border border-line bg-surface-1 px-2 py-1 text-sm text-ink" aria-label="Historical date (valid time)" />
        <span>?</span>
        {eventLabel && <span className="text-xs text-ink-3">(event: {eventLabel})</span>}
      </div>
      {q.data && (
        <>
          <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {q.data.facts.length === 0 && <p className="text-ink-3">Nothing stated for that moment and date.</p>}
            {q.data.facts.map((f) => (
              <div key={f.field} className="min-w-0">
                <dt className="text-[11px] uppercase tracking-wide text-ink-3">{f.label}</dt>
                <dd className="truncate text-ink" title={f.value}>{f.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3">
            <SqlPanel title="Bitemporal query: FOR SYSTEM_TIME AS OF × valid period" sql={q.data.sql}
              timings={[{ label: "SQL", ms: q.data.timings.sql_ms }]} />
          </div>
          {q.data.facts[0] && (
            <a className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline" target="_blank" rel="noreferrer"
              href={`https://fi.wikipedia.org/?oldid=${q.data.facts[0].rev_id}`}>open that revision <ArrowUpRight className="size-3" /></a>
          )}
        </>
      )}
    </div>
  );
}
