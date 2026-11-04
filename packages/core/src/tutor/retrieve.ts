import type { PlanTopic, TutorAction } from "../types";
import { answerRank, pageKind } from "./page-role";
import type { Excerpt, FigureNote, Material } from "./prompts";

// Which pages of a session's files go into the tutor's prompt, and how much
// of each. The same choice on the server and on the device: only where the
// pages come from differs (a PageSource).

// Rough budget for document text in a prompt (~3k tokens). Tight, relevant
// context beats "everything", on any provider's rate limits.
const TOTAL_BUDGET = 11_000;

export type PageHit = { document_id: string; page_number: number; content: string };
export type FigureRow = { id: string; document_id: string; page_number: number; vlm_description: string };

export interface PageSource {
  pages(docId: string, pages: number[]): Promise<PageHit[]>;
  searchDoc(docId: string, query: string, limit: number): Promise<PageHit[]>;
  searchSession(sessionId: string, query: string, limit: number): Promise<PageHit[]>;
  // Pages after (ascending) or before (descending) a page, for finding where a question is answered.
  after(docId: string, page: number, limit: number): Promise<PageHit[]>;
  before(docId: string, page: number, limit: number): Promise<PageHit[]>;
  // Notes on captured figures in these files, newest first.
  figures(docIds: string[], limit: number): Promise<FigureRow[]>;
}

export type PageRef = { docId: string; page: number; reason: string; max: number };

const STOPWORDS = new Set(
  "the a an and or of to in on for is are was were be been it this that with as by at from what why how which can does do i me my about into than then there their".split(" "),
);

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9α-ω]+/i)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// Cut a page down to `max` chars, centred on the densest cluster of query terms.
export function windowed(text: string, query: string, max: number): string {
  const clean = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= max) return clean;
  const lower = clean.toLowerCase();
  let best = 0;
  let bestScore = -1;
  const step = Math.max(200, Math.floor(max / 4));
  const ts = terms(query);
  for (let start = 0; start < clean.length - max / 2; start += step) {
    const slice = lower.slice(start, start + max);
    const score = ts.reduce((s, t) => s + (slice.includes(t) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = start;
    }
  }
  const start = Math.max(0, Math.min(best, clean.length - max));
  return `${start > 0 ? "…" : ""}${clean.slice(start, start + max)}${start + max < clean.length ? "…" : ""}`;
}

// One page from each file, then the next, so the first file can't use up the budget.
function interleave(buckets: PageHit[][]): PageHit[] {
  const depth = Math.max(0, ...buckets.map((b) => b.length));
  const hits: PageHit[] = [];
  for (let i = 0; i < depth; i++) for (const bucket of buckets) if (bucket[i]) hits.push(bucket[i]);
  return hits;
}

// Search each chosen file on its own. A session-wide search returns the
// strongest pages overall, which are usually the file already open.
async function searchChosen(src: PageSource, docIds: string[], query: string): Promise<PageHit[]> {
  const n = docIds.length;
  const limit = n <= 1 ? 5 : n === 2 ? 4 : n <= 4 ? 3 : 2;
  const q = query.slice(0, 500);
  return interleave(await Promise.all(docIds.map((docId) => src.searchDoc(docId, q, limit))));
}

export type RetrieveInput = {
  sessionId: string;
  materials: Material[];
  action: TutorAction;
  query: string;
  current: { docId: string; page: number } | null;
  focus: { docId: string; page: number } | null; // page of a selection or captured figure
  topic: PlanTopic | null;
  highlightId: string | null;
  extraPages?: PageRef[]; // pages a paper pass always needs
  scopeIds?: string[] | null; // files turned on for this question; null searches the whole session
};

