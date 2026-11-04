import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyReview, type PaperReview } from "@confu/core/paper";
import { docLabel, EMPTY_MEMORY, type LearnerMemory, type PlanTopic, type SessionKind, type StudyPlan, type TutorAction } from "@confu/core/types";
import { answerRank, pageKind } from "@confu/core/tutor/page-role";
import type { Excerpt, FigureNote, Material } from "@confu/core/tutor/prompts";

// Rough budget for document text in a prompt (~3k tokens). Groq's on-demand
// rate limits make tight, relevant context better than "everything".
const TOTAL_BUDGET = 11_000;

export async function loadTutorState(supabase: SupabaseClient, sessionId: string) {
  // An explicit cite_mode column 400s the whole select before 0035 is applied.
  // Retry without it so chat still works, with cite mode treated as off.
  let session = await supabase
    .from("study_sessions")
    .select("id, title, kind, research_goal, exam_date, cite_mode")
    .eq("id", sessionId)
    .maybeSingle();
  if (session.error && /cite_mode/i.test(session.error.message)) {
    session = await supabase.from("study_sessions").select("id, title, kind, research_goal, exam_date").eq("id", sessionId).maybeSingle();
  }

  const [docs, plan, memory] = await Promise.all([
    supabase.from("documents").select("id, title, page_count").eq("session_id", sessionId).order("position").order("created_at"),
    supabase.from("study_plans").select("*").eq("session_id", sessionId).maybeSingle(),
    supabase.from("learner_memory").select("*").eq("session_id", sessionId).maybeSingle(),
  ]);

  let topics: PlanTopic[] = [];
  if (plan.data) {
    const { data } = await supabase.from("plan_topics").select("*").eq("plan_id", plan.data.id).order("position");
    topics = (data ?? []) as PlanTopic[];
  }

  const materials: Material[] = ((docs.data ?? []) as { id: string; title: string; page_count: number }[]).map((d, i) => ({
    id: d.id,
    label: docLabel(i),
    title: d.title,
    pageCount: d.page_count,
  }));

  const sessionRow = session.data as {
    id: string;
    title: string;
    kind: SessionKind;
    research_goal: string;
    exam_date: string | null;
    cite_mode?: boolean;
  } | null;
  const reviews = new Map<string, PaperReview>();
  // Paper sessions: every document is a paper. Study sessions: the ones with notes.
  if (sessionRow && sessionRow.kind !== "exam") {
    const { data } = await supabase.from("paper_reviews").select("*").eq("session_id", sessionId);
    for (const r of (data ?? []) as PaperReview[]) reviews.set(r.document_id, r);
    if (sessionRow.kind === "paper") for (const m of materials) if (!reviews.has(m.id)) reviews.set(m.id, emptyReview(m.id));
  }

  const m = memory.data as LearnerMemory | null;
  return {
    session: sessionRow,
    citeMode: sessionRow?.cite_mode === true,
    reviews,
    materials,
    plan: plan.data as StudyPlan | null,
    topics,
    memory: m
      ? {
          summary: m.summary,
          understood: m.understood,
          struggling: m.struggling,
          misconceptions: m.misconceptions,
          open_questions: m.open_questions,
          explained: m.explained,
        }
      : EMPTY_MEMORY,
  };
}

