"use client";

import Link from "next/link";
import { ago } from "@/lib/format-usage";
import type { ThreadCard } from "@/lib/community";

export function ThreadList({ threads, empty }: { threads: ThreadCard[]; empty: string }) {
  if (!threads.length) {
    return <p className="rounded-2xl border border-dashed border-ink/30 px-5 py-10 text-center text-sm text-muted">{empty}</p>;
  }
  return (
    <ul className="space-y-3">
      {threads.map((thread) => (
        <li key={thread.id}>
          <Link href={`/threads/${thread.id}`} className="block rounded-2xl border border-ink bg-panel p-4 transition hover:-translate-y-px hover:shadow-hard-sm sm:p-5">
            <p className="font-serif text-xl leading-snug">{thread.title}</p>
            <p className="mt-2 line-clamp-2 text-sm text-muted">{thread.body}</p>
            <p className="mt-3 font-mono text-[11px] text-muted">
              {thread.mine ? "You" : thread.author} · {ago(thread.created_at)} · {thread.replies} {thread.replies === 1 ? "reply" : "replies"}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
