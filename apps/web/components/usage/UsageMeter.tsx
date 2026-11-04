"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AI_USED_EVENT } from "@/lib/ai-errors";
import { ago, formatTokens } from "@/lib/format-usage";

type Main = {
  plan: "own" | "server" | "trial";
  status: "blocked" | "ok" | "stale" | "none";
  used24h: number;
  dailyLimit: number | null;
  dailyLimitEstimated: boolean;
  checkedAt: string | null;
  blockedSince: string | null;
};

// Compact usage chip for the tutor bar: tokens used today on the student's
// own AI (and, for Groq keys, how much of the daily allowance is left). It
// never shows a stale "limit reached": while blocked it re-checks every
// minute (the server throttles this), so it clears once tokens free up.
export function UsageMeter({ sessionId, keyId, keyTag, keyName }: { sessionId: string; keyId?: string | null; keyTag?: string | null; keyName?: string }) {
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
    let timers = [window.setTimeout(load, 0)];
    // An answer's usage is recorded as soon as it finishes; the progress-notes
    // update that follows lands a few seconds later. Refresh for both.
    const onUsed = () => {
      timers.forEach(window.clearTimeout);
      timers = [window.setTimeout(load, 2500), window.setTimeout(load, 9000)];
    };
    window.addEventListener(AI_USED_EVENT, onUsed);
    return () => {
      window.removeEventListener(AI_USED_EVENT, onUsed);
      timers.forEach(window.clearTimeout);
    };
  }, [load, keyId]);

  // While Groq is refusing the key, keep checking so "limit reached" clears
  // as soon as tokens free up (each result reschedules the next check).
  useEffect(() => {
    if (main?.status !== "blocked" || main.plan === "trial") return;
    const next = window.setTimeout(load, 65_000);
    return () => window.clearTimeout(next);
  }, [main, load]);

  const left = main?.dailyLimit ? Math.max(0, 1 - main.used24h / main.dailyLimit) : null;
  const stale = main?.status === "stale";
  const blocked = main?.status === "blocked";

  let label: string | null = null;
  let suffix = ""; // dropped when the tutor panel is narrow
  if (main?.plan === "trial") {
    const n = Math.max(0, (main.dailyLimit ?? 0) - main.used24h);
    label = blocked ? "free prompts used" : `${n} free prompt${n === 1 ? "" : "s"} left`;
  }
  else if (blocked) label = "limit reached";
  else if (main && main.status !== "none") {
    label = left !== null ? `${stale ? "~" : ""}${Math.round(left * 100)}%` : formatTokens(main.used24h);
    suffix = left !== null ? " left" : " today";
  }
  // Nothing used yet: just the provider's name (the tooltip says the rest).

  const tone = blocked ? "text-danger" : stale ? "text-muted/70" : left !== null && left < 0.1 ? "text-danger" : left !== null && left < 0.3 ? "text-warn" : "text-muted";
  const on = keyName ? `On ${keyName}. ` : "";
  const title = !main
    ? `${on}Usage`
    : main.status === "none" && main.plan === "own"
      ? `${on}No usage yet. See Settings → Usage.`
    : main.plan === "trial"
      ? `Free prompts on the server's keys: ${main.used24h} of ${main.dailyLimit} used. Connect your own AI to keep going after that.`
      : main.plan === "server"
      ? `Owner, on the server's keys: ${formatTokens(main.used24h)} tokens used in the last 24 h.`
      : blocked
      ? `${on}Groq refused this key at ${new Date(main.blockedSince!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} for its daily limit. Re-checking every minute; it frees up gradually.`
      : `${on}${formatTokens(main.used24h)} tokens used here in the last 24 h${main.dailyLimit ? ` of ${main.dailyLimitEstimated ? "~" : ""}${formatTokens(main.dailyLimit)} per day` : ""}. Last checked ${ago(main.checkedAt)}${stale ? " (may be out of date)" : ""}. See Settings → Usage.`;

  if (!label && !keyTag && main?.plan !== "server") return null;
  return (
    <Link
      href="/settings#usage"
      title={title}
      className="my-2.5 mr-1 flex shrink-0 items-center gap-2 rounded-md border border-line px-2 font-mono text-[11px] whitespace-nowrap text-muted transition hover:border-ink hover:text-ink"
    >
      {main?.plan === "trial" ? (
        <span className="rounded border border-ink/40 px-1 text-[9px] font-bold text-ink uppercase">Trial</span>
      ) : main?.plan === "server" ? (
        <span className="rounded bg-yellow-400 px-1 text-[9px] font-bold text-ink uppercase">Admin</span>
      ) : (
        keyTag && <span>{keyTag}</span>
      )}
      {label && (
        <span className={`flex items-center gap-1.5 ${tone}`}>
          {left !== null && !blocked && (
            <span className={`h-1.5 w-8 overflow-hidden rounded-full bg-line ${stale ? "opacity-50" : ""}`}>
              <span className="block h-full rounded-full bg-current transition-[width] duration-500" style={{ width: `${left * 100}%` }} />
            </span>
          )}
          {label}
          {/* "today" / "left" only when the tutor panel has room (it's an @container). */}
          {suffix && <span className="hidden @lg:inline">{suffix}</span>}
          {stale && <span className="rounded border border-dashed border-ink/30 px-1 text-[9px] uppercase">stale</span>}
        </span>
      )}
    </Link>
  );
}
