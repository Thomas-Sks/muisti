import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ArrowUpRight, Bot, CircleCheck, CircleHelp, CircleX, Loader2, Search } from "lucide-react";
import clsx from "clsx";
import { api4, type CheckedClaim } from "../api";
import { Card, ErrorBox, LangBadge, Segmented, displayText } from "../ui";
import ContradictionsPanel from "../components/ContradictionsPanel";

const EXAMPLES = [
  "Combien de prisonniers rouges sont morts dans les camps après la guerre civile finlandaise de 1918, et quand les camps ont-ils fermé ?",
  "How many Soviet soldiers died in the Winter War, and who commanded the Finnish army?",
  "Vem var Finlands första president och när valdes han?",
];

const VERDICT = {
  supported: { label: "Wikipedia agrees", short: "confirmed by Wikipedia", icon: CircleCheck, color: "#0ca30c" },
  contradicted: { label: "Wikipedia says otherwise", short: "contradicted by Wikipedia", icon: CircleX, color: "var(--critical)" },
  not_found: { label: "Not found in Wikipedia", short: "not found in Wikipedia", icon: CircleHelp, color: "var(--text-muted)" },
} as const;

function AiCheck() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  const check = useQuery({ queryKey: ["check", q], queryFn: () => api4.check(q), enabled: q.trim().length >= 5, staleTime: Infinity, retry: false });

  return (
    <div className="space-y-6">
      <p className="mx-auto max-w-3xl text-center text-[15px] text-ink-2">
        An AI model answers from memory, with no sources. Every claim it makes is then looked up in Finnish, Swedish
        and English Wikipedia (the passages come from MariaDB’s vector index) and checked against them.
      </p>

      <form className="mx-auto max-w-3xl" onSubmit={(e) => { e.preventDefault(); const v = draft.trim(); if (v.length >= 5) setParams({ tab: "ai", q: v }); }}>
        <div className="flex items-center gap-2 rounded-2xl border border-line-strong bg-surface-1 p-2 shadow-sm focus-within:border-accent">
          <Search className="ml-2 size-5 shrink-0 text-ink-3" />
          <input value={draft} maxLength={300} onChange={(e) => setDraft(e.target.value)} aria-label="Question"
            placeholder="Ask a question about the history of Finland"
            className="min-w-0 flex-1 bg-transparent px-1 py-2 text-[15px] text-ink outline-none placeholder:text-ink-3" />
          <button type="submit" disabled={draft.trim().length < 5}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">Check</button>
        </div>
      </form>

      {!q && (
        <div className="mx-auto grid max-w-3xl gap-2">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => setParams({ tab: "ai", q: e })}
              className="rounded-xl border border-line bg-surface-1 p-3 text-left text-sm text-ink transition-colors hover:border-accent">{e}</button>
          ))}
        </div>
      )}

      {check.isFetching && <Progress />}
      {check.error && <div className="mx-auto max-w-3xl"><ErrorBox error={check.error} /></div>}
      {check.data && !check.isFetching && (
        <div className="mx-auto max-w-4xl space-y-4">
          <Card>
            <div className="p-5">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-3">
                <Bot className="size-4" /> The AI’s answer, from memory ({check.data.model}, no sources)
              </div>
              <p className="mt-2 text-[15px] leading-relaxed text-ink">{check.data.answer}</p>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line px-5 py-3 text-sm">
              {(Object.keys(VERDICT) as (keyof typeof VERDICT)[]).map((k) => {
                const V = VERDICT[k];
                return (
                  <span key={k} className="inline-flex items-center gap-1.5 text-ink-2">
                    <V.icon className="size-4" style={{ color: V.color }} aria-hidden />
                    <b className="tabular text-ink">{check.data.counts[k]}</b> {V.short}
                  </span>
                );
              })}
              <span className="ml-auto text-xs text-ink-3">
                AI {check.data.timings.llm_answer_s}s · MariaDB {Math.round(check.data.timings.mariadb_ms)} ms · check {check.data.timings.llm_judge_s}s
              </span>
            </div>
          </Card>
          {[...check.data.claims].sort((a, b) => order(a) - order(b)).map((c, i) => <ClaimCard key={i} c={c} />)}
        </div>
      )}
    </div>
  );
}

