import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { docLabel, EMPTY_MEMORY, type LearnerMemory, type PlanTopic, type StudyPlan, type TutorAction } from "@/lib/types";
import type { Excerpt, FigureNote, Material } from "@/lib/tutor/prompts";

// Rough budget for document text in a prompt (~3k tokens). Groq's on-demand
// rate limits make tight, relevant context better than "everything".
const TOTAL_BUDGET = 11_000;

export async function loadTutorState(supabase: SupabaseClient, sessionId: string) {
  const [session, docs, plan, memory] = await Promise.all([
    supabase.from("study_sessions").select("id, title").eq("id", sessionId).maybeSingle(),
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

  const m = memory.data as LearnerMemory | null;
  return {
    session: session.data as { id: string; title: string } | null,
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

type PageRef = { docId: string; page: number; reason: string; max: number };

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
  },
): Promise<{ excerpts: Excerpt[]; figures: FigureNote[] }> {
  const { sessionId, materials, action, query, current, focus, topic, highlightId } = input;
  const labelOf = new Map(materials.map((m) => [m.id, m.label]));

  // Pages we always want, in priority order.
  const wanted: PageRef[] = [];
  if (focus) wanted.push({ ...focus, reason: "page of the highlighted passage", max: 3500 });
  if (current && !(focus && focus.docId === current.docId && focus.page === current.page)) {
    wanted.push({ ...current, reason: "page the student is reading", max: 2200 });
  }
  if (topic?.document_id && topic.page_start && topic.page_end && (action === "teach" || action === "quiz")) {
    for (let p = topic.page_start; p <= Math.min(topic.page_end, topic.page_start + 2); p++) {
      wanted.push({ docId: topic.document_id, page: p, reason: "current topic", max: 2500 });
    }
  }

  // Fetch fixed pages, grouped by document.
  const byDoc = new Map<string, number[]>();
  for (const w of wanted) byDoc.set(w.docId, [...(byDoc.get(w.docId) ?? []), w.page]);

  const [fixedResults, searched] = await Promise.all([
    Promise.all(
      [...byDoc].map(([docId, pages]) =>
        supabase.from("document_pages").select("document_id, page_number, content").eq("document_id", docId).in("page_number", pages),
      ),
    ),
    query.trim()
      ? supabase.rpc("search_session_pages", { p_session_id: sessionId, p_query: query.slice(0, 500), p_limit: 5 })
      : Promise.resolve({ data: [] }),
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
    const cut = windowed(text, query, Math.min(max, TOTAL_BUDGET - used));
    seen.add(k);
    used += cut.length;
    excerpts.push({ label, page, text: cut, reason });
  };

  for (const w of wanted) push(w.docId, w.page, fixed.get(key(w.docId, w.page)) ?? "", w.reason, w.max);
  for (const r of (searched.data ?? []) as { document_id: string; page_number: number; content: string }[]) {
    push(r.document_id, r.page_number, r.content, "relevant to the question", 1800);
  }

  // Figure notes from captured regions on pages in play.
  const { data: figs } = await supabase
    .from("highlights")
    .select("id, document_id, page_number, vlm_description")
    .in(
      "document_id",
      materials.map((m) => m.id),
    )
    .eq("kind", "region")
    .not("vlm_description", "is", null)
    .order("created_at", { ascending: false })
    .limit(40);

  const figures: FigureNote[] = ((figs ?? []) as { id: string; document_id: string; page_number: number; vlm_description: string }[])
    // The figure just captured is sent in the instruction itself.
    .filter((f) => f.id !== highlightId && seen.has(key(f.document_id, f.page_number)))
    .slice(0, 4)
    .map((f) => ({ label: labelOf.get(f.document_id) ?? "", page: f.page_number, description: f.vlm_description.slice(0, 1500) }));

  excerpts.sort((a, b) => a.label.localeCompare(b.label) || a.page - b.page);
  return { excerpts, figures };
}
