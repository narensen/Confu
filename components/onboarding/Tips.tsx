"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Eyebrow } from "@/components/ui";

// A note shown once per browser. The server render hides it, so it never
// flashes for someone who already dismissed it.
function useDismissed(key: string) {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      return () => window.removeEventListener("storage", cb);
    },
    () => {
      try {
        return localStorage.getItem(key) === "1";
      } catch {
        return false;
      }
    },
    () => true,
  );
}

export function OnceTip({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  const key = `confu:tip:${id}`;
  const stored = useDismissed(key);
  const [gone, setGone] = useState(false);
  if (stored || gone) return null;

  return (
    <div role="status" className={`flex items-start gap-3 bg-paper px-3 py-2 text-sm leading-relaxed ${className}`}>
      <p className="min-w-0 flex-1">{children}</p>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(key, "1");
          } catch {}
          setGone(true);
        }}
        className="shrink-0 text-xs font-medium underline underline-offset-4"
      >
        Got it
      </button>
    </div>
  );
}

// The first-run list on an empty library. The key step is the only one this
// page can already know; the rest are what happens next.
export function GettingStarted({ needsKey }: { needsKey: boolean }) {
  const items = [
    { title: "Start a session", body: "Press + New session, or Try a sample beside it.", done: false },
    { title: "Add something to read", body: "A PDF, slides, or the sample guide.", done: false },
    {
      title: "Give the tutor an AI",
      body: needsKey
        ? "Add a Groq key in Settings before the first question, or allow Claude, ChatGPT, Gemini or Grok on this computer."
        : "Ready. A key is saved, or this account uses the server's keys.",
      done: !needsKey,
    },
    { title: "Write a goal", body: "The plan appears once you do, with a short tip.", done: false },
  ];

  return (
    <section className="mt-8 rounded-2xl border border-ink bg-panel p-5" aria-label="Getting started">
      <Eyebrow>Getting started</Eyebrow>
      <ol className="mt-4 space-y-3">
        {items.map((item, i) => (
          <li key={item.title} className="flex gap-3 text-sm">
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs ${item.done ? "border-ink bg-ink text-on-ink" : "border-ink"}`}
              aria-hidden
            >
              {item.done ? "✓" : i + 1}
            </span>
            <span>
              <span className="font-medium">{item.title}</span>
              {item.done && <span className="sr-only">, done</span>}
              <span className="mt-0.5 block leading-relaxed text-muted">{item.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
