"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

// In-app replacements for window.confirm and window.alert. The native ones
// freeze the page while open, which browsers report as a very slow
// interaction (INP), and they look nothing like Confu.
//
//   if (!(await ask({ title: "Delete this?", danger: true }))) return;
//   const c = await choose({ title: "Delete?", alternative: "Archive instead" }); // "confirm" | "alternative" | "cancel"
//   toast("Saved");  toast("Couldn't save", "error");
//   notify({ title: "Ben sent you a friend request", avatar: "Ben", actions: [{ label: "Accept", onClick }] });
//
// <DialogHost /> (mounted once in the root layout) renders them. Toasts and
// notifications slide in on the right, below the header, and wait while
// the pointer is over them.

type AskOptions = { title: string; body?: string; confirm?: string; cancel?: string; danger?: boolean };
export type Choice = "confirm" | "alternative" | "cancel";
type Pending = AskOptions & { alternative?: string; resolve: (choice: Choice) => void };
export type NotifyAction = { label: string; href?: string; onClick?: () => unknown; primary?: boolean };
export type NotifyOptions = {
  title: string;
  body?: string;
  avatar?: string; // a person's name: their initial in a circle
  icon?: ReactNode;
  tone?: "info" | "success" | "error";
  href?: string; // where the card goes when clicked
  actions?: NotifyAction[];
  duration?: number; // ms; 0 stays until closed
};
type Toast = { id: number; message: string; tone: "info" | "error" };
type Card = { id: number; kind: "toast"; toast: Toast } | { id: number; kind: "notify"; notice: NotifyOptions };

const ASK_EVENT = "confu:ask";
const TOAST_EVENT = "confu:toast";
const NOTIFY_EVENT = "confu:notify";

export function ask(options: AskOptions): Promise<boolean> {
  return choose(options).then((c) => c === "confirm");
}

// Like ask, with a third, safer way out (e.g. "Archive instead" of deleting).
export function choose(options: AskOptions & { alternative?: string }): Promise<Choice> {
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { ...options, resolve } })));
}

export function toast(message: string, tone: Toast["tone"] = "info") {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message, tone } }));
}

// A richer card on the right: who, what, and something to do about it.
export function notify(options: NotifyOptions) {
  window.dispatchEvent(new CustomEvent(NOTIFY_EVENT, { detail: options }));
}

