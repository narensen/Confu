"use client";

import { useEffect, useRef, useState } from "react";

// In-app replacements for window.confirm and window.alert. The native ones
// freeze the page while open, which browsers report as a very slow
// interaction (INP), and they look nothing like Confu.
//
//   if (!(await ask({ title: "Delete this?", danger: true }))) return;
//   toast("Saved");  toast("Couldn't save", "error");
//
// <DialogHost /> (mounted once in the root layout) renders them.

type AskOptions = { title: string; body?: string; confirm?: string; cancel?: string; danger?: boolean };
type Pending = AskOptions & { resolve: (ok: boolean) => void };
type Toast = { id: number; message: string; tone: "info" | "error" };

const ASK_EVENT = "confu:ask";
const TOAST_EVENT = "confu:toast";

export function ask(options: AskOptions): Promise<boolean> {
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { ...options, resolve } })));
}

export function toast(message: string, tone: Toast["tone"] = "info") {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message, tone } }));
}

export function DialogHost() {
  const [queue, setQueue] = useState<Pending[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const current = queue[0];

  useEffect(() => {
    const onAsk = (e: Event) => setQueue((q) => [...q, (e as CustomEvent<Pending>).detail]);
    const onToast = (e: Event) => {
      const { message, tone } = (e as CustomEvent<Omit<Toast, "id">>).detail;
      const id = ++nextId.current;
      setToasts((list) => [...list.slice(-2), { id, message, tone }]);
      window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === "error" ? 8000 : 5000);
    };
    window.addEventListener(ASK_EVENT, onAsk);
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(ASK_EVENT, onAsk);
      window.removeEventListener(TOAST_EVENT, onToast);
    };
  }, []);

  function answer(ok: boolean) {
    if (!current) return;
    current.resolve(ok);
    setQueue((q) => q.slice(1));
  }

  // Focus the safe choice: Cancel for destructive actions, otherwise Confirm.
  useEffect(() => {
    if (!current) return;
    (current.danger ? cancelRef : confirmRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        current.resolve(false);
        setQueue((q) => q.slice(1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current]);

  return (
    <>
      {current && (
        <div
          className="animate-fade fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]"
          onMouseDown={(e) => e.target === e.currentTarget && answer(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confu-ask-title"
            className="animate-pop w-full max-w-sm rounded-xl border border-ink bg-panel p-5 shadow-[6px_6px_0_0_#0d0d0c]"
          >
            <p id="confu-ask-title" className="font-serif text-xl leading-snug">
              {current.title}
            </p>
            {current.body && <p className="mt-2 text-sm leading-relaxed text-muted">{current.body}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => answer(false)}
                className="rounded-lg border border-ink bg-panel px-3.5 py-2 text-sm font-medium transition hover:-translate-y-px hover:shadow-hard-sm"
              >
                {current.cancel ?? "Cancel"}
              </button>
              <button
                ref={confirmRef}
                type="button"
                onClick={() => answer(true)}
                className={`rounded-lg border px-3.5 py-2 text-sm font-medium text-white transition hover:-translate-y-px hover:shadow-hard-sm ${
                  current.danger ? "border-danger bg-danger" : "border-ink bg-ink"
                }`}
              >
                {current.confirm ?? "OK"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={`animate-pop pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-[4px_4px_0_0_#0d0d0c] ${
              t.tone === "error" ? "border-danger bg-panel text-ink" : "border-ink bg-ink text-white"
            }`}
          >
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${t.tone === "error" ? "bg-danger" : "bg-yellow-400"}`} />
            <p className="min-w-0 flex-1 leading-relaxed whitespace-pre-line">{t.message}</p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
              className="-mr-1 shrink-0 rounded px-1 opacity-60 transition hover:opacity-100"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
