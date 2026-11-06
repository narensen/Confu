"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { eyebrowClass } from "@/components/ui";

// The tools beside the tutor: audio overviews, lectures, flashcards and
// notes. They live in the on-device app (/app), which can bring this
// account's sessions over. Hidden for good once the student says so.

const HIDE_KEY = "confu:study-tools-hidden";
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const hiddenNow = () => {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
};

const TOOLS: { name: string; body: string; icon: React.ReactNode }[] = [
  {
    name: "Listen",
    body: "Two voices talk your notes through, for a walk or the bus.",
    icon: <path d="M3 14v-2a9 9 0 0 1 18 0v2M3 14h3v6H4a1 1 0 0 1-1-1zM21 14h-3v6h2a1 1 0 0 0 1-1z" />,
  },
  {
    name: "Lectures",
    body: "Record a class and get a transcript the tutor can cite.",
    icon: <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3" />,
  },
  {
    name: "Cards",
    body: "Flashcards from your pages, back just before you'd forget.",
    icon: <path d="M4 7h12v12H4zM8 3h12v12" />,
  },
  {
    name: "Notes",
    body: "Maths and chemistry that render, written together live.",
    icon: <path d="M5 3h10l4 4v14H5zM9 12h6M9 16h4M14 3v5h5" />,
  },
];

export function StudyTools() {
  const hidden = useSyncExternalStore(subscribe, hiddenNow, () => true);
  if (hidden) return null;

  const hide = () => {
    try {
      localStorage.setItem(HIDE_KEY, "1");
    } catch {}
    listeners.forEach((fn) => fn());
  };

  return (
    <section aria-label="Listen, record, remember" className="relative mt-8 rounded-2xl border border-ink bg-panel p-5 sm:p-6">
      <button
        type="button"
        onClick={hide}
        aria-label="Hide these tools"
        title="Hide"
        className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-full text-muted transition hover:bg-paper hover:text-ink"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <div className="flex flex-wrap items-end justify-between gap-4 pr-8">
        <div>
          <p className={eyebrowClass}>New · Listen, record, remember</p>
          <h2 className="mt-1 font-serif text-2xl leading-tight">Hear your notes as a podcast, and more</h2>
        </div>
        <Link
          href="/app"
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-ink bg-ink px-4 py-2 text-sm font-medium text-white transition duration-200 ease-fluid"
        >
          Open the tools →
        </Link>
      </div>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TOOLS.map((t) => (
          <li key={t.name}>
            <Link href="/app" className="group flex h-full gap-3 rounded-xl border border-ink/20 p-3.5 transition hover:border-ink hover:bg-paper">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
                {t.icon}
              </svg>
              <span>
                <span className="block text-sm font-medium">{t.name}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">{t.body}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted">
        They run on your device. To use them with these sessions, open them and choose <span className="text-ink">Bring my sessions over</span>.
      </p>
    </section>
  );
}