const STOPWORDS = new Set(
  "the a an and or of to in on for is are was were be been it this that with as by at from what why how which can does do i me my about into than then there their".split(
    " ",
  ),
);

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9α-ω]+/i)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// Cut a page down to `max` chars, centred on the densest cluster of query terms.
function windowed(text: string, query: string, max: number): string {
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

export type PageRef = { docId: string; page: number; reason: string; max: number };

type PageHit = { document_id: string; page_number: number; content: string };

// One page from each file, then the next, so the first file can't use up the budget.
function interleave(buckets: PageHit[][]): PageHit[] {
  const depth = Math.max(0, ...buckets.map((b) => b.length));
  const hits: PageHit[] = [];
  for (let i = 0; i < depth; i++) {
    for (const bucket of buckets) {
      const row = bucket[i];
      if (row) hits.push(row);
    }
  }
  return hits;
}

// Search each chosen file on its own. A session-wide search returns the
// strongest pages overall, which are usually the file already open.
async function searchChosen(supabase: SupabaseClient, docIds: string[], query: string): Promise<PageHit[]> {
  const n = docIds.length;
  const limit = n <= 1 ? 5 : n === 2 ? 4 : n <= 4 ? 3 : 2;
  const q = query.slice(0, 500);
  const found = await Promise.all(
    docIds.map((docId) => supabase.rpc("search_pages", { p_document_id: docId, p_query: q, p_limit: limit })),
  );
  return interleave(
    found.map((res, i) =>
      ((res.data ?? []) as { page_number: number; content: string }[]).map((row) => ({
        document_id: docIds[i],
        page_number: row.page_number,
        content: row.content,
      })),
    ),
  );
}

export async function retrieveContext(
  supabase: SupabaseClient,
  input: {
    sessionId: string;
    materials: Material[];
    action: TutorAction;
    query: string;
    current: { docId: string; page: number } | null;
    focus: { docId: string; page: number } | null; // page of a selection or captured figure
    topic: PlanTopic | null;
    highlightId: string | null;
    // Pages a paper pass always needs (e.g. abstract, introduction, conclusion).
    extraPages?: PageRef[];
    // Files the student turned on for this question. Null keeps a session-wide search.
    scopeIds?: string[] | null;
  },
): Promise<{ excerpts: Excerpt[]; figures: FigureNote[] }> {
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

  // Fetch fixed pages, grouped by document.
  const byDoc = new Map<string, number[]>();
  for (const w of wanted) byDoc.set(w.docId, [...(byDoc.get(w.docId) ?? []), w.page]);

  const [fixedResults, hits] = await Promise.all([
    Promise.all(
      [...byDoc].map(([docId, pages]) =>
        supabase.from("document_pages").select("document_id, page_number, content").eq("document_id", docId).in("page_number", pages),
      ),
    ),
    query.trim()
      ? allowed
        ? searchChosen(supabase, [...allowed], query)
        : supabase
            .rpc("search_session_pages", { p_session_id: sessionId, p_query: query.slice(0, 500), p_limit: 5 })
            .then((r) => (r.data ?? []) as PageHit[])
      : Promise.resolve([] as PageHit[]),
  ]);

  const key = (docId: string, page: number) => `${docId}:${page}`;
  const fixed = new Map<string, string>();
  for (const r of fixedResults) {
    for (const row of (r.data ?? []) as { document_id: string; page_number: number; content: string }[]) {
      fixed.set(key(row.document_id, row.page_number), row.content);
    }
  }

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
    const stated =
      kind === "question" ? "asks the question. Do not cite this page for the answer" : kind === "answer" ? "where the answer is written" : reason;
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

  const answerHits: PageHit[] = [];
  if (questionAt.size) {
    const more = await Promise.all(
      [...questionAt].filter(([docId]) => !haveAnswer(docId)).map(async ([docId, after]) => {
        const { data } = await supabase
          .from("document_pages")
          .select("document_id, page_number, content")
          .eq("document_id", docId)
          .gt("page_number", after)
          .order("page_number")
          .limit(24);
        const rows = (data ?? []) as PageHit[];
        const picked = rows
          .map((row) => ({ row, rank: answerRank(row.content, query) }))
          .filter((x) => x.rank >= 0)
          .sort((a, b) => b.rank - a.rank)
          .slice(0, 3)
          .map((x) => x.row);
        if (picked.length) return picked;
        const earlier = await supabase
          .from("document_pages")
          .select("document_id, page_number, content")
          .eq("document_id", docId)
          .lt("page_number", after)
          .order("page_number", { ascending: false })
          .limit(12);
        return ((earlier.data ?? []) as PageHit[])
          .map((row) => ({ row, rank: answerRank(row.content, query) }))
          .filter((x) => x.rank >= 0)
          .sort((a, b) => b.rank - a.rank)
          .slice(0, 3)
          .map((x) => x.row);
      }),
    );
    for (const rows of more) answerHits.push(...rows);
  }

  for (const row of answerHits) push(row.document_id, row.page_number, row.content, "where the answer is written", many ? 1400 : 1800);
  for (const w of wanted) push(w.docId, w.page, fixed.get(key(w.docId, w.page)) ?? "", w.reason, w.max);
  for (const r of hits) {
    if (!inScope(r.document_id)) continue;
    push(r.document_id, r.page_number, r.content, "relevant to the question", many ? 1400 : 1800);
  }

  // Figure notes from captured regions on pages in play.
  const figDocs = allowed ? [...allowed] : materials.map((m) => m.id);
  const { data: figs } = figDocs.length
    ? await supabase
        .from("highlights")
        .select("id, document_id, page_number, vlm_description")
        .in("document_id", figDocs)
        .eq("kind", "region")
        .not("vlm_description", "is", null)
        .order("created_at", { ascending: false })
        .limit(40)
    : { data: [] };

  const figures: FigureNote[] = ((figs ?? []) as { id: string; document_id: string; page_number: number; vlm_description: string }[])
    // The figure just captured is sent in the instruction itself.
    .filter((f) => f.id !== highlightId && seen.has(key(f.document_id, f.page_number)))
    .slice(0, 4)
    .map((f) => ({ label: labelOf.get(f.document_id) ?? "", page: f.page_number, description: f.vlm_description.slice(0, 1500) }));

  const roleOrder = { answer: 0, mixed: 1, question: 2 };
  excerpts.sort((a, b) => roleOrder[a.kind ?? "mixed"] - roleOrder[b.kind ?? "mixed"] || a.label.localeCompare(b.label) || a.page - b.page);
  return { excerpts, figures };
}
