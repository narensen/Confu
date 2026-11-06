"use client";

import Link from "next/link";
import { useEffect } from "react";
import { openFeedback } from "@/components/Feedback";
import { reportClientError } from "@/lib/telemetry";

// Shown when a page fails to render. Errors from the server carry a digest and
// are already logged by instrumentation.ts; browser-side ones are reported here.
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest?: unknown }).digest ?? "") : "";

  useEffect(() => {
    if (!digest) reportClientError(error);
  }, [error, digest]);

  return (
    <main className="animate-enter flex flex-1 flex-col items-center justify-center bg-paper px-6 py-20 text-center">
      <p className="font-mono text-[11px] font-medium tracking-[0.12em] text-muted uppercase">Something went wrong</p>
      <h1 className="mt-2 max-w-lg font-serif text-4xl leading-tight tracking-tight">That page didn&apos;t load properly.</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
        It&apos;s been reported automatically. It&apos;s often a one-off, so try again. Your work is saved.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-lg border border-ink bg-ink px-4 py-2 text-sm font-medium text-white transition"
        >
          Try again
        </button>
        <Link href="/dashboard" className="rounded-lg border border-ink bg-panel px-4 py-2 text-sm font-medium transition">
          Go to your library
        </Link>
        <button
          type="button"
          onClick={() => openFeedback({ kind: "bug", message: "A page failed to load. I was trying to: " })}
          className="rounded-lg px-4 py-2 text-sm font-medium text-muted underline-offset-4 transition hover:text-ink hover:underline"
        >
          Tell us what happened
        </button>
      </div>
      {digest && <p className="mt-6 font-mono text-[11px] text-muted">Reference: {digest}</p>}
    </main>
  );
}
