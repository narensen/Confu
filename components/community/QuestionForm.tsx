"use client";

import { useState, type FormEvent } from "react";
import { buttonClass, inputClass, labelClass } from "@/components/ui";
import { createThread } from "@/lib/community";
import { track } from "@/lib/telemetry";

export function QuestionForm({
  spaceId,
  onPosted,
}: {
  spaceId?: string | null;
  onPosted: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (title.trim().length < 3) {
      setError("Ask it in one sentence.");
      return;
    }
    if (!body.trim()) {
      setError("Add a little more so people can answer.");
      return;
    }
    setPending(true);
    try {
      const id = await createThread({ title, body, spaceId });
      track("thread.post", { space: Boolean(spaceId) });
      setTitle("");
      setBody("");
      onPosted(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post that.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-ink bg-panel p-4">
      <label className="block">
        <span className={labelClass}>Question</span>
        <input
          value={title}
          maxLength={160}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What's confusing you?"
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className="sr-only">Details</span>
        <textarea
          value={body}
          maxLength={8000}
          rows={4}
          onChange={(e) => setBody(e.target.value)}
          placeholder="The part you're stuck on, and what you've already tried."
          className={`${inputClass} resize-y`}
        />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Posting…" : "Post"}
      </button>
    </form>
  );
}
