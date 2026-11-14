// Word-level diff (LCS). Inputs are short (a sentence or a paragraph), capped at 400 words.
export type WordOp = { op: "eq" | "del" | "ins"; w: string };

export function wordDiff(a: string, b: string): WordOp[] {
  const x = a.split(/\s+/).filter(Boolean).slice(0, 400);
  const y = b.split(/\s+/).filter(Boolean).slice(0, 400);
  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: WordOp[] = [];
  let i = 0, j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { out.push({ op: "eq", w: x[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: "del", w: x[i++] });
    else out.push({ op: "ins", w: y[j++] });
  }
  while (i < x.length) out.push({ op: "del", w: x[i++] });
  while (j < y.length) out.push({ op: "ins", w: y[j++] });
  return out;
}

/** The words of `a` marked as differing from `b` (for showing two versions side by side). */
export function sideDiff(a: string, b: string): { w: string; diff: boolean }[] {
  return wordDiff(a, b).filter((d) => d.op !== "ins").map((d) => ({ w: d.w, diff: d.op === "del" }));
}
