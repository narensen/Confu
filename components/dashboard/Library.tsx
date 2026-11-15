"use client";

import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { useGSAP } from "@gsap/react";
import { ReviewDue } from "@/components/review/ReviewDue";
import { StudyStreak } from "./StudyStreak";
import { TrySample } from "./TrySample";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { eyebrowClass } from "@/components/ui";
import { countdownLabel, daysUntil } from "@/lib/exam";
import { ago } from "@/lib/format-usage";
import { setLibrarySort, togglePinnedSession, useLibrarySort, usePinnedSessions, type LibrarySort } from "@/lib/prefs";
import { formatMinutes } from "@/lib/schedule";
import type { SessionKind } from "@/lib/types";
import { useReviewsDue } from "@/lib/use-reviews-due";
import { useToday } from "@/lib/use-today";
import { SessionActions } from "./SessionActions";
import { DoorCardLauncher } from "./DoorCardDialog";
import { LibraryMore } from "./LibraryMore";
import { KINDS, NewSessionLauncher, openNewSession } from "./NewSessionDialog";

gsap.registerPlugin(useGSAP, Flip);

// A plan topic still to do: what it is, where it is, how long, when it's due.
export type NextStep = {
  id: string;
  title: string;
  due: string; // YYYY-MM-DD
  minutes: number;
  docId: string | null; // the file it's in (null: beyond your files)
  docLabel: string | null; // "D2", only when the session has several files
  pages: string | null; // "pp. 2–3"
};

export type LibrarySession = {
  id: string;
  title: string;
  kind: SessionKind;
  updatedAt: string;
  archived: boolean;
  docs: { id: string; title: string; label: string; pages: number; ready: boolean; lastPage: number; updatedAt: string }[];
  // The file read last, and its page: where Continue takes you.
  resume: { docId: string; label: string; page: number } | null;
  study: { goal: string; done: number; total: number; deadline: string; open: NextStep[] } | null;
  exam: { examDate: string | null; answered: number; accuracy: number | null } | null;
  paper: { total: number; done: number; papers: { title: string; target: number; done: number }[] } | null;
};

const KIND_LABEL: Record<SessionKind, string> = { study: "Study", exam: "Exam prep", paper: "Papers" };
type Filter = "all" | SessionKind;
const SORTS: [LibrarySort, string][] = [
  ["recent", "Recently used"],
  ["deadline", "Deadline"],
  ["name", "Name"],
];

const noSubscribe = () => () => {};
function useGreeting(name: string | null) {
  const hour = useSyncExternalStore(noSubscribe, () => new Date().getHours(), () => null);
  const first = name?.trim().split(/\s+/)[0];
  const part = hour === null ? "Welcome back" : hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return first ? `${part}, ${first}` : part;
}

// A goal worth showing under a title: not when it just repeats it.
const sameText = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");
const goalOf = (s: LibrarySession) => (s.study && !sameText(s.study.goal, s.title) ? s.study.goal : null);

// The date that orders a session by deadline: the plan's, or the exam's.
const deadlineOf = (s: LibrarySession) => s.study?.deadline ?? s.exam?.examDate ?? null;

const resumeHref = (s: LibrarySession) => `/session/${s.id}${s.resume ? `?doc=${s.resume.docId}` : ""}`;

