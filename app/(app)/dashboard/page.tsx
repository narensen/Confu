import { Suspense } from "react";
import { Library, type LibrarySession, type NextStep } from "@/components/dashboard/Library";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { docLabel, type SessionKind } from "@/lib/types";
import { logError } from "@/lib/log";

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
      <Suspense fallback={<LibrarySkeleton />}>
        <LibraryLoader />
      </Suspense>
    </main>
  );
}

function LibrarySkeleton() {
  return (
    <div className="space-y-6">
      <div className="skeleton h-12 w-80 rounded" />
      <div className="skeleton h-36 rounded-2xl border border-ink/20" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-48 rounded-2xl border border-ink/20" />
        ))}
      </div>
    </div>
  );
}

type TopicRow = {
  id: string;
  title: string;
  status: string;
  position: number;
  source: "pdf" | "external";
  document_id: string | null;
  page_start: number | null;
  page_end: number | null;
  est_minutes: number;
  due_date: string;
};

type Row = {
  id: string;
  title: string;
  kind: SessionKind;
  exam_date: string | null;
  updated_at: string;
  archived_at?: string | null;
  documents: { id: string; title: string; page_count: number; status: string; last_page: number | null; updated_at: string }[];
  study_plans: { goal: string; goal_title: string; deadline: string; plan_topics: TopicRow[] } | null;
  paper_reviews: { document_id: string; target_pass: number; passes_done: number }[];
  exam_attempts: { score: number }[];
};

async function LibraryLoader() {
  const user = await requireUser();
  const supabase = await createClient();
  const load = (archive: boolean) =>
    supabase
      .from("study_sessions")
      .select(
        `id, title, kind, exam_date, updated_at,${archive ? " archived_at," : ""} documents(id, title, page_count, status, last_page, updated_at), study_plans(goal, goal_title, deadline, plan_topics(id, title, status, position, source, document_id, page_start, page_end, est_minutes, due_date)), paper_reviews(document_id, target_pass, passes_done), exam_attempts(score)`,
      )
      .order("updated_at", { ascending: false })
      .order("position", { referencedTable: "documents" })
      .order("created_at", { referencedTable: "exam_attempts", ascending: false })
      .limit(200, { referencedTable: "exam_attempts" });
  let { data, error } = await load(true);
  // Before migration 0021 there's no archive column: show the library without it.
  if (error?.code === "42703" && error.message.includes("archived_at")) ({ data, error } = await load(false));

  // Never let a failed query masquerade as an empty library.
  if (error) {
    logError("dashboard query failed", error);
    const schemaOutdated = ["42703", "42P01", "PGRST200", "PGRST205"].includes(error.code ?? "");
    return (
      <div className="animate-enter rounded-xl border border-danger/50 bg-panel px-6 py-8">
        <p className="font-serif text-2xl">Couldn&apos;t load your library</p>
        <p className="mt-2 font-mono text-xs text-danger">{error.message}</p>
        {schemaOutdated && (
          <p className="mt-3 text-sm text-muted">
            The database schema is out of date. Run the newest files in <code className="font-mono">supabase/migrations/</code> in
            the Supabase SQL editor, then refresh.
          </p>
        )}
      </div>
    );
  }

  const sessions: LibrarySession[] = ((data ?? []) as unknown as Row[]).map((r) => {
    const docs = r.documents.map((d, i) => ({
      id: d.id,
      title: d.title,
      label: docLabel(i),
      pages: d.page_count,
      ready: d.status === "ready",
      lastPage: Math.max(1, d.last_page ?? 1),
      updatedAt: d.updated_at,
    }));
    // Where you left off: the file you read last, at its page.
    const lastRead = [...docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const topics = [...(r.study_plans?.plan_topics ?? [])].sort((a, b) => a.position - b.position);
    const step = (t: TopicRow): NextStep => {
      const d = docs.find((x) => x.id === t.document_id);
      const inPdf = t.source === "pdf" && t.page_start !== null && d;
      return {
        id: t.id,
        title: t.title,
        due: t.due_date,
        minutes: t.est_minutes,
        docId: inPdf ? d.id : null,
        docLabel: inPdf && docs.length > 1 ? d.label : null,
        pages: inPdf ? (t.page_start === t.page_end ? `p. ${t.page_start}` : `pp. ${t.page_start}–${t.page_end}`) : null,
      };
    };
    const scores = (r.exam_attempts ?? []).map((a) => a.score);
    const reviews = r.paper_reviews ?? [];
    // Every paper with its passes: done so far, and the pass it should reach.
    const papers = docs.map((d) => {
      const review = reviews.find((x) => x.document_id === d.id);
      return { title: d.title, target: review?.target_pass ?? 1, done: review?.passes_done ?? 0 };
    });
    return {
      id: r.id,
      title: r.title,
      kind: r.kind,
      updatedAt: r.updated_at,
      archived: Boolean(r.archived_at),
      docs,
      resume: lastRead ? { docId: lastRead.id, label: lastRead.label, page: lastRead.lastPage } : null,
      study: r.study_plans
        ? {
            goal: r.study_plans.goal_title || r.study_plans.goal,
            done: topics.filter((t) => t.status === "completed").length,
            total: topics.length,
            deadline: r.study_plans.deadline,
            // The next few topics still to do, in plan order (the first is "next").
            open: topics.filter((t) => t.status !== "completed").slice(0, 8).map(step),
          }
        : null,
      exam: r.kind === "exam" ? { examDate: r.exam_date, answered: scores.length, accuracy: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null } : null,
      paper: r.kind === "paper" ? { total: papers.length, done: papers.filter((x) => x.done >= x.target).length, papers } : null,
    };
  });

  return <Library name={user.name} sessions={sessions} />;
}
