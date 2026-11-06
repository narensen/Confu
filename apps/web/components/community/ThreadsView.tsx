"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AskButton, SpaceIcon } from "@/components/community/kit";
import { ThreadBrowser } from "@/components/community/ThreadBrowser";
import { eyebrowClass } from "@/components/ui";
import { browseSpaces, loadSpaces, type SpaceCard } from "@/lib/community";

// Threads: every public question, with the subjects down the side (the ones
// you follow first) and a way to ask.
export function ThreadsView() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<SpaceCard[] | null>(null);
  const [mine, setMine] = useState<SpaceCard[]>([]);

  useEffect(() => {
    let live = true;
    void Promise.all([browseSpaces().catch(() => [] as SpaceCard[]), loadSpaces().catch(() => [] as SpaceCard[])]).then(([all, joined]) => {
      if (!live) return;
      setSubjects(all);
      setMine(joined);
    });
    return () => {
      live = false;
    };
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, SpaceCard[]>();
    for (const s of subjects ?? []) map.set(s.category || "Subjects", [...(map.get(s.category || "Subjects") ?? []), s]);
    return [...map.entries()];
  }, [subjects]);

  return (
    <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <aside className="space-y-6 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto lg:pb-6 [scrollbar-width:thin]">
        <AskButton className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-ink bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-hard-sm transition" onPosted={(id) => router.push(`/threads/${id}`)} />

        {/* Phones: subjects as a row of chips. */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:hidden">
          {(subjects ?? []).map((s) => (
            <Link key={s.id} href={`/spaces/${s.slug}`} className="flex shrink-0 items-center gap-1.5 rounded-full border border-ink/25 bg-panel px-3 py-1.5 text-xs font-medium hover:border-ink">
              <span aria-hidden>{s.icon}</span>
              {s.name}
            </Link>
          ))}
        </div>

        <nav aria-label="Spaces" className="hidden space-y-6 lg:block">
          <div>
            <p className={`${eyebrowClass} px-2`}>Browse</p>
            <ul className="mt-2 space-y-0.5">
              <li>
                <span aria-current="page" className="flex items-center gap-2.5 rounded-lg bg-accent-soft px-2 py-1.5 text-sm font-medium text-ink">
                  <span aria-hidden className="flex size-6 items-center justify-center rounded-md border border-ink/20 bg-panel text-xs">
                    💬
                  </span>
                  All questions
                </span>
              </li>
              <li>
                <Link href="/spaces" className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted transition hover:bg-panel hover:text-ink">
                  <span aria-hidden className="flex size-6 items-center justify-center rounded-md border border-ink/25 text-xs">
                    ⌘
                  </span>
                  All subjects & spaces
                </Link>
              </li>
            </ul>
          </div>

          {mine.length > 0 && (
            <div>
              <p className={`${eyebrowClass} px-2`}>Your spaces</p>
              <ul className="mt-2 space-y-0.5">
                {mine.slice(0, 12).map((s) => (
                  <SideLink key={s.id} space={s} />
                ))}
              </ul>
            </div>
          )}

          {subjects === null ? (
            <div className="space-y-2 px-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="skeleton h-6 rounded" />
              ))}
            </div>
          ) : (
            groups.map(([category, list]) => (
              <div key={category}>
                <p className={`${eyebrowClass} px-2`}>{category}</p>
                <ul className="mt-2 space-y-0.5">
                  {list.map((s) => (
                    <SideLink key={s.id} space={s} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </nav>
      </aside>

      <ThreadBrowser />
    </div>
  );
}

function SideLink({ space }: { space: SpaceCard }) {
  return (
    <li>
      <Link href={`/spaces/${space.slug}`} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted transition hover:bg-panel hover:text-ink">
        <SpaceIcon space={space} size="sm" />
        <span className="min-w-0 flex-1 truncate">{space.name}</span>
        {space.questions > 0 && <span className="font-mono text-[10px] text-muted/80 tabular-nums">{space.questions}</span>}
      </Link>
    </li>
  );
}
