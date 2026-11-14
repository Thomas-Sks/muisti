import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { Check, ChevronDown, CircleAlert, Copy, Info, Loader2 } from "lucide-react";
import type { Lang } from "./api";

export const LANG_NAME: Record<Lang, string> = { fi: "Finnish", sv: "Swedish", en: "English" };
export const LANG_VAR: Record<Lang, string> = { fi: "var(--series-1)", sv: "var(--series-2)", en: "var(--series-3)" };

export const nf = new Intl.NumberFormat("en-US");
export const fmtDate = (iso: string | null | undefined, withTime = false) => {
  if (!iso) return "n/a";
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  return d.toLocaleDateString("en-GB", {
    year: "numeric", month: "short", day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", timeZone: "UTC" } : { timeZone: "UTC" }),
  }) + (withTime ? " UTC" : "");
};

const LANG_STYLE: Record<Lang, string> = {
  fi: "bg-fi-soft text-fi border-[color-mix(in_oklab,var(--lang-fi)_25%,transparent)]",
  sv: "bg-sv-soft text-sv border-[color-mix(in_oklab,var(--lang-sv)_25%,transparent)]",
  en: "bg-en-soft text-en border-[color-mix(in_oklab,var(--lang-en)_25%,transparent)]",
};

/** Language code with a soft identity colour (the code itself carries the meaning). */
export function LangBadge({ lang, size = "sm" }: { lang: Lang; size?: "sm" | "xs" }) {
  return (
    <span title={LANG_NAME[lang]}
      className={clsx("inline-flex shrink-0 items-center justify-center rounded-md border font-semibold uppercase tracking-wide", LANG_STYLE[lang],
        size === "sm" ? "h-5 min-w-8 px-1.5 text-[11px]" : "h-[18px] min-w-7 px-1 text-[10px]")}>
      {lang}
    </span>
  );
}

/** Copies text to the clipboard and confirms. */
export function CopyButton({ text, label, kind = "normal" }: { text: string; label: string; kind?: "normal" | "quiet" }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); } catch { /* clipboard blocked */ } }}
      className={clsx("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors",
        kind === "normal" ? "border border-line-input bg-surface-1 text-ink hover:bg-surface-2" : "text-accent hover:bg-accent-soft")}>
      {done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />} {done ? "Copied" : label}
    </button>
  );
}

