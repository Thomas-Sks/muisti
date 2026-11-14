// The editor's workspace: the article text with every problem highlighted in its sentence, and the issue
// cards in the margin facing their sentence (like comments in a document). A switch puts another edition
// next to it, aligned passage by passage, read-only, with links to edit on Wikipedia.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowUpRight, Check, CircleCheck, Loader2, PanelRightClose, PanelRightOpen, RotateCcw, X } from "lucide-react";
import {
  wapi, wapi2, wapi3, wapi4, wapi6, type IssueStatus, type IssueType, type Lang, type Workspace, type WsIssue,
  type WsOtherPassage, type WsPassage,
} from "../api";
import { Button, CopyButton, ErrorBox, LANG_NAME, LangBadge, Spinner, displayText } from "../ui";
import { attribution, talkNote, wiki } from "../wiki";

const TYPES: { type: IssueType; label: string; mark: string; dot: string; strip: string }[] = [
  { type: "fact", label: "Facts", mark: "bg-[color-mix(in_oklab,var(--diff-removed)_55%,transparent)] decoration-[#c58a00]", dot: "bg-[#d29a00]", strip: "border-l-[#d29a00]" },
  { type: "contradiction", label: "Contradictions", mark: "bg-[color-mix(in_oklab,var(--critical)_14%,transparent)] decoration-[var(--critical)]", dot: "bg-[var(--critical)]", strip: "border-l-[var(--critical)]" },
  { type: "wording", label: "Wording", mark: "bg-[#efe7ff] decoration-[#7c3aed]", dot: "bg-[#7c3aed]", strip: "border-l-[#7c3aed]" },
  { type: "missing", label: "Missing", mark: "", dot: "bg-[var(--accent)]", strip: "border-l-[var(--accent)]" },
];
const META = Object.fromEntries(TYPES.map((t) => [t.type, t])) as Record<IssueType, (typeof TYPES)[number]>;
const HEADER = 100;   // height of the panel header: cards start below it
const PROVENANCE: Record<WsIssue["provenance"], string> = {
  sql: "Found in SQL", claude: "Found by Claude", "sql+claude": "SQL found · Claude confirmed", "claude+sql": "Claude found · SQL checked",
};

/** One card in the margin: a single issue, or the passages of other editions that could go after one paragraph. */
interface CardModel { id: string; type: IssueType; chunk_id: number | null; issues: WsIssue[] }

const top = (s: string | null) => (s ?? "Introduction").split(" › ")[0];

