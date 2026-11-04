import { emptyReview, type PaperReview } from "@confu/core/paper";
import type { Material } from "@confu/core/tutor/prompts";
import { docLabel, EMPTY_MEMORY, type LearnerMemory, type PlanTopic, type SessionKind, type StudyPlan } from "@confu/core/types";
import type { Store } from "@confu/storage/store";

// Everything the tutor needs to know about a session, from the device.
export type TutorState = Awaited<ReturnType<typeof loadTutorState>>;

type SessionRow = { id: string; title: string; kind: SessionKind; research_goal: string; exam_date: string | null; cite_mode: boolean };

export async function loadTutorState(store: Store, sessionId: string) {
  const session = await store.get<SessionRow>("study_sessions", { id: sessionId });
  const [docs, plans, memoryRow] = await Promise.all([
    store.query<{ id: string; title: string; page_count: number }>(`SELECT id, title, page_count FROM documents WHERE session_id = ? ORDER BY position, created_at`, [sessionId]),
    store.list<StudyPlan>("study_plans", { session_id: sessionId }, { limit: 1 }),
    store.get<LearnerMemory & { session_id: string }>("learner_memory", { session_id: sessionId }),
  ]);
  const plan = plans[0] ?? null;
  const topics = plan ? await store.list<PlanTopic>("plan_topics", { plan_id: plan.id }, { order: "position" }) : [];
  const materials: Material[] = docs.map((d, i) => ({ id: d.id, label: docLabel(i), title: d.title, pageCount: d.page_count }));

  const reviews = new Map<string, PaperReview>();
  // Paper sessions: every document is a paper. Study sessions: the ones with notes.
  if (session && session.kind !== "exam") {
    for (const r of await store.list<PaperReview>("paper_reviews", { session_id: sessionId })) reviews.set(r.document_id, r);
    if (session.kind === "paper") for (const m of materials) if (!reviews.has(m.id)) reviews.set(m.id, emptyReview(m.id));
  }

  const memory: LearnerMemory = memoryRow
    ? {
        summary: memoryRow.summary,
        understood: memoryRow.understood,
        struggling: memoryRow.struggling,
        misconceptions: memoryRow.misconceptions,
        open_questions: memoryRow.open_questions,
        explained: memoryRow.explained,
      }
    : EMPTY_MEMORY;

  return { session, citeMode: session?.cite_mode === true, reviews, materials, plan, topics, memory };
}
