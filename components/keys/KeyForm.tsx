"use client";

import { useState, useTransition } from "react";
import { saveAiKey } from "@/app/(app)/settings/actions";
import { buttonClass, inputClass } from "@/components/ui";
import { connectHref } from "@/lib/ai/openrouter";
import { keyProblem, PROVIDER_ORDER, PROVIDERS, type ProviderId } from "@/lib/ai/providers";
import type { KeyInfo } from "@/lib/ai-keys";

// Bring your own AI: sign in with OpenRouter (one click, their credits), or
// paste a key from any provider → checked with the provider → stored
// encrypted. `sessionId` null saves for the account; with `allowScopeChoice`
// the student picks account vs this session.
export function KeyForm({
  sessionId,
  allowScopeChoice = false,
  submitLabel,
  next,
  onSaved,
}: {
  sessionId: string | null;
  allowScopeChoice?: boolean;
  submitLabel?: string;
  next: string; // where "Connect OpenRouter" comes back to
  onSaved: (info: KeyInfo, models: string[]) => void;
}) {
  const [provider, setProvider] = useState<ProviderId>("groq");
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [show, setShow] = useState(false);
  const [scope, setScope] = useState<"account" | "session">("account");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const p = PROVIDERS[provider];
  const target = allowScopeChoice && scope === "account" ? null : sessionId;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = key.trim();
    const problem = keyProblem(provider, value) ?? (provider === "custom" && !baseUrl.trim() ? "Enter the server's address." : null);
    if (problem) return setError(problem);
    setError(null);
    start(async () => {
      const res = await saveAiKey({ provider, key: value, baseUrl: baseUrl.trim(), sessionId: target });
      if (res.ok) {
        setKey("");
        onSaved(res.info, res.models);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-5">
      {allowScopeChoice && sessionId && (
        <fieldset className="space-y-1.5 text-sm">
          <legend className="sr-only">Where to save it</legend>
          {(
            [
              ["account", "Use it in all my sessions", "Saved to your account."],
              ["session", "Only this session", "Overrides your account's AI here."],
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

      {/* Bring your own subscription: OpenRouter's sign-in gives Confu a key of the student's own. */}
      <div className="rounded-xl border border-ink bg-paper p-4">
        <a
          href={connectHref(next, target)}
          className={`${buttonClass} w-full py-2.5`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
          </svg>
          Connect OpenRouter
        </a>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Sign in on openrouter.ai and approve Confu. It runs on your OpenRouter credits, with hundreds of models to choose from, and you can set
          a spending limit there. No key to copy.
        </p>
      </div>

      <div className="flex items-center gap-3 text-[11px] tracking-widest text-muted uppercase">
        <span className="h-px flex-1 bg-line" />
        or paste an API key
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div role="radiogroup" aria-label="Provider" className="flex flex-wrap gap-1.5">
          {PROVIDER_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={provider === id}
              onClick={() => {
                setProvider(id);
                setError(null);
              }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                provider === id ? "border-ink bg-ink text-white" : "border-ink/25 text-muted hover:border-ink hover:text-ink"
              }`}
            >
              {id === "custom" ? "Other" : PROVIDERS[id].name.replace("Google ", "")}
            </button>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-muted">
          {p.blurb}{" "}
          {p.keyUrl && (
            <>
              Get a key at{" "}
              <a href={p.keyUrl} target="_blank" rel="noreferrer" className="font-medium text-ink underline underline-offset-2">
                {p.keyUrl.replace(/^https:\/\//, "")}
              </a>
              .
            </>
          )}
        </p>

        {provider === "custom" && (
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            aria-label="Server address"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://your-server.example.com/v1"
            className={`${inputClass} font-mono`}
          />
        )}

        <div className="relative">
          <input
            type={show ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            aria-label={`${p.name} API key`}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={p.keyPlaceholder}
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

        {error && <p className="animate-pop rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}

        <button className={`${buttonClass} w-full py-2.5`} disabled={pending || (!key.trim() && provider !== "custom")}>
          {pending ? `Checking with ${provider === "custom" ? "the server" : p.name}…` : (submitLabel ?? "Verify & save")}
        </button>
      </form>
    </div>
  );
}