export default function WorkspaceView({ qid, lang, compare }: { qid: string; lang: Lang; compare: Lang | null }) {
  const qc = useQueryClient();
  const ws = useQuery({ queryKey: ["workspace", qid, lang], queryFn: () => wapi6.workspace(qid, lang), staleTime: 30_000 });
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<IssueType>>(new Set());
  const [showHandled, setShowHandled] = useState(false);
  const [local, setLocal] = useState<Record<string, IssueStatus>>({});
  const [panel, setPanelState] = useState<boolean>(() => { try { return localStorage.getItem("muisti-panel") !== "closed"; } catch { return true; } });
  const setPanel = (v: boolean) => { setPanelState(v); try { localStorage.setItem("muisti-panel", v ? "open" : "closed"); } catch { /* ignore */ } };
  useEffect(() => { setSelected(null); setLocal({}); }, [qid, lang]);

  const statusOf = useCallback((id: string): IssueStatus => local[id] ?? ws.data?.status[id]?.status ?? "open", [local, ws.data]);
  const setStatus = async (id: string, s: IssueStatus) => {
    setLocal((m) => ({ ...m, [id]: s }));
    try { await wapi6.setStatus(qid, id, lang, s); } catch { setLocal((m) => { const n = { ...m }; delete n[id]; return n; }); }
  };

  if (ws.isLoading) return <Spinner label="Opening the article" />;
  if (ws.error) return <ErrorBox error={ws.error} />;
  if (!ws.data) return null;
  const d = ws.data;

  const visible = d.issues.filter((i) => !hidden.has(i.type) && (showHandled || statusOf(i.id) === "open"));
  const counts = Object.fromEntries(TYPES.map((t) => [t.type, d.issues.filter((i) => i.type === t.type).length])) as Record<IssueType, number>;
  const handled = d.issues.filter((i) => statusOf(i.id) !== "open").length;

  const toggle = (t: IssueType) => setHidden((h) => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const header = (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-ink">Checks</span>
        <span className="tabular text-xs text-ink-2"><b className="text-ink">{handled}</b> / {d.issues.length} handled</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full bg-success" style={{ width: `${(100 * handled) / Math.max(1, d.issues.length)}%` }} /></div>
        <button onClick={() => setPanel(false)} title="Close the panel" className="rounded p-1 text-ink-2 hover:bg-surface-2 hover:text-ink"><PanelRightClose className="size-4" /></button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {TYPES.map((t) => (
          <button key={t.type} onClick={() => toggle(t.type)}
            className={clsx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              hidden.has(t.type) ? "border-line bg-surface-1 text-ink-3" : "border-line-strong bg-surface-1 text-ink")}>
            <span className={clsx("size-1.5 rounded-full", hidden.has(t.type) ? "bg-surface-3" : t.dot)} />{t.label}
            <span className="tabular text-ink-3">{counts[t.type]}</span>
          </button>
        ))}
        <label className="ml-auto inline-flex items-center gap-1 text-[11px] text-ink-2">
          <input type="checkbox" checked={showHandled} onChange={(e) => setShowHandled(e.target.checked)} /> handled
        </label>
      </div>
    </div>
  );
  const rail = (
    <div className="sticky top-[92px] flex flex-col items-center gap-3 py-3">
      <button onClick={() => setPanel(true)} title="Open the checks" className="rounded p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink"><PanelRightOpen className="size-4" /></button>
      {TYPES.map((t) => (
        <button key={t.type} onClick={() => { setPanel(true); setHidden(new Set(TYPES.map((x) => x.type).filter((x) => x !== t.type))); }}
          title={`${t.label}: ${counts[t.type]}`} className="flex flex-col items-center gap-0.5">
          <span className={clsx("size-2.5 rounded-full", t.dot)} /><span className="tabular text-[11px] text-ink-2">{counts[t.type]}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <Pending qid={qid} d={d} onDone={() => qc.invalidateQueries({ queryKey: ["workspace", qid] })} />
      {compare ? (
        <div className="px-4 py-3 sm:px-6"><CompareView d={d} other={compare} /></div>
      ) : (
        <Annotated d={d} issues={visible} selected={selected} onSelect={setSelected} statusOf={statusOf} setStatus={setStatus} qid={qid}
          panel={panel} header={header} rail={rail} openPanel={() => setPanel(true)} />
      )}
    </div>
  );
}

// ── Analyses not computed yet ──────────────────────────────────────────────────

function Pending({ qid, d, onDone }: { qid: string; d: Workspace; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const run = async (what: string, f: () => Promise<unknown>) => {
    setBusy(what); setErr(null);
    try { await f(); onDone(); } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  // one-line summaries of missing content are cheap: fetched in the background
  useEffect(() => {
    if (d.pending.summaries) wapi3.missing(qid, d.lang).then(onDone).catch(() => {});
  }, [qid, d.lang, d.pending.summaries]); // eslint-disable-line react-hooks/exhaustive-deps
  const needCompare = d.pending.facts || d.pending.wording;
  if (!needCompare && !d.pending.contradictions) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-warning-soft/40 px-6 py-2 text-sm">
      {busy ? <span className="flex items-center gap-2 text-ink-2"><Loader2 className="size-4 animate-spin text-accent" /> {busy}…</span> : <>
        <span className="text-ink-2">Some checks have not run on this article yet.</span>
        {needCompare && <Button kind="primary" onClick={() => run("Comparing facts and wording across the editions (about 30 s)", () => Promise.all([wapi2.facts(qid), wapi.framing(qid)]))}>Compare the editions</Button>}
        {d.pending.contradictions && <Button onClick={() => run("Checking contradictions with other articles (about 20 s)", () => wapi4.contradictions(d.lang, d.article.page_id))}>Check contradictions with other articles</Button>}
      </>}
      {err != null && <div className="w-full"><ErrorBox error={err} /></div>}
    </div>
  );
}

// ── Text with highlights + margin cards ────────────────────────────────────────

function Annotated({ d, issues, selected, onSelect, statusOf, setStatus, qid, panel, header, rail, openPanel }: {
  d: Workspace; issues: WsIssue[]; selected: string | null; onSelect: (id: string | null) => void;
  statusOf: (id: string) => IssueStatus; setStatus: (id: string, s: IssueStatus) => void; qid: string;
  panel: boolean; header: React.ReactNode; rail: React.ReactNode; openPanel: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [pos, setPos] = useState<Record<string, number>>({});
  const [height, setHeight] = useState(0);

  // cards: one per issue, missing content grouped by the paragraph it would follow
  const cards = useMemo<CardModel[]>(() => {
    const out: CardModel[] = [];
    const groups = new Map<string, CardModel>();
    for (const i of issues) {
      if (i.type === "contradiction" && i.start != null) {          // same sentence, several other articles: one card
        const key = `contra@${i.chunk_id}:${i.start}`;
        let g = groups.get(key);
        if (!g) { g = { id: key, type: "contradiction", chunk_id: i.chunk_id, issues: [] }; groups.set(key, g); out.push(g); }
        g.issues.push(i);
        continue;
      }
      if (i.type !== "missing") { out.push({ id: i.id, type: i.type, chunk_id: i.chunk_id, issues: [i] }); continue; }
      const key = `missing@${i.chunk_id ?? "none"}`;
      let g = groups.get(key);
      if (!g) { g = { id: key, type: "missing", chunk_id: i.chunk_id, issues: [] }; groups.set(key, g); out.push(g); }
      g.issues.push(i);
    }
    const order = new Map(d.passages.map((p, k) => [p.chunk_id, k]));
    return out.sort((a, b) => (order.get(a.chunk_id ?? -1) ?? 1e6) - (order.get(b.chunk_id ?? -1) ?? 1e6));
  }, [issues, d.passages]);
  const selCardModel = cards.find((c) => c.id === selected || c.issues.some((i) => i.id === selected));
  const selCard = selCardModel?.id ?? null;
  const selIds = new Set(selCardModel ? selCardModel.issues.map((i) => i.id) : []);

  const layout = useCallback(() => {
    const el = box.current;
    if (!el || !panel) return;
    const base = el.getBoundingClientRect().top;
    const want = cards.map((c) => {
      const a = el.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(c.id)}"]`)
        ?? el.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(c.issues[0].id)}"]`)
        ?? (c.chunk_id != null ? el.querySelector<HTMLElement>(`[data-chunk="${c.chunk_id}"]`) : null)
        ?? el.querySelector<HTMLElement>("[data-end]");
      return a ? a.getBoundingClientRect().top - base : 0;
    });
    const hAll = cards.map((c) => cardRefs.current.get(c.id)?.offsetHeight ?? 60);
    // place in the order of the sentences on the page, not of the passages
    const ord = cards.map((_, j) => j).sort((x, y) => want[x] - want[y] || x - y);
    const w = ord.map((j) => want[j]), h = ord.map((j) => hAll[j]);
    const gap = 8, q: number[] = new Array(ord.length).fill(0);
    const k = selCard ? ord.findIndex((j) => cards[j].id === selCard) : -1;
    if (k < 0) {
      for (let j = 0; j < ord.length; j++) q[j] = Math.max(w[j], j ? q[j - 1] + h[j - 1] + gap : HEADER);
    } else {
      q[k] = w[k];
      for (let j = k + 1; j < ord.length; j++) q[j] = Math.max(w[j], q[j - 1] + h[j - 1] + gap);
      for (let j = k - 1; j >= 0; j--) q[j] = Math.min(w[j], q[j + 1] - h[j] - gap);   // may go above the top, like comments in a document
    }
    const p: number[] = new Array(cards.length).fill(0);
    ord.forEach((j, r) => { p[j] = q[r]; });
    const next = Object.fromEntries(cards.map((c, j) => [c.id, Math.round(p[j])]));
    setPos((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    const last = ord.length ? q[ord.length - 1] + h[ord.length - 1] : 0;
    setHeight(Math.max(last, 0));
  }, [cards, selCard, panel]);

  useLayoutEffect(() => { layout(); });
  useEffect(() => {
    const ro = new ResizeObserver(() => layout());
    if (box.current) ro.observe(box.current);
    window.addEventListener("resize", layout);
    return () => { ro.disconnect(); window.removeEventListener("resize", layout); };
  }, [layout]);

  const select = (id: string | null, scrollText = false) => {
    onSelect(id);
    if (id && !panel) openPanel();
    if (id && scrollText) {
      const card = cards.find((c) => c.id === id);
      const a = box.current?.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(id)}"]`)
        ?? (card ? box.current?.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(card.issues[0].id)}"]`) : null)
        ?? (card?.chunk_id != null ? box.current?.querySelector<HTMLElement>(`[data-chunk="${card.chunk_id}"]`) : null);
      a?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  // spans per passage (non-overlapping), and paragraph-level issues
  const spans = new Map<number, WsIssue[]>();
  const para = new Map<number, WsIssue[]>();
  for (const i of issues) {
    if (i.chunk_id == null || i.type === "missing") continue;
    if (i.start != null && i.end != null) spans.set(i.chunk_id, [...(spans.get(i.chunk_id) ?? []), i]);
    else para.set(i.chunk_id, [...(para.get(i.chunk_id) ?? []), i]);
  }
  const missingAfter = new Map(cards.filter((c) => c.type === "missing" && c.chunk_id != null).map((c) => [c.chunk_id!, c]));
  const nowhere = cards.find((c) => c.id === "missing@none");

  let prevTop: string | null = null, prevSec: string | null | undefined = undefined;
  return (
    <div ref={box} className={clsx("relative grid min-h-[calc(100vh-92px)]", panel ? "grid-cols-[minmax(0,1fr)_380px]" : "grid-cols-[minmax(0,1fr)_48px]")}>
      <article className="min-w-0 bg-surface-1 px-6 py-6 sm:px-12">
        <h2 className="serif border-b border-line pb-2 text-[26px] text-ink-strong">{d.article.title}</h2>
        {d.passages.map((p) => {
          const t = top(p.section);
          const heads: React.ReactNode[] = [];
          if (t !== prevTop && !(prevTop === null && t === "Introduction")) heads.push(<h3 key="h" className="serif mt-6 border-b border-line pb-1 text-xl text-ink-strong">{t}</h3>);
          const sub = p.section?.split(" › ").slice(1).join(" › ");
          if (p.section !== prevSec && sub) heads.push(<h4 key="s" className="mt-4 text-[15px] font-semibold text-ink">{sub}</h4>);
          prevTop = t; prevSec = p.section;
          const m = missingAfter.get(p.chunk_id);
          return (
            <Fragment key={p.chunk_id}>
              {heads}
              <Paragraph p={p} spans={spans.get(p.chunk_id) ?? []} para={para.get(p.chunk_id) ?? []} isSel={(id) => selIds.has(id)} onSelect={(id) => select(id)} />
              {m && (
                <button data-anchor={m.id} onClick={() => select(m.id)}
                  className={clsx("my-1 block w-full rounded border border-dashed px-3 py-1 text-left text-xs",
                    selCard === m.id ? "border-accent bg-accent-soft text-accent" : "border-[color-mix(in_oklab,var(--accent)_40%,transparent)] text-accent hover:bg-accent-soft")}>
                  + {m.issues.length} passage{m.issues.length === 1 ? "" : "s"} from {[...new Set(m.issues.map((i) => LANG_NAME[i.detail.lang as Lang]))].join(" and ")} could go here
                </button>
              )}
            </Fragment>
          );
        })}
        <div data-end className="h-px" />
        {nowhere && <p className="mt-4 text-xs text-ink-3">Content not covered anywhere in this article is listed at the bottom of the margin.</p>}
      </article>
      <aside className="relative border-l border-line bg-bg" style={{ minHeight: panel ? height + 120 : undefined }}>
        {!panel ? rail : <>
        <div className="sticky top-[92px] z-20 border-b border-line bg-bg/95 px-3 py-2.5 backdrop-blur">{header}</div>
        <div className="absolute inset-x-3 top-0">
        {cards.map((c) => (
          <div key={c.id} ref={(el) => { if (el) cardRefs.current.set(c.id, el); else cardRefs.current.delete(c.id); }}
            className="absolute left-0 right-0 transition-[top] duration-200" style={{ top: pos[c.id] ?? 0 }}>
            <IssueCard c={c} open={selCard === c.id} onOpen={() => select(selCard === c.id ? null : c.id, true)}
              statusOf={statusOf} setStatus={setStatus} d={d} qid={qid} />
          </div>
        ))}
        </div>
        </>}
      </aside>
    </div>
  );
}

function Paragraph({ p, spans, para, isSel, onSelect }: {
  p: WsPassage; spans: WsIssue[]; para: WsIssue[]; isSel: (id: string) => boolean; onSelect: (id: string) => void;
}) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const s of [...spans].sort((a, b) => a.start! - b.start!)) {
    if (s.start! < at) continue;                      // overlapping highlight: its card still points here
    if (s.start! > at) parts.push(displayText(p.text.slice(at, s.start!)));
    parts.push(
      <mark key={s.id} data-anchor={s.id} onClick={() => onSelect(s.id)}
        className={clsx("cursor-pointer rounded-[2px] px-0.5 text-inherit underline decoration-2 underline-offset-2", META[s.type].mark,
          isSel(s.id) && "outline outline-2 outline-offset-1 outline-[var(--accent)]")}>
        {displayText(p.text.slice(s.start!, s.end!))}
      </mark>,
    );
    at = s.end!;
  }
  parts.push(displayText(p.text.slice(at)));
  return (
    <p data-chunk={p.chunk_id} className="serif my-2.5 whitespace-pre-line text-[16.5px] leading-[1.7] text-ink">
      {parts}
      {para.map((i) => (
        <button key={i.id} data-anchor={i.id} onClick={() => onSelect(i.id)} title={i.title}
          className={clsx("ml-1 inline-block size-2.5 rounded-full align-middle", META[i.type].dot, isSel(i.id) && "ring-2 ring-[var(--accent)] ring-offset-1")} />
      ))}
    </p>
  );
}

// ── Cards ──────────────────────────────────────────────────────────────────────

function IssueCard({ c, open, onOpen, statusOf, setStatus, d }: {
  c: CardModel; open: boolean; onOpen: () => void; statusOf: (id: string) => IssueStatus;
  setStatus: (id: string, s: IssueStatus) => void; d: Workspace; qid: string;
}) {
  const i = c.issues[0];
  const st = c.issues.length > 1 || c.type === "missing" ? (c.issues.every((x) => statusOf(x.id) !== "open") ? "fixed" : "open") : statusOf(i.id);
  const title = c.type === "missing" ? `${c.issues.length} passage${c.issues.length === 1 ? "" : "s"} to add${c.chunk_id == null ? " (no matching section)" : " here"}` : i.title;
  return (
    <div className={clsx("rounded-md border border-l-4 bg-surface-1 shadow-sm transition-shadow", META[c.type].strip,
      open ? "border-y-[var(--accent)] border-r-[var(--accent)] shadow-md" : "border-y-line border-r-line hover:shadow", st !== "open" && "opacity-60")}>
      <button onClick={onOpen} className="block w-full px-3 py-2 text-left">
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-3">
          <span className={clsx("size-1.5 rounded-full", META[c.type].dot)} />{META[c.type].label.replace(/s$/, "")}
          {c.type !== "missing" && <span className="truncate font-medium normal-case tracking-normal">· {c.issues.length > 1 ? `vs ${c.issues.length} articles` : i.status_label}</span>}
          {st !== "open" && <span className="ml-auto text-success">{st === "fixed" ? "fixed" : "not a problem"}</span>}
        </div>
        <div className="mt-0.5 text-[13px] font-semibold leading-snug text-ink">{title}</div>
        {!open && <Summary c={c} lang={d.lang} />}
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2.5 text-[12.5px]">
          {c.type === "fact" && <FactDetail i={i} d={d} />}
          {c.type === "wording" && <WordingDetail i={i} d={d} />}
          {c.type === "contradiction" && c.issues.map((x, k) => (
            <div key={x.id} className={k ? "border-t border-line pt-2" : ""}><ContraDetail i={x} />
              {c.issues.length > 1 && <div className="mt-1.5"><StatusButtons st={statusOf(x.id)} onSet={(s) => setStatus(x.id, s)} /></div>}
            </div>
          ))}
          {c.type === "missing" && <MissingDetail c={c} d={d} statusOf={statusOf} setStatus={setStatus} />}
          <div className="flex items-center gap-1 pt-1 text-[10.5px] text-ink-3">{PROVENANCE[i.provenance]}</div>
          {c.type !== "missing" && c.issues.length === 1 && <StatusButtons st={st} onSet={(s) => setStatus(i.id, s)} />}
        </div>
      )}
    </div>
  );
}

function StatusButtons({ st, onSet }: { st: IssueStatus; onSet: (s: IssueStatus) => void }) {
  if (st !== "open") return <button onClick={() => onSet("open")} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"><RotateCcw className="size-3" /> Reopen</button>;
  return (
    <div className="flex gap-2">
      <button onClick={() => onSet("fixed")} className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-xs font-medium text-ink hover:border-success hover:text-success"><Check className="size-3" /> Fixed</button>
      <button onClick={() => onSet("dismissed")} className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-xs font-medium text-ink-2 hover:text-ink"><X className="size-3" /> Not a problem</button>
    </div>
  );
}

function Summary({ c, lang }: { c: CardModel; lang: Lang }) {
  const i = c.issues[0];
  if (c.type === "fact") return (
    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[12px] text-ink-2">
      {(i.detail.values as { lang: Lang; value: string }[]).map((v) => <span key={v.lang} className={v.lang === lang ? "font-semibold text-ink" : ""}><span className="uppercase text-ink-3">{v.lang}</span> {v.value}</span>)}
      {i.detail.history?.traceable && <span className={i.detail.history.stale ? "text-warning" : "text-ink-3"}>· fi since {String(i.detail.history.since).slice(0, 4)}</span>}
    </div>
  );
  if (c.type === "contradiction") return (
    <div className="mt-1 space-y-0.5 text-[12px] text-ink-2">
      {c.issues.slice(0, 3).map((x) => <div key={x.id} className="truncate"><b className="text-ink">{x.detail.value_a}</b> vs <b className="text-ink">{x.detail.value_b}</b> <span className="text-ink-3">in {x.detail.b.title}</span></div>)}
      {c.issues.length > 3 && <div className="text-ink-3">+ {c.issues.length - 3} more</div>}
    </div>
  );
  if (c.type === "wording") return <div className="mt-1 line-clamp-2 text-[12px] text-ink-2">{i.detail.explanation}</div>;
  return <div className="mt-1 line-clamp-2 text-[12px] text-ink-2">{c.issues.map((x) => x.title).join(" · ")}</div>;
}

function Quote({ lang, quote, en, mine }: { lang: Lang; quote: string; en?: string; mine?: boolean }) {
  return (
    <div className={clsx("rounded border px-2 py-1.5", mine ? "border-accent/40 bg-accent-soft/40" : "border-line")}>
      <div className="flex items-center gap-1.5"><LangBadge lang={lang} size="xs" />{mine && <span className="text-[10px] font-semibold uppercase text-accent">this article</span>}</div>
      {en && lang !== "en" && <div className="mt-1 text-ink">“{en}”</div>}
      <div className={clsx("serif mt-0.5", en && lang !== "en" ? "text-ink-3" : "text-ink")}>{quote}</div>
    </div>
  );
}

function FactDetail({ i, d }: { i: WsIssue; d: Workspace }) {
  const x = i.detail;
  const vals = [...x.values].sort((a: { lang: Lang }, b: { lang: Lang }) => (a.lang === d.lang ? -1 : b.lang === d.lang ? 1 : 0));
  const note = talkNote(`${x.subject}: the language editions differ`, `Comparing the Finnish, Swedish and English articles, the editions do not agree on ${String(x.subject).toLowerCase()}:`,
    vals.map((v: { lang: Lang; quote: string; translation: string }) => ({ lang: v.lang, title: x.group[v.lang]?.title ?? "", rev: x.group[v.lang]?.rev_id ?? 0, quote: v.quote, translation: v.translation })));
  const h = x.history;
  return (
    <>
      {x.note && <p className="text-ink-2">{x.note}</p>}
      {vals.map((v: { lang: Lang; quote: string; translation: string; sql_check?: { status: string; values: { surface: string }[] } }) => (
        <div key={v.lang}>
          <Quote lang={v.lang} quote={v.quote} en={v.translation} mine={v.lang === d.lang} />
          {v.sql_check?.status === "checked" && <div className="mt-0.5 text-[10.5px] text-success">figures found in MariaDB: {v.sql_check.values.map((s) => s.surface).join(", ")}</div>}
        </div>
      ))}
      {x.missing_in?.includes(d.lang) && <p className="text-ink-2">Not stated in the {LANG_NAME[d.lang]} article.</p>}
      {h?.traceable && (
        <p className={h.stale ? "text-warning" : "text-ink-2"}>
          In the Finnish article since {String(h.since).slice(0, 10)}{h.edit ? <> (<a href={h.edit.diff_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">edit</a>)</> : null}
          {h.before ? <> · before: <span className="serif">“{h.before}”</span></> : null}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {x.group[d.lang] && vals.find((v: { lang: Lang }) => v.lang === d.lang) && (
          <a href={wiki.sentence(d.lang, x.group[d.lang].title, vals.find((v: { lang: Lang }) => v.lang === d.lang).quote)} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">Open on Wikipedia <ArrowUpRight className="size-3" /></a>
        )}
        <a href={wiki.edit(d.lang, d.article.title)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">Edit on Wikipedia <ArrowUpRight className="size-3" /></a>
      </div>
      <CopyButton text={note} label="Copy talk-page note" kind="quiet" />
    </>
  );
}

function WordingDetail({ i, d }: { i: WsIssue; d: Workspace }) {
  const x = i.detail;
  return (
    <>
      <p className="text-ink-2">{x.explanation}</p>
      {(x.quotes as { lang: Lang; quote: string; translation: string }[]).sort((a) => (a.lang === d.lang ? -1 : 1)).map((q) => (
        <Quote key={q.lang} lang={q.lang} quote={q.quote} en={q.translation} mine={q.lang === d.lang} />
      ))}
      <a href={wiki.edit(d.lang, d.article.title)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">Edit on Wikipedia <ArrowUpRight className="size-3" /></a>
    </>
  );
}

function ContraDetail({ i }: { i: WsIssue }) {
  const x = i.detail;
  const vals = x.kind === "number" && x.sql_check ? [...x.sql_check.a.values, ...x.sql_check.b.values].filter((v: { kind: string }) => v.kind === "number") : [];
  return (
    <>
      <p className="text-ink-2">{x.explanation}</p>
      <Quote lang={x.a.lang} quote={x.quote_a} en={x.quote_a_en} mine />
      <div className="text-[11px] text-ink-3">Other article: <a href={x.b.oldid_url} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">{x.b.title}</a></div>
      <Quote lang={x.b.lang} quote={x.quote_b} en={x.quote_b_en} />
      {x.kind === "date" && <p className="text-[10.5px] text-ink-3">Same anchor date in both, dates {x.days} day{x.days === 1 ? "" : "s"} apart (SQL), confirmed by Claude.</p>}
      {vals.length > 0 && <p className="text-[10.5px] text-success">Figures checked in MariaDB: {vals.map((v: { surface: string; found: boolean }) => `${v.surface} ${v.found ? "✓" : "✗"}`).join(" ")}</p>}
    </>
  );
}

function MissingDetail({ c, d, statusOf, setStatus }: { c: CardModel; d: Workspace; statusOf: (id: string) => IssueStatus; setStatus: (id: string, s: IssueStatus) => void }) {
  return (
    <ul className="space-y-2">
      {c.issues.map((m) => <MissingItem key={m.id} m={m} d={d} st={statusOf(m.id)} onSet={(s) => setStatus(m.id, s)} />)}
    </ul>
  );
}

function MissingItem({ m, d, st, onSet }: { m: WsIssue; d: Workspace; st: IssueStatus; onSet: (s: IssueStatus) => void }) {
  const x = m.detail;
  const [open, setOpen] = useState(false);
  const tr = useQuery({ queryKey: ["translate", x.chunk_id], queryFn: () => wapi2.translate(x.chunk_id), enabled: open && x.lang !== "en", staleTime: Infinity, retry: false });
  return (
    <li className={clsx("rounded border border-line px-2 py-1.5", st !== "open" && "opacity-60")}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-1.5 text-left">
        <LangBadge lang={x.lang} size="xs" /><span className="text-ink">{m.title}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {x.lang !== "en" && <p className="text-ink">{tr.isFetching ? <span className="text-ink-3">Translating…</span> : tr.data?.translation}</p>}
          <p className="serif text-ink-3">{displayText(x.text)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <a href={wiki.section(x.lang, x.article.title, x.section)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">Source <ArrowUpRight className="size-3" /></a>
            <a href={wiki.edit(d.lang, d.article.title)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">Edit on Wikipedia <ArrowUpRight className="size-3" /></a>
            <CopyButton text={attribution(d.lang, x.lang, x.article.title, x.article.rev_id)} label="Copy attribution" kind="quiet" />
          </div>
          <StatusButtons st={st} onSet={onSet} />
        </div>
      )}
    </li>
  );
}

// ── Two editions side by side (read-only) ──────────────────────────────────────

function CompareView({ d, other }: { d: Workspace; other: Lang }) {
  const right = d.other_passages[other] ?? [];
  const otherArt = d.articles.find((a) => a.lang === other);
  const [hover, setHover] = useState<{ side: "l" | "r"; idx: number } | null>(null);
  const rightBox = useRef<HTMLDivElement>(null);
  const leftBox = useRef<HTMLDivElement>(null);
  const matched = new Set(right.filter((r) => (r.distance ?? 1) <= d.covered).map((r) => r.match_idx));
  if (!otherArt) return <p className="text-sm text-ink-3">There is no {LANG_NAME[other]} article on this topic.</p>;

  const isLinked = (side: "l" | "r", p: WsPassage | WsOtherPassage) => {
    if (!hover) return false;
    if (hover.side === "l") return side === "r" ? (p as WsOtherPassage).match_idx === hover.idx && ((p as WsOtherPassage).distance ?? 1) <= d.covered : p.chunk_idx === hover.idx;
    const r = right.find((x) => x.chunk_idx === hover.idx);
    return side === "l" ? !!r && r.match_idx === p.chunk_idx && (r.distance ?? 1) <= d.covered : p.chunk_idx === hover.idx;
  };
  const jump = (side: "l" | "r", idx: number) => {
    const target = side === "l"
      ? rightBox.current?.querySelector<HTMLElement>(`[data-match="${idx}"]`)
      : leftBox.current?.querySelector<HTMLElement>(`[data-idx="${right.find((x) => x.chunk_idx === idx)?.match_idx}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="grid grid-cols-2 gap-4">
      {([["l", d.article, d.passages], ["r", otherArt, right]] as const).map(([side, art, ps]) => {
        let prevTop: string | null = null;
        return (
          <div key={side} ref={side === "l" ? leftBox : rightBox} className="h-[calc(100vh-220px)] overflow-y-auto rounded-lg border border-line bg-surface-1 px-6 py-4 shadow-sm">
            <div className="sticky top-0 z-10 -mx-6 -mt-4 mb-2 flex items-center gap-2 border-b border-line bg-surface-1/95 px-6 py-2 backdrop-blur">
              <LangBadge lang={art.lang} /><span className="truncate font-semibold text-ink">{art.title}</span>
              <span className="ml-auto text-[11px] text-ink-3">read-only</span>
              <a href={wiki.edit(art.lang, art.title)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">Edit on Wikipedia <ArrowUpRight className="size-3" /></a>
            </div>
            {(ps as (WsPassage | WsOtherPassage)[]).map((p) => {
              const t = top(p.section);
              const head = t !== prevTop ? (
                <div className="mt-4 flex items-baseline gap-2 border-b border-line pb-0.5">
                  <h3 className="serif text-lg text-ink-strong">{t}</h3>
                  <a href={wiki.section(art.lang, art.title, p.section)} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline">open</a>
                </div>
              ) : null;
              prevTop = t;
              const only = side === "r" ? ((p as WsOtherPassage).distance ?? 1) > d.covered : !matched.has(p.chunk_idx);
              return (
                <Fragment key={p.chunk_id}>
                  {head}
                  <p data-idx={side === "l" ? p.chunk_idx : undefined} data-match={side === "r" && !only ? (p as WsOtherPassage).match_idx ?? undefined : undefined}
                    onMouseEnter={() => setHover({ side, idx: p.chunk_idx })} onMouseLeave={() => setHover(null)} onClick={() => jump(side, p.chunk_idx)}
                    className={clsx("serif my-2 cursor-pointer whitespace-pre-line rounded px-2 py-1 text-[15px] leading-relaxed text-ink transition-colors",
                      isLinked(side, p) ? "bg-accent-soft" : "hover:bg-surface-2",
                      only && "border-l-4 border-[color-mix(in_oklab,var(--accent)_45%,transparent)]")}>
                    {only && <span className="mb-0.5 block font-sans text-[10.5px] font-semibold uppercase tracking-wide text-accent">Only in {LANG_NAME[art.lang]}</span>}
                    {displayText(p.text)}
                  </p>
                </Fragment>
              );
            })}
          </div>
        );
      })}
      <p className="col-span-2 flex items-center gap-1.5 text-xs text-ink-3"><CircleCheck className="size-3.5" /> Hover a passage to see its counterpart; click to scroll the other column to it. Passages marked “Only in” have no equivalent in the other edition (vector distance above {d.covered}).</p>
    </div>
  );
}