export function DialogHost() {
  const [queue, setQueue] = useState<Pending[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const nextId = useRef(0);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const current = queue[0];

  useEffect(() => {
    const onAsk = (e: Event) => setQueue((q) => [...q, (e as CustomEvent<Pending>).detail]);
    const onToast = (e: Event) => {
      const { message, tone } = (e as CustomEvent<Omit<Toast, "id">>).detail;
      const id = ++nextId.current;
      setCards((list) => [...list.slice(-3), { id, kind: "toast", toast: { id, message, tone } }]);
    };
    const onNotify = (e: Event) => {
      const id = ++nextId.current;
      setCards((list) => [...list.slice(-3), { id, kind: "notify", notice: (e as CustomEvent<NotifyOptions>).detail }]);
    };
    window.addEventListener(ASK_EVENT, onAsk);
    window.addEventListener(TOAST_EVENT, onToast);
    window.addEventListener(NOTIFY_EVENT, onNotify);
    return () => {
      window.removeEventListener(ASK_EVENT, onAsk);
      window.removeEventListener(TOAST_EVENT, onToast);
      window.removeEventListener(NOTIFY_EVENT, onNotify);
    };
  }, []);

  function answer(choice: Choice) {
    if (!current) return;
    current.resolve(choice);
    setQueue((q) => q.slice(1));
  }

  // Focus the safe choice: Cancel for destructive actions, otherwise Confirm.
  useEffect(() => {
    if (!current) return;
    (current.danger ? cancelRef : confirmRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        current.resolve("cancel");
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
          onMouseDown={(e) => e.target === e.currentTarget && answer("cancel")}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confu-ask-title"
            className="animate-pop w-full max-w-sm rounded-xl border border-ink bg-panel p-5 shadow-[6px_6px_0_0_var(--shadow)]"
          >
            <p id="confu-ask-title" className="font-serif text-xl leading-snug">
              {current.title}
            </p>
            {current.body && <p className="mt-2 text-sm leading-relaxed text-muted">{current.body}</p>}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {current.alternative && (
                <button
                  type="button"
                  onClick={() => answer("alternative")}
                  className="mr-auto rounded-lg border border-ink bg-yellow-300 px-3.5 py-2 text-sm font-medium transition hover:-translate-y-px hover:shadow-hard-sm"
                >
                  {current.alternative}
                </button>
              )}
              <button
                ref={cancelRef}
                type="button"
                onClick={() => answer("cancel")}
                className="rounded-lg border border-ink bg-panel px-3.5 py-2 text-sm font-medium transition hover:-translate-y-px hover:shadow-hard-sm"
              >
                {current.cancel ?? "Cancel"}
              </button>
              <button
                ref={confirmRef}
                type="button"
                onClick={() => answer("confirm")}
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

      <div aria-live="polite" className="pointer-events-none fixed top-[4.25rem] right-3 z-[80] flex w-[min(23rem,calc(100vw-1.5rem))] flex-col gap-2 sm:right-4">
        {cards.map((c) => (
          <StackCard key={c.id} card={c} onDone={() => setCards((list) => list.filter((x) => x.id !== c.id))} />
        ))}
      </div>
    </>
  );
}

// One card in the stack. It closes itself after a while, but not while the
// pointer is on it.
function StackCard({ card, onDone }: { card: Card; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const duration = card.kind === "toast" ? (card.toast.tone === "error" ? 8000 : 5000) : (card.notice.duration ?? 9000);
  const left = useRef(duration);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    if (leaving) {
      const id = window.setTimeout(() => done.current(), 180);
      return () => window.clearTimeout(id);
    }
    if (paused || !left.current) return;
    const started = Date.now();
    const id = window.setTimeout(() => setLeaving(true), left.current);
    return () => {
      window.clearTimeout(id);
      left.current = Math.max(800, left.current - (Date.now() - started));
    };
  }, [paused, leaving]);

  const close = () => setLeaving(true);
  const motion = `pointer-events-auto transition duration-200 ease-fluid ${leaving ? "translate-x-6 opacity-0" : "animate-notify"}`;

  if (card.kind === "toast") {
    const t = card.toast;
    return (
      <div
        role={t.tone === "error" ? "alert" : "status"}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className={`${motion} flex items-start gap-3 rounded-xl border bg-panel px-4 py-3 text-sm shadow-hard ${t.tone === "error" ? "border-danger" : "border-ink"}`}
      >
        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${t.tone === "error" ? "bg-danger" : "bg-yellow-400"}`} />
        <p className="min-w-0 flex-1 leading-relaxed whitespace-pre-line">{t.message}</p>
        <button type="button" aria-label="Dismiss" onClick={close} className="-mr-1 shrink-0 rounded px-1 text-muted transition hover:text-ink">
          ✕
        </button>
      </div>
    );
  }

  const n = card.notice;
  const tone = n.tone ?? "info";
  const lead = n.avatar ? (
    <span aria-hidden className={`flex size-9 shrink-0 items-center justify-center rounded-full border border-ink font-serif text-sm ${tone === "success" ? "bg-yellow-300" : "bg-yellow-100"}`}>
      {n.avatar.slice(0, 1).toUpperCase()}
    </span>
  ) : n.icon ? (
    <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full border border-ink bg-paper">
      {n.icon}
    </span>
  ) : (
    <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${tone === "error" ? "bg-danger" : tone === "success" ? "bg-ok" : "bg-yellow-400"}`} />
  );
  const text = (
    <span className="min-w-0 flex-1">
      <span className="block text-sm leading-snug font-medium">{n.title}</span>
      {n.body && <span className="mt-0.5 line-clamp-3 block text-xs leading-relaxed text-muted">{n.body}</span>}
    </span>
  );
  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`${motion} overflow-hidden rounded-xl border bg-panel shadow-hard ${tone === "error" ? "border-danger" : "border-ink"}`}
    >
      <div className="flex items-start gap-3 px-3.5 pt-3 pb-3">
        {lead}
        {n.href ? (
          <Link href={n.href} onClick={close} className="min-w-0 flex-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ink">
            {text}
          </Link>
        ) : (
          text
        )}
        <button type="button" aria-label="Dismiss" onClick={close} className="-mr-1 shrink-0 rounded px-1 text-muted transition hover:text-ink">
          ✕
        </button>
      </div>
      {n.actions && n.actions.length > 0 && (
        <div className="flex gap-2 border-t border-line bg-paper px-3.5 py-2">
          {n.actions.map((a) => {
            const cls = `rounded-lg border px-3 py-1 text-xs font-medium transition hover:-translate-y-px ${a.primary ? "border-ink bg-ink text-white" : "border-ink/30 bg-panel hover:border-ink"}`;
            return a.href ? (
              <Link key={a.label} href={a.href} onClick={close} className={cls}>
                {a.label}
              </Link>
            ) : (
              <button
                key={a.label}
                type="button"
                className={cls}
                onClick={() => {
                  void a.onClick?.();
                  close();
                }}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
