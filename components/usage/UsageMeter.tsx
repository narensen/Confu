"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AI_USED_EVENT } from "@/lib/ai-errors";
import { ago, formatTokens } from "@/lib/format-usage";

type Main = {
  status: "blocked" | "ok" | "stale" | "none";
  used24h: number;
  dailyLimit: number | null;
  dailyLimitEstimated: boolean;
  checkedAt: string | null;
  blockedSince: string | null;
};

// Compact "how much of today's Groq allowance is left" chip for the tutor bar.
// It never shows a stale "limit reached": while blocked it re-checks with Groq
// every minute (the server throttles this), so it clears once tokens free up.
export function UsageMeter({ sessionId, keyId, keyLast4 }: { sessionId: string; keyId?: string | null; keyLast4?: string | null }) {
  const [main, setMain] = useState<Main | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/usage?sessionId=${sessionId}`, { cache: "no-store" });
      if (!res.ok) return;
      setMain(((await res.json()) as { main: Main | null }).main);
    } catch {}
  }, [sessionId]);

  // keyId: switching keys reloads, since usage is tracked per key.
  useEffect(() => {
    let soon = window.setTimeout(load, 0);
    // Usage is recorded just after each response finishes; give it a moment.
    const onUsed = () => {
      window.clearTimeout(soon);
      soon = window.setTimeout(load, 2500);
    };
    window.addEventListener(AI_USED_EVENT, onUsed);
    return () => {
      window.removeEventListener(AI_USED_EVENT, onUsed);
      window.clearTimeout(soon);
    };
  }, [load, keyId]);

  // While Groq is refusing the key, keep checking so "limit reached" clears
  // as soon as tokens free up (each result reschedules the next check).
  useEffect(() => {
    if (main?.status !== "blocked") return;
    const next = window.setTimeout(load, 65_000);
    return () => window.clearTimeout(next);
  }, [main, load]);

  const left = main?.dailyLimit ? Math.max(0, 1 - main.used24h / main.dailyLimit) : null;
  const stale = main?.status === "stale";
  const blocked = main?.status === "blocked";

  let label: string | null = null;
  if (blocked) label = "limit reached";
  else if (main && main.status !== "none") label = left !== null ? `${stale ? "~" : ""}${Math.round(left * 100)}% left` : `${formatTokens(main.used24h)} today`;
  else if (keyLast4) label = "no usage yet";

  const tone = blocked ? "text-danger" : stale ? "text-muted/70" : left !== null && left < 0.1 ? "text-danger" : left !== null && left < 0.3 ? "text-warn" : "text-muted";
  const title = !main
    ? "Usage"
    : blocked
      ? `Groq refused this key at ${new Date(main.blockedSince!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} for its daily limit. Re-checking every minute; it frees up gradually.`
      : `${formatTokens(main.used24h)} tokens used here in the last 24 h${main.dailyLimit ? ` of ${main.dailyLimitEstimated ? "~" : ""}${formatTokens(main.dailyLimit)} per day` : ""}. Last checked with Groq ${ago(main.checkedAt)}${stale ? " (may be out of date)" : ""}. See Settings → Usage.`;

  if (!label && !keyLast4) return null;
  return (
    <Link
      href="/settings#usage"
      title={title}
      className="my-2.5 mr-1 flex items-center gap-2 rounded-md border border-line px-2 font-mono text-[11px] text-muted transition hover:border-ink hover:text-ink"
    >
      {keyLast4 && <span>…{keyLast4}</span>}
      {label && (
        <span className={`flex items-center gap-1.5 ${tone}`}>
          {left !== null && !blocked && (
            <span className={`h-1.5 w-8 overflow-hidden rounded-full bg-line ${stale ? "opacity-50" : ""}`}>
              <span className="block h-full rounded-full bg-current transition-[width] duration-500" style={{ width: `${left * 100}%` }} />
            </span>
          )}
          {label}
          {stale && <span className="rounded border border-dashed border-ink/30 px-1 text-[9px] uppercase">stale</span>}
        </span>
      )}
    </Link>
  );
}