const order = (c: CheckedClaim) => ({ contradicted: 0, not_found: 1, supported: 2 })[c.verdict];

function ClaimCard({ c }: { c: CheckedClaim }) {
  const V = VERDICT[c.verdict];
  return (
    <Card className={clsx("overflow-hidden", c.verdict === "contradicted" && "ring-1 ring-[var(--critical)]/40")}>
      <div className="space-y-3 p-5">
        <div className="flex items-start gap-3">
          <V.icon className="mt-0.5 size-5 shrink-0" style={{ color: V.color }} aria-hidden />
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">{V.label}</div>
            <p className="mt-0.5 text-[15px] font-medium text-ink">“{c.claim}”</p>
            {c.explanation && <p className="mt-1 text-sm text-ink-2">{c.explanation}</p>}
          </div>
        </div>
        {c.passage && <Evidence c={c} />}
      </div>
    </Card>
  );
}

function Progress() {
  const steps = ["The AI answers from memory", "Each claim is searched in MariaDB (vector index)", "Each claim is checked against the passages"];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), 7000);
    return () => clearInterval(t);
  }, [steps.length]);
  return (
    <Card className="mx-auto max-w-3xl">
      <ol className="space-y-2 p-5 text-sm">
        {steps.map((s, k) => (
          <li key={s} className={clsx("flex items-center gap-2", k <= i ? "text-ink" : "text-ink-3")}>
            {k < i ? <CircleCheck className="size-4 text-[#0ca30c]" /> : k === i ? <Loader2 className="size-4 animate-spin text-accent" /> : <span className="size-4 rounded-full border border-line" />}
            {s}
          </li>
        ))}
        <li className="pt-1 text-xs text-ink-3">About 20 seconds.</li>
      </ol>
    </Card>
  );
}

export default function CheckPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "self" ? "self" : "ai";
  return (
    <div className="space-y-6">
      <div className="mx-auto max-w-3xl pt-4 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-accent">Fact check · neutral point of view</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
          {tab === "ai" ? "Does Wikipedia agree with the AI?" : "Does Wikipedia contradict itself?"}
        </h1>
        <div className="mt-4 flex justify-center">
          <Segmented label="Check" value={tab} onChange={(v) => setParams({ tab: v })}
            options={[{ value: "ai", label: "AI vs Wikipedia" }, { value: "self", label: "Wikipedia vs itself" }]} />
        </div>
      </div>
      {tab === "ai" ? <AiCheck /> : <ContradictionsPanel />}
    </div>
  );
}

const LANG_LABEL = { fi: "Finnish", sv: "Swedish", en: "English" } as const;

function Evidence({ c }: { c: CheckedClaim }) {
  const [open, setOpen] = useState(false);
  const p = c.passage!;
  return (
    <div className="rounded-lg border border-line bg-surface-2/40 px-4 py-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span className="font-medium uppercase tracking-wide">Wikipedia says</span>
        <LangBadge lang={p.lang} size="xs" />
        <span className="font-medium text-ink">{p.title}</span>
        <a href={p.oldid_url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 font-medium text-accent hover:underline">
          revision {p.rev_id} <ArrowUpRight className="size-3" />
        </a>
      </div>
      {c.quote_en && <p className="text-[15px] leading-relaxed text-ink">“{c.quote_en}”</p>}
      {c.quote && p.lang !== "en" && (
        <p className="mt-1 text-[13px] text-ink-3"><span className="mr-1 text-[11px] font-medium uppercase tracking-wide">Original ({LANG_LABEL[p.lang]}):</span>{c.quote}</p>
      )}
      <button onClick={() => setOpen(!open)} className="mt-2 text-xs font-medium text-ink-2 hover:text-ink">{open ? "Hide" : "Show"} the full passage</button>
      {open && <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{displayText(p.text)}</p>}
    </div>
  );
}
