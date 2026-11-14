import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowUpRight, Search } from "lucide-react";
import clsx from "clsx";
import { api2, type GapPassage, type Lang } from "../api";
import { Card, LANG_NAME, LANG_VAR, LangBadge, Spinner, SqlPanel, displayText, nf } from "../ui";

const LANGS: Lang[] = ["fi", "sv", "en"];

export default function LanguagesPage() {
  const { qid } = useParams();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const hits = useQuery({ queryKey: ["topics", q], queryFn: () => api2.topics(q), enabled: q.trim().length >= 2 });
  const fallback = useQuery({ queryKey: ["topics", "sisällissota"], queryFn: () => api2.topics("Suomen sisällissota"), enabled: !qid });
  useEffect(() => {
    if (!qid && fallback.data?.[0]) nav(`/languages/${fallback.data[0].wikidata_id}`, { replace: true });
  }, [qid, fallback.data, nav]);
  const gaps = useQuery({ queryKey: ["gaps", qid], queryFn: () => api2.gaps(qid!), enabled: !!qid });
  const [onlyUnique, setOnlyUnique] = useState(true);
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-accent">Compare language editions · vector search inside MariaDB</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">What does each Wikipedia say that the others don't?</h1>
          <p className="mt-2 max-w-3xl text-sm text-ink-2">
            Every passage of the Finnish, Swedish and English articles on the same topic is matched to its nearest passage
            in the other two languages by meaning (multilingual bge-m3). A passage with no close counterpart is a blind spot of the other editions.
          </p>
        </div>
        <div className="relative w-full max-w-sm">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-1 px-3 py-2 focus-within:border-accent">
            <Search className="size-4 text-ink-3" />
            <input value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} placeholder="Topic (e.g. Talvisota, Mannerheim)"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3" aria-label="Find a topic" />
          </div>
          {q.trim().length >= 2 && hits.data && hits.data.length === 0 && !hits.isFetching && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-ink-3 shadow-lg">
              No topic with all three languages matches “{q.trim()}”. Try “Talvisota” or “Mannerheim”.
            </div>
          )}
          {hits.data && hits.data.length > 0 && q && (
            <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-line bg-surface-1 py-1 shadow-lg">
              {hits.data.map((t) => (
                <li key={t.wikidata_id}>
                  <button onClick={() => { setQ(""); nav(`/languages/${t.wikidata_id}`); }}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-2">
                    <div className="text-ink">{t.fi_title}</div>
                    <div className="truncate text-xs text-ink-3">{t.sv_title} · {t.en_title}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {gaps.isLoading && <Spinner label="Aligning passages across languages" />}
      {gaps.error && (
        <Card>
          <div className="p-5 text-sm text-ink-2">
            This topic is not in the dataset (or not available in Finnish, Swedish and English).{" "}
            <button className="font-medium text-accent hover:underline" onClick={() => nav("/languages")}>Show the 1918 civil war instead</button>
          </div>
        </Card>
      )}
      {gaps.data && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {LANGS.filter((l) => gaps.data.languages[l]).map((l) => {
              const g = gaps.data.languages[l]!;
              const a = gaps.data.articles.find((x) => x.lang === l)!;
              const share = g.total ? g.unique / g.total : 0;
              return (
                <Card key={l}>
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <LangBadge lang={l} />
                      <a href={`https://${l}.wikipedia.org/?oldid=${a.rev_id}`} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-accent hover:underline">rev {a.rev_id}<ArrowUpRight className="size-3" /></a>
                    </div>
                    <div className="mt-2 truncate text-[15px] font-semibold text-ink">{a.title}</div>
                    <div className="mt-3 flex items-baseline gap-2">
                      <span className="tabular text-2xl font-semibold text-ink">{g.unique}</span>
                      <span className="text-sm text-ink-2">of {nf.format(g.total)} passages found only in {LANG_NAME[l]}</span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-surface-2" aria-hidden>
                      <div className="h-1.5 rounded-full" style={{ width: `${share * 100}%`, background: LANG_VAR[l] }} />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
          <div className="flex items-center justify-between">
            <label className="inline-flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={onlyUnique} onChange={(e) => setOnlyUnique(e.target.checked)} className="accent-[var(--accent)]" />
              Show only passages without a counterpart (cosine distance &gt; {gaps.data.threshold})
            </label>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {LANGS.filter((l) => gaps.data.languages[l]).map((l) => (
              <div key={l} className="space-y-2">
                {gaps.data.languages[l]!.passages.filter((p) => !onlyUnique || p.only_here).slice(0, showAll ? 500 : 12).map((p) => (
                  <PassageCard key={p.chunk_idx} lang={l} p={p} />
                ))}
              </div>
            ))}
          </div>
          <div className="text-center">
            <button onClick={() => setShowAll(!showAll)} className="rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-sm text-ink-2 hover:text-ink">
              {showAll ? "Show fewer" : "Show all passages"}
            </button>
          </div>
          <SqlPanel title="Passages and vectors of the three articles (one query)" sql={gaps.data.sql}
            timings={[{ label: "SQL", ms: gaps.data.timings.sql_ms }]} />
        </>
      )}
    </div>
  );
}

export function PassageCard({ lang, p }: { lang: Lang; p: GapPassage }) {
  const [open, setOpen] = useState(false);
  const others = Object.entries(p.matches) as [Lang, NonNullable<GapPassage["matches"][Lang]>][];
  return (
    <div className={clsx("rounded-xl border bg-surface-1 p-3 text-[13px] leading-relaxed",
      p.only_here ? "border-line-strong" : "border-line opacity-70")}
      style={p.only_here ? { borderLeft: `3px solid ${LANG_VAR[lang]}` } : undefined}>
      {p.section && <div className="mb-1 truncate text-[11px] font-medium text-ink-3">{p.section}</div>}
      <p className="text-ink-2">{displayText(p.text).slice(0, open ? 4000 : 360)}{!open && p.text.length > 360 ? "…" : ""}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
        {p.only_here && <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-medium text-ink">only in {LANG_NAME[lang]}</span>}
        {others.map(([l, m]) => (
          <span key={l} className="tabular inline-flex items-center gap-1"><LangBadge lang={l} size="xs" /> d={m.distance.toFixed(2)}</span>
        ))}
        <button onClick={() => setOpen(!open)} className="ml-auto text-accent hover:underline">{open ? "less" : "nearest matches"}</button>
      </div>
      {open && others.map(([l, m]) => (
        <div key={l} className="mt-2 rounded-md bg-surface-2/60 p-2 text-[12px] text-ink-2">
          <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-ink-3"><LangBadge lang={l} size="xs" /> {m.section ?? "intro"} · d={m.distance.toFixed(3)}</div>
          {displayText(m.text)}
        </div>
      ))}
    </div>
  );
}
