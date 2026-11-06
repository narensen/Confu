"use client";

import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { useGSAP } from "@gsap/react";
import { ReviewDue } from "@/components/review/ReviewDue";
import { StudyStreak } from "./StudyStreak";
import { StudyTools } from "./StudyTools";
import { TrySample } from "./TrySample";
import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { eyebrowClass, ghostButtonClass } from "@/components/ui";
import { countdownLabel, daysUntil } from "@confu/core/exam";
import { ago } from "@/lib/format-usage";
import type { SessionKind } from "@confu/core/types";
import { useToday } from "@/lib/use-today";
import { SessionActions } from "./SessionActions";
import { DoorCardLauncher } from "./DoorCardDialog";
import { KINDS, NewSessionLauncher, openNewSession } from "./NewSessionDialog";

gsap.registerPlugin(useGSAP, Flip);

export type LibrarySession = {
  id: string;
  title: string;
  kind: SessionKind;
  updatedAt: string;
  archived: boolean;
  docs: { id: string; title: string; pages: number; ready: boolean }[];
  study: { goal: string; done: number; total: number; deadline: string } | null;
  exam: { examDate: string | null; answered: number; accuracy: number | null } | null;
  paper: { total: number; done: number; byTarget: [number, number, number] } | null;
};

const KIND_LABEL: Record<SessionKind, string> = { study: "Study", exam: "Exam prep", paper: "Papers" };
type Filter = "all" | SessionKind;

