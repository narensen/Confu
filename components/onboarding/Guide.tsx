"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useModal } from "@/components/Modal";
import { Button } from "@/components/ui";
import { TrySample } from "@/components/dashboard/TrySample";
import { openNewSession } from "@/components/dashboard/NewSessionDialog";
import { completeOnboarding } from "./actions";

// Per account: a new account on a browser where someone else saw the welcome
// still gets it.
const seenKey = (userId: string) => `confu:guide-seen:${userId}`;
const OPEN_EVENT = "confu:open-guide";

// Lets Settings (and anything else) open the welcome again.
export function openGuide() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function useSeenLocally(userId: string) {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      return () => window.removeEventListener("storage", cb);
    },
    () => {
      try {
        return localStorage.getItem(seenKey(userId)) === "1";
      } catch {
        return false;
      }
    },
    () => true,
  );
}

// A short welcome the first time, and again from Settings. The long tour is
// gone: a tip appears the first time a PDF opens, and the first time a plan does.
export function Guide({ userId, firstTime, needsKey }: { userId: string; firstTime: boolean; needsKey: boolean }) {
  const seenLocally = useSeenLocally(userId);
  const [dismissed, setDismissed] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const path = usePathname();
  const router = useRouter();

  const open = manualOpen || (firstTime && !seenLocally && !dismissed);

  const close = useCallback(() => {
    setManualOpen(false);
    setDismissed(true);
    try {
      localStorage.setItem(seenKey(userId), "1");
    } catch {}
    void completeOnboarding();
  }, [userId]);

  const begin = useCallback(() => {
    close();
    if (path.startsWith("/dashboard")) openNewSession();
    else router.push("/dashboard?new=1");
  }, [close, path, router]);

  const dialogRef = useModal(open, close);

  useEffect(() => {
    const onOpen = () => setManualOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  if (!open) return null;

  return createPortal(
    <div className="animate-fade fixed inset-0 z-60 flex items-end justify-center bg-scrim p-3 backdrop-blur-[2px] sm:items-center sm:p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        className="animate-pop w-full max-w-lg rounded-2xl border border-ink bg-panel p-6 shadow-hard sm:p-8"
      >
        <p className="font-mono text-xs font-medium uppercase tracking-[0.12em] text-muted">Welcome</p>
        <h2 id="guide-title" className="mt-2 font-serif text-3xl leading-tight tracking-tight">
          Learn one idea at a time
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Confu plans from a goal, teaches from your own files, and asks you to explain it back. Start a session, or try the sample. Tips show up the first time you open a PDF and the first time you get a plan.
        </p>
        {needsKey && (
          <p className="mt-3 text-sm leading-relaxed">
            Add a Groq key in Settings before the first question, or allow Claude, ChatGPT, Gemini or Grok on this computer. There isn&apos;t a stack of free prompts to use up first.
          </p>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button data-autofocus onClick={begin}>
            New session
          </Button>
          <TrySample compact />
          <button type="button" onClick={close} className="px-3 py-2 text-sm text-muted transition hover:text-ink">
            Not now
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
