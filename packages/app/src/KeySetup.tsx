"use client";

import { useState } from "react";
import { keyProblem, PROVIDER_ORDER, PROVIDERS, type ProviderId } from "@confu/ai/providers";
import type { DeviceKeyInfo } from "@confu/client/keys";
import { openRouterAuthUrl } from "@confu/client/openrouter";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@confu/ui/classes";
import { useHost } from "./host";
import { useDevice, useLocal } from "./local";

// The student's own AI on this device: sign in with OpenRouter, or paste a
// key. The key is checked with its provider, then sealed with a key this
// browser can't export, and is only ever sent to that provider.

export function useAiKey() {
  return useLocal((d) => d.keys.get(null), []);
}

export function KeySetup({ onSaved }: { onSaved?: (info: DeviceKeyInfo) => void }) {
  const { keys, changed } = useDevice();
  const { openRouter = true } = useHost();
  const [provider, setProvider] = useState<ProviderId>("groq");
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const p = PROVIDERS[provider];

  async function connect() {
    setError(null);
    // Back to this page; LocalApp finishes the sign-in when ?code= arrives.
    const here = new URL(window.location.href);
    here.searchParams.delete("code");
    window.location.assign(await openRouterAuthUrl(here.toString()));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = key.trim();
    const problem = keyProblem(provider, value) ?? (provider === "custom" && !baseUrl.trim() ? "Enter the server's address." : null);
    if (problem) return setError(problem);
    setError(null);
    setPending(true);
    try {
      const res = await keys.add({ provider, key: value, baseUrl: baseUrl.trim() });
      if (!res.ok) return setError(res.error);
      setKey("");
      changed();
      onSaved?.(res.info);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the key.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      {openRouter && (
        <div className="rounded-xl border border-ink bg-paper p-4">
          <button type="button" onClick={connect} className={`${buttonClass} w-full py-2.5`}>
            <LinkIcon />
            Connect OpenRouter
          </button>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Sign in on openrouter.ai and approve Confu. It runs on your OpenRouter credits, with free models too, and you can set a spending limit
            there.
          </p>
        </div>

      )}

      {openRouter && (
        <div className="flex items-center gap-3 text-[11px] tracking-widest text-muted uppercase">
          <span className="h-px flex-1 bg-line" />
          or paste an API key
          <span className="h-px flex-1 bg-line" />
        </div>
      )}

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
            placeholder="http://localhost:11434/v1"
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
          <button type="button" onClick={() => setShow((v) => !v)} className="absolute inset-y-0 right-2 my-auto h-7 rounded px-2 text-xs text-muted hover:text-ink">
            {show ? "Hide" : "Show"}
          </button>
        </div>

        {error && <p className="animate-pop rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}

        <button className={`${buttonClass} w-full py-2.5`} disabled={pending || (!key.trim() && provider !== "custom")}>
          {pending ? `Checking with ${provider === "custom" ? "the server" : p.name}…` : "Verify & save"}
        </button>
      </form>
      <p className="text-xs leading-relaxed text-muted">The key stays on this device, encrypted, and is only sent to {provider === "custom" ? "that server" : p.name}.</p>
    </div>
  );
}

// The AI in use, with a way to change or remove it.
export function KeySummary({ info, onChange }: { info: DeviceKeyInfo; onChange: () => void }) {
  const { keys, changed } = useDevice();
  const name = info.provider === "custom" ? (info.host ?? "Your server") : PROVIDERS[info.provider].name;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-ink bg-paper p-4">
        <p className={eyebrowClass}>Your AI</p>
        <p className="mt-1 text-sm font-medium">
          {name} <span className="font-normal text-muted">{info.via === "oauth" ? "· connected" : `· key ending ${info.last4}`}</span>
        </p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
          <dt className="text-muted">Tutor</dt>
          <dd className="truncate">{info.models.chat}</dd>
          <dt className="text-muted">Quick jobs</dt>
          <dd className="truncate">{info.models.fast}</dd>
        </dl>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onChange} className={`${ghostButtonClass} flex-1`}>
          Use a different AI
        </button>
        <button
          type="button"
          onClick={async () => {
            await keys.remove(null);
            changed();
          }}
          className={`${ghostButtonClass} text-danger`}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export function AiPanel({ onSaved }: { onSaved?: () => void }) {
  const { data: info } = useAiKey();
  const [replacing, setReplacing] = useState(false);
  if (info === undefined) return null;
  if (info && !replacing) return <KeySummary info={info} onChange={() => setReplacing(true)} />;
  return (
    <KeySetup
      onSaved={() => {
        setReplacing(false);
        onSaved?.();
      }}
    />
  );
}

function LinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  );
}
