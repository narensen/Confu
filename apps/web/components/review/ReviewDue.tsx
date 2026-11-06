"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { endOfToday } from "@/lib/review";
import { createClient } from "@/lib/supabase/client";

// Dashboard card: how many reviews are due today (the student's local day).
// Hidden until the student has something to review.
// compact: a card for the library's Today column; otherwise a full-width banner.
export function ReviewDue({ compact = false }: { compact?: boolean }) {
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

  if (compact) {
    const minutes = Math.max(1, Math.round(state.due * 0.75));
    if (state.due === 0) {
      return (
        <div className="animate-enter flex items-center gap-4 rounded-2xl border border-line bg-panel p-5">
          <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-line text-ok">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 5 5L20 7" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block font-medium">Reviews all caught up</span>
            <span className="block text-xs text-muted">
              {state.next ? `Next one ${new Date(state.next).toLocaleDateString(undefined, { weekday: "long" })}.` : "New ones come from what you highlight and get wrong."}
            </span>
          </span>
        </div>
      );
    }
    return (
      <Link
        href="/review"
        className="animate-enter group flex items-center gap-4 rounded-2xl border border-ink bg-panel p-5 shadow-hard-sm transition duration-200 ease-fluid"
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-ink bg-yellow-300 font-serif text-2xl tabular-nums">{state.due}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{state.due === 1 ? "Review due today" : "Reviews due today"}</span>
          <span className="block text-xs text-muted">About {minutes} min. Recall it before you forget it.</span>
        </span>
        <span aria-hidden className="text-lg transition-transform group-hover:translate-x-1">
          →
        </span>
      </Link>
    );
  }

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
      className="animate-enter group flex items-center gap-5 rounded-2xl border border-ink bg-inverse px-6 py-5 text-inverse-ink transition duration-200 ease-fluid"
    >
      <span className="font-serif text-5xl leading-none tabular-nums">{state.due}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[11px] tracking-[0.12em] text-yellow-400 uppercase">Due today</span>
        <span className="mt-1 block text-sm text-inverse-muted">
          {state.due === 1 ? "1 review" : `${state.due} reviews`} · about {minutes} min. Recall it before you forget it.
        </span>
      </span>
      <span className="hidden shrink-0 rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-ink transition group-hover:bg-yellow-300 sm:block">Start review →</span>
    </Link>
  );
}
