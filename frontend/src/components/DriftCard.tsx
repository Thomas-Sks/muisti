import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api2 } from "../api";
import { useWidth } from "../charts/useWidth";
import { Card, SqlPanel, nf } from "../ui";

// Meaning drift: cosine distance between the article on 1 January of each year and the article today,
// computed in SQL (VEC_DISTANCE_COSINE between yearly snapshot embeddings). One series, one axis.

export default function DriftCard({ pageId, onCompare }: { pageId: number; onCompare: (from: string, to: string) => void }) {
  const q = useQuery({ queryKey: ["drift", pageId], queryFn: () => api2.drift(pageId) });
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const years = q.data?.years ?? [];
  if (!q.data) return null;
  if (years.length < 2) return (
    <Card title="Meaning drift" subtitle="how far the article of each 1 January is from today's, by meaning">
      <p className="p-5 text-sm text-ink-2">
        Yearly snapshots are embedded for the 200 most edited articles; this one is not among them.{" "}
        <Link to="/time/1256" className="font-medium text-accent hover:underline">See it on Talvisota</Link> or{" "}
        <Link to="/time/1150" className="font-medium text-accent hover:underline">Suomen sisällissota</Link>.
      </p>
    </Card>
  );

  const H = 180, M = { t: 16, r: 16, b: 24, l: 44 };
  const iw = width - M.l - M.r, ih = H - M.t - M.b;
  const y0 = years[0].year, y1 = years[years.length - 1].year;
  const maxD = Math.max(...years.map((d) => d.d_now), 0.05);
  const x = (yr: number) => ((yr - y0) / Math.max(1, y1 - y0)) * iw;
  const y = (d: number) => ih - (d / maxD) * ih;
  const jump = years.filter((d) => d.d_prev != null).sort((a, b) => (b.d_prev ?? 0) - (a.d_prev ?? 0))[0];
  const path = years.map((d, i) => `${i ? "L" : "M"}${x(d.year)},${y(d.d_now)}`).join("");
  const h = hover != null ? years[hover] : null;

  return (
    <Card title="Meaning drift" subtitle="how far the article of each 1 January is from today's, by meaning (bge-m3 embeddings, cosine distance) · click a year to see what changed">
      <div className="space-y-3 p-5">
        {jump && (
          <p className="text-sm text-ink-2">
            Biggest single-year rewrite: <b className="text-ink">{jump.year - 1} → {jump.year}</b>
            <span className="text-ink-3"> (distance {jump.d_prev!.toFixed(3)})</span>.
          </p>
        )}
        <div ref={ref} className="relative">
          <svg width={width} height={H} role="img" aria-label="Distance from today's article, per year">
            <g transform={`translate(${M.l},${M.t})`}>
              {[0, maxD / 2, maxD].map((v) => (
                <g key={v} transform={`translate(0,${y(v)})`}>
                  <line x1={0} x2={iw} stroke="var(--grid)" />
                  <text x={-8} dy="0.32em" textAnchor="end" className="tabular fill-[var(--text-muted)] text-[10px]">{v.toFixed(2)}</text>
                </g>
              ))}
              <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
              {jump && <line x1={x(jump.year)} x2={x(jump.year)} y1={0} y2={ih} stroke="var(--series-2)" strokeDasharray="4 3" strokeWidth={1.5} />}
              {years.map((d, i) => (
                <g key={d.year}>
                  <circle cx={x(d.year)} cy={y(d.d_now)} r={hover === i ? 6 : 4} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
                  <rect x={x(d.year) - iw / years.length / 2} y={0} width={iw / years.length} height={ih} fill="transparent" style={{ cursor: "pointer" }}
                    onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                    onClick={() => onCompare(`${d.year - 1}-01-01T00:00:00`, `${d.year}-01-01T00:00:00`)} />
                  {(d.year % 4 === 0 || i === 0) && (
                    <text x={x(d.year)} y={ih + 18} textAnchor="middle" className="tabular fill-[var(--text-muted)] text-[10px]">{d.year}</text>
                  )}
                </g>
              ))}
            </g>
          </svg>
          {h && hover != null && (
            <div className="pointer-events-none absolute top-0 z-10 w-56 rounded-lg border border-line bg-surface-1 p-2.5 text-xs shadow-lg"
              style={{ left: Math.min(width - 230, M.l + x(h.year) + 10) }}>
              <div className="font-semibold text-ink">1 January {h.year}</div>
              <div className="mt-1 flex justify-between text-ink-2"><span>distance to today</span><b className="tabular text-ink">{h.d_now.toFixed(3)}</b></div>
              {h.d_prev != null && <div className="flex justify-between text-ink-2"><span>change since {h.year - 1}</span><b className="tabular text-ink">{h.d_prev.toFixed(3)}</b></div>}
              <div className="flex justify-between text-ink-2"><span>size</span><b className="tabular text-ink">{nf.format(Math.round(h.len / 1000))} kB</b></div>
              <div className="mt-1 text-[11px] text-ink-3">click to compare {h.year - 1} with {h.year}</div>
            </div>
          )}
        </div>
        <SqlPanel title="Drift in SQL: VEC_DISTANCE_COSINE between yearly snapshots" sql={q.data.sql}
          timings={[{ label: "SQL", ms: q.data.timings.sql_ms }]} />
      </div>
    </Card>
  );
}
