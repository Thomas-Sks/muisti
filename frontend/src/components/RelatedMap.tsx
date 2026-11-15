// Map of related articles: starts from one article, each click adds its nearest articles by meaning
// (MariaDB HNSW index on whole-article vectors). Any article can be checked against the others for
// contradicting facts; results are stored in MariaDB and drawn as red links. Nothing is shown in red before the
// visitor asks for a check: a check returns the stored result at once when someone has already run it.
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CircleCheck, Loader2, Plus, RotateCcw, TriangleAlert } from "lucide-react";
import { wapi4, type Contradictions, type Lang, type RelatedNode } from "../api";
import { ArticleLinks, Button, ErrorBox, LANG_NAME, LangBadge, SqlPanel } from "../ui";
import { wiki } from "../wiki";
import { ContradictionCard } from "./ContradictionsPanel";

const MAX_NODES = 45;
const W = 900, H = 520;

type Node = RelatedNode & { key: string; x: number; y: number; depth: number; expanded: boolean; loading: boolean };
type Edge = { a: string; b: string; distance: number };
type ContraResult = Contradictions & { cached: boolean };

const keyOf = (n: { lang: Lang; page_id: number }) => `${n.lang}:${n.page_id}`;
const short = (t: string, n = 24) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

/** A few steps of repulsion so labels do not pile up; the centre stays fixed. */
function relax(nodes: Map<string, Node>, edges: Edge[], centre: string) {
  const list = [...nodes.values()];
  for (let it = 0; it < 120; it++) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const p = list[i], q = list[j];
        let dx = q.x - p.x, dy = q.y - p.y;
        const d2 = dx * dx + dy * dy || 0.01, d = Math.sqrt(d2);
        if (d > 150) continue;
        const f = (150 - d) / d * 0.08;
        dx *= f; dy *= f;
        if (p.key !== centre) { p.x -= dx; p.y -= dy; }
        if (q.key !== centre) { q.x += dx; q.y += dy; }
      }
    }
    for (const e of edges) {                         // springs keep neighbours near their parent
      const p = nodes.get(e.a), q = nodes.get(e.b);
      if (!p || !q) continue;
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 0.01;
      const rest = 120 + e.distance * 200;
      const f = (d - rest) / d * 0.02;
      if (p.key !== centre) { p.x += dx * f; p.y += dy * f; }
      if (q.key !== centre) { q.x -= dx * f; q.y -= dy * f; }
    }
  }
}

