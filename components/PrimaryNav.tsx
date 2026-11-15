"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { PaletteButton } from "@/components/CommandPalette";
import { useFriendNotices } from "@/components/friends/FriendsLink";
import { useReviewsDue } from "@/lib/use-reviews-due";

// The app's three places, beside the logo, with the one you're in marked by
// a pill that slides from place to place (the header stays mounted between
// pages: see app/(app)/layout.tsx). Community gathers Threads, Spaces, Rooms
// and Friends, which have tabs of their own. Phones get the same places in a
// tab bar at the bottom (MobileTabBar). In a session the header needs its
// room for the title, so it shows only the Go to… button (SessionNav).

type Place = { href: string; label: string; icon: ReactNode; here: (path: string) => boolean };

const icon = (d: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);

export const COMMUNITY_PATHS = ["/threads", "/spaces", "/rooms", "/friends"];

const PLACES: Place[] = [
  {
    href: "/dashboard",
    label: "Library",
    icon: icon(<path d="M4 4.5h4v15H4zM10 4.5h4v15h-4zM16.2 5.2l3.6-1 3.2 14.3-3.6 1z" />),
    here: (p) => p === "/dashboard" || p.startsWith("/session") || p.startsWith("/map"),
  },
  {
    href: "/review",
    label: "Review",
    icon: icon(
      <>
        <rect x="3" y="6" width="14" height="14" rx="2" />
        <path d="M7 3h12a2 2 0 0 1 2 2v12" />
      </>,
    ),
    here: (p) => p.startsWith("/review"),
  },
  {
    href: "/threads",
    label: "Community",
    icon: icon(<path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8" />),
    here: (p) => COMMUNITY_PATHS.some((c) => p.startsWith(c)),
  },
];

// The small count beside a place: reviews due, or friend requests and invites.
function useBadges(): Record<string, { n: number; label: string } | undefined> {
  const waiting = useFriendNotices();
  const due = useReviewsDue();
  return {
    "/review": due ? { n: due, label: `${due} due today` } : undefined,
    "/threads": waiting ? { n: waiting, label: `${waiting} waiting` } : undefined,
  };
}

function Count({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span aria-hidden className={`inline-flex min-w-4 items-center justify-center rounded-full bg-yellow-300 px-1 font-mono text-[11px] leading-4 font-medium text-ink ${className}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function PrimaryNav() {
  const path = usePathname();
  const badges = useBadges();
  const nav = useRef<HTMLElement>(null);
  const current = PLACES.find((p) => p.here(path))?.href ?? null;
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  // Off a main place (an admin page, say), the pill fades out where it was.
  const [shown, setShown] = useState(false);
  const badgeKey = Object.values(badges)
    .map((b) => b?.n ?? 0)
    .join(",");

  useLayoutEffect(() => {
    const measure = () => {
      const el = current ? nav.current?.querySelector<HTMLElement>(`[data-place="${current}"]`) : null;
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
      setShown(Boolean(el));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (nav.current) ro.observe(nav.current);
    return () => ro.disconnect();
  }, [current, badgeKey]);

  return (
    <nav ref={nav} aria-label="App" className="relative hidden items-center gap-0.5 md:flex">
      {pill && (
        <span
          aria-hidden
          className="absolute inset-y-0 rounded-full bg-accent-soft transition-[left,width,opacity] duration-300 ease-fluid"
          style={{ left: pill.left, width: pill.width, opacity: shown ? 1 : 0 }}
        />
      )}
      {PLACES.map((p) => {
        const here = p.href === current;
        const badge = badges[p.href];
        return (
          <Link
            key={p.href}
            href={p.href}
            data-place={p.href}
            aria-current={here ? "page" : undefined}
            aria-label={badge ? `${p.label}, ${badge.label}` : undefined}
            className={`relative z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-200 ${
              here ? "text-ink" : "text-muted hover:bg-paper/70 hover:text-ink"
            }`}
          >
            {p.label}
            {badge && <Count n={badge.n} />}
          </Link>
        );
      })}
    </nav>
  );
}

// Phones: the same places in a bar along the bottom, plus Account (your
// settings; the account menu stays in the header too). Only on the app's own pages; a session
// has its own bar.
export function MobileTabBar() {
  const path = usePathname();
  const badges = useBadges();
  const items = [
    ...PLACES,
    {
      href: "/settings",
      label: "Account",
      icon: icon(
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </>,
      ),
      here: (p: string) => p.startsWith("/settings"),
    },
  ];
  return (
    <nav
      aria-label="App"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-ink bg-panel px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] md:hidden"
    >
      {items.map((p) => {
        const here = p.here(path);
        const badge = badges[p.href];
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={here ? "page" : undefined}
            aria-label={badge ? `${p.label}, ${badge.label}` : undefined}
            className={`relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg py-1.5 transition active:scale-95 ${here ? "text-ink" : "text-muted"}`}
          >
            <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${here ? "bg-ink text-white" : ""}`}>{p.icon}</span>
            <span className={`max-w-full truncate text-[11px] leading-none ${here ? "font-semibold" : "font-medium"}`}>{p.label}</span>
            {badge && <Count n={badge.n} className="absolute top-0 left-1/2 ml-2.5" />}
          </Link>
        );
      })}
    </nav>
  );
}

// In a session: the Go to… button in place of the places. It also keeps the
// presence heartbeat going (useFriendNotices), so friends see you online.
export function SessionNav() {
  useFriendNotices();
  // Phones keep the header's room for the session's title (and have the
  // session's own tab bar); Go to… is a keyboard-first tool anyway.
  return (
    <span className="hidden md:flex">
      <PaletteButton compact />
    </span>
  );
}
