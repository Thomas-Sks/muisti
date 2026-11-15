// Typed client for the Muisti API (backend/api.py). Vite proxies /api to the FastAPI server.

export type Lang = "fi" | "sv" | "en";
export type Mode = "hybrid" | "vector" | "keyword";

export interface Passage {
  chunk_id: number;
  lang: Lang;
  page_id: number;
  chunk_idx: number;
  section: string | null;
  text: string;
  title: string;
  url: string;
  rev_id: number;
  wikidata_id: string | null;
  date_modified: string | null;
  score: number;
  v_rank: number | null;
  k_rank: number | null;
  distance: number | null;
  oldid_url: string;
}

export interface Group {
  key: string;
  wikidata_id: string | null;
  score: number;
  best: Passage;
  by_lang: Partial<Record<Lang, Passage>>;
}

export interface SearchResponse {
  query: string;
  mode: Mode;
  groups: Group[];
  passages: Passage[];
  sql: string;
  timings: { embed_ms: number; sql_ms: number };
}

export interface Stats {
  articles_by_lang: Record<Lang, number>;
  passages: number;
  passage_vectors: number;
  article_vectors: number;
  topics_all_three: number;
  history_articles: number;
  versions: number;
  history_range: { first: string | null; last: string | null };
}

export interface ArticleHit { page_id: number; title: string; versions: number }

export interface Month {
  month: string; edits: number; reverts: number; named_reverts: number;
  anonymous_edits: number; editors: number; len: number;
}
export interface YearWar {
  year: number; edits: number; editors: number; reverts: number; named_reverts: number;
  mutual_pairs: number; controversy_m: number;
}
export interface Revert {
  rev_id: number; ts: string; user: string | null; anonymous: number;
  reverted_user: string | null; reverted_anonymous: number; comment: string | null; delta: number | null;
}
export interface Editor { user: string | null; anonymous: number; edits: number; reverts: number; first_edit: string; last_edit: string }

export interface Timeline {
  article: { page_id: number; title: string; len: number; last_edit: string; versions: number; first_edit: string };
  monthly: Month[];
  yearly: YearWar[];
  reverts: Revert[];
  editors: Editor[];
  sql: { monthly: string; yearly: string };
  timings: Record<string, number>;
}

export interface Block { kind: "h" | "p" | "li"; text: string }
export interface Version {
  page_id: number; title: string; rev_id: number; parent_id: number | null; user: string | null;
  anonymous: number; comment: string | null; len: number; row_start: string; row_end: string; oldid_url: string;
}
export interface AsOf {
  requested: string;
  notice: string | null;
  version: Version;
  neighbours: { prev_ts: string | null; next_ts: string | null; version_no: number; versions: number };
  blocks: Block[];
  sql: string;
  timings: { as_of_ms: number; neighbours_ms: number };
}

export type DiffBlock =
  | { op: "same"; count: number; kind: string }
  | { op: "changed"; kind: string; words: { op: "eq" | "ins" | "del"; text: string }[] }
  | { op: "added"; kind: string; text: string }
  | { op: "removed"; kind: string; text: string };

export interface Diff {
  from: Version; to: Version;
  stats: { unchanged: number; changed: number; added: number; removed: number };
  blocks: DiffBlock[];
  timings: { from_ms: number; to_ms: number };
}

export interface Controversial {
  articles: { page_id: number; title: string; controversy_m: number; mutual_pairs: number; named_reverts: number;
    reverts: number; edits: number; peak_year: number }[];
  heatmap: { page_id: number; year: number; controversy_m: number; named_reverts: number; edits: number }[];
  sql: string;
  timings: { sql_ms: number };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) {
    let detail: unknown = r.statusText;
    try { detail = (await r.json()).detail ?? detail; } catch { /* not JSON */ }
    // FastAPI validation errors are arrays of objects: turn them into one readable sentence.
    if (Array.isArray(detail)) detail = "That input is not valid here: " + detail.map((d) => d?.msg ?? "").filter(Boolean).join("; ").toLowerCase();
    if (r.status >= 500) detail = "The server had a problem with this request. Try again, or change the input.";
    throw new Error(typeof detail === "string" ? detail : "Something went wrong.");
  }
  return r.json() as Promise<T>;
}