export default function RelatedMap({ lang, pageId, editions = [], onLang }: {
  lang: Lang; pageId: number; editions?: Lang[]; onLang?: (l: Lang) => void;
}) {
  const qc = useQueryClient();
  const centre = `${lang}:${pageId}`;
  const [nodes, setNodes] = useState<Map<string, Node>>(new Map());
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<string>(centre);
  const [error, setError] = useState<unknown>(null);
  const [sql, setSql] = useState<{ sql: string; ms: number } | null>(null);
  const [contra, setContra] = useState<Record<string, ContraResult>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<unknown>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const expand = useCallback(async (key: string, seed?: RelatedNode) => {
    const cur = nodesRef.current.get(key);
    if (cur?.expanded || cur?.loading) return;
    const [l, p] = key.split(":");
    if (cur) setNodes((m) => new Map(m).set(key, { ...cur, loading: true }));
    try {
      const r = await qc.fetchQuery({ queryKey: ["related", key], queryFn: () => wapi4.related(l as Lang, Number(p)), staleTime: Infinity });
      setSql({ sql: r.sql, ms: r.timings.sql_ms });
      setNodes((prev) => {
        const m = new Map(prev);
        const parent: Node = m.get(key) ?? { ...(seed ?? r.article), key, x: W / 2, y: H / 2, depth: 0, expanded: false, loading: false };
        parent.contradictions = parent.contradictions ?? r.article.contradictions;
        const outward = parent.key === centre ? 0 : Math.atan2(parent.y - H / 2, parent.x - W / 2);
        const fresh = r.related.filter((n) => !m.has(keyOf(n))).slice(0, Math.max(0, MAX_NODES - m.size));
        const spread = parent.key === centre ? Math.PI * 2 : Math.PI * 0.9;
        fresh.forEach((n, i) => {
          const a = parent.key === centre ? (i / fresh.length) * spread - Math.PI / 2
            : outward - spread / 2 + (spread * (i + 0.5)) / fresh.length;
          const rad = parent.key === centre ? 170 : 120;
          m.set(keyOf(n), { ...n, key: keyOf(n), x: parent.x + Math.cos(a) * rad, y: parent.y + Math.sin(a) * rad,
            depth: parent.depth + 1, expanded: false, loading: false });
        });
        m.set(key, { ...parent, expanded: true, loading: false });
        const newEdges = r.related.filter((n) => m.has(keyOf(n))).map((n) => ({ a: key, b: keyOf(n), distance: n.distance ?? 0.3 }));
        setEdges((es) => {
          const seen = new Set(es.map((e) => [e.a, e.b].sort().join("|")));
          const add = newEdges.filter((e) => !seen.has([e.a, e.b].sort().join("|")));
          const all = [...es, ...add];
          relax(m, all, centre);
          return all;
        });
        return m;
      });
    } catch (e) {
      setError(e);
      if (cur) setNodes((m) => new Map(m).set(key, { ...cur, loading: false }));
    }
  }, [qc, centre]);

  const reset = useCallback(() => {
    setNodes(new Map()); setEdges([]); setSelected(centre); setError(null); setContra({});
    nodesRef.current = new Map();
    void expand(centre);
  }, [centre, expand]);

  useEffect(() => { reset(); }, [reset]);

  const applyContra = useCallback((key: string, r: ContraResult) => {
      setContra((c) => ({ ...c, [key]: r }));
      setNodes((prev) => {
        const m = new Map(prev);
        const me = m.get(key)!;
        m.set(key, { ...me, contradictions: r.contradictions.length });
        // put the other articles of each contradiction on the map
        r.contradictions.forEach((c, i) => {
          const k = keyOf(c.b);
          if (!m.has(k) && m.size < MAX_NODES + 10) {
            const a = (i / Math.max(1, r.contradictions.length)) * Math.PI * 2;
            m.set(k, { lang: c.b.lang, page_id: c.b.page_id, title: c.b.title, wikidata_id: null, contradictions: null,
              key: k, x: me.x + Math.cos(a) * 110, y: me.y + Math.sin(a) * 110, depth: me.depth + 1, expanded: false, loading: false });
          }
        });
        relax(m, edges, centre);
        return m;
      });
  }, [edges, centre]);

  const check = async (key: string, refresh = false) => {
    const n = nodes.get(key);
    if (!n) return;
    setChecking(key); setCheckError(null);
    try {
      applyContra(key, await wapi4.contradictions(n.lang, n.page_id, refresh));
    } catch (e) {
      setCheckError(e);
    } finally {
      setChecking(null);
    }
  };

  // red links: one per pair of articles with at least one possible contradiction
  const contraEdges = useMemo(() => {
    const out = new Map<string, { a: string; b: string; n: number }>();
    for (const [k, r] of Object.entries(contra)) {
      for (const c of r.contradictions) {
        const b = keyOf(c.b);
        if (b === k) continue;
        const id = [k, b].sort().join("|");
        out.set(id, { a: k, b, n: (out.get(id)?.n ?? 0) + 1 });
      }
    }
    return [...out.values()];
  }, [contra]);

  // fit the drawing to its content
  const box = useMemo(() => {
    const list = [...nodes.values()];
    if (!list.length) return `0 0 ${W} ${H}`;
    const xs = list.map((n) => n.x), ys = list.map((n) => n.y);
    const x0 = Math.min(...xs) - 90, x1 = Math.max(...xs) + 90, y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 50;
    const w = Math.max(x1 - x0, 500), h = Math.max(y1 - y0, 320);
    return `${(x0 + x1) / 2 - w / 2} ${(y0 + y1) / 2 - h / 2} ${w} ${h}`;
  }, [nodes]);

  const sel = nodes.get(selected);
  const selContra = contra[selected];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          Articles in the {LANG_NAME[lang]} Wikipedia closest in meaning to this one. Click an article to add its own neighbours,
          then check it for facts that contradict the others.
        </p>
        {editions.length > 1 && onLang && (
          <div className="flex items-center gap-2 text-xs" role="radiogroup" aria-label="Map language">
            <span className="text-ink-3">Search in</span>
            {editions.map((l) => (
              <label key={l} className={clsx("flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1",
                l === lang ? "border-accent bg-accent/5 font-semibold text-ink" : "border-line text-ink-2 hover:border-accent")}>
                <input type="radio" name="map-lang" className="accent-[var(--accent)]" checked={l === lang} onChange={() => onLang(l)} />
                {LANG_NAME[l]}
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <div className="relative overflow-hidden rounded-xl border border-line bg-surface-1 shadow-sm">
          <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-3 rounded-lg bg-surface-1/90 px-2.5 py-1.5 text-[11px] text-ink-3 backdrop-blur">
            <span className="flex items-center gap-1"><span className="inline-block h-px w-5 bg-[var(--border-strong)]" /> close in meaning</span>
            <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-[var(--critical)]" /> possible contradiction</span>
            <span className="flex items-center gap-1"><Plus className="size-3" /> click to expand</span>
          </div>
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
            <span className="tabular rounded-md bg-surface-2 px-2 py-1 text-[11px] text-ink-3">{nodes.size} articles</span>
            <button onClick={reset} title="Start again from this article" className="rounded-md border border-line bg-surface-1 p-1.5 text-ink-2 hover:text-ink">
              <RotateCcw className="size-3.5" />
            </button>
          </div>
          <svg viewBox={box} className="h-[520px] w-full select-none" role="img" aria-label="Map of related articles">
            {edges.map((e) => {
              const a = nodes.get(e.a), b = nodes.get(e.b);
              if (!a || !b) return null;
              const on = e.a === selected || e.b === selected;
              return <line key={`${e.a}|${e.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={on ? "var(--accent)" : "var(--border-strong)"} strokeOpacity={on ? 0.7 : 1} strokeWidth={on ? 1.5 : 1} />;
            })}
            {contraEdges.map((e) => {
              const a = nodes.get(e.a), b = nodes.get(e.b);
              if (!a || !b) return null;
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              return (
                <g key={`c${e.a}|${e.b}`}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--critical)" strokeWidth={2} strokeDasharray="5 4" />
                  <circle cx={mx} cy={my} r={9} fill="var(--critical)" />
                  <text x={mx} y={my + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">{e.n}</text>
                </g>
              );
            })}
            {[...nodes.values()].map((n) => {
              const isCentre = n.key === centre, isSel = n.key === selected;
              const r = isCentre ? 13 : 8;
              const mine = contra[n.key];                    // only what this visitor has checked is coloured
              const flagged = (mine?.contradictions.length ?? 0) > 0;
              return (
                <g key={n.key} transform={`translate(${n.x},${n.y})`} className="cursor-pointer"
                  onClick={() => { setSelected(n.key); setCheckError(null); void expand(n.key); }}>
                  <title>{n.title}{n.expanded ? "" : " (click to show its neighbours)"}</title>
                  {isSel && <circle r={r + 6} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1} />}
                  <circle r={r} fill={isCentre ? "var(--accent)" : n.expanded ? "var(--seq-300)" : "#fff"}
                    stroke={flagged ? "var(--critical)" : isCentre ? "var(--accent-hover)" : "var(--seq-500)"} strokeWidth={flagged ? 2.5 : 1.5} />
                  {!n.expanded && !n.loading && <text y={3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--seq-500)">+</text>}
                  {n.loading && <circle r={r + 3} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="4 4">
                    <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s" repeatCount="indefinite" />
                  </circle>}
                  {mine && mine.contradictions.length === 0 && <circle cx={r - 1} cy={-r + 1} r={3.5} fill="var(--success)" />}
                  <text y={r + 13} textAnchor="middle" fontSize={isCentre ? 13 : 11} fontWeight={isCentre || isSel ? 600 : 400}
                    fill="var(--text-primary)" stroke="#fff" strokeWidth={3} paintOrder="stroke">{short(n.title, isCentre ? 34 : 24)}</text>
                </g>
              );
            })}
          </svg>
          {nodes.size >= MAX_NODES && <p className="absolute bottom-2 left-3 text-[11px] text-ink-3">The map is full ({MAX_NODES} articles). Start again to explore elsewhere.</p>}
        </div>

        <aside className="rounded-xl border border-line bg-surface-1 p-4 shadow-sm">
          {!sel ? <p className="text-sm text-ink-3">Loading the neighbourhood…</p> : (
            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-2"><LangBadge lang={sel.lang} size="xs" />
                  {sel.distance != null && sel.key !== centre && <span className="tabular text-[11px] text-ink-3">distance {sel.distance.toFixed(2)}</span>}</div>
                <h3 className="mt-1 font-serif text-lg font-semibold leading-snug text-ink">{sel.title}</h3>
                <div className="mt-2"><ArticleLinks links={[
                  { label: "Read", href: wiki.read(sel.lang, sel.title) },
                  { label: "Edit", href: wiki.edit(sel.lang, sel.title) },
                  { label: "Talk", href: wiki.talk(sel.lang, sel.title) },
                ]} /></div>
                {sel.wikidata_id && (sel.languages ?? 0) > 1 && sel.key !== centre && (
                  <Link to={`/topic/${sel.wikidata_id}`} className="mt-2 inline-block text-xs font-medium text-accent hover:underline">
                    Compare this topic across {sel.languages} languages
                  </Link>
                )}
              </div>
              {!sel.expanded && (
                <Button onClick={() => void expand(sel.key)} disabled={sel.loading || nodes.size >= MAX_NODES}>
                  {sel.loading ? "Finding neighbours…" : "Show its neighbours"}
                </Button>
              )}
              <div className="border-t border-line pt-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Contradictions with other articles</h4>
                <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-ink-3">
                  <li><b className="font-medium text-ink-2">MariaDB finds the candidates:</b> passages of other articles (not the same topic in another language), in any language, that give the same anchor date but a different date a few days away, and are close in meaning.</li>
                  <li><b className="font-medium text-ink-2">Claude checks each one:</b> same event, and really incompatible? Rejected candidates stay visible.</li>
                  <li><b className="font-medium text-ink-2">Figures</b> (deaths, strengths) are read by Claude in close passages, then every figure it quotes is looked up in MariaDB: it must be in the Wikipedia text.</li>
                </ol>
                <p className="mt-1 text-[11px] text-ink-3">About 15 seconds the first time, then stored for this revision.</p>
                {checking === sel.key ? (
                  <p className="mt-2 flex items-center gap-2 text-sm text-ink-2"><Loader2 className="size-4 animate-spin text-accent" /> Checking…</p>
                ) : selContra ? (
                  <div className="mt-2 text-sm">
                    <p className="mb-1 text-xs text-ink-2"><b className="tabular text-ink">{selContra.date_candidates ?? selContra.pairs_checked}</b> date candidates from SQL · <b className="tabular text-ink">{selContra.number_pairs ?? 0}</b> passage pairs read for figures · <b className="tabular text-ink">{selContra.contradictions.length}</b> kept</p>
                    {selContra.contradictions.length === 0
                      ? <p className="flex items-center gap-2 text-ink-2"><CircleCheck className="size-4 text-success" /> No contradiction confirmed.</p>
                      : <p className="flex items-center gap-2 font-medium text-ink"><TriangleAlert className="size-4 text-[var(--critical)]" /> {selContra.contradictions.length} possible contradiction{selContra.contradictions.length === 1 ? "" : "s"} with other articles, shown below the map.</p>}
                    {(selContra.same_topic?.length ?? 0) > 0 && (
                      <p className="mt-1 text-xs text-ink-2">
                        {selContra.same_topic!.length} difference{selContra.same_topic!.length === 1 ? "" : "s"} with the{" "}
                        {[...new Set(selContra.same_topic!.map((c) => LANG_NAME[c.b.lang]))].join(" and ")} edition of this topic: not
                        another article, so they are compared in the{" "}
                        {sel.wikidata_id ? <Link to={`/topic/${sel.wikidata_id}?tab=facts`} className="font-medium text-accent hover:underline">Facts table</Link> : "Facts table"}.
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-ink-3">{selContra.cached ? "Stored result for this revision" : `Checked now in ${selContra.timings.total_s}s`} ·{" "}
                      <button onClick={() => void check(sel.key, true)} className="font-medium text-accent hover:underline">check again</button></p>
                  </div>
                ) : (
                  <div className="mt-2">
                    <Button kind="primary" onClick={() => void check(sel.key)} disabled={!!checking}>
                      Check this article
                    </Button>
                    {sel.contradictions != null && !checking && <p className="mt-1 text-[11px] text-ink-3">Already checked by someone: the stored result appears at once.</p>}
                    {checking && <p className="mt-1 text-[11px] text-ink-3">Another check is running.</p>}
                  </div>
                )}
                {checkError != null && <div className="mt-2"><ErrorBox error={checkError} /></div>}
              </div>
            </div>
          )}
        </aside>
      </div>
      {error != null && <ErrorBox error={error} />}

      {selContra && selContra.contradictions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">Possible contradictions: {sel?.title}</h3>
          {selContra.contradictions.map((c, i) => <ContradictionCard key={i} c={c} />)}
        </div>
      )}
      {selContra?.rejected && selContra.rejected.length > 0 && <Rejected items={selContra.rejected} />}
      {selContra?.method === "sql+claude" && <SqlPanel title="Contradiction candidates (anchor date shared, another date a few days apart, close in meaning)"
        sql={selContra.sql} timings={[{ label: "SQL", ms: selContra.timings.mariadb_ms }]} />}
      {sql && <SqlPanel title="Nearest articles (HNSW index, the article's stored vector as the query)" sql={sql.sql}
        timings={[{ label: "SQL", ms: sql.ms }]} />}
    </div>
  );
}

/** Candidates found in SQL that Claude judged not to be contradictions, with its reason. */
function Rejected({ items }: { items: NonNullable<ContraResult["rejected"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-line bg-surface-1">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm">
        <span className="font-medium text-ink-2">{items.length} candidate{items.length === 1 ? "" : "s"} rejected by Claude</span>
        <span className="text-xs font-medium text-accent">{open ? "Hide" : "Show why"}</span>
      </button>
      {open && (
        <ul className="divide-y divide-line border-t border-line">
          {items.map((c, i) => (
            <li key={i} className="px-4 py-2.5 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular font-medium text-ink">{c.value_a}</span><span className="text-ink-3">vs</span>
                <span className="tabular font-medium text-ink">{c.value_b}</span>
                <span className="text-ink-3">in</span><LangBadge lang={c.b.lang} size="xs" /><span className="text-ink-2">{c.b.title}</span>
              </div>
              <p className="mt-0.5 text-ink-2">{c.explanation}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
