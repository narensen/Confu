"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PROVIDERS } from "@confu/ai/providers";
import { useArrive, usePresence, useUnfold } from "@confu/ui/motion";
import { useAiKey } from "./KeySetup";
import { useSync } from "./sync";

// Pieces shared by the library and the session: the top bar, a dialog, and
// a few formatters.

// The top bar has a slot in the middle; a screen puts its own controls there
// with <InTopBar> (the session: back and its title).
const SlotContext = createContext<HTMLElement | null>(null);

export function TopBar({ homeHref, onAi, right, children }: { homeHref: string; onAi: () => void; right?: ReactNode; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <SlotContext.Provider value={slot}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ink bg-panel px-3 sm:gap-3 sm:px-4">
        <a href={homeHref} className="shrink-0 font-serif text-lg leading-none font-medium tracking-tight">
          Confu
        </a>
        <div ref={setSlot} className="flex min-w-0 flex-1 items-center gap-1" />
        {right}
        <AiChip onClick={onAi} />
      </header>
      {children}
    </SlotContext.Provider>
  );
}

// One screen of the app (the library, a session). It arrives softly when
// it opens; leaving is instant, so moving between screens never waits.
export function Screen({ children }: { children: ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  useArrive(el);
  return (
    <div ref={el} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  );
}

export function InTopBar({ children }: { children: ReactNode }) {
  const slot = useContext(SlotContext);
  return slot ? createPortal(children, slot) : null;
}

function AiChip({ onClick }: { onClick: () => void }) {
  const { data: key } = useAiKey();
  if (key === undefined) return null;
  const name = key ? (key.provider === "custom" ? (key.host ?? "Your server") : PROVIDERS[key.provider].name) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
        key ? "border-ink/25 text-muted hover:border-ink hover:text-ink" : "border-ink bg-ink text-white"
      }`}
    >
      <span className={`size-1.5 rounded-full ${key ? "bg-ok" : "bg-white"}`} aria-hidden />
      {name ?? "Connect your AI"}
    </button>
  );
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const scrim = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Closing plays the dialog out first.
  const close = usePresence(scrim, panel, onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  return (
    <div ref={scrim} className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-0 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={panel} role="dialog" aria-modal aria-label={title} className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-ink bg-panel p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-serif text-xl">{title}</h2>
          <button type="button" onClick={close} aria-label="Close" className="flex size-8 items-center justify-center rounded-full text-muted transition hover:bg-paper hover:text-ink">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// A strip under the top bar for something the student should know.
export function Notice({ tone = "warn", children, onDismiss }: { tone?: "warn" | "ok" | "danger"; children: ReactNode; onDismiss?: () => void }) {
  const color = tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : "text-warn";
  const strip = useRef<HTMLDivElement>(null);
  useUnfold(strip);
  return (
    <div ref={strip} className={`flex shrink-0 items-start gap-3 border-b border-line bg-paper px-4 py-2 text-xs leading-relaxed ${color}`} role="status">
      <p className="min-w-0 flex-1">{children}</p>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 text-muted hover:text-ink">
          Dismiss
        </button>
      )}
    </div>
  );
}

export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: new Date(iso).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

export const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

// PDFs dropped anywhere on the element.
export function dropHandlers(onFiles: (files: File[]) => void) {
  return {
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      const files = [...e.dataTransfer.files];
      if (!files.length) return;
      e.preventDefault();
      onFiles(files);
    },
  };
}

// Sync status, when the host offers Google Drive.
export function SyncChip({ onClick }: { onClick: () => void }) {
  const { state } = useSync();
  if (!state.available) return null;
  const text = !state.on ? "Back up" : state.busy ? "Syncing…" : state.paused ? "Sync paused" : state.error ? "Sync problem" : "Synced";
  const tone = state.on && (state.paused || state.error) ? "text-warn border-warn/40" : "border-ink/25 text-muted hover:border-ink hover:text-ink";
  return (
    <button type="button" onClick={onClick} title={state.lastAt ? `Last synced ${ago(state.lastAt)}` : "Sync and backup"} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${tone}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={state.busy ? "animate-pulse" : ""}>
        <path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.78A6 6 0 0 0 4.5 12.5 3.5 3.5 0 0 0 6.5 19z" />
      </svg>
      <span className="hidden sm:inline">{text}</span>
    </button>
  );
}