function dueLabel(due: string, today: string | null) {
  if (!today) return null;
  const days = daysUntil(due, today);
  if (days === null) return null;
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due in ${days} days`;
}

export function Library({ name, sessions: all }: { name: string | null; sessions: LibrarySession[] }) {
  // Archived sessions are kept (streak included) but sit apart, at the bottom.
  const sessions = useMemo(() => all.filter((s) => !s.archived), [all]);
  const archived = useMemo(() => all.filter((s) => s.archived), [all]);
  const [showArchived, setShowArchived] = useState(false);
  const greeting = useGreeting(name);
  const today = useToday();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const sort = useLibrarySort();
  const pinned = usePinnedSessions();
  const root = useRef<HTMLDivElement>(null);
  const flipState = useRef<Flip.FlipState | null>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);

  // Continue is the session you touched last (sessions come newest first).
  const recent = sessions[0];
  const counts = useMemo(() => {
    const c = { all: sessions.length, study: 0, exam: 0, paper: 0 } as Record<Filter, number>;
    for (const s of sessions) c[s.kind]++;
    return c;
  }, [sessions]);
  const q = query.trim().toLowerCase();
  const matches = (s: LibrarySession) =>
    (filter === "all" || s.kind === filter) && (!q || s.title.toLowerCase().includes(q) || s.docs.some((d) => d.title.toLowerCase().includes(q)));
  // With no filter or search, the Continue card already shows the latest
  // session, so the grid doesn't repeat it.
  const browsing = filter === "all" && !q;
  const visible = (s: LibrarySession) => matches(s) && !(browsing && s.id === recent?.id);
  const shown = sessions.filter(matches).length;

  // Pinned first (newest pin first), then the chosen order.
  const ordered = useMemo(() => {
    const byChoice = [...sessions];
    if (sort === "name") byChoice.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    if (sort === "deadline")
      byChoice.sort((a, b) => {
        const da = deadlineOf(a);
        const db = deadlineOf(b);
        if (!da || !db) return da ? -1 : db ? 1 : 0;
        // Upcoming first, soonest first; passed ones after them.
        const pa = today ? da < today : false;
        const pb = today ? db < today : false;
        if (pa !== pb) return pa ? 1 : -1;
        return pa ? db.localeCompare(da) : da.localeCompare(db);
      });
    const rank = (s: LibrarySession) => {
      const i = pinned.indexOf(s.id);
      return i === -1 ? Infinity : i;
    };
    return byChoice.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s);
  }, [sessions, sort, pinned, today]);

  // "New session" from the Go to… palette on another page lands here with
  // ?new=1: open the dialog (its launcher, a child, is listening by now).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("new") !== "1") return;
    url.searchParams.delete("new");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    openNewSession();
  }, []);

  // Remember where cards were, then let Flip animate them to their new places.
  const change = (fn: () => void) => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && root.current) {
      flipState.current = Flip.getState(root.current.querySelectorAll("[data-card]"));
    }
    fn();
  };

  const orderKey = ordered.map((s) => s.id).join(",");
  useLayoutEffect(() => {
    const state = flipState.current;
    flipState.current = null;
    if (!state) return;
    Flip.from(state, {
      duration: 0.55,
      ease: "power3.inOut",
      absolute: true,
      scale: true,
      onEnter: (els) => (els.length ? gsap.fromTo(els, { autoAlpha: 0, scale: 0.94 }, { autoAlpha: 1, scale: 1, duration: 0.45, ease: "power3.out" }) : undefined),
      onLeave: (els) => (els.length ? gsap.to(els, { autoAlpha: 0, scale: 0.94, duration: 0.3 }) : undefined),
    });
  }, [filter, query, orderKey]);

  // Sliding underline under the active filter.
  useLayoutEffect(() => {
    const el = tabs.current?.querySelector<HTMLElement>(`[data-filter="${filter}"]`);
    if (el) setBar({ left: el.offsetLeft, width: el.offsetWidth });
  }, [filter, sessions.length]);

  // Entrance: header, then the continue card, then the grid.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
        tl.fromTo("[data-intro]", { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, stagger: 0.07, clearProps: "all" })
          .fromTo("[data-continue]", { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7, clearProps: "all" }, "-=0.35")
          .fromTo("[data-card]", { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, stagger: 0.05, clearProps: "all" }, "-=0.45");
      });
    },
    { scope: root },
  );

  return (
    <div ref={root}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p data-intro className={eyebrowClass}>
            Library
          </p>
          <h1 data-intro className="mt-1 font-serif text-4xl tracking-tight sm:text-5xl" suppressHydrationWarning>
            {greeting}
          </h1>
          <p data-intro className="mt-2 text-sm text-muted">
            {sessions.length || archived.length ? "Pick up where you left off, or start something new." : "Start your first session: it takes a minute."}
          </p>
        </div>
        <div data-intro className="flex flex-wrap items-center gap-2 [&>*]:whitespace-nowrap">
          <LibraryMore map={all.some((x) => x.kind !== "exam" && x.docs.length > 0)} />
          <DoorCardLauncher button={false} />
          <NewSessionLauncher />
        </div>
      </header>

      {/* Today: where you left off, beside what's due (across every session) and your streak. */}
      {sessions.length > 0 && recent ? (
        // Phones: Continue, Today, then the streak. Wide: Continue with the
        // streak under it, and Today down the right.
        <section aria-label="Today" className="mt-8 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <ContinueCard s={recent} today={today} />
          </div>
          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <TodayCard sessions={sessions} today={today} />
          </div>
          <div className="min-w-0 empty:hidden lg:col-start-1 lg:row-start-2 [&>section]:mt-0">
            <StudyStreak />
          </div>
        </section>
      ) : (
        <div className="mt-8 grid gap-4 empty:hidden lg:grid-cols-2">
          <ReviewDue compact />
          <StudyStreak compact />
        </div>
      )}

      {sessions.length === 0 ? (
        <>
          <section className="mt-10 grid gap-4 md:grid-cols-3">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                data-card
                onClick={() => openNewSession(k.kind)}
                className="group flex flex-col rounded-2xl border border-ink bg-panel p-6 text-left transition-[translate,box-shadow] duration-300 ease-fluid hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard"
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {k.icon}
                </svg>
                <span className="mt-4 font-serif text-2xl">{k.name}</span>
                <span className="mt-2 text-sm leading-relaxed text-muted">{k.body}</span>
                <span className="mt-5 text-sm font-medium underline decoration-ink/30 underline-offset-4 group-hover:decoration-ink">Start →</span>
              </button>
            ))}
          </section>
          <TrySample />
        </>
      ) : (
        <>
          {/* Filter, order and search */}
          <div data-intro className="mt-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-ink/15">
            <div ref={tabs} role="tablist" aria-label="Filter sessions" className="relative flex gap-1 overflow-x-auto [scrollbar-width:none]">
              {(["all", "study", "exam", "paper"] as Filter[]).map((f) => (
                <button
                  key={f}
                  data-filter={f}
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => change(() => setFilter(f))}
                  className={`flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm transition-colors ${filter === f ? "font-medium text-ink" : "text-muted hover:text-ink"}`}
                >
                  {f === "all" ? "All" : KIND_LABEL[f]}
                  <span className="font-mono text-[11px] text-muted">{counts[f]}</span>
                </button>
              ))}
              {bar && <span aria-hidden className="absolute -bottom-px h-0.5 bg-stroke transition-all duration-300 ease-fluid" style={{ left: bar.left, width: bar.width }} />}
            </div>
            <div className="mb-2 flex w-full items-center gap-2 sm:w-auto">
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                <span className="hidden sm:inline">Sort</span>
                <select
                  value={sort}
                  aria-label="Sort sessions"
                  onChange={(e) => change(() => setLibrarySort(e.target.value as LibrarySort))}
                  className="rounded-lg border border-ink/20 bg-panel py-1.5 pr-7 pl-2 text-sm text-ink outline-none transition focus:border-ink"
                >
                  {SORTS.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                <span className="sr-only">Search sessions</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden>
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-4-4" />
                </svg>
                <input
                  value={query}
                  onChange={(e) => change(() => setQuery(e.target.value))}
                  placeholder="Search titles and files"
                  className="w-full rounded-lg border border-ink/20 bg-panel py-1.5 pr-3 pl-8 text-sm outline-none transition focus:border-ink"
                />
              </label>
            </div>
          </div>

          {/* Grid */}
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ordered.map((s) => (
              <li key={s.id} data-card className={visible(s) ? "" : "hidden"}>
                <SessionCard s={s} today={today} pinned={pinned.includes(s.id)} onPin={() => change(() => togglePinnedSession(s.id))} />
              </li>
            ))}
          </ul>
          {shown === 0 ? (
            <p className="mt-10 text-center text-sm text-muted">
              No sessions match{q ? ` “${query}”` : ""}.{" "}
              <button
                onClick={() =>
                  change(() => {
                    setFilter("all");
                    setQuery("");
                  })
                }
                className="underline underline-offset-4 hover:text-ink"
              >
                Clear filters
              </button>
            </p>
          ) : (
            browsing &&
            sessions.length === 1 && <p className="mt-2 text-sm text-muted">Your only session is above. Start another with + New session.</p>
          )}
        </>
      )}

      {archived.length > 0 && (
        <section className="mt-12 border-t border-ink/15 pt-5">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
            className="flex items-center gap-2 text-sm text-muted transition hover:text-ink"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden className={`transition-transform duration-300 ease-fluid ${showArchived ? "rotate-90" : ""}`}>
              <path d="m9 6 6 6-6 6" />
            </svg>
            Archived <span className="font-mono text-[11px]">{archived.length}</span>
          </button>
          {showArchived && (
            <ul className="animate-enter mt-4 grid gap-4 opacity-80 sm:grid-cols-2 lg:grid-cols-3">
              {archived.map((s) => (
                <li key={s.id}>
                  <SessionCard s={s} today={today} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

// The next concrete thing to do in a session, in one line: a topic with its
// pages and time, the exam countdown, or the next paper and pass.
function nextOf(s: LibrarySession, today: string | null): { label: string; title: string; meta: string[] } | null {
  if (s.kind === "study") {
    const next = s.study?.open[0];
    if (next) {
      const due = dueLabel(next.due, today);
      return {
        label: "Next",
        title: next.title,
        meta: [next.pages ? `${next.docLabel ? `${next.docLabel} ` : ""}${next.pages}` : "beyond your files", `~${formatMinutes(next.minutes)}`, ...(due ? [due] : [])],
      };
    }
    if (s.study) return { label: "Plan", title: "Every topic done", meta: ["review what you've learnt"] };
    return s.docs.length ? { label: "Next", title: "Set a goal to get a plan", meta: [`${s.docs.length} file${s.docs.length > 1 ? "s" : ""} ready`] } : { label: "Next", title: "Add a file to begin", meta: [] };
  }
  if (s.kind === "exam") {
    const days = today ? daysUntil(s.exam?.examDate ?? null, today) : null;
    return {
      label: "Exam",
      title: today ? countdownLabel(days) : "Exam prep",
      meta: s.exam?.answered ? [`${s.exam.answered} practice answers`, `${Math.round((s.exam.accuracy ?? 0) * 100)}% correct`] : ["practise questions from your notes"],
    };
  }
  const paper = s.paper?.papers.find((p) => p.done < p.target);
  if (paper) return { label: "Next", title: paper.title, meta: [`pass ${Math.min(3, paper.done + 1)} of ${paper.target}`] };
  return s.paper?.total ? { label: "Papers", title: "Every paper read to its target pass", meta: [] } : { label: "Next", title: "Add papers by arXiv ID, DOI or title", meta: [] };
}

// Where you left off: the session you touched last, the next step in it,
// and one button back in at the page you were reading. The page's main call
// to action.
function ContinueCard({ s, today }: { s: LibrarySession; today: string | null }) {
  const progress =
    s.kind === "study" && s.study ? (s.study.total ? s.study.done / s.study.total : 0) : s.kind === "paper" && s.paper ? (s.paper.total ? s.paper.done / s.paper.total : 0) : null;
  const label = s.kind === "paper" ? "of papers read" : "of the plan done";
  const goal = goalOf(s);
  const next = nextOf(s, today);
  return (
    <Link
      data-continue
      href={resumeHref(s)}
      className="group relative flex min-w-0 flex-col gap-5 overflow-hidden rounded-2xl border border-ink bg-inverse p-6 text-inverse-ink shadow-[4px_4px_0_0_#facc15] transition-[translate,box-shadow] duration-300 ease-fluid hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_#facc15] sm:p-7"
    >
      <div className="min-w-0">
        <p className="font-mono text-[11px] tracking-widest text-inverse-muted uppercase">
          <span className="text-yellow-400">Continue</span> · {KIND_LABEL[s.kind]} · updated <span suppressHydrationWarning>{ago(s.updatedAt)}</span>
        </p>
        <p className="mt-2.5 line-clamp-2 font-serif text-3xl leading-tight tracking-tight sm:text-4xl">{s.title}</p>
        {goal && <p className="mt-1.5 line-clamp-1 text-sm text-inverse-muted">{goal}</p>}
      </div>

      {next && (
        <div className="flex min-w-0 items-baseline gap-3 rounded-xl border border-inverse-ink/15 bg-inverse-ink/5 px-4 py-3">
          <span className="shrink-0 font-mono text-[11px] tracking-widest text-yellow-400 uppercase">{next.label}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium" suppressHydrationWarning>
              {next.title}
            </span>
            {next.meta.length > 0 && (
              <span className="mt-0.5 block truncate font-mono text-[11px] text-inverse-muted" suppressHydrationWarning>
                {next.meta.join(" · ")}
              </span>
            )}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        {progress !== null ? (
          <div className="min-w-40 flex-1 sm:max-w-xs">
            <div className="h-1.5 overflow-hidden rounded-full bg-inverse-ink/15">
              <div className="h-full rounded-full bg-yellow-400 transition-[width] duration-700 ease-fluid" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="mt-1.5 font-mono text-[11px] text-inverse-muted">
              {Math.round(progress * 100)}% {label}
            </p>
          </div>
        ) : (
          <span />
        )}
        <span className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-inverse-ink px-5 py-2.5 text-sm font-medium text-inverse transition-[gap] group-hover:gap-3">
          {s.resume ? `Resume${s.docs.length > 1 ? ` ${s.resume.label}` : ""} at p. ${s.resume.page}` : "Continue"} <span aria-hidden>→</span>
        </span>
      </div>
    </Link>
  );
}

type TodayItem = { key: string; href: string; title: string; meta: string; tone: "review" | "late" | "due" | "exam" };

// What's due today, across every session: reviews, plan topics due today or
// behind, and exams in the next two weeks. Each one opens where it's done.
function TodayCard({ sessions, today }: { sessions: LibrarySession[]; today: string | null }) {
  const due = useReviewsDue();
  if (!today) return <div className="skeleton h-40 rounded-2xl border border-line" />;

  const items: TodayItem[] = [];
  if (due)
    items.push({
      key: "reviews",
      href: "/review",
      title: `${due} review${due === 1 ? "" : "s"} due`,
      meta: `About ${Math.max(1, Math.round(due * 0.75))} min, before you forget them`,
      tone: "review",
    });
  const topics: TodayItem[] = [];
  for (const s of sessions) {
    for (const t of s.study?.open ?? []) {
      if (t.due > today) continue;
      topics.push({
        key: t.id,
        href: `/session/${s.id}${t.docId ? `?doc=${t.docId}` : ""}`,
        title: t.title,
        meta: `${s.title} · ${dueLabel(t.due, today)}${t.pages ? ` · ${t.pages}` : ""}`,
        tone: t.due < today ? "late" : "due",
      });
    }
  }
  // Due today before what's behind, so today's work isn't buried.
  topics.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "due" ? -1 : 1));
  items.push(...topics);
  for (const s of sessions) {
    const days = s.kind === "exam" ? daysUntil(s.exam?.examDate ?? null, today) : null;
    if (days === null || days < 0 || days > 14) continue;
    items.push({
      key: `exam-${s.id}`,
      href: `/session/${s.id}`,
      title: countdownLabel(days),
      meta: `${s.title}${s.exam?.answered ? ` · ${Math.round((s.exam.accuracy ?? 0) * 100)}% correct so far` : " · practise from your notes"}`,
      tone: "exam",
    });
  }

  const SHOW = 4;
  return (
    <section aria-labelledby="today-title" className="animate-enter rounded-2xl border border-ink bg-panel p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="today-title" className="font-serif text-xl">
          Today
        </h2>
        {items.length > 0 && <span className="font-mono text-[11px] text-muted">{items.length} to do</span>}
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-sm leading-relaxed text-muted">Nothing due today. You&apos;re on track: pick up where you left off, or start something new.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {items.slice(0, SHOW).map((it) => (
            <li key={it.key}>
              <Link href={it.href} className="group -mx-2 flex items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-paper">
                <span
                  aria-hidden
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${it.tone === "review" ? "bg-yellow-400" : it.tone === "late" ? "bg-danger" : it.tone === "exam" ? "bg-warn" : "bg-ink"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{it.title}</span>
                  <span className="block truncate text-xs text-muted">{it.meta}</span>
                </span>
                <span aria-hidden className="mt-0.5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-ink">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {items.length > SHOW && <p className="mt-1 text-xs text-muted">And {items.length - SHOW} more in your sessions.</p>}
    </section>
  );
}

// Each paper as three small cells, one per pass: filled for a pass done, an
// outline for one still to do, nothing past the pass it needs.
function PassCells({ papers }: { papers: { title: string; target: number; done: number }[] }) {
  const SHOW = 10;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="img" aria-label={papers.map((p) => `${p.title}: ${Math.min(p.done, 3)} of ${p.target} passes`).join("; ")}>
      {papers.slice(0, SHOW).map((p, i) => (
        <span key={i} title={`${p.title}: pass ${Math.min(p.done, 3)} of ${p.target}`} className="flex gap-px">
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className={`h-2.5 w-1.5 rounded-[1px] ${n <= p.done ? "bg-ink" : n <= p.target ? "border border-ink/40" : "border border-dashed border-ink/15"}`}
            />
          ))}
        </span>
      ))}
      {papers.length > SHOW && <span className="font-mono text-[11px] text-muted">+{papers.length - SHOW}</span>}
    </div>
  );
}

function SessionCard({ s, today, pinned = false, onPin }: { s: LibrarySession; today: string | null; pinned?: boolean; onPin?: () => void }) {
  const pages = s.docs.reduce((n, d) => n + d.pages, 0);
  const notReady = s.docs.filter((d) => !d.ready).length;
  const goal = goalOf(s);
  const next = s.study?.open[0];
  const examDays = s.kind === "exam" && today ? daysUntil(s.exam?.examDate ?? null, today) : null;
  const accuracy = s.exam?.answered ? Math.round((s.exam.accuracy ?? 0) * 100) : null;

  return (
    <article className="group relative flex h-full flex-col rounded-2xl border border-ink bg-panel p-5 transition-[translate,box-shadow] duration-300 ease-fluid hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5">
          <span className="rounded border border-ink/30 px-1.5 py-px font-mono text-[11px] tracking-wider text-muted uppercase">{KIND_LABEL[s.kind]}</span>
          {pinned && <span className="font-mono text-[11px] text-muted">Pinned</span>}
        </span>
        {/* Actions show on hover, on keyboard focus, and always on touch screens (no hover there). */}
        <div className="relative z-10 flex items-center opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          {onPin && (
            <button
              type="button"
              onClick={onPin}
              aria-pressed={pinned}
              title={pinned ? "Unpin" : "Pin to the top of your library (on this device)"}
              className="rounded-md px-2 py-1 text-xs text-muted transition hover:bg-paper hover:text-ink"
            >
              {pinned ? "Unpin" : "Pin"}
            </button>
          )}
          <SessionActions id={s.id} title={s.title} archived={s.archived} />
        </div>
      </div>
      <Link href={resumeHref(s)} className="mt-3 font-serif text-xl leading-snug after:absolute after:inset-0">
        <span className="line-clamp-2">{s.title}</span>
      </Link>
      <p className="mt-1 font-mono text-[11px] text-muted">
        {!s.docs.length
          ? s.kind === "paper"
            ? "No papers yet"
            : "No files yet"
          : s.kind === "paper"
            ? `${s.docs.length} paper${s.docs.length === 1 ? "" : "s"}`
            : `${s.docs.length} file${s.docs.length === 1 ? "" : "s"} · ${pages} pages`}
        {notReady > 0 && <span className="ml-2 text-warn">{notReady} not ready</span>}
      </p>

      {s.kind === "study" && goal && <p className="mt-3 line-clamp-2 text-sm">{goal}</p>}
      {s.kind === "study" && next && (
        <p className="mt-3 line-clamp-2 text-sm">
          <span className="text-muted">Next: </span>
          {next.title}
        </p>
      )}
      {s.kind === "study" && !s.study && <p className="mt-3 text-sm text-muted">No plan yet: set a goal to get one.</p>}

      <div className="mt-auto pt-5">
        {s.kind === "study" && s.study && (
          <>
            <div className="h-1.5 overflow-hidden rounded-full bg-line" role="img" aria-label={`${s.study.done} of ${s.study.total} topics done`}>
              <div className="h-full rounded-full bg-ink transition-[width] duration-700 ease-fluid" style={{ width: `${s.study.total ? Math.round((s.study.done / s.study.total) * 100) : 0}%` }} />
            </div>
            <Footer
              left={`${s.study.done}/${s.study.total} topics${today ? ` · ${(() => {
                const days = daysUntil(s.study.deadline, today);
                return days === null ? "" : days >= 0 ? `${days} days left` : "deadline passed";
              })()}` : ""}`}
              right={ago(s.updatedAt)}
            />
          </>
        )}
        {/* Exam prep has no plan to complete: the countdown and how practice is going, not a progress bar. */}
        {s.kind === "exam" && (
          <>
            <p className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium" suppressHydrationWarning>
                {today ? countdownLabel(examDays) : " "}
              </span>
              {accuracy !== null && (
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
                  <span aria-hidden className={`size-2 rounded-full ${accuracy >= 70 ? "bg-ok" : accuracy >= 50 ? "bg-warn" : "bg-danger"}`} />
                  {accuracy}% correct
                </span>
              )}
            </p>
            <Footer left={s.exam?.answered ? `${s.exam.answered} practice answers` : "No practice yet"} right={ago(s.updatedAt)} />
          </>
        )}
        {s.kind === "paper" && s.paper && (
          <>
            {s.paper.total > 0 && <PassCells papers={s.paper.papers} />}
            <Footer left={s.paper.total ? `${s.paper.done} of ${s.paper.total} read to their target pass` : "Add papers to start"} right={ago(s.updatedAt)} />
          </>
        )}
      </div>
    </article>
  );
}

function Footer({ left, right }: { left: string; right: string }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[11px] text-muted">
      <span className="truncate" suppressHydrationWarning>
        {left}
      </span>
      <span className="shrink-0" suppressHydrationWarning>
        {right}
      </span>
    </div>
  );
}
