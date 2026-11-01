import Link from "next/link";
import { ago } from "@/lib/format-usage";
import type { ThreadCard } from "@/lib/community";

export function ThreadList({ threads, empty }: { threads: ThreadCard[]; empty: string }) {
  if (!threads.length) {
    return <p className="rounded-2xl border border-dashed border-ink/40 px-4 py-8 text-center text-sm text-muted">{empty}</p>;
  }
  return (
    <ul className="space-y-3">
      {threads.map((thread) => (
        <li key={thread.id}>
          <Link
            href={`/threads/${thread.id}`}
            className="block rounded-2xl border border-ink bg-panel p-4 transition hover:-translate-y-px hover:shadow-hard-sm"
          >
            <span className="block font-serif text-xl leading-snug">{thread.title}</span>
            {thread.body && <span className="mt-1 block line-clamp-3 text-sm leading-relaxed text-muted">{thread.body}</span>}
            <span className="mt-3 block font-mono text-[11px] text-muted">
              {thread.author} · {thread.replies} {thread.replies === 1 ? "reply" : "replies"} · {ago(thread.created_at)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
