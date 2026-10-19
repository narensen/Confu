import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Library, type LibrarySession } from "@/components/dashboard/Library";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { SessionKind } from "@/lib/types";

export default function DashboardPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <Suspense fallback={<LibrarySkeleton />}>
          <LibraryLoader />
        </Suspense>
      </main>
    </div>
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

type Row = {
  id: string;
  title: string;
  kind: SessionKind;
  exam_date: string | null;
  updated_at: string;
  documents: { id: string; title: string; page_count: number; status: string }[];
  study_plans: { goal: string; goal_title: string; deadline: string; plan_topics: { status: string }[] } | null;
  paper_reviews: { target_pass: number; passes_done: number }[];
  exam_attempts: { score: number }[];
};

async function LibraryLoader() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_sessions")
    .select(
      "id, title, kind, exam_date, updated_at, documents(id, title, page_count, status), study_plans(goal, goal_title, deadline, plan_topics(status)), paper_reviews(target_pass, passes_done), exam_attempts(score)",
    )
    .order("updated_at", { ascending: false })
    .order("position", { referencedTable: "documents" })
    .order("created_at", { referencedTable: "exam_attempts", ascending: false })
    .limit(200, { referencedTable: "exam_attempts" });

  // Never let a failed query masquerade as an empty library.
  if (error) {
    console.error("dashboard query failed", error);
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
    const topics = r.study_plans?.plan_topics ?? [];
    const scores = (r.exam_attempts ?? []).map((a) => a.score);
    const reviews = r.paper_reviews ?? [];
    const byTarget: [number, number, number] = [1, 2, 3].map(
      (n) => reviews.filter((x) => x.target_pass === n).length + (n === 1 ? Math.max(0, r.documents.length - reviews.length) : 0),
    ) as [number, number, number];
    return {
      id: r.id,
      title: r.title,
      kind: r.kind,
      updatedAt: r.updated_at,
      docs: r.documents.map((d) => ({ id: d.id, title: d.title, pages: d.page_count, ready: d.status === "ready" })),
      study: r.study_plans
        ? {
            goal: r.study_plans.goal_title || r.study_plans.goal,
            done: topics.filter((t) => t.status === "completed").length,
            total: topics.length,
            deadline: r.study_plans.deadline,
          }
        : null,
      exam: r.kind === "exam" ? { examDate: r.exam_date, answered: scores.length, accuracy: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null } : null,
      paper: r.kind === "paper" ? { total: r.documents.length, done: reviews.filter((x) => x.passes_done >= x.target_pass).length, byTarget } : null,
    };
  });

  return <Library name={user.name} sessions={sessions} />;
}
