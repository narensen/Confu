"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteAiKey } from "@/app/(app)/settings/actions";
import { eyebrowClass, ghostButtonClass } from "@/components/ui";
import { keyLabel, PROVIDERS } from "@/lib/ai/providers";
import type { KeyInfo } from "@/lib/ai-keys";
import { KeyForm } from "./KeyForm";
import { ModelPicker } from "./ModelPicker";
import { ask } from "@/components/dialogs";

type Override = KeyInfo & { sessionId: string; title: string };

// Settings → Your AI: the account's AI, its models, and any per-session keys.
export function KeyManager({ initialAccount, initialOverrides, serverKeys }: { initialAccount: KeyInfo | null; initialOverrides: Override[]; serverKeys: boolean }) {
  const [account, setAccount] = useState(initialAccount);
  const [known, setKnown] = useState<string[]>([]);
  const [overrides, setOverrides] = useState(initialOverrides);
  const [replacing, setReplacing] = useState(false);
  const [pending, start] = useTransition();
  // The header's account menu and the Usage section are drawn on the server.
  const router = useRouter();

  async function removeAccountKey() {
    if (!account) return;
    const what = account.via === "oauth" ? "Disconnect OpenRouter?" : `Remove your ${PROVIDERS[account.provider].name} key?`;
    if (!(await ask({ title: what, body: "Sessions without their own key will ask you to connect an AI again.", confirm: account.via === "oauth" ? "Disconnect" : "Remove key", danger: true }))) return;
    start(async () => {
      await deleteAiKey(null);
      setAccount(null);
      setReplacing(false);
      router.refresh();
    });
  }

  async function removeOverride(o: Override) {
    if (!(await ask({ title: `Remove the key for “${o.title}”?`, body: "That session will use your account's AI instead.", confirm: "Remove key", danger: true }))) return;
    start(async () => {
      await deleteAiKey(o.sessionId);
      setOverrides((list) => list.filter((x) => x.sessionId !== o.sessionId));
      router.refresh();
    });
  }

  return (
    <div className="px-5 py-5 sm:px-6">
      <p className="text-sm leading-relaxed text-muted">
        Confu runs on an AI you bring. Connect your OpenRouter account, or paste an API key from Groq, OpenAI, Anthropic, Google Gemini or any
        OpenAI-compatible server. Usage is billed to your account with them, at their prices. A key is checked with its provider, then
        encrypted before it&apos;s stored; only its last four characters are ever shown.
      </p>
      <p className="mt-3 rounded-lg border border-dashed border-ink/40 bg-paper px-3 py-2 text-xs leading-relaxed text-muted">
        <span className="font-medium text-ink">Our promise:</span> your key is used only to run the requests you make in Confu. We never use it for anything
        else, and never share, sell or log it.{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          Privacy Policy
        </Link>
      </p>
      {serverKeys && !account && (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          <span className="font-medium text-ink">Owner account:</span> until you connect an AI of your own, your requests run on the server&apos;s keys
          (GROQ_API_KEYS).
        </p>
      )}

      <div className="mt-5">
        {account && !replacing ? (
          <div className="space-y-3 rounded-lg border border-line bg-paper px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {PROVIDERS[account.provider].name}
                  {account.host && <span className="ml-1.5 font-mono text-xs font-normal text-muted">{account.host}</span>}
                </p>
                <p className="mt-0.5 font-mono text-xs text-muted">
                  {keyLabel(account.provider, account.last4, account.via)} · used in every session · encrypted
                </p>
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
                  {account.via === "oauth" ? "Disconnect" : "Remove"}
                </button>
              </div>
            </div>
            <ModelPicker
              key={account.id}
              info={account}
              scope={null}
              known={known}
              onSaved={(info) => {
                setAccount(info);
                router.refresh();
              }}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <KeyForm
              sessionId={null}
              next="/settings#api-key"
              submitLabel={account ? "Verify & replace" : "Verify & save"}
              onSaved={(info, models) => {
                setAccount(info);
                setKnown(models);
                setReplacing(false);
                router.refresh();
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
          <p className="mt-1 text-xs text-muted">These sessions use their own AI instead of your account&apos;s.</p>
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {overrides.map((o) => (
              <li key={o.sessionId} className="space-y-2 px-4 py-2.5 text-sm">
                <div className="flex items-center gap-3">
                  <Link href={`/session/${o.sessionId}`} className="min-w-0 flex-1 truncate hover:underline">
                    {o.title}
                  </Link>
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {PROVIDERS[o.provider].name} · {keyLabel(o.provider, o.last4, o.via)}
                  </span>
                  <button onClick={() => removeOverride(o)} disabled={pending} className="shrink-0 text-xs text-muted hover:text-danger">
                    Remove
                  </button>
                </div>
                <ModelPicker
                  info={o}
                  scope={o.sessionId}
                  onSaved={(info) => setOverrides((list) => list.map((x) => (x.sessionId === o.sessionId ? { ...x, models: info.models } : x)))}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
