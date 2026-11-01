"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { QuestionForm } from "@/components/community/QuestionForm";
import { ThreadList } from "@/components/community/ThreadList";
import { eyebrowClass } from "@/components/ui";
import { loadThreads, type ThreadCard } from "@/lib/community";

export function ThreadsView() {
  const router = useRouter();
  const [threads, setThreads] = useState<ThreadCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    loadThreads(null).then(
      (next) => {
        setThreads(next);
        setError(null);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : "Couldn't load threads."),
    );

  useEffect(() => {
    let live = true;
    void loadThreads(null).then(
      (next) => {
        if (live) setThreads(next);
      },
      (err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "Couldn't load threads.");
      },
    );
    return () => {
      live = false;
    };
  }, []);

  if (error) return <p className="mt-8 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p>;
  if (!threads) {
    return (
      <div className="mt-8 space-y-3">
        <div className="skeleton h-36 rounded-2xl" />
        <div className="skeleton h-24 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="space-y-6">
        <QuestionForm onPosted={(id) => router.push(`/threads/${id}`)} />
        <ThreadList threads={threads} empty="No questions yet. Ask the first one." />
      </div>
      <aside className="space-y-4 lg:pt-1">
        <div className="rounded-2xl border border-ink bg-yellow-100 p-4">
          <p className={eyebrowClass}>Private</p>
          <p className="mt-2 font-serif text-xl">A space for your group</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">People with the link can join and ask. No timer, no voice. Just the questions.</p>
          <Link href="/spaces" className="mt-3 inline-block text-sm font-medium underline underline-offset-4">
            Your spaces
          </Link>
        </div>
        <p className="text-sm leading-relaxed text-muted">
          Want to share how you studied, not a question? Open a session and press Share, then turn on roadmap.{" "}
          <Link href="/roadmaps" className="font-medium text-ink underline underline-offset-4">
            Roadmaps
          </Link>
        </p>
        <button type="button" onClick={() => void reload()} className="text-sm text-muted underline underline-offset-4 hover:text-ink">
          Refresh
        </button>
      </aside>
    </div>
  );
}
