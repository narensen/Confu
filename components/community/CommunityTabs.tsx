"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { useFriendNotices } from "@/components/friends/FriendsLink";

// Community's four parts, as tabs along the top of each: one place in the
// nav instead of four.
const TABS = [
  { href: "/threads", label: "Threads", hint: "Ask and answer questions" },
  { href: "/spaces", label: "Spaces", hint: "Subjects, classes and groups" },
  { href: "/rooms", label: "Study rooms", hint: "A shared focus timer" },
  { href: "/friends", label: "Friends", hint: "People you study with" },
];

// The tabs read the URL to mark where you are, so they stream in after the
// page; until then they show unmarked.
export function CommunityTabs() {
  return (
    <Suspense fallback={<Tabs path={null} waiting={0} />}>
      <LiveTabs />
    </Suspense>
  );
}

function LiveTabs() {
  return <Tabs path={usePathname()} waiting={useFriendNotices()} />;
}

function Tabs({ path, waiting }: { path: string | null; waiting: number }) {
  return (
    <nav aria-label="Community" className="-mx-4 mb-8 overflow-x-auto border-b border-ink/15 px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <ul className="flex gap-1">
        {TABS.map((t) => {
          const here = Boolean(path?.startsWith(t.href));
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                title={t.hint}
                aria-current={here ? "page" : undefined}
                className={`relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors ${
                  here ? "border-stroke font-medium text-ink" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {t.label}
                {t.href === "/friends" && waiting > 0 && (
                  <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-yellow-300 px-1 font-mono text-[11px] leading-4 font-medium text-ink">
                    {waiting > 9 ? "9+" : waiting}
                    <span className="sr-only"> waiting</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