const noSubscribe = () => () => {};
function useGreeting(name: string | null) {
  const hour = useSyncExternalStore(noSubscribe, () => new Date().getHours(), () => null);
  const first = name?.trim().split(/\s+/)[0];
  const part = hour === null ? "Welcome back" : hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return first ? `${part}, ${first}` : part;
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
  const root = useRef<HTMLDivElement>(null);
  const flipState = useRef<Flip.FlipState | null>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);

  const recent = sessions[0];
  const counts = useMemo(() => {
    const c = { all: sessions.length, study: 0, exam: 0, paper: 0 } as Record<Filter, number>;
    for (const s of sessions) c[s.kind]++;
    return c;
  }, [sessions]);
  const q = query.trim().toLowerCase();
  const visible = (s: LibrarySession) =>
    (filter === "all" || s.kind === filter) && (!q || s.title.toLowerCase().includes(q) || s.docs.some((d) => d.title.toLowerCase().includes(q)));
  const shown = sessions.filter(visible).length;

  // Remember where cards were, then let Flip animate them to their new places.
  const change = (fn: () => void) => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && root.current) {
      flipState.current = Flip.getState(root.current.querySelectorAll("[data-card]"));
    }
    fn();
  };

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
  }, [filter, query]);

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
          {all.some((x) => x.kind !== "exam" && x.docs.length > 0) && (
            <Link href="/map" className={`${ghostButtonClass} py-2.5`} title="Every paper across your sessions, and how they connect">
              Literature map
            </Link>
          )}
          <DoorCardLauncher />
          <NewSessionLauncher />
        </div>
      </header>

      {/* Today: where you left off, beside what's due and your streak. */}
      {sessions.length > 0 && recent ? (
        <section aria-label="Today" className="mt-8 flex flex-col gap-4 lg:flex-row">
          <ContinueCard s={recent} today={today} />
          <div className="grid gap-4 empty:hidden sm:grid-cols-2 lg:flex lg:w-[22rem] lg:shrink-0 lg:flex-col">
            <ReviewDue compact />
            <StudyStreak compact />
          </div>
        </section>
      ) : (
        <div className="mt-8 grid gap-4 empty:hidden lg:grid-cols-2">
          <ReviewDue compact />
          <StudyStreak compact />
        </div>
      )}

      <StudyTools />

      {sessions.length === 0 ? (
        <>
        <section className="mt-10 grid gap-4 md:grid-cols-3">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              data-card
              onClick={() => openNewSession(k.kind)}
              className="group flex flex-col rounded-2xl border border-ink bg-panel p-6 text-left transition-colors hover:bg-paper"
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
          {/* Filter + search */}
          <div data-intro className="mt-10 flex flex-wrap items-center justify-between gap-4 border-b border-ink/15">
            <div ref={tabs} role="tablist" aria-label="Filter sessions" className="relative flex gap-1">
              {(["all", "study", "exam", "paper"] as Filter[]).map((f) => (
                <button
                  key={f}
                  data-filter={f}
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => change(() => setFilter(f))}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-sm transition-colors ${filter === f ? "font-medium text-ink" : "text-muted hover:text-ink"}`}
                >
                  {f === "all" ? "All" : KIND_LABEL[f]}
                  <span className="font-mono text-[10px] text-muted">{counts[f]}</span>
                </button>
              ))}
              {bar && <span aria-hidden className="absolute -bottom-px h-0.5 bg-ink transition-all duration-300 ease-fluid" style={{ left: bar.left, width: bar.width }} />}
            </div>
            <label className="relative mb-2 w-full sm:w-64">
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

          {/* Grid */}
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map((s) => (
              <li key={s.id} data-card className={visible(s) ? "" : "hidden"}>
                <SessionCard s={s} today={today} />
              </li>
            ))}
          </ul>
          {shown === 0 && (
            <p className="mt-10 text-center text-sm text-muted">
              No sessions match{q ? ` “${query}”` : ""}.{" "}
              <button onClick={() =>
                  change(() => {
                    setFilter("all");
                    setQuery("");
                  })
                } className="underline underline-offset-4 hover:text-ink">
                Clear filters
              </button>
            </p>
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
            Archived <span className="font-mono text-[10px]">{archived.length}</span>
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

// Where you left off: the session you touched last, how far along it is,
// and one button back in. The page's main call to action.
function ContinueCard({ s, today }: { s: LibrarySession; today: string | null }) {
  const progress =
    s.kind === "study" && s.study
      ? s.study.total
        ? s.study.done / s.study.total
        : 0
      : s.kind === "paper" && s.paper
        ? s.paper.total
          ? s.paper.done / s.paper.total
          : 0
        : s.kind === "exam"
          ? (s.exam?.accuracy ?? null)
          : null;
  const label = s.kind === "exam" ? "correct in practice" : s.kind === "paper" ? "of papers read" : "of the plan done";
  return (
    <Link
      data-continue
      href={`/session/${s.id}`}
      className="group relative flex min-w-0 flex-1 flex-col justify-between gap-8 rounded-2xl border border-ink bg-inverse p-6 text-inverse-ink sm:p-7"
    >
      <div className="min-w-0">
        <p className="font-mono text-[11px] tracking-widest text-inverse-muted uppercase">
          <span className="text-yellow-400">Continue</span> · {KIND_LABEL[s.kind]} · updated <span suppressHydrationWarning>{ago(s.updatedAt)}</span>
        </p>
        <p className="mt-3 line-clamp-2 font-serif text-3xl leading-tight tracking-tight sm:text-4xl">{s.title}</p>
        <p className="mt-2 line-clamp-2 text-sm text-inverse-muted">
          <Summary s={s} today={today} />
        </p>
        {s.docs.length > 0 && (
          <ul className="mt-5 flex flex-wrap gap-2" aria-label="Files">
            {s.docs.slice(0, 3).map((d, i) => (
              <li key={d.id} className="flex max-w-60 items-center gap-1.5 rounded-md border border-inverse-ink/40 px-2 py-1 text-xs text-inverse-ink">
                <span className="font-mono text-[10px] text-inverse-muted">D{i + 1}</span>
                <span className="truncate">{d.title}</span>
              </li>
            ))}
            {s.docs.length > 3 && <li className="px-1 py-1 text-xs text-inverse-muted">+{s.docs.length - 3} more</li>}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        {progress !== null ? (
          <div className="min-w-40 flex-1 sm:max-w-xs">
            <div className="h-1 overflow-hidden rounded-full bg-inverse-ink/30">
              <div className="h-full rounded-full bg-yellow-400" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="mt-1.5 font-mono text-[11px] text-inverse-muted">
              {Math.round(progress * 100)}% {label}
            </p>
          </div>
        ) : (
          <span />
        )}
        <span className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-inverse-ink px-5 py-2.5 text-sm font-medium text-inverse transition-[gap] group-hover:gap-3">
          Continue <span aria-hidden>→</span>
        </span>
      </div>
    </Link>
  );
}

function Summary({ s, today }: { s: LibrarySession; today: string | null }) {
  const pages = s.docs.reduce((n, d) => n + d.pages, 0);
  if (s.kind === "exam") {
    const days = today ? daysUntil(s.exam?.examDate ?? null, today) : null;
    return (
      <>
        {today ? countdownLabel(days) : " "}
        {s.exam?.answered ? ` · ${s.exam.answered} practice answers, ${Math.round((s.exam.accuracy ?? 0) * 100)}% correct` : ""}
      </>
    );
  }
  if (s.kind === "paper") return <>{s.paper && s.paper.total ? `${s.paper.done} of ${s.paper.total} papers read to their target pass` : "No papers yet"}</>;
  if (s.study) return <>{`${s.study.done} of ${s.study.total} topics · ${s.study.goal}`}</>;
  return <>{s.docs.length ? `${s.docs.length} file${s.docs.length > 1 ? "s" : ""} · ${pages} pages · set a goal to get a plan` : "Add a file to begin"}</>;
}

function SessionCard({ s, today }: { s: LibrarySession; today: string | null }) {
  const pages = s.docs.reduce((n, d) => n + d.pages, 0);
  const notReady = s.docs.filter((d) => !d.ready).length;

  let progress: number | null = null;
  let detail = "";
  if (s.kind === "study" && s.study) {
    progress = s.study.total ? s.study.done / s.study.total : 0;
    const days = today ? daysUntil(s.study.deadline, today) : null;
    detail = `${s.study.done}/${s.study.total} topics${days !== null ? ` · ${days >= 0 ? `${days} days left` : "deadline passed"}` : ""}`;
  } else if (s.kind === "exam") {
    progress = s.exam?.accuracy ?? null;
    detail = `${today ? countdownLabel(daysUntil(s.exam?.examDate ?? null, today)) : ""}${s.exam?.answered ? ` · ${Math.round((s.exam.accuracy ?? 0) * 100)}% correct` : ""}`;
  } else if (s.kind === "paper" && s.paper) {
    progress = s.paper.total ? s.paper.done / s.paper.total : 0;
    detail = `${s.paper.done}/${s.paper.total} read to target · passes ${s.paper.byTarget.join("/")}`;
  }

  return (
    <article className="group relative flex h-full flex-col rounded-2xl border border-ink bg-panel p-5 transition-colors hover:bg-paper">
      <div className="flex items-center justify-between gap-3">
        <span className="rounded border border-ink/30 px-1.5 py-px font-mono text-[10px] tracking-wider text-muted uppercase">{KIND_LABEL[s.kind]}</span>
        <div className="relative z-10 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          <SessionActions id={s.id} title={s.title} archived={s.archived} />
        </div>
      </div>
      <Link href={`/session/${s.id}`} className="mt-3 font-serif text-xl leading-snug after:absolute after:inset-0">
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

      {s.kind === "study" && s.study && <p className="mt-3 line-clamp-2 text-sm">{s.study.goal}</p>}
      {s.kind === "study" && !s.study && <p className="mt-3 text-sm text-muted">No plan yet: set a goal to get one.</p>}

      <div className="mt-auto pt-5">
        {progress !== null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-ink transition-[width] duration-700 ease-fluid" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[11px] text-muted">
          <span className="truncate" suppressHydrationWarning>
            {detail}
          </span>
          <span className="shrink-0" suppressHydrationWarning>
            {ago(s.updatedAt)}
          </span>
        </div>
      </div>
    </article>
  );
}
