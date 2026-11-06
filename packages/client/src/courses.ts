import type { FetchLike } from "@confu/ai/fetch-like";
import { templateBySlug, type CourseSource, type Template } from "@confu/core/templates";
import type { PlanTopic, StudyPlan, TopicStatus } from "@confu/core/types";
import type { FileStore } from "@confu/storage/files";
import type { Store } from "@confu/storage/store";
import { addPdf, createSession, touchSession, type LocalSession, type PdfExtractor } from "./library";

// Ready-made courses (packages/core/templates): starting one makes a session
// with the course's goal and a plan of its topics, spread over its weeks.
// Its free sources are listed with the plan; open papers can be added as
// PDFs.

const TEMPLATE_PREFIX = "template:";
const day = (d: Date) => d.toISOString().slice(0, 10);

export async function startCourse(store: Store, t: Template, now = new Date()): Promise<LocalSession> {
  const s = await createSession(store, { title: t.title, kind: t.kind });
  const days = t.weeks * 7;
  const deadline = new Date(now.getTime() + days * 86_400_000);
  const plan = await store.put("study_plans", {
    session_id: s.id,
    goal: t.goal,
    goal_title: t.title,
    goal_summary: t.tagline,
    level: t.level,
    start_date: day(now),
    deadline: day(deadline),
    minutes_per_day: t.minutesPerDay,
    materials: `${TEMPLATE_PREFIX}${t.slug}`,
    phases: t.outline.map((p) => ({ title: p.phase, description: "" })),
  });
  const topics = t.outline.flatMap((p, phase) => p.topics.map((title) => ({ title, phase })));
  await store.putMany(
    "plan_topics",
    topics.map((topic, i) => ({
      plan_id: plan.id,
      position: i,
      phase: topic.phase,
      title: topic.title,
      source: "external",
      est_minutes: Math.max(15, Math.round((t.minutesPerDay * days) / topics.length)),
      due_date: day(new Date(now.getTime() + Math.ceil(((i + 1) * days) / topics.length) * 86_400_000)),
    })),
  );
  await touchSession(store, s.id);
  return s;
}

export type LocalPlan = Omit<StudyPlan, "materials"> & { materials: string; topics: PlanTopic[]; template: Template | null };

export async function sessionPlan(store: Store, sessionId: string): Promise<LocalPlan | null> {
  const [plan] = await store.list<StudyPlan>("study_plans", { session_id: sessionId }, { order: "created_at", desc: true, limit: 1 });
  if (!plan) return null;
  const topics = await store.list<PlanTopic>("plan_topics", { plan_id: plan.id }, { order: "position" });
  const template = plan.materials?.startsWith(TEMPLATE_PREFIX) ? templateBySlug(plan.materials.slice(TEMPLATE_PREFIX.length)) : null;
  return { ...plan, topics, template };
}

export async function setTopicStatus(store: Store, topicId: string, status: TopicStatus) {
  await store.put("plan_topics", { id: topicId, status, completed_at: status === "completed" ? new Date().toISOString() : null, updated_at: new Date().toISOString() });
}

// An open-access paper from a course, added as a PDF. `fetchPdf` is the
// host's way to get bytes from another site (a server proxy on the web).
export async function addCoursePaper(
  store: Store,
  files: FileStore,
  input: { sessionId: string; source: CourseSource; extract: PdfExtractor; fetchPdf: (url: string) => Promise<Blob>; onProgress?: (done: number, total: number) => void },
) {
  const url = input.source.pdf_url;
  if (!url) throw new Error("This source has no open PDF. Open it in your browser instead.");
  const file = await input.fetchPdf(url);
  return addPdf(store, files, { sessionId: input.sessionId, file, title: input.source.title, extract: input.extract, onProgress: input.onProgress });
}

// The web host's paper fetcher: the site's proxy (signed-in students only).
export const proxyPdfFetcher =
  (endpoint: string, fetcher: FetchLike = fetch) =>
  async (url: string): Promise<Blob> => {
    const res = await fetcher(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    if (res.status === 401) throw new Error("Sign in to confu.lol to fetch papers, or download the PDF and drop it here.");
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't fetch the PDF.");
    return res.blob();
  };
