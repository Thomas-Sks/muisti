import { useMemo, useState } from "react";
import type { Month } from "../api";
import { nf } from "../ui";
import { useWidth } from "./useWidth";

// Edits per month (bars, sqrt scale so quiet months stay visible), reverts as markers:
// filled = a named editor undoing another named editor (counts toward an edit war),
// hollow ring = undoing an anonymous edit (vandalism cleanup). Months with >= 3 named
// reverts are shaded. Colours: validated palette slots 1 (blue) and 2 (orange), both modes.

const H = 210;
const M = { top: 14, right: 12, bottom: 26, left: 40 };
const WAR_THRESHOLD = 3;

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export default function Timeline({ monthly, selected, compare, onPick }: {
  monthly: Month[];
  selected: string | null;      // "YYYY-MM"
  compare?: string | null;      // "YYYY-MM"
  onPick: (month: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const data = useMemo(() => {
    if (!monthly.length) return [];
    const byMonth = new Map(monthly.map((m) => [m.month, m]));
    return monthsBetween(monthly[0].month, monthly[monthly.length - 1].month).map(
      (month) => byMonth.get(month) ?? { month, edits: 0, reverts: 0, named_reverts: 0, anonymous_edits: 0, editors: 0, len: 0 });
  }, [monthly]);

  if (!data.length) return null;
  const innerW = width - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const step = innerW / data.length;
  const barW = Math.max(1, Math.min(10, step - 2));         // 2px surface gap between bars
  const maxEdits = Math.max(...data.map((d) => d.edits), 1);
  const y = (v: number) => innerH - Math.sqrt(v / maxEdits) * innerH;
  const x = (i: number) => i * step + step / 2;
  const ticksY = [0, Math.round(maxEdits / 4), maxEdits].filter((v, i, a) => a.indexOf(v) === i);
  const years = data.map((d, i) => ({ i, y: d.month.slice(0, 4), m: d.month.slice(5) })).filter((d) => d.m === "01");
  const yearEvery = Math.ceil(years.length / Math.max(1, Math.floor(innerW / 48)));
  const idxOf = (month: string | null | undefined) => (month ? data.findIndex((d) => d.month === month) : -1);
  const sel = idxOf(selected);
  const cmp = idxOf(compare);
  const h = hover != null ? data[hover] : null;

  return (
    <div ref={ref} className="relative select-none">
      <svg width={width} height={H} role="img" aria-label="Edits per month, with reverts">
        <g transform={`translate(${M.left},${M.top})`}>
          {ticksY.map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x1={0} x2={innerW} stroke="var(--grid)" />
              <text x={-8} dy="0.32em" textAnchor="end" className="tabular fill-[var(--text-muted)] text-[10px]">{nf.format(t)}</text>
            </g>
          ))}
          {data.map((d, i) => d.named_reverts >= WAR_THRESHOLD && (
            <rect key={`w${i}`} x={i * step} y={0} width={step} height={innerH} fill="var(--series-2)" opacity={0.12} />
          ))}
          {data.map((d, i) => d.edits > 0 && (
            <path key={i} fill="var(--series-1)" opacity={hover == null || hover === i ? 0.85 : 0.45}
              d={roundedTop(x(i) - barW / 2, y(d.edits), barW, innerH - y(d.edits), Math.min(4, barW / 2))} />
          ))}
          {data.map((d, i) => {
            const cleanup = d.reverts - d.named_reverts;
            return (
              <g key={`r${i}`}>
                {cleanup > 0 && <circle cx={x(i)} cy={innerH + 8} r={4} fill="var(--surface-1)" stroke="var(--text-muted)" strokeWidth={1.5} />}
                {d.named_reverts > 0 && <circle cx={x(i)} cy={innerH + 8} r={4.5} fill="var(--series-2)" stroke="var(--surface-1)" strokeWidth={2} />}
              </g>
            );
          })}
          {years.filter((_, k) => k % yearEvery === 0).map((t) => (
            <text key={t.y} x={x(t.i)} y={innerH + 22} textAnchor="middle" className="tabular fill-[var(--text-muted)] text-[10px]">{t.y}</text>
          ))}
          {cmp >= 0 && <line x1={x(cmp)} x2={x(cmp)} y1={-6} y2={innerH} stroke="var(--text-secondary)" strokeWidth={2} strokeDasharray="4 3" />}
          {sel >= 0 && <line x1={x(sel)} x2={x(sel)} y1={-6} y2={innerH} stroke="var(--text-primary)" strokeWidth={2} />}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={innerH} stroke="var(--text-muted)" strokeDasharray="2 3" />}
          <rect x={0} y={-M.top} width={innerW} height={H} fill="transparent" style={{ cursor: "pointer" }}
            onMouseMove={(e) => {
              const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
              setHover(Math.max(0, Math.min(data.length - 1, Math.floor((e.clientX - r.left) / step))));
            }}
            onMouseLeave={() => setHover(null)}
            onClick={() => hover != null && onPick(data[hover].month)} />
        </g>
      </svg>
      {h && hover != null && (
        <div className="pointer-events-none absolute top-0 z-10 w-52 rounded-lg border border-line bg-surface-1 p-2.5 text-xs shadow-lg"
          style={{ left: Math.min(width - 216, Math.max(0, M.left + x(hover) + 12)) }}>
          <div className="mb-1 font-semibold text-ink">{new Date(h.month + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</div>
          <Row label="Edits" value={h.edits} swatch="var(--series-1)" />
          <Row label="Reverts between named editors" value={h.named_reverts} swatch="var(--series-2)" />
          <Row label="Vandalism cleanup" value={h.reverts - h.named_reverts} ring />
          <Row label="Editors" value={h.editors} />
          <div className="mt-1.5 text-[11px] text-ink-3">Click to read the article as it stood at the end of this month</div>
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 pl-10 text-[11px] text-ink-2">
        <Legend swatch="var(--series-1)" label="Edits per month (√ scale)" />
        <Legend swatch="var(--series-2)" label="Revert between named editors" dot />
        <Legend ring label="Vandalism cleanup (undid an anonymous edit)" />
        <Legend band label={`Edit-war month (≥ ${WAR_THRESHOLD} named reverts)`} />
      </div>
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  r = Math.min(r, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function Row({ label, value, swatch, ring }: { label: string; value: number; swatch?: string; ring?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5 text-ink-2">
      <span className="flex items-center gap-1.5">
        {swatch && <span className="size-2 rounded-full" style={{ background: swatch }} />}
        {ring && <span className="size-2 rounded-full border-[1.5px] border-[var(--text-muted)]" />}
        {label}
      </span>
      <b className="tabular font-semibold text-ink">{nf.format(value)}</b>
    </div>
  );
}

function Legend({ swatch, label, dot, ring, band }: { swatch?: string; label: string; dot?: boolean; ring?: boolean; band?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {band ? <span className="h-3 w-3 rounded-sm" style={{ background: "var(--series-2)", opacity: 0.2 }} />
        : ring ? <span className="size-2.5 rounded-full border-[1.5px] border-[var(--text-muted)]" />
        : <span className={dot ? "size-2.5 rounded-full" : "h-2.5 w-1.5 rounded-sm"} style={{ background: swatch }} />}
      {label}
    </span>
  );
}
