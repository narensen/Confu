"use client";

import { useEffect } from "react";
import "./globals.css";
import { reportClientError } from "@/lib/telemetry";

// Last resort, when even the root layout fails. It replaces the whole
// document, so it brings its own <html>, <body> and styles.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest?: unknown }).digest ?? "") : "";

  useEffect(() => {
    if (!digest) reportClientError(error);
  }, [error, digest]);

  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col items-center justify-center bg-paper px-6 text-center font-sans text-ink">
        <title>Something went wrong · Confu</title>
        <p className="font-serif text-xl font-semibold tracking-tight">
          Confu<span className="text-yellow-500">.</span>
        </p>
        <h1 className="mt-6 max-w-lg font-serif text-4xl leading-tight">Confu hit a problem loading.</h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          It&apos;s been reported. Your work is saved. Try again, or email{" "}
          <a href="mailto:confuedu.ai@gmail.com" className="underline underline-offset-2">
            confuedu.ai@gmail.com
          </a>{" "}
          if it keeps happening.
        </p>
        <button type="button" onClick={() => retry()} className="mt-7 rounded-lg border border-ink bg-ink px-4 py-2 text-sm font-medium text-white">
          Try again
        </button>
        {digest && <p className="mt-6 font-mono text-[11px] text-muted">Reference: {digest}</p>}
      </body>
    </html>
  );
}
