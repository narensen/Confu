"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteGroqKey } from "@/app/settings/actions";
import { eyebrowClass, ghostButtonClass } from "@/components/ui";
import type { KeyInfo } from "@/lib/groq-keys";
import { GroqKeyForm } from "./GroqKeyForm";

type Override = { sessionId: string; title: string; last4: string };

export function KeyManager({ initialAccount, initialOverrides }: { initialAccount: KeyInfo | null; initialOverrides: Override[] }) {
  const [account, setAccount] = useState(initialAccount);
  const [overrides, setOverrides] = useState(initialOverrides);
  const [replacing, setReplacing] = useState(false);
  const [pending, start] = useTransition();

  function removeAccountKey() {
    if (!confirm("Remove your account's Groq key? Sessions without their own key will ask for one again.")) return;
    start(async () => {
      await deleteGroqKey(null);
      setAccount(null);
      setReplacing(false);
    });
  }

  function removeOverride(o: Override) {
    if (!confirm(`Remove the key for “${o.title}”? That session will use your account key instead.`)) return;
    start(async () => {
      await deleteGroqKey(o.sessionId);
      setOverrides((list) => list.filter((x) => x.sessionId !== o.sessionId));
    });
  }

  return (
    <div className="px-5 py-5 sm:px-6">
      <p className="text-sm leading-relaxed text-muted">
        Confu&apos;s AI runs on your own Groq account. Get a key at{" "}
        <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="font-medium text-ink underline underline-offset-4">
          console.groq.com/keys
        </a>{" "}
        (there&apos;s a free tier). It&apos;s checked with Groq, then encrypted before it&apos;s stored; we only ever show its last four characters.
      </p>
      <p className="mt-3 rounded-lg border border-dashed border-ink/40 bg-paper px-3 py-2 text-xs leading-relaxed text-muted">
        <span className="font-medium text-ink">Our promise:</span> your key is used only to run the requests you make in Confu. We never use it for anything
        else, and never share, sell or log it.{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          Privacy Policy
        </Link>
      </p>

      <div className="mt-5">
        {account && !replacing ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-paper px-4 py-3">
            <div>
              <p className="font-mono text-sm">gsk_••••••••{account.last4}</p>
              <p className="mt-0.5 text-xs text-muted">Account key · used in every session · encrypted</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setReplacing(true)} className={`${ghostButtonClass} py-1.5 text-xs`}>
                Replace
              </button>
              <button
                onClick={removeAccountKey}
                disabled={pending}
                className="rounded-lg px-3 py-1.5 text-xs text-muted transition hover:bg-danger/10 hover:text-danger"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <GroqKeyForm
              sessionId={null}
              submitLabel={account ? "Verify & replace" : "Verify & save"}
              onSaved={(info) => {
                setAccount(info);
                setReplacing(false);
              }}
            />
            {replacing && (
              <button onClick={() => setReplacing(false)} className="text-xs text-muted hover:text-ink">
                Cancel
              </button>
            )}
          </div>
        )}
      </div>

      {overrides.length > 0 && (
        <div className="mt-6">
          <p className={eyebrowClass}>Session-specific keys</p>
          <p className="mt-1 text-xs text-muted">These sessions use their own key instead of your account key.</p>
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {overrides.map((o) => (
              <li key={o.sessionId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Link href={`/session/${o.sessionId}`} className="min-w-0 flex-1 truncate hover:underline">
                  {o.title}
                </Link>
                <span className="font-mono text-xs text-muted">…{o.last4}</span>
                <button onClick={() => removeOverride(o)} disabled={pending} className="text-xs text-muted hover:text-danger">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
