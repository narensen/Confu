"use client";

import { useSyncExternalStore } from "react";
import { endOfToday } from "@/lib/review";
import { createClient } from "@/lib/supabase/client";

// How many reviews are due today (the student's local day): the count on
// Review in the nav and the phone tab bar. One shared poller however many
// places show it; it refreshes when the tab comes back into view, after a
// review session (REVIEWED_EVENT), and every few minutes.

export const REVIEWED_EVENT = "confu:reviewed";

let due: number | null = null;
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

function emit() {
  for (const fn of listeners) fn();
}

function start() {
  let live = true;
  const sync = () => {
    void createClient()
      .from("review_items")
      .select("id", { count: "exact", head: true })
      .eq("suspended", false)
      .lte("due_at", endOfToday())
      .then(({ count, error }) => {
        if (!live || error) return;
        due = count ?? 0;
        emit();
      });
  };
  sync();
  const poll = window.setInterval(sync, 5 * 60_000);
  const onVisible = () => {
    if (document.visibilityState === "visible") sync();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener(REVIEWED_EVENT, sync);
  return () => {
    live = false;
    window.clearInterval(poll);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener(REVIEWED_EVENT, sync);
  };
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (listeners.size === 1) stop = start();
  return () => {
    listeners.delete(fn);
    if (!listeners.size) {
      stop?.();
      stop = null;
    }
  };
}

// null until the first count arrives.
export function useReviewsDue(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => due,
    () => null,
  );
}
