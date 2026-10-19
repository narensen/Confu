import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { DeleteSessionButton } from "@/components/dashboard/DeleteSessionButton";
import { NewSessionButton } from "@/components/dashboard/NewSessionButton";
import { eyebrowClass } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { daysBetween, toISODate } from "@/lib/schedule";
import { createClient } from "@/lib/supabase/server";

export default function DashboardPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="animate-enter">
            <p className={eyebrowClass}>Library</p>
            <h1 className="mt-1 font-serif text-4xl tracking-tight">What are you learning?</h1>
            <p className="mt-2 text-sm text-muted">Each session has one goal, any number of PDFs, and a tutor that remembers your progress.</p>
          </div>
          <NewSessionButton />
        </div>
        <Suspense fallback={<ListSkeleton />}>
          <SessionList />
        </Suspense>
      </main>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {[0, 1].map((i) => (
        <div key={i} className="skeleton h-44 rounded-xl border border-ink/20" />
      ))}
    </div>
  );
}

type Row = {
  id: string;
  title: string;
  updated_at: string;
  documents: { id: string; title: string; page_count: number; status: string }[];
  study_plans: { goal: string; goal_title: string; deadline: string; plan_topics: { status: string }[] } | null;
};

async function SessionList() {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_sessions")
    .select("id, title, updated_at, documents(id, title, page_count, status), study_plans(goal, goal_title, deadline, plan_topics(status))")
    .order("updated_at", { ascending: false })
    .order("position", { referencedTable: "documents" });

  // Never let a failed query masquerade as an empty library.
  if (error) {
    console.error("dashboard query failed", error);
    const schemaOutdated = error.code === "42703" || error.code === "42P01" || error.code === "PGRST200" || error.code === "PGRST205";
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

  const sessions = (data ?? []) as unknown as Row[];
  const today = toISODate(new Date());

  if (!sessions.length) {
    return (
      <div className="animate-enter rounded-xl border border-dashed border-ink bg-panel px-6 py-16 text-center">
        <p className="font-serif text-2xl">Your library is empty</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          Start a session with one or more PDFs: textbook chapters, papers, lecture notes. You&apos;ll set a goal and a deadline,
          and Confu builds a plan across all of them and beyond.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {sessions.map((s, i) => {
        const plan = s.study_plans;
        const total = plan?.plan_topics.length ?? 0;
        const done = plan?.plan_topics.filter((t) => t.status === "completed").length ?? 0;
        const daysLeft = plan ? daysBetween(today, plan.deadline) : null;
        const pages = s.documents.reduce((n, d) => n + d.page_count, 0);
        const failed = s.documents.filter((d) => d.status !== "ready").length;
        return (
          <li
            key={s.id}
            className="group animate-enter relative flex flex-col rounded-xl border border-ink bg-panel p-5 transition duration-300 ease-fluid hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard"
            style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
          >
            <div className="flex items-start justify-between gap-3">
              <Link href={`/session/${s.id}`} className="min-w-0 font-serif text-lg leading-snug after:absolute after:inset-0">
                <span className="line-clamp-2">{s.title}</span>
              </Link>
              <div className="relative z-10 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                <DeleteSessionButton id={s.id} title={s.title} />
              </div>
            </div>
            <p className="mt-1 font-mono text-[11px] text-muted">
              {s.documents.length} PDF{s.documents.length === 1 ? "" : "s"} · {pages} pages
              {failed > 0 && <span className="ml-2 text-warn">{failed} not ready</span>}
            </p>
            {s.documents.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {s.documents.slice(0, 4).map((d, j) => (
                  <span key={d.id} className="max-w-48 truncate rounded border border-line px-1.5 py-0.5 text-[11px] text-muted">
                    <span className="font-mono">D{j + 1}</span> {d.title}
                  </span>
                ))}
                {s.documents.length > 4 && <span className="px-1 text-[11px] text-muted">+{s.documents.length - 4}</span>}
              </div>
            )}
            {plan ? (
              <div className="mt-4 space-y-2">
                <p className="line-clamp-2 text-sm">{plan.goal_title || plan.goal}</p>
                <div className="h-1.5 overflow-hidden rounded-full border border-ink/40 bg-panel">
                  <div className="h-full bg-ink transition-[width] duration-700 ease-fluid" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                </div>
                <p className="font-mono text-[11px] text-muted">
                  {done}/{total} topics ·{" "}
                  {daysLeft! >= 0 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : "deadline passed"}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm font-medium underline decoration-ink/30 underline-offset-4">Set a goal to get a study plan →</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
