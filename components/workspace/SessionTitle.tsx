"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function SessionTitle({ sessionId, initialTitle }: { sessionId: string; initialTitle: string }) {
  const [title, setTitle] = useState(initialTitle);
  const [draft, setDraft] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  async function save() {
    if (draft === null) return;
    const next = draft.replace(/\s+/g, " ").trim().slice(0, 200);
    setDraft(null);
    if (!next || next === title) return;
    const previous = title;
    setTitle(next);
    setStatus("saving");
    const { error } = await createClient().from("study_sessions").update({ title: next }).eq("id", sessionId);
    if (error) {
      setTitle(previous);
      setStatus("error");
      window.setTimeout(() => setStatus("idle"), 2500);
    } else {
      setStatus("idle");
    }
  }

  if (draft !== null) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={200}
        aria-label="Session title"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(null);
        }}
        className="animate-pop h-9 w-full max-w-xl rounded-md border border-ink bg-panel px-2 font-serif text-base outline-none shadow-hard-sm"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setDraft(title)}
      title="Rename session"
      className="group flex max-w-xl min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left transition hover:bg-paper"
    >
      <span className="truncate font-serif text-base">{title}</span>
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
        className="shrink-0 text-muted opacity-0 transition group-hover:opacity-100"
      >
        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
      {status === "saving" && <span className="shrink-0 font-mono text-[11px] text-muted">Saving…</span>}
      {status === "error" && <span className="shrink-0 font-mono text-[11px] text-danger">Couldn&apos;t save</span>}
    </button>
  );
}
