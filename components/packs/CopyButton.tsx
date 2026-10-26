"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { JSON_HEADERS } from "@/lib/ai-errors";
import { track } from "@/lib/telemetry";

// "Copy into my library" for a study pack, or "Start this goal" for a template.
export function CopyButton({
  slug,
  template,
  signedIn,
  classMode,
  authorName,
  label,
  next,
}: {
  slug?: string;
  template?: string;
  signedIn: boolean;
  classMode?: boolean;
  authorName?: string | null;
  label: string;
  next: string; // back here after signing up
}) {
  const router = useRouter();
  const [share, setShare] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <div>
        <Link
          href={`/signup?next=${encodeURIComponent(next)}`}
          className="inline-flex items-center gap-2 rounded-lg border border-ink bg-ink px-5 py-2.5 text-sm font-medium text-white transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-[3px_3px_0_0_#facc15]"
        >
          Sign up free to {template ? "start" : "copy"} →
        </Link>
        <p className="mt-2 text-xs text-muted">
          Already have an account?{" "}
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="underline underline-offset-2 hover:text-ink">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      {classMode && (
        <label className="mb-3 flex cursor-pointer items-start gap-2.5 text-sm">
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]" />
          <span className="leading-relaxed">
            Share my progress with {authorName ?? "the pack's author"}
            <span className="block text-xs text-muted">Topics done, days active and reading time. Never your notes, answers or chats. You can stop any time.</span>
          </span>
        </label>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const res = await fetch("/api/packs/copy", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(template ? { template } : { slug, share }) });
            const j = (await res.json().catch(() => ({}))) as { sessionId?: string; error?: string };
            if (!res.ok || !j.sessionId) throw new Error(j.error ?? "Couldn't copy it. Try again.");
            track(template ? "template.start" : "pack.copy", { id: template ?? slug ?? "", shared: share });
            router.push(`/session/${j.sessionId}`);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't copy it. Try again.");
            setPending(false);
          }
        }}
        className="inline-flex items-center gap-2 rounded-lg border border-ink bg-ink px-5 py-2.5 text-sm font-medium text-white transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-[3px_3px_0_0_#facc15] disabled:opacity-60"
      >
        {pending && <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
        {pending ? "Setting it up…" : label}
      </button>
      {error && <p className="animate-pop mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