/** Read · Edit · History · Talk links for one article. */
export function ArticleLinks({ links }: { links: { label: string; href: string }[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
      {links.map((l) => (
        <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">{l.label}</a>
      ))}
    </span>
  );
}

/** Flat bordered panel. */
export function Card({ children, className, title, action, subtitle }: {
  children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; subtitle?: ReactNode;
}) {
  return (
    <section className={clsx("rounded-lg border border-line bg-surface-1 shadow-sm", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="text-xs text-ink-3">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** Toggle-button group (Codex ToggleButtonGroup): for switching a filter or a mode. */
export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; hint?: string }[]; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded-md border border-line-input bg-surface-1 shadow-sm">
      {options.map((o, i) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} title={o.hint}
          onClick={() => onChange(o.value)}
          className={clsx("h-8 px-3 text-sm transition-colors", i > 0 && "border-l border-line-input",
            value === o.value ? "bg-accent-soft font-semibold text-accent" : "bg-surface-1 text-ink hover:bg-surface-2")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Quiet tabs (Codex Tabs): page-level views. */
export function Tabs<T extends string>({ value, onChange, tabs }: {
  value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number | null; disabled?: boolean }[];
}) {
  return (
    <div role="tablist" className="flex gap-6 border-b border-line">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} disabled={t.disabled}
          onClick={() => onChange(t.value)}
          className={clsx("-mb-px border-b-2 pb-2 pt-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            value === t.value ? "border-accent font-semibold text-accent" : "border-transparent text-ink-2 hover:text-ink")}>
          {t.label}
          {t.count != null && <span className="tabular ml-1.5 text-ink-3">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Button({ children, onClick, kind = "normal", disabled, type = "button", title }: {
  children: ReactNode; onClick?: () => void; kind?: "primary" | "normal" | "quiet"; disabled?: boolean; type?: "button" | "submit"; title?: string;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
      className={clsx("inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-50",
        kind === "primary" && "bg-accent text-white hover:bg-accent-hover",
        kind === "normal" && "border border-line-input bg-surface-1 text-ink hover:bg-surface-2",
        kind === "quiet" && "text-accent hover:bg-accent-soft")}>
      {children}
    </button>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="tabular mt-0.5 truncate text-lg font-semibold text-ink">{value}</div>
      {hint && <div className="text-xs text-ink-3">{hint}</div>}
    </div>
  );
}

export function Timing({ ms, label }: { ms: number; label: string }) {
  return (
    <span className="tabular inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[11px] text-ink-3">
      {label} <span className="text-ink-2">{ms < 10 ? ms.toFixed(2) : ms.toFixed(0)} ms</span>
    </span>
  );
}

const SQL_KEYWORDS = /\b(WITH|SELECT|FROM|WHERE|JOIN|ON|GROUP BY|ORDER BY|LIMIT|UNION ALL|AS|AND|OR|NOT|IN|BOOLEAN MODE|MATCH|AGAINST|OVER|PARTITION BY|ROW_NUMBER|SUM|MAX|MIN|COUNT|IF|CAST|NULL|DESC|FOR SYSTEM_TIME|AS OF|TIMESTAMP|ALL|BETWEEN|VEC_DISTANCE_COSINE|VEC_FromText|DATE_FORMAT|LEFT|DISTINCT|COALESCE)\b/g;

function highlightSql(sql: string) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of sql.matchAll(SQL_KEYWORDS)) {
    parts.push(sql.slice(last, m.index));
    parts.push(<span key={m.index} className="font-semibold text-accent">{m[0]}</span>);
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(sql.slice(last));
  return parts;
}

/** Collapsed by default: the query behind a view, for the technically curious. */
export function SqlPanel({ sql, timings, defaultOpen = false, title = "SQL" }: {
  sql: string; timings?: { label: string; ms: number }[]; defaultOpen?: boolean; title?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-sm border border-line bg-surface-1">
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left">
        <span className="min-w-0 truncate text-xs text-ink-2"><span className="font-mono font-semibold text-ink-3">SQL</span> · {title}</span>
        <span className="flex items-center gap-2">
          {timings?.map((t) => <Timing key={t.label} {...t} />)}
          <ChevronDown className={clsx("size-4 text-ink-3 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div className="relative border-t border-line">
          <button
            onClick={() => { navigator.clipboard.writeText(sql); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
            className="absolute right-2 top-2 rounded-sm border border-line bg-surface-1 p-1 text-ink-3 hover:text-ink" aria-label="Copy SQL">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </button>
          <pre className="max-h-96 overflow-auto bg-surface-2 p-3 pr-10 font-mono text-[12px] leading-relaxed text-ink-2">{highlightSql(sql.trim())}</pre>
        </div>
      )}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-ink-3" role="status">
      <Loader2 className="size-4 animate-spin" /> {label}…
    </div>
  );
}

/** Codex-style message: system state only (errors, notices), never decoration. */
export function Message({ kind = "notice", children }: { kind?: "notice" | "error" | "warning"; children: ReactNode }) {
  return (
    <div className={clsx("flex items-start gap-2 rounded-sm border px-3 py-2 text-sm",
      kind === "error" && "border-[#f54739] bg-destructive-soft text-ink",
      kind === "warning" && "border-[#ab7f2a] bg-warning-soft text-ink",
      kind === "notice" && "border-line-strong bg-surface-2 text-ink")}>
      {kind === "notice" ? <Info className="mt-0.5 size-4 shrink-0 text-ink-2" /> : <CircleAlert className={clsx("mt-0.5 size-4 shrink-0", kind === "error" ? "text-destructive" : "text-warning")} />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return <Message kind="error">{error instanceof Error ? error.message : String(error)}</Message>;
}

/** Highlight words of `text` that share a stem-ish prefix with query words (UI only). */
export function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.toLowerCase().match(/\p{L}{4,}|\d{4}/gu) ?? [];
  if (!words.length) return <>{text}</>;
  const stems = [...new Set(words.map((w) => (/^\d+$/.test(w) ? w : w.slice(0, Math.max(4, w.length - 3)))))];
  const re = new RegExp(`(${stems.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[\\p{L}]*`, "giu");
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(last, m.index));
    out.push(<mark key={m.index} className="hit">{m[0]}</mark>);
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

/** Passages from Markdown tables read like "| 28 | | Name | 1962 |": show them as "28 · Name · 1962". */
export function displayText(text: string) {
  return text.split("\n").map((line) => {
    if (!line.includes("|")) return line;
    const cells = line.split("|").map((c) => c.trim()).filter((c) => c && !/^[-:]+$/.test(c));
    return cells.join(" · ");
  }).filter(Boolean).join("\n");
}
