"use client";

import Link from "next/link";
import { GroqKeyForm } from "@/components/keys/GroqKeyForm";
import { eyebrowClass } from "@/components/ui";
import type { KeyInfo } from "@/lib/groq-keys";

// Shown in place of the tutor when a regular (non-admin) user has no usable
// Groq key for this session.
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
            <p className={eyebrowClass}>Bring your own key</p>
            <h2 className="mt-1 font-serif text-2xl leading-tight">Add your Groq API key</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              The tutor, planner and figure reader run on your own Groq account. You can still read your PDFs without a key.
            </p>
          </header>

          {notice && <p className="animate-pop rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{notice}</p>}

          <ol className="space-y-3 text-sm">
            {[
              <>
                Open{" "}
                <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
                  console.groq.com/keys
                </a>{" "}
                and sign in (there&apos;s a free tier).
              </>,
              <>
                Create an API key and copy it. It starts with <code className="font-mono text-xs">gsk_</code>.
              </>,
              <>Paste it below and choose where to save it.</>,
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-ink font-mono text-[11px]">{i + 1}</span>
                <span className="pt-0.5 leading-relaxed text-muted">{step}</span>
              </li>
            ))}
          </ol>

          <GroqKeyForm sessionId={sessionId} allowScopeChoice onSaved={onSaved} />

          <p className="text-[11px] leading-relaxed text-muted">
            <span className="font-medium text-ink">We only use your key to run the requests you make here.</span> We never share,
            sell or log it. It&apos;s checked with Groq, then encrypted before it&apos;s stored, and only its last four characters
            are ever shown. Usage is billed to your Groq account. Remove it any time in{" "}
            <Link href="/settings" className="underline underline-offset-2">
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
