"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { eyebrowClass } from "@/components/ui";
import { completeOnboarding } from "./actions";
import { GUIDE_STEPS } from "./steps";

const SEEN_KEY = "confu:guide-seen";
const OPEN_EVENT = "confu:open-guide";

// Lets other components (e.g. the empty dashboard) open the guide.
export function openGuide() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

// Local fallback so the guide doesn't reopen if the server write fails or the
// onboarding migration hasn't been run. Server render assumes "seen" so the
// modal never flashes before hydration.
function useSeenLocally() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      return () => window.removeEventListener("storage", cb);
    },
    () => {
      try {
        return localStorage.getItem(SEEN_KEY) === "1";
      } catch {
        return false;
      }
    },
    () => true,
  );
}

export function Guide({ firstTime, needsKey }: { firstTime: boolean | null; needsKey: boolean }) {
  const steps = useMemo(() => GUIDE_STEPS.filter((s) => !s.onlyForKeyUsers || needsKey), [needsKey]);
  const seenLocally = useSeenLocally();
  const [dismissed, setDismissed] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const nextRef = useRef<HTMLButtonElement>(null);

  const open = manualOpen || ((firstTime ?? true) && !seenLocally && !dismissed);
  const step = steps[index];
  const last = index === steps.length - 1;

  const close = useCallback(() => {
    setManualOpen(false);
    setDismissed(true);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {}
    void completeOnboarding();
  }, []);

  const go = useCallback(
    (delta: 1 | -1) => {
      setDirection(delta);
      setIndex((i) => Math.min(steps.length - 1, Math.max(0, i + delta)));
    },
    [steps.length],
  );

  useEffect(() => {
    const onOpen = () => {
      setIndex(0);
      setManualOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    nextRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") {
        if (last) close();
        else go(1);
      }
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, last, close, go]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIndex(0);
          setManualOpen(true);
        }}
        className="rounded-md px-2 py-1 text-muted transition hover:bg-paper hover:text-ink"
      >
        Guide
      </button>

      {open && (
        <div className="animate-fade fixed inset-0 z-60 flex items-center justify-center bg-ink/40 p-3 backdrop-blur-[2px] sm:p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
            className="animate-pop flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard md:h-[34rem] md:flex-row"
          >
            {/* Illustration */}
            <div className="relative h-56 shrink-0 border-b border-ink bg-paper p-6 md:h-auto md:w-[46%] md:border-r md:border-b-0 md:p-8">
              <div key={step.id} className={direction === 1 ? "animate-enter h-full" : "animate-slide-in h-full"}>
                {step.art}
              </div>
            </div>

            {/* Explanation */}
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center justify-between px-6 pt-5 md:px-8">
                <span className="font-mono text-[11px] text-muted tabular-nums">
                  {String(index + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}
                </span>
                <button onClick={close} className="text-xs text-muted transition hover:text-ink">
                  Skip guide
                </button>
              </div>

              <div key={step.id} className="animate-enter min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-2 md:px-8">
                <p className={eyebrowClass}>{step.eyebrow}</p>
                <h2 id="guide-title" className="mt-1.5 font-serif text-[1.65rem] leading-tight tracking-tight">
                  {step.title}
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted">{step.intro}</p>

                <dl className="mt-5 space-y-3.5">
                  {step.points.map((p, i) => (
                    <div key={i} className="animate-enter flex gap-3" style={{ animationDelay: `${80 + i * 60}ms` }}>
                      <span className="mt-[0.45em] size-1.5 shrink-0 bg-ink" />
                      <div className="text-sm leading-relaxed">
                        <dt className="inline font-medium">{p.label}. </dt>
                        <dd className="inline text-ink/80">{p.body}</dd>
                      </div>
                    </div>
                  ))}
                </dl>

                {step.tip && (
                  <p className="mt-5 rounded-lg border border-dashed border-ink/40 bg-paper px-3 py-2 text-xs leading-relaxed text-muted">{step.tip}</p>
                )}
              </div>

              {/* Progress + navigation */}
              <div className="border-t border-ink px-6 py-4 md:px-8">
                <div className="mb-4 flex gap-1" aria-hidden>
                  {steps.map((s, i) => (
                    <button
                      key={s.id}
                      tabIndex={-1}
                      onClick={() => {
                        setDirection(i > index ? 1 : -1);
                        setIndex(i);
                      }}
                      className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i <= index ? "bg-ink" : "bg-line hover:bg-ink/30"}`}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <button
                    onClick={() => go(-1)}
                    disabled={index === 0}
                    className="rounded-lg border border-ink px-4 py-2 text-sm font-medium transition duration-200 hover:-translate-y-px hover:shadow-hard-sm disabled:pointer-events-none disabled:opacity-30"
                  >
                    Back
                  </button>
                  <button
                    ref={nextRef}
                    onClick={() => (last ? close() : go(1))}
                    className="rounded-lg border border-ink bg-ink px-5 py-2 text-sm font-medium text-white transition duration-200 hover:-translate-y-px hover:shadow-hard-sm active:translate-y-0"
                  >
                    {last ? "Start learning" : index === 0 ? "Show me around" : "Next"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
