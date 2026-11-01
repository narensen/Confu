"use client";

import { useState } from "react";
import { buttonClass, inputClass } from "@/components/ui";
import { createThread } from "@/lib/community";
import { track } from "@/lib/telemetry";

// Ask a question on the public threads, or inside one space.
export function QuestionForm({ spaceId, onPosted }: { spaceId?: string | null; onPosted: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (title.trim().length < 3) return setError("Ask it in one sentence.");
    if (!body.trim()) return setError("Add a little more: what you're stuck on, and what you've tried.");
    setPending(true);
    try {
      const id = await createThread({ title, body, spaceId });
      track("thread.post", { space: Boolean(spaceId) });
      setTitle("");
      setBody("");
      onPosted(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post that.");
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-3 rounded-2xl border border-ink bg-panel p-4 sm:p-5"
    >
      <p className="font-medium">Ask a question</p>
      <input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="The question, in one sentence" aria-label="Question" className={inputClass} />
      <textarea
        value={body}
        maxLength={8000}
        rows={4}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What you're stuck on, and what you've already tried."
        aria-label="Details"
        className={inputClass}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Posting…" : "Post question"}
      </button>
    </form>
  );
}
