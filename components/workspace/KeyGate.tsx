"use client";

import Link from "next/link";
import { KeyForm } from "@/components/keys/KeyForm";
import { eyebrowClass } from "@/components/ui";
import type { KeyInfo } from "@/lib/ai-keys";

// Shown in place of the tutor when there's no AI connected for this session
// (and no free prompts left).
export function KeyGate({
  sessionId,
  notice,
  onSaved,
  onClose,
}: {
  sessionId: string;
  notice: string | null;
  onSaved: (info: KeyInfo) => void;
  onClose?: () => void;
}) {
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
        <div className="animate-enter mx-auto max-w-md space-y-6">
          <header>
            <p className={eyebrowClass}>Bring your own AI</p>
            <h2 className="mt-1 font-serif text-2xl leading-tight">Connect the AI you&apos;ll study with</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              The tutor, planner and figure reader run on your own AI account: OpenRouter, Groq (free tier), OpenAI, Anthropic, Google Gemini, or
              your own model server. You can still read your files without one.
            </p>
          </header>

          {notice && <p className="animate-pop rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{notice}</p>}

          <KeyForm sessionId={sessionId} allowScopeChoice next={`/session/${sessionId}`} onSaved={(info) => onSaved(info)} />

          <p className="text-[11px] leading-relaxed text-muted">
            <span className="font-medium text-ink">We only use your key to run the requests you make here.</span> We never share, sell or log it.
            It&apos;s checked with its provider, then encrypted before it&apos;s stored, and only its last four characters are ever shown. Usage is
            billed to your account with that provider. Change models or remove it any time in{" "}
            <Link href="/settings#api-key" className="underline underline-offset-2">
              Settings
            </Link>
            . See our{" "}
            <Link href="/privacy" className="underline underline-offset-2">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
