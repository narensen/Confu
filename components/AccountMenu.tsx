"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { signOut } from "@/app/(auth)/actions";
import { openFeedback } from "@/components/Feedback";
import { canInstall, promptInstall, subscribeInstall } from "@/lib/pwa/install";
import { ago, formatTokens } from "@/lib/format-usage";
import { setTheme, useTheme, type Theme } from "@/lib/theme";

type Usage = {
  plan: "own" | "server" | "trial";
  status: "blocked" | "ok" | "stale" | "none";
  used24h: number;
  dailyLimit: number | null;
  dailyLimitEstimated: boolean;
  checkedAt: string | null;
};

type Props = {
  name: string | null;
  email: string | null;
  owner: boolean;
  ai: { provider: string; label: string } | null; // the account's own AI; null when none
};

// The black name button in the header and its account dropdown.
export function AccountMenu({ name, email, owner, ai }: Props) {
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
        aria-label={display}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void loadUsage();
        }}
        className="flex max-w-40 items-center gap-2 rounded-full border border-line bg-panel py-1 pr-2.5 pl-1 text-sm font-medium text-ink transition duration-200 ease-fluid hover:border-ink/40 hover:bg-paper aria-expanded:border-ink/40 aria-expanded:bg-paper sm:max-w-56"
      >
        <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-yellow-300 font-serif text-xs text-ink">
          {display.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden truncate sm:inline">{display}</span>
        {owner && <span className="shrink-0 rounded bg-yellow-400 px-1 font-mono text-[9px] font-bold tracking-wider text-ink uppercase">Admin</span>}
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
          className="animate-pop absolute top-full right-0 z-50 mt-2 w-80 origin-top-right overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard"
        >
          {/* Who */}
          <div className="border-b border-line px-4 py-3.5">
            <div className="flex items-center gap-2">
              <p className="min-w-0 truncate font-serif text-lg leading-tight">{name?.trim() || "Your account"}</p>
              {owner && <span className="shrink-0 rounded bg-yellow-400 px-1.5 py-px font-mono text-[10px] tracking-wider text-ink uppercase">Admin</span>}
            </div>
            {email && <p className="mt-0.5 truncate text-xs text-muted">{email}</p>}
          </div>

          {/* Usage */}
          <div className="border-b border-line px-4 py-3.5">
            <p className="font-mono text-[10px] tracking-widest text-muted uppercase">
              {usage !== "loading" && usage?.plan === "trial" ? "Free prompts" : usage !== "loading" && usage?.plan === "server" ? "Server keys today" : "AI usage today"}
            </p>
            <UsageBlock usage={usage} />
          </div>

          {/* The account's AI */}
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] tracking-widest text-muted uppercase">Your AI</p>
              <p className="mt-0.5 truncate text-sm">
                {ai ? (
                  <>
                    {ai.provider} <span className="font-mono text-xs text-muted">{ai.label}</span>
                  </>
                ) : (
                  <span className="text-muted">Nothing connected</span>
                )}
              </p>
            </div>
            <Link
              role="menuitem"
              href="/settings#api-key"
              onClick={() => setOpen(false)}
              className="shrink-0 rounded-md border border-ink px-2.5 py-1 text-xs font-medium transition hover:bg-ink hover:text-white"
            >
              {ai ? "Change" : "Connect"}
            </Link>
          </div>

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
            <Link
              role="menuitem"
              href="/settings#invite"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition hover:bg-paper"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7Zm0 0h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7Z" />
              </svg>
              Invite friends
            </Link>
            <Link
              role="menuitem"
              href="/friends"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition hover:bg-paper"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <circle cx="9" cy="8" r="3" />
                <path d="M3 19v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 1 .1M19 8v6M16 11h6" />
              </svg>
              Friends
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
              href="/threads"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition hover:bg-paper"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M5 5h14v10H8l-3 3z" />
              </svg>
              Threads
            </Link>
            <Link
              role="menuitem"
              href="/spaces"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition hover:bg-paper"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M4 10.5 12 4l8 6.5V20H4zM9 20v-6h6v6" />
              </svg>
              Learning spaces
            </Link>
            <Link
              role="menuitem"
              href="/map"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition hover:bg-paper"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm-.6-15.1 8.8 3.2M16.6 10.6l-7.4 7M6.4 7l1.2 10" />
              </svg>
              Literature map
            </Link>
            <ThemeSwitch />
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
        Connect your AI to start.{" "}
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
        {left === 0 ? "Connect your own AI to keep going (Groq has a free tier)." : "On the server's keys, no setup. Connect your own AI any time."}{" "}
        <Link href="/settings#api-key" className="underline underline-offset-2 hover:text-ink">
          Connect
        </Link>
      </p>
    </div>
  );
}

// Appearance: the system's setting, or always light or dark.
function ThemeSwitch() {
  const theme = useTheme();
  return (
    <div className="flex items-center justify-between gap-3 px-2.5 py-2 text-sm">
      <span className="flex items-center gap-2.5">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
        Appearance
      </span>
      <span className="flex rounded-md border border-ink/25 p-0.5 text-[11px]" role="radiogroup" aria-label="Appearance">
        {(["system", "light", "dark"] as Theme[]).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={theme === t}
            onClick={() => setTheme(t)}
            className={`rounded px-1.5 py-0.5 capitalize transition ${theme === t ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
          >
            {t === "system" ? "Auto" : t}
          </button>
        ))}
      </span>
    </div>
  );
}