export const api = {
  stats: () => req<Stats>("/api/stats"),
  search: (q: string, mode: Mode, lang: Lang | null) =>
    req<SearchResponse>("/api/search", { method: "POST", body: JSON.stringify({ q, mode, lang, limit: 40 }) }),
  articles: (prefix: string) => req<ArticleHit[]>(`/api/articles?prefix=${encodeURIComponent(prefix)}`),
  timeline: (pageId: number) => req<Timeline>(`/api/articles/${pageId}/timeline`),
  asOf: (pageId: number, ts: string) => req<AsOf>(`/api/articles/${pageId}/as-of?ts=${encodeURIComponent(ts)}`),
  diff: (pageId: number, from: string, to: string) =>
    req<Diff>(`/api/articles/${pageId}/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  controversial: (y0: number, y1: number) => req<Controversial>(`/api/editors/controversial?y0=${y0}&y1=${y1}&limit=25`),
};

export interface FactRun {
  field: string; value: string; num: number | null; rev_id: number;
  valid_from: string; valid_to: string; valid_known: number; row_start: string; row_end: string;
}
export interface FactField { field: string; label: string; runs: FactRun[]; changes: number; current: string | null }
export interface Facts { fields: FactField[]; sql: string; timings: { sql_ms: number } }
export interface Bitemporal {
  said_at: string; event_date: string;
  facts: (FactRun & { label: string })[];
  sql: string; timings: { sql_ms: number };
}
export interface MostRevised {
  facts: { page_id: number; title: string; field: string; label: string; versions: number; distinct_numbers: number;
    min_num: number; max_num: number; first_stated: string; last_changed: string }[];
  sql: string; timings: { sql_ms: number };
}
export interface Drift {
  years: { year: number; rev_id: number; ts: string; len: number; d_prev: number | null; d_now: number }[];
  sql: string; timings: { sql_ms: number };
}
export interface PastResult {
  snap_chunk_id: number; page_id: number; year: number; rev_id: number; section: string | null; text: string;
  title: string; d: number; oldid_url: string;
  now: { snap_chunk_id: number; section: string | null; text: string; rev_id: number; d: number } | null;
}
export interface PastSearch {
  query: string; year: number; results: PastResult[]; sql: string; sql_now: string;
  timings: { search_ms: number; now_ms: number };
}
export interface TopicHit { wikidata_id: string; fi_title: string; sv_title: string; en_title: string; fi_len: number; sv_len: number; en_len: number }
export interface GapPassage {
  chunk_id: number; chunk_idx: number; section: string | null; text: string; only_here: boolean;
  matches: Partial<Record<Lang, { distance: number; chunk_idx: number; section: string | null; text: string }>>;
}
export interface Gaps {
  wikidata_id: string;
  articles: { lang: Lang; page_id: number; title: string; url: string; rev_id: number }[];
  languages: Partial<Record<Lang, { passages: GapPassage[]; unique: number; total: number }>>;
  threshold: number; sql: string; timings: { sql_ms: number };
}

export const api2 = {
  facts: (pageId: number) => req<Facts>(`/api/articles/${pageId}/facts`),
  bitemporal: (pageId: number, saidAt: string, eventDate: string) =>
    req<Bitemporal>(`/api/articles/${pageId}/facts/as-of?said_at=${encodeURIComponent(saidAt)}&event_date=${encodeURIComponent(eventDate)}`),
  mostRevised: () => req<MostRevised>("/api/facts/most-revised?limit=15"),
  drift: (pageId: number) => req<Drift>(`/api/articles/${pageId}/drift`),
  searchPast: (q: string, year: number) => req<PastSearch>("/api/search/past", { method: "POST", body: JSON.stringify({ q, year }) }),
  topics: (prefix: string) => req<TopicHit[]>(`/api/topics?prefix=${encodeURIComponent(prefix)}`),
  gaps: (qid: string) => req<Gaps>(`/api/topics/${qid}/gaps`),
};

export interface WarSummary {
  page_id: number; title: string; year: number; controversy_m: number; mutual_pairs: number;
  named_reverts: number; edits: number; editors: number;
}
export interface Hunk { before: string; removed: string; added: string; after: string }
export interface Dispute {
  key: string; toggles: number; editors: string[]; first: string; last: string; hunk: Hunk; final_rev: number;
  events: { rev_id: number; ts: string; user: string; reverted_user: string; comment: string | null }[];
}
export interface War {
  page_id: number; title: string; year: number; reverts: number; disputes: Dispute[];
  sql: string; sql_texts: string; timings: { events_ms: number; texts_ms: number };
}

export const api3 = {
  wars: () => req<{ wars: WarSummary[]; sql: string; timings: { sql_ms: number } }>("/api/wars?limit=20"),
  war: (pageId: number, year: number) => req<War>(`/api/wars/${pageId}/${year}`),
};

export interface CheckedClaim {
  claim: string; verdict: "supported" | "contradicted" | "not_found"; explanation: string; quote: string; quote_en: string;
  passage: { chunk_id: number; lang: Lang; title: string; section: string | null; text: string; rev_id: number; oldid_url: string } | null;
}
export interface Check {
  question: string; model: string; answer: string; claims: CheckedClaim[];
  counts: { supported: number; contradicted: number; not_found: number };
  timings: { llm_answer_s: number; mariadb_ms: number; llm_judge_s: number };
}
export const api4 = {
  check: (q: string) => req<Check>("/api/check", { method: "POST", body: JSON.stringify({ q }) }),
};

export interface Origin {
  found: boolean; page_id: number; versions: number; version_no?: number; message?: string;
  origin?: { rev_id: number; ts: string; user: string | null; anonymous: boolean; comment: string | null; diff_url: string; oldid_url: string };
  first_wording?: string | null; similarity?: number; reworded?: boolean;
  steps: { index: number; ts: string; similarity: number }[];
  sql?: string; timings: { total_s: number };
}
export const api5 = {
  origin: (pageId: number, text: string, upto: string | null) =>
    req<Origin>(`/api/articles/${pageId}/origin`, { method: "POST", body: JSON.stringify({ text, upto }) }),
};

export interface ContraPassage { chunk_id: number; lang: Lang; page_id: number; title: string; section: string | null; text: string; rev_id: number; oldid_url: string }
export interface SqlCheck { status: "checked" | "mismatch" | "none"; values: { surface: string; value: string | number; kind: "number" | "date"; found: boolean }[] }
export interface Contradictions {
  article: { lang: Lang; page_id: number; title: string; rev_id: number; url: string };
  model: string; pairs_checked: number;
  contradictions: { topic: string; value_a: string; value_b: string; explanation: string; distance: number;
    quote_a: string; quote_b: string; quote_a_en: string; quote_b_en: string; a: ContraPassage; b: ContraPassage;
    days?: number; same_event?: boolean; verified?: boolean; kind?: "date" | "number";
    sql_check?: { a: SqlCheck; b: SqlCheck } }[];
  rejected?: Contradictions["contradictions"];
  same_topic?: Contradictions["contradictions"];   // differences with the other editions of the same topic
  method?: string; date_candidates?: number; number_pairs?: number;
  sql: string; timings: { mariadb_ms: number; llm_s: number; total_s: number };
}
export const api6 = {
  contradictions: (lang: Lang, pageId: number) => req<Contradictions>(`/api/contradictions/${lang}/${pageId}`),
  sArticles: (prefix: string) => req<{ lang: Lang; page_id: number; title: string; passages: number }[]>(`/api/s-articles?prefix=${encodeURIComponent(prefix)}`),
};

// ── Writer workspace ──
export interface TopicHitW {
  wikidata_id: string | null; title: string; comparable: boolean;
  languages: Partial<Record<Lang, { page_id: number; title: string; len: number | null; date_modified: string | null }>>;
}
export interface TopicOverview {
  wikidata_id: string;
  articles: { lang: Lang; page_id: number; title: string; rev_id: number; url: string; date_modified: string | null; len: number; passages: number; sections: number; oldid_url: string }[];
  history: { versions: number; first_edit: string; last_edit: string; reverts: number; named_reverts: number } | null;
  analyses: Record<string, string>;
}
export interface FramingQuote { lang: Lang; quote: string; translation: string; loaded_words: string[]; verified: boolean }
export interface FramingDiff {
  group_index: number; kind: "loaded_wording" | "agency_blame" | "certainty" | "naming" | "emphasis";
  severity: "high" | "medium" | "low"; title: string; explanation: string; quotes: FramingQuote[];
}
export interface FramingPassage { chunk_id: number; lang: Lang; title: string; section: string | null; text: string; rev_id: number; oldid_url: string }
export interface Framing {
  available: boolean; reason?: string; pending?: boolean;
  wikidata_id?: string; model?: string; overall?: string;
  profiles?: { lang: Lang; profile: string }[];
  differences?: FramingDiff[];
  groups?: Partial<Record<Lang, FramingPassage>>[];
  counts?: Record<string, number>;
  usage?: { input_tokens: number; output_tokens: number };
  timings?: { mariadb_ms: number; llm_s: number };
  cached?: boolean; computed_at?: string | null; seconds?: number;
}
export const wapi = {
  search: (q: string) => req<{ query: string; topics: TopicHitW[]; timings: { total_ms: number } }>(`/api/topics/search?q=${encodeURIComponent(q)}`),
  topic: (qid: string) => req<TopicOverview>(`/api/topic/${qid}`),
  framing: (qid: string, opts: { refresh?: boolean; cachedOnly?: boolean } = {}) =>
    req<Framing>(`/api/topic/${qid}/framing?refresh=${opts.refresh ? 1 : 0}&cached_only=${opts.cachedOnly ? 1 : 0}`),
};

export interface FactValue { lang: Lang; value: string; quote: string; translation: string; verified: boolean; sql_check?: SqlCheck }
export interface Fact {
  group_index: number; subject: string; category: "date" | "number" | "person" | "place" | "outcome" | "other";
  status: "agree" | "differ" | "missing"; values: FactValue[]; missing_in: Lang[]; note: string;
}
export interface FactsResult {
  available: boolean; reason?: string; pending?: boolean; model?: string;
  facts?: Fact[]; groups?: Partial<Record<Lang, FramingPassage>>[];
  counts?: { differ: number; missing: number; agree: number };
  usage?: { input_tokens: number; output_tokens: number }; timings?: { mariadb_ms: number; llm_s: number };
  cached?: boolean; computed_at?: string | null; seconds?: number;
}
export const wapi2 = {
  facts: (qid: string, opts: { refresh?: boolean; cachedOnly?: boolean } = {}) =>
    req<FactsResult>(`/api/topic/${qid}/facts?refresh=${opts.refresh ? 1 : 0}&cached_only=${opts.cachedOnly ? 1 : 0}`),
  translate: (chunkId: number) => req<{ chunk_id: number; translation: string; cached: boolean }>(`/api/passages/${chunkId}/translate`, { method: "POST" }),
};

export const wapi3 = {
  missing: (qid: string, target: Lang) => req<{ target: Lang; summaries: Record<string, string>; sections: Record<string, string>; cached: boolean }>(`/api/topic/${qid}/missing?target=${target}`),
};

// ── Related articles map ──
export interface RelatedNode { lang: Lang; page_id: number; title: string; wikidata_id: string | null; distance?: number; languages?: number; contradictions: number | null }
export interface Related { article: RelatedNode; related: RelatedNode[]; sql: string; timings: { sql_ms: number } }
export const wapi4 = {
  related: (lang: Lang, pageId: number) => req<Related>(`/api/related/${lang}/${pageId}?limit=8`),
  contradictions: (lang: Lang, pageId: number, refresh = false) =>
    req<Contradictions & { cached: boolean }>(`/api/contradictions-stored/${lang}/${pageId}?refresh=${refresh ? "true" : "false"}`),
};

// ── Stale facts: when the Finnish article started saying its value ──
export interface StaleItem {
  fact_index: number; group_index: number; subject: string; value: string; quote: string; others: { lang: Lang; value: string }[];
  traceable: boolean; reason?: string; strip?: { year: number; present: boolean }[]; changes?: number;
  since?: string; years_unchanged?: number; stale?: boolean; first_in_history?: boolean; before?: string | null;
  edit?: { rev_id: number; user: string | null; anonymous: boolean; comment: string | null; diff_url: string } | null;
  search_steps?: number; timings?: { years_sql_ms: number; total_ms: number };
}
export interface Stale {
  available: boolean; reason?: string; page_id?: number; items?: StaleItem[]; stale_years?: number;
  sql?: string; timings?: { total_s: number }; cached?: boolean;
}
export const wapi5 = {
  stale: (qid: string) => req<Stale>(`/api/topic/${qid}/stale`),
};

// ── Editor workspace ──
export type IssueType = "fact" | "wording" | "contradiction" | "missing";
export type IssueStatus = "open" | "fixed" | "dismissed";
export interface WsPassage { chunk_id: number; chunk_idx: number; section: string | null; text: string }
export interface WsOtherPassage extends WsPassage { match_idx: number | null; distance: number | null }
export interface WsIssue {
  id: string; type: IssueType; severity: "high" | "medium" | "low"; title: string; status_label: string;
  provenance: "sql" | "claude" | "sql+claude" | "claude+sql"; chunk_id: number | null; start: number | null; end: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail: any;
}
export interface WsArticle { lang: Lang; page_id: number; title: string; rev_id: number }
export interface Workspace {
  wikidata_id: string; lang: Lang; article: WsArticle; articles: WsArticle[];
  passages: WsPassage[]; issues: WsIssue[]; status: Record<string, { status: IssueStatus; note: string | null }>;
  pending: { facts: boolean; wording: boolean; contradictions: boolean; summaries: boolean };
  other_passages: Partial<Record<Lang, WsOtherPassage[]>>; covered: number;
  compare?: Partial<Record<Lang, Partial<Record<Lang, CompareMark[]>>>>;
}
export interface CompareMark {
  chunk_id: number; start: number; end: number; key: string; type: "differ" | "only" | "wording";
  title: string; value: string | null; vs: string | null;
}
export const wapi6 = {
  workspace: (qid: string, lang: Lang) => req<Workspace>(`/api/topic/${qid}/workspace?lang=${lang}`),
  setStatus: (qid: string, issueId: string, lang: Lang, status: IssueStatus) =>
    req<{ ok: boolean }>(`/api/topic/${qid}/issues/${encodeURIComponent(issueId)}`, { method: "PUT", body: JSON.stringify({ lang, status }) }),
};
