"use client";

import { useState } from "react";
import { buttonClass, eyebrowClass, inputClass } from "@/components/ui";
import { GROQ_KEY_HEADER, looksLikeGroqKey } from "@/lib/ai-key";
import { keyNotice, saveKey } from "@/lib/ai-key-store";

// Shown in place of the tutor until a regular (non-admin) user adds their own
// Groq key for this session.
export function KeyGate({ sessionId, onClose }: { sessionId: string; onClose?: () => void }) {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(() => keyNotice(sessionId));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = key.trim();
    if (!looksLikeGroqKey(value)) return setError("That doesn't look like a Groq API key. They start with gsk_.");
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/groq-key", { method: "POST", headers: { [GROQ_KEY_HEADER]: value } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't verify the key.");
      saveKey(sessionId, value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't verify the key.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {onClose && (
        <div className="flex h-12 shrink-0 items-center justify-end border-b border-ink px-3">
          <button onClick={onClose} aria-label="Hide" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-paper">
            ✕
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <form onSubmit={submit} className="animate-enter mx-auto max-w-md space-y-6">
          <header>
            <p className={eyebrowClass}>Bring your own key</p>
            <h2 className="mt-1 font-serif text-2xl leading-tight">Add your Groq API key for this session</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              The tutor, planner and figure reader run on your own Groq account. You can still read your PDFs without a key.
            </p>
          </header>

          <ol className="space-y-3 text-sm">
            {[
              <>
                Open{" "}
                <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
                  console.groq.com/keys
                </a>{" "}
                and sign in (there&apos;s a free tier).
              </>,
              <>Create an API key and copy it. It starts with <code className="font-mono text-xs">gsk_</code>.</>,
              <>Paste it below.</>,
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-ink font-mono text-[11px]">{i + 1}</span>
                <span className="pt-0.5 leading-relaxed text-muted">{step}</span>
              </li>
            ))}
          </ol>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Groq API key</span>
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
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
          </label>

          {error && <p className="animate-pop rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}

          <button className={`${buttonClass} w-full py-2.5`} disabled={pending || !key.trim()}>
            {pending ? "Checking with Groq…" : "Verify & use for this session"}
          </button>

          <p className="text-[11px] leading-relaxed text-muted">
            Your key is kept only in this browser, for this session. It&apos;s sent with each request to run the AI and is
            never saved on our servers. Usage is billed to your Groq account. You can remove it any time.
          </p>
        </form>
      </div>
    </div>
  );
}
