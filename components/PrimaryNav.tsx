"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useFriendNotices } from "@/components/friends/FriendsLink";

// The app's main places, beside the logo, with the one you're in marked.
// In a session the header needs its room for the title, so the places
// become icons on the right (labels in their tooltips).

type Place = { href: string; label: string; icon: ReactNode; here: (path: string) => boolean };

const icon = (d: ReactNode) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);

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
    label: "Threads",
    icon: icon(<path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5Z" />),
    here: (p) => p.startsWith("/threads") || p.startsWith("/spaces"),
  },
  {
    href: "/rooms",
    label: "Rooms",
    icon: icon(<path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M14 12h.01" />),
    here: (p) => p.startsWith("/rooms"),
  },
  {
    href: "/friends",
    label: "Friends",
    icon: icon(<path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8" />),
    here: (p) => p.startsWith("/friends"),
  },
];

export function PrimaryNav({ variant = "text" }: { variant?: "text" | "icons" }) {
  const path = usePathname();
  const waiting = useFriendNotices();

  if (variant === "icons") {
    return (
      <nav aria-label="App" className="hidden items-center gap-0.5 lg:flex">
        {PLACES.filter((p) => p.href !== "/dashboard").map((p) => {
          const here = p.here(path);
          const badge = p.href === "/friends" && waiting > 0;
          return (
            <Link
              key={p.href}
              href={p.href}
              title={badge ? `${p.label} · ${waiting} waiting` : p.label}
              aria-label={badge ? `${p.label}, ${waiting} waiting` : p.label}
              aria-current={here ? "page" : undefined}
              className={`relative flex size-8 items-center justify-center rounded-full transition ${here ? "bg-accent-soft text-ink" : "text-muted hover:bg-paper hover:text-ink"}`}
            >
              {p.icon}
              {badge && <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full border border-panel bg-yellow-400" />}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="App" className="hidden items-center gap-0.5 md:flex">
      {PLACES.map((p) => {
        const here = p.here(path);
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={here ? "page" : undefined}
            className={`relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
              here ? "bg-accent-soft text-ink" : "text-muted hover:bg-paper hover:text-ink"
            }`}
          >
            {p.label}
            {p.href === "/friends" && waiting > 0 && (
              <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-yellow-300 px-1 font-mono text-[10px] leading-4 font-medium">{waiting > 9 ? "9+" : waiting}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
