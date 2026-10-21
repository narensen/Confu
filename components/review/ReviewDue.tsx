"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { endOfToday } from "@/lib/review";
import { createClient } from "@/lib/supabase/client";

// Dashboard card: how many reviews are due today (the student's local day).
// Hidden until the student has something to review.
export function ReviewDue() {
  const [state, setState] = useState<{ due: number; total: number; next: string | null } | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let live = true;
    void Promise.all([
      supabase.from("review_items").select("id", { count: "exact", head: true }).eq("suspended", false).lte("due_at", endOfToday()),
      supabase.from("review_items").select("id", { count: "exact", head: true }).eq("suspended", false),
      supabase.from("review_items").select("due_at").eq("suspended", false).gt("due_at", endOfToday()).order("due_at").limit(1),
    ]).then(([due, total, next]) => {
      if (!live || due.error) return;
      setState({ due: due.count ?? 0, total: total.count ?? 0, next: (next.data?.[0] as { due_at: string } | undefined)?.due_at ?? null });
    });
    return () => {
      live = false;
    };
  }, []);

  if (!state || state.total === 0) return null;

  if (state.due === 0) {
    return (
      <p className="animate-enter flex flex-wrap items-center gap-2 text-sm text-muted">
        <span className="size-2 rounded-full bg-ok" />
        Reviews all caught up.
        {state.next && <> Next one {new Date(state.next).toLocaleDateString(undefined, { weekday: "long" })}.</>}
      </p>
    );
  }

  const minutes = Math.max(1, Math.round(state.due * 0.75));
  return (
    <Link
      href="/review"
      className="animate-enter group flex items-center gap-5 rounded-2xl border border-ink bg-ink px-6 py-5 text-white shadow-[4px_4px_0_0_#facc15] transition duration-200 ease-fluid hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_#facc15]"
    >
      <span className="font-serif text-5xl leading-none tabular-nums">{state.due}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[11px] tracking-[0.12em] text-yellow-400 uppercase">Due today</span>
        <span className="mt-1 block text-sm text-white/80">
          {state.due === 1 ? "1 review" : `${state.due} reviews`} · about {minutes} min. Recall it before you forget it.
        </span>
      </span>
      <span className="hidden shrink-0 rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-ink transition group-hover:bg-yellow-300 sm:block">Start review →</span>
    </Link>
  );
}
