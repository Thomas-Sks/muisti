import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Fingerprint, Loader2, X } from "lucide-react";
import { api5 } from "../api";
import { Card, SqlPanel, fmtDate, nf } from "../ui";
import { wordDiff } from "../diff";

export default function OriginPanel({ pageId, text, upto, onClose }: {
  pageId: number; text: string; upto: string | null; onClose: () => void;
}) {
  const q = useQuery({ queryKey: ["origin", pageId, text, upto], queryFn: () => api5.origin(pageId, text, upto), retry: false, staleTime: Infinity });
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Fingerprint className="size-4 text-accent" /> Where did this passage come from?</span>}
      action={<button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"><X className="size-4" /></button>}
      subtitle="binary search over the system-versioned history, matching by meaning (bge-m3)">
      <div className="space-y-3 p-5 text-sm">
        <p className="line-clamp-3 text-xs italic text-ink-3">“{text}”</p>
        {q.isFetching && (
          <p className="flex items-center gap-2 text-ink-2"><Loader2 className="size-4 animate-spin" /> Searching the versions… (a few seconds)</p>
        )}
        {q.error && <p className="text-[var(--del-text)]">{q.error instanceof Error ? q.error.message : "Could not trace this passage."}</p>}
        {q.data && !q.isFetching && !q.data.found && <p className="text-ink-2">{q.data.message}</p>}
        {q.data && !q.isFetching && q.data.found && q.data.origin && (
          <>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">First appeared</div>
              <div className="mt-0.5 text-base font-semibold text-ink">{fmtDate(q.data.origin.ts, true)}</div>
              <div className="text-ink-2">
                in version {nf.format(q.data.version_no ?? 0)} of {nf.format(q.data.versions)}, by <b className="text-ink">{q.data.origin.user ?? "unknown"}</b>
                {q.data.origin.anonymous ? " (anonymous)" : ""}
              </div>
              {q.data.origin.comment && <div className="mt-1 text-xs italic text-ink-3">edit summary: “{q.data.origin.comment.slice(0, 140)}”</div>}
              <a href={q.data.origin.diff_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                see that edit on Wikipedia <ArrowUpRight className="size-3" />
              </a>
            </div>
            {q.data.first_wording && (
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
                  {q.data.reworded ? "First wording → wording shown now" : "Unchanged since then"}
                </div>
                <p className="mt-1 rounded-lg border border-line bg-surface-2/40 p-3 leading-relaxed text-ink-2">
                  {q.data.reworded
                    ? wordDiff(q.data.first_wording, text).map((d, k) =>
                        d.op === "eq" ? <span key={k}>{d.w} </span>
                          : d.op === "del" ? <del key={k} className="rounded bg-[var(--del-bg)] px-0.5 text-[var(--del-text)]">{d.w} </del>
                          : <ins key={k} className="rounded bg-[var(--ins-bg)] px-0.5 text-[var(--ins-text)] no-underline">{d.w} </ins>)
                    : q.data.first_wording}
                </p>
              </div>
            )}
            <p className="text-xs text-ink-3">{q.data.steps.length} versions read · {q.data.timings.total_s} s · similarity {q.data.similarity}</p>
            {q.data.sql && <SqlPanel title="Versions read during the search" sql={q.data.sql} />}
          </>
        )}
      </div>
    </Card>
  );
}
