"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { signOut } from "@/app/(auth)/actions";
import { openFeedback } from "@/components/Feedback";
import { canInstall, promptInstall, subscribeInstall } from "@/lib/pwa/install";
import { ago, formatTokens } from "@/lib/format-usage";

type Usage = {
  plan: "free" | "pro" | "trial";
  status: "blocked" | "ok" | "stale" | "none";
  used24h: number;
  dailyLimit: number | null;
  dailyLimitEstimated: boolean;
  checkedAt: string | null;
};

type Props = {
  name: string | null;
  email: string | null;
  plan: "free" | "pro";
  owner: boolean;
  keyLast4: string | null; // the account key; null when none
};

// The black name button in the header and its account dropdown.
export function AccountMenu({ name, email, plan, owner, keyLast4 }: Props) {
  const pro = plan === "pro";
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<Usage | null | "loading">(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const display = name?.trim() || email || "Account";
  const installable = useSyncExternalStore(subscribeInstall, canInstall, () => false);

  // Usage is fetched when the menu opens, so normal page loads cost nothing.
  const loadUsage = useCallback(async () => {
    setUsage("loading");
    try {
      const res = await fetch("/api/usage", { cache: "no-store" });
      setUsage(res.ok ? ((await res.json()) as { main: Usage | null }).main : null);
    } catch {
      setUsage(null);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && !pro) void loadUsage();
        }}
        className="flex max-w-56 items-center gap-2 rounded-lg border border-ink bg-ink px-3 py-1.5 text-sm font-medium text-white transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-[2px_2px_0_0_#facc15] active:translate-y-0"
      >
        <span className="truncate">{display}</span>
        {pro && <span className="shrink-0 rounded bg-yellow-400 px-1 font-mono text-[9px] font-bold tracking-wider text-ink uppercase">{owner ? "Admin" : "Pro"}</span>}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden
          className={`shrink-0 transition-transform duration-300 ease-fluid ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="animate-pop absolute top-full right-0 z-50 mt-2 w-80 origin-top-right overflow-hidden rounded-xl border border-ink bg-panel shadow-hard"
        >
          {/* Who */}
          <div className="border-b border-line px-4 py-3.5">
            <div className="flex items-center gap-2">
              <p className="min-w-0 truncate font-serif text-lg leading-tight">{name?.trim() || "Your account"}</p>
              <span
                className={`shrink-0 rounded px-1.5 py-px font-mono text-[10px] tracking-wider uppercase ${pro ? "bg-yellow-400 text-ink" : "border border-ink/30 text-muted"}`}
              >
                {owner ? "Admin" : pro ? "Pro" : "Free"}
              </span>
            </div>
            {email && <p className="mt-0.5 truncate text-xs text-muted">{email}</p>}
          </div>

          {/* Usage: Free only (Pro runs on Confu's keys) */}
          {!pro && (
            <div className="border-b border-line px-4 py-3.5">
              <p className="font-mono text-[10px] tracking-widest text-muted uppercase">{usage !== "loading" && usage?.plan === "trial" ? "Free trial" : "Groq usage today"}</p>
              <UsageBlock usage={usage} />
            </div>
          )}

          {/* Key: Free only */}
          {!pro && (
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] tracking-widest text-muted uppercase">API key</p>
                <p className="mt-0.5 truncate font-mono text-sm">{keyLast4 ? `gsk_••••${keyLast4}` : <span className="text-muted">No key added</span>}</p>
              </div>
              <Link
                role="menuitem"
                href="/settings#api-key"
                onClick={() => setOpen(false)}
                className="shrink-0 rounded-md border border-ink px-2.5 py-1 text-xs font-medium transition hover:bg-ink hover:text-white"
              >
                {keyLast4 ? "Change" : "Add a key"}
              </Link>
            </div>
          )}

          {/* Actions */}
          <div className="p-1.5">
            {owner && (
              <Link
                role="menuitem"
                href="/admin"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition hover:bg-paper"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M3 3v18h18M7 15l4-4 3 3 5-6" />
                </svg>
                Admin dashboard
              </Link>
            )}
            <Link
              role="menuitem"
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition hover:bg-paper"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
              </svg>
              Settings
            </Link>
            {!pro && (
              <Link
                role="menuitem"
                href="/pricing"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition hover:bg-yellow-100"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />
                </svg>
                Upgrade to Pro
              </Link>
            )}
            <Link
              role="menuitem"
              href="/settings#invite"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition hover:bg-paper"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7Zm0 0h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7Z" />
              </svg>
              Invite friends, get Pro
            </Link>
            <Link
              role="menuitem"
              href="/rooms"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition hover:bg-paper"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8" />
              </svg>
              Study rooms
            </Link>
            <Link
              role="menuitem"
              href="/wrapped"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition hover:bg-paper"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M3 3v18h18M7 16v-3M11 16V8M15 16v-5M19 16V5" />
              </svg>
              Your month
            </Link>
            {installable && (
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setOpen(false);
                  void promptInstall();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-paper"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" />
                </svg>
                Install Confu app
              </button>
            )}
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                openFeedback();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-paper"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Send feedback
            </button>
            <form action={signOut}>
              <button
                role="menuitem"
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-danger/10 hover:text-danger"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function UsageBlock({ usage }: { usage: Usage | null | "loading" }) {
  if (usage === "loading") return <div className="skeleton mt-2 h-14 rounded" />;
  if (!usage) {
    return (
      <p className="mt-1.5 text-sm text-muted">
        Add a key to start.{" "}
        <Link href="/settings#api-key" className="underline underline-offset-2 hover:text-ink">
          Settings
        </Link>
      </p>
    );
  }

  if (usage.plan === "trial") return <TrialBlock used={usage.used24h} total={usage.dailyLimit ?? 0} />;

  const blocked = usage.status === "blocked";
  const stale = usage.status === "stale";
  const limit = usage.dailyLimit;
  const usedShare = blocked ? 1 : limit ? Math.min(1, usage.used24h / limit) : 0;
  const leftPct = Math.round((1 - usedShare) * 100);
  const approx = usage.dailyLimitEstimated || stale ? "~" : "";
  const tone = blocked || leftPct < 10 ? "bg-danger" : leftPct < 30 ? "bg-warn" : "bg-ink";
  const text = blocked || leftPct < 10 ? "text-danger" : leftPct < 30 ? "text-warn" : "text-ink";

  return (
    <div className="mt-2">
      {limit !== null ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className={`font-serif text-2xl leading-none ${text}`}>
              {blocked ? "0%" : `${approx}${leftPct}%`}
              <span className="ml-1.5 font-sans text-xs text-muted">{blocked ? "limit reached" : "left today"}</span>
            </span>
            <span className="font-mono text-[11px] text-muted">
              {formatTokens(usage.used24h)} / {usage.dailyLimitEstimated ? "~" : ""}
              {formatTokens(limit)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Daily tokens used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(usedShare * 100)}
            className={`mt-2 h-2 overflow-hidden rounded-full bg-line ${stale ? "opacity-60" : ""}`}
          >
            <div className={`h-full rounded-full transition-[width] duration-700 ease-fluid ${tone}`} style={{ width: `${usedShare * 100}%` }} />
          </div>
        </>
      ) : (
        <p className="text-sm">{formatTokens(usage.used24h)} tokens used in the last 24 h</p>
      )}
      <p className="mt-2 text-[11px] text-muted">
        {blocked
          ? "Frees up gradually; Confu re-checks automatically."
          : usage.status === "none"
            ? "Nothing used yet today."
            : `Checked ${ago(usage.checkedAt)}${stale ? ", may be out of date" : ""}.`}
        {usage.dailyLimitEstimated && !blocked ? " ~ = Groq free-tier estimate." : ""}{" "}
        <Link href="/settings#usage" className="underline underline-offset-2 hover:text-ink">
          Details
        </Link>
      </p>
    </div>
  );
}

// Free trial: counted in prompts, once (not a daily allowance).
function TrialBlock({ used, total }: { used: number; total: number }) {
  const left = Math.max(0, total - used);
  const share = total ? left / total : 0;
  const tone = left === 0 ? "bg-danger" : left <= 3 ? "bg-warn" : "bg-ink";
  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className={`font-serif text-2xl leading-none ${left === 0 ? "text-danger" : left <= 3 ? "text-warn" : ""}`}>
          {left}
          <span className="ml-1.5 font-sans text-xs text-muted">of {total} free prompts left</span>
        </span>
        <span className="font-mono text-[11px] text-muted">{Math.round(share * 100)}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Free prompts left"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={left}
        className="mt-2 h-2 overflow-hidden rounded-full bg-line"
      >
        <div className={`h-full rounded-full transition-[width] duration-700 ease-fluid ${tone}`} style={{ width: `${share * 100}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-muted">
        {left === 0 ? "Add your own Groq key (it's free) to keep going." : "On Confu's keys, no setup. Add your own Groq key any time."}{" "}
        <Link href="/settings#api-key" className="underline underline-offset-2 hover:text-ink">
          Add key
        </Link>
      </p>
    </div>
  );
}