export async function retrieveContext(src: PageSource, input: RetrieveInput): Promise<{ excerpts: Excerpt[]; figures: FigureNote[] }> {
  const { sessionId, materials, action, query, current, focus, topic, highlightId, extraPages = [], scopeIds = null } = input;
  const labelOf = new Map(materials.map((m) => [m.id, m.label]));
  const allowed = scopeIds?.length ? new Set(scopeIds) : null;
  const inScope = (id: string) => !allowed || allowed.has(id);
  const many = (allowed?.size ?? 0) > 1;

  // Pages we always want, in priority order.
  const wanted: PageRef[] = [];
  if (focus && inScope(focus.docId)) wanted.push({ ...focus, reason: "page of the highlighted passage", max: many ? 2200 : 3500 });
  if (current && inScope(current.docId) && !(focus && focus.docId === current.docId && focus.page === current.page)) {
    wanted.push({ ...current, reason: "page the student is reading", max: many ? 1400 : 2200 });
  }
  if (topic?.document_id && inScope(topic.document_id) && topic.page_start && topic.page_end && (action === "teach" || action === "quiz" || action === "diagram")) {
    for (let p = topic.page_start; p <= Math.min(topic.page_end, topic.page_start + 2); p++) {
      wanted.push({ docId: topic.document_id, page: p, reason: "current topic", max: many ? 1600 : 2500 });
    }
  }
  wanted.push(...extraPages);

  const byDoc = new Map<string, number[]>();
  for (const w of wanted) byDoc.set(w.docId, [...(byDoc.get(w.docId) ?? []), w.page]);

  const [fixedRows, hits] = await Promise.all([
    Promise.all([...byDoc].map(([docId, pages]) => src.pages(docId, pages))),
    query.trim() ? (allowed ? searchChosen(src, [...allowed], query) : src.searchSession(sessionId, query.slice(0, 500), 5)) : Promise.resolve([] as PageHit[]),
  ]);

  const key = (docId: string, page: number) => `${docId}:${page}`;
  const fixed = new Map<string, string>();
  for (const rows of fixedRows) for (const row of rows) fixed.set(key(row.document_id, row.page_number), row.content);

  const excerpts: Excerpt[] = [];
  const seen = new Set<string>();
  let used = 0;

  const push = (docId: string, page: number, text: string, reason: string, max: number) => {
    const k = key(docId, page);
    const label = labelOf.get(docId);
    if (!label || seen.has(k) || !text?.trim() || used >= TOTAL_BUDGET) return;
    const kind = pageKind(text);
    // A question sheet is only there so the answer pages can be told apart from it.
    const cap = kind === "question" ? Math.min(max, 700) : max;
    const cut = windowed(text, query, Math.min(cap, TOTAL_BUDGET - used));
    const stated = kind === "question" ? "asks the question. Do not cite this page for the answer" : kind === "answer" ? "where the answer is written" : reason;
    seen.add(k);
    used += cut.length;
    excerpts.push({ label, page, text: cut, reason: stated, kind });
  };

  // The page of questions ranks first (it matches the wording, and it is often
  // the page on screen). Pull in the later pages that actually write the answer.
  const questionAt = new Map<string, number>();
  const noteQuestion = (docId: string, page: number, text: string) => {
    if (!inScope(docId) || pageKind(text) !== "question") return;
    const prev = questionAt.get(docId);
    if (prev == null || page < prev) questionAt.set(docId, page);
  };
  for (const w of wanted) {
    const text = fixed.get(key(w.docId, w.page));
    if (text) noteQuestion(w.docId, w.page, text);
  }
  for (const r of hits) noteQuestion(r.document_id, r.page_number, r.content);

  const haveAnswer = (docId: string) =>
    [...hits.filter((h) => h.document_id === docId).map((h) => h.content), ...wanted.filter((w) => w.docId === docId).map((w) => fixed.get(key(w.docId, w.page)) ?? "")].some(
      (text) => answerRank(text, query) >= 8,
    );
  const best = (rows: PageHit[]) =>
    rows
      .map((row) => ({ row, rank: answerRank(row.content, query) }))
      .filter((x) => x.rank >= 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 3)
      .map((x) => x.row);

  const answerHits: PageHit[] = [];
  if (questionAt.size) {
    const more = await Promise.all(
      [...questionAt]
        .filter(([docId]) => !haveAnswer(docId))
        .map(async ([docId, at]) => {
          const picked = best(await src.after(docId, at, 24));
          return picked.length ? picked : best(await src.before(docId, at, 12));
        }),
    );
    for (const rows of more) answerHits.push(...rows);
  }

  for (const row of answerHits) push(row.document_id, row.page_number, row.content, "where the answer is written", many ? 1400 : 1800);
  for (const w of wanted) push(w.docId, w.page, fixed.get(key(w.docId, w.page)) ?? "", w.reason, w.max);
  for (const r of hits) if (inScope(r.document_id)) push(r.document_id, r.page_number, r.content, "relevant to the question", many ? 1400 : 1800);

  // Figure notes from captured regions on pages in play.
  const figDocs = allowed ? [...allowed] : materials.map((m) => m.id);
  const figs = figDocs.length ? await src.figures(figDocs, 40) : [];
  const figures: FigureNote[] = figs
    // The figure just captured is sent in the instruction itself.
    .filter((f) => f.id !== highlightId && seen.has(key(f.document_id, f.page_number)))
    .slice(0, 4)
    .map((f) => ({ label: labelOf.get(f.document_id) ?? "", page: f.page_number, description: f.vlm_description.slice(0, 1500) }));

  const roleOrder = { answer: 0, mixed: 1, question: 2 };
  excerpts.sort((a, b) => roleOrder[a.kind ?? "mixed"] - roleOrder[b.kind ?? "mixed"] || a.label.localeCompare(b.label) || a.page - b.page);
  return { excerpts, figures };
}
