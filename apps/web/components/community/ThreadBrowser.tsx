"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, ErrorNote, SpaceChip, VoteButton } from "@/components/community/kit";
import { ago } from "@/lib/format-usage";
import { browseThreads, PAGE_SIZE, plainExcerpt, type ThreadCard, type ThreadSort } from "@/lib/community";

const SORTS: { id: ThreadSort; label: string; hint: string }[] = [
  { id: "active", label: "Active", hint: "Most recently asked or answered" },
  { id: "new", label: "New", hint: "Newest questions first" },
  { id: "top", label: "Top", hint: "Most helpful first" },
  { id: "unanswered", label: "Unanswered", hint: "No replies yet: help someone out" },
  { id: "mine", label: "Mine", hint: "Questions you asked" },
];

// The questions in one place (a space, or everywhere public): search, sort,
// and a page at a time.
export function ThreadBrowser({ space, showSpace = true, refreshKey = 0 }: { space?: string | null; showSpace?: boolean; refreshKey?: number }) {
  const [sort, setSort] = useState<ThreadSort>("active");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [threads, setThreads] = useState<ThreadCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  // Search as you type, a moment after you stop.
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(draft.trim()), 300);
    return () => window.clearTimeout(id);
  }, [draft]);

  useEffect(() => {
    let live = true;
    void browseThreads({ space, sort, query }).then(
      (page) => {
        if (!live) return;
        setThreads(page.threads);
        setTotal(page.total);
        setError(null);
      },
      (err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "Couldn't load the questions.");
      },
    );
    return () => {
      live = false;
    };
  }, [space, sort, query, refreshKey]);

  async function loadMore() {
    if (!threads) return;
    setMore(true);
    try {
      const page = await browseThreads({ space, sort, query, offset: threads.length });
      setThreads((list) => [...(list ?? []), ...page.threads.filter((t) => !list?.some((x) => x.id === t.id))]);
      setTotal(page.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load more.");
    } finally {
      setMore(false);
    }
  }

  const current = SORTS.find((s) => s.id === sort)!;

  return (
    <section aria-label="Questions">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Sort" className="flex gap-1 overflow-x-auto rounded-xl border border-ink/20 bg-panel p-1 [scrollbar-width:none]">
          {SORTS.map((s) => (
            <button
              key={s.id}
              role="tab"
              type="button"
              aria-selected={sort === s.id}
              title={s.hint}
              onClick={() => setSort(s.id)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition ${sort === s.id ? "bg-ink text-white" : "text-muted hover:bg-paper hover:text-ink"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="relative block sm:w-64">
          <span className="sr-only">Search questions</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search questions"
            className="w-full rounded-xl border border-ink/20 bg-panel py-2 pr-3 pl-9 text-sm outline-none transition placeholder:text-muted/70 hover:border-ink/50 focus:border-ink focus:shadow-hard-sm"
          />
        </label>
      </div>

      <p className="mt-3 font-mono text-[11px] text-muted">
        {threads ? `${total} ${total === 1 ? "question" : "questions"}${query ? ` matching “${query}”` : ""} · ${current.hint.toLowerCase()}` : " "}
      </p>

      <div className="mt-2">
        {error ? (
          <ErrorNote>{error}</ErrorNote>
        ) : !threads ? (
          <div className="overflow-hidden rounded-2xl border border-ink bg-panel">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex gap-4 border-b border-line px-5 py-4 last:border-0">
                <div className="skeleton h-12 w-11 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-5 w-3/4 rounded" />
                  <div className="skeleton h-3 w-full rounded" />
                  <div className="skeleton h-3 w-1/3 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : threads.length === 0 ? (
          <Empty sort={sort} query={query} />
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-ink bg-panel">
            {threads.map((t, i) => (
              <ThreadRow key={t.id} thread={t} showSpace={showSpace} delay={Math.min(i, 8) * 30} />
            ))}
          </ul>
        )}
      </div>

      {threads && threads.length < total && threads.length >= PAGE_SIZE && (
        <div className="mt-4 flex justify-center">
          <button type="button" onClick={() => void loadMore()} disabled={more} className="rounded-xl border border-ink bg-panel px-4 py-2 text-sm font-medium transition hover:-translate-y-px hover:shadow-hard-sm disabled:opacity-50">
            {more ? "Loading…" : `Show more (${total - threads.length} left)`}
          </button>
        </div>
      )}
    </section>
  );
}

function ThreadRow({ thread: t, showSpace, delay }: { thread: ThreadCard; showSpace: boolean; delay: number }) {
  const router = useRouter();
  const href = `/threads/${t.id}`;
  return (
    // The whole row opens the thread; the vote and the subject chip do their own thing.
    <li
      className="animate-enter group flex cursor-pointer gap-4 border-b border-line px-4 py-4 transition last:border-0 hover:bg-paper/70 sm:px-5"
      style={{ animationDelay: `${delay}ms` }}
      onClick={() => router.push(href)}
    >
      <div className="flex flex-col items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <VoteButton postId={t.id} votes={t.votes} voted={t.voted} mine={t.mine} layout="column" />
      </div>
      <div className="min-w-0 flex-1">
        <Link href={href} onClick={(e) => e.stopPropagation()} className="block font-serif text-[1.15rem] leading-snug tracking-tight decoration-ink/30 underline-offset-4 group-hover:underline">
          {t.title}
        </Link>
        {t.body && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">{plainExcerpt(t.body)}</p>}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
          {showSpace && t.space && <SpaceChip space={t.space} />}
          <span className="flex items-center gap-1.5">
            <Avatar name={t.author} size="sm" me={t.mine} />
            <span className="font-medium text-ink">{t.mine ? "You" : t.author}</span>
          </span>
          <span>asked {ago(t.created_at)}</span>
          {t.activity_at !== t.created_at && Date.parse(t.activity_at) - Date.parse(t.created_at) > 60_000 && <span>· active {ago(t.activity_at)}</span>}
        </div>
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
        {t.solved ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-ok/50 bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
              <path d="m5 12 5 5L20 7" />
            </svg>
            Answered
          </span>
        ) : t.replies === 0 ? (
          <span className="rounded-full border border-dashed border-ink/30 px-2 py-0.5 text-[11px] text-muted">No replies yet</span>
        ) : null}
        <span className={`flex items-center gap-1 font-mono text-xs tabular-nums ${t.replies ? "text-ink" : "text-muted"}`} title={`${t.replies} ${t.replies === 1 ? "reply" : "replies"}`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5Z" />
          </svg>
          {t.replies}
        </span>
      </div>
    </li>
  );
}

function Empty({ sort, query }: { sort: ThreadSort; query: string }) {
  const [title, body] = query
    ? ["Nothing matches that", "Try fewer words, or ask it yourself: someone else is probably wondering too."]
    : sort === "unanswered"
      ? ["Every question has a reply", "Nice. Check back later, or ask something new."]
      : sort === "mine"
        ? ["You haven't asked anything yet", "Stuck on something? Ask it here and people studying the same thing can help."]
        : ["No questions here yet", "Be the first: ask what you're stuck on."];
  return (
    <div className="rounded-2xl border border-dashed border-ink/40 bg-panel/50 px-6 py-12 text-center">
      <p className="font-serif text-2xl">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted">{body}</p>
    </div>
  );
}
