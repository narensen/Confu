"use client";

import { useState, useTransition } from "react";
import { saveGroqKey } from "@/app/(app)/settings/actions";
import { buttonClass, inputClass } from "@/components/ui";
import { looksLikeGroqKey } from "@/lib/ai-key";
import type { KeyInfo } from "@/lib/groq-keys";

// Paste → verify with Groq → store encrypted. `sessionId` null saves the
// account key; with `allowScopeChoice` the user picks account vs this session.
export function GroqKeyForm({
  sessionId,
  allowScopeChoice = false,
  submitLabel,
  onSaved,
}: {
  sessionId: string | null;
  allowScopeChoice?: boolean;
  submitLabel?: string;
  onSaved: (info: KeyInfo) => void;
}) {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [scope, setScope] = useState<"account" | "session">("account");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = key.trim();
    if (!looksLikeGroqKey(value)) return setError("That doesn't look like a Groq API key. They start with gsk_.");
    setError(null);
    const target = allowScopeChoice && scope === "account" ? null : sessionId;
    start(async () => {
      const res = await saveGroqKey(value, target);
      if (res.ok) {
        setKey("");
        onSaved(res.info);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          aria-label="Groq API key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="gsk_…"
          className={`${inputClass} pr-16 font-mono`}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute inset-y-0 right-2 my-auto h-7 rounded px-2 text-xs text-muted hover:text-ink"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>

      {allowScopeChoice && sessionId && (
        <fieldset className="space-y-1.5 text-sm">
          {(
            [
              ["account", "Save to my account", "Used in all your sessions."],
              ["session", "Only this session", "Overrides your account key here."],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className="flex cursor-pointer items-start gap-2.5">
              <input type="radio" name="scope" checked={scope === value} onChange={() => setScope(value)} className="mt-1 accent-[var(--ink)]" />
              <span>
                <span className="font-medium">{label}</span> <span className="text-muted">— {hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {error && <p className="animate-pop rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}

      <button className={`${buttonClass} w-full py-2.5`} disabled={pending || !key.trim()}>
        {pending ? "Checking with Groq…" : (submitLabel ?? "Verify & save")}
      </button>
    </form>
  );
}
