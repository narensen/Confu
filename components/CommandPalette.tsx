"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { openFeedback } from "@/components/Feedback";
import { openNewSession } from "@/components/dashboard/NewSessionDialog";
import { OPEN_PALETTE_EVENT, openPalette, usePageCommands } from "@/lib/commands";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/telemetry";
import { setTheme, useTheme } from "@/lib/theme";
import type { SessionKind } from "@/lib/types";
import { useModal } from "@/components/Modal";

// Ctrl/Cmd+K, anywhere once signed in: jump to a session or a place, or run
// one of the open page's commands (a workspace tool, full screen…). Typing
// filters; arrows move; Enter runs; Esc closes.

type Item = { id: string; group: string; label: string; hint?: string; keys?: string; run: () => void };
type SessionRow = { id: string; title: string; kind: SessionKind; updated_at: string };

const KIND: Record<SessionKind, string> = { study: "Study", exam: "Exam prep", paper: "Papers" };

const noSubscribe = () => () => {};
function useIsMac() {
  return useSyncExternalStore(
    noSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    () => false,
  );
}

// The button in the header that opens it (and says how to, next time).
export function PaletteButton({ compact = false }: { compact?: boolean }) {
  const mac = useIsMac();
  return (
    <button
      type="button"
      onClick={openPalette}
      aria-label="Go to a session, a place or a tool"
      aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
      title={`Go to… (${mac ? "⌘" : "Ctrl+"}K)`}
      className={`flex h-8 shrink-0 items-center gap-2 rounded-full border border-line bg-panel text-sm text-muted transition hover:border-ink/40 hover:text-ink ${compact ? "w-8 justify-center lg:w-auto lg:px-2.5" : "px-2.5"}`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <span className={compact ? "hidden lg:inline" : "hidden sm:inline"}>Go to…</span>
      <kbd className={`rounded border border-line px-1 font-mono text-xs ${compact ? "hidden lg:inline" : "hidden sm:inline"}`}>{mac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  return open ? createPortal(<Palette onClose={() => setOpen(false)} />, document.body) : null;
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const path = usePathname();
  const theme = useTheme();
  const page = usePageCommands();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);

  // Focus the box; give focus back to where it was on close.
  useEffect(() => {
    returnTo.current = document.activeElement;
    input.current?.focus();
    track("palette.open");
    return () => {
      if (returnTo.current instanceof HTMLElement) returnTo.current.focus();
    };
  }, []);

  useEffect(() => {
    let live = true;
    void createClient()
      .from("study_sessions")
      .select("id, title, kind, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (live) setSessions((data ?? []) as SessionRow[]);
      });
    return () => {
      live = false;
    };
  }, []);

  const items = useMemo(() => {
    const go = (href: string) => () => router.push(href);
    const all: Item[] = [
      ...page.map((c) => ({ ...c, group: "This session" })),
      { id: "new", group: "Actions", label: "New session", hint: "Study, exam prep or papers", run: () => (path === "/dashboard" ? openNewSession() : router.push("/dashboard?new=1")) },
      {
        id: "theme",
        group: "Actions",
        label: theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
        run: () => setTheme(theme === "dark" ? "light" : "dark"),
      },
      { id: "feedback", group: "Actions", label: "Send feedback", run: () => openFeedback() },
      { id: "p-library", group: "Places", label: "Library", hint: "Your sessions", run: go("/dashboard") },
      { id: "p-review", group: "Places", label: "Review", hint: "What's due before you forget it", run: go("/review") },
      { id: "p-threads", group: "Places", label: "Threads", hint: "Community questions", run: go("/threads") },
      { id: "p-spaces", group: "Places", label: "Spaces", hint: "Subjects and private groups", run: go("/spaces") },
      { id: "p-rooms", group: "Places", label: "Study rooms", hint: "A shared focus timer", run: go("/rooms") },
      { id: "p-friends", group: "Places", label: "Friends", run: go("/friends") },
      { id: "p-map", group: "Places", label: "Literature map", hint: "Every paper across your sessions", run: go("/map") },
      { id: "p-month", group: "Places", label: "Your month", run: go("/wrapped") },
      { id: "p-settings", group: "Places", label: "Settings", run: go("/settings") },
      { id: "p-appearance", group: "Places", label: "Appearance settings", hint: "Theme, reading theme, shortcuts", run: go("/settings#appearance") },
    ];
    const q = query.trim().toLowerCase();
    // Without a search, the six sessions touched last; with one, all of them.
    const shown = q ? (sessions ?? []) : (sessions ?? []).slice(0, 6);
    all.push(...shown.map((s) => ({ id: `s-${s.id}`, group: "Sessions", label: s.title, hint: KIND[s.kind], run: go(`/session/${s.id}`) })));
    if (!q) return all;
    const words = q.split(/\s+/);
    return all
      .map((i) => {
        const text = `${i.label} ${i.hint ?? ""}`.toLowerCase();
        if (!words.every((w) => text.includes(w))) return null;
        const label = i.label.toLowerCase();
        const score = label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
        return { i, score };
      })
      .filter((x): x is { i: Item; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.i);
  }, [page, path, query, router, sessions, theme]);

  const current = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => {
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function run(item: Item | undefined) {
    if (!item) return;
    track("palette.run", { id: item.id.startsWith("s-") ? "session" : item.id });
    onClose();
    item.run();
  }

  // Group headings, in the order the items come.
  let lastGroup = "";
  const rows: ReactNode[] = [];
  items.forEach((item, index) => {
    if (item.group !== lastGroup && !query.trim()) {
      lastGroup = item.group;
      rows.push(
        <p key={`g-${item.group}`} role="presentation" className="px-3 pt-3 pb-1 font-mono text-xs tracking-[0.12em] text-muted uppercase">
          {item.group}
        </p>,
      );
    }
    const on = index === current;
    rows.push(
      <div
        key={item.id}
        id={`palette-${index}`}
        data-index={index}
        role="option"
        aria-selected={on}
        onMouseMove={() => setActive(index)}
        onClick={() => run(item)}
        className={`mx-1.5 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${on ? "bg-ink text-on-ink" : "text-ink"}`}
      >
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.hint && <span className={`max-w-[45%] shrink-0 truncate text-xs ${on ? "text-on-ink/70" : "text-muted"}`}>{item.hint}</span>}
        {item.keys && <kbd className={`shrink-0 rounded border px-1 font-mono text-xs ${on ? "border-on-ink/30 text-on-ink/80" : "border-line text-muted"}`}>{item.keys}</kbd>}
      </div>,
    );
  });

  const dialogRef = useModal(true, onClose);
  return (
    <div className="animate-fade fixed inset-0 z-[70] flex items-start justify-center bg-scrim px-3 pt-[12vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Go to" className="animate-pop w-full max-w-lg overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-muted" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((current + 1) % Math.max(1, items.length));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((current - 1 + items.length) % Math.max(1, items.length));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(items[current]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              } else if (e.key === "Tab") {
                e.preventDefault(); // the box is the only stop in here
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items.length ? `palette-${current}` : undefined}
            aria-autocomplete="list"
            placeholder="Go to a session, a place or a tool…"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <kbd className="shrink-0 rounded border border-line px-1.5 font-mono text-xs text-muted">Esc</kbd>
        </div>
        <div ref={list} id="palette-list" role="listbox" aria-label="Results" className="max-h-[min(60vh,26rem)] overflow-y-auto pb-1.5">
          {items.length ? rows : <p className="px-4 py-6 text-center text-sm text-muted">Nothing matches “{query.trim()}”.</p>}
          {!query.trim() && sessions && sessions.length > 6 && <p className="px-4 pt-2 pb-1 text-xs text-muted">Type to search all {sessions.length} sessions.</p>}
        </div>
      </div>
    </div>
  );
}
