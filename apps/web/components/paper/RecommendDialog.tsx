"use client";

import { useEffect, useState } from "react";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";
import { JSON_HEADERS, notifyAiUsed, readAiError } from "@/lib/ai-errors";
import type { PaperMeta } from "@/lib/pdf/add-paper";

const OPEN_EVENT = "confu:recommend-papers";
export const openRecommendPapers = () => window.dispatchEvent(new Event(OPEN_EVENT));

type Item = { paper: PaperMeta; stage: "start" | "core" | "frontier"; pass: 1 | 2 | 3; why: string };

const STAGES = [
  { key: "start", title: "Start here", hint: "Foundations and the landmark papers" },
  { key: "core", title: "Core methods", hint: "What you need to understand deeply" },
  { key: "frontier", title: "The frontier", hint: "Recent work and open problems" },
] as const;

const STEPS = ["Reading what you've studied…", "Planning the search…", "Searching the literature…", "Checking landmark papers…", "Choosing your reading path…"];

// Workspace mounts this once; anything can open it with openRecommendPapers().
export function RecommendPapers({ sessionId, researchGoal, onAdd }: { sessionId: string; researchGoal: string; onAdd: (papers: PaperMeta[]) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  return open ? <RecommendDialog sessionId={sessionId} researchGoal={researchGoal} onAdd={onAdd} onClose={() => setOpen(false)} /> : null;
}

function RecommendDialog({
  sessionId,
  researchGoal,
  onAdd,
  onClose,
}: {
  sessionId: string;
  researchGoal: string;
  onAdd: (papers: PaperMeta[]) => void;
  onClose: () => void;
}) {
  const [goal, setGoal] = useState(researchGoal);
  const [useHistory, setUseHistory] = useState(true);
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ summary: string; items: Item[] } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !pending && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  // Progress hints while the server works (it takes 15–45 s).
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 6000);
    return () => window.clearInterval(t);
  }, [pending]);

  async function run() {
    setPending(true);
    setStep(0);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/paper/recommend", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ sessionId, goal, useHistory }) });
      if (!res.ok) throw new Error(await readAiError(res));
      const json = (await res.json()) as { summary: string; items: Item[] };
      setResult(json);
      setPicked(new Set(json.items.map((_, i) => i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't get recommendations.");
    } finally {
      setPending(false);
      notifyAiUsed();
    }
  }

  const chosen = (result?.items ?? []).filter((_, i) => picked.has(i)).map((it) => it.paper);

  return (
    <div
      className="animate-fade fixed inset-0 z-60 flex items-center justify-center bg-scrim p-3 sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && !pending && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="rec-title" className="animate-pop flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard">
        <div className="flex items-start justify-between gap-4 border-b border-ink px-6 pt-5 pb-4">
          <div>
            <p className={eyebrowClass}>Find papers</p>
            <h2 id="rec-title" className="mt-1 font-serif text-2xl">Build me a reading path</h2>
            <p className="mt-1 text-sm text-muted">Tell us where you want to get to. You&apos;ll get real papers, in order, from foundations to the frontier.</p>
          </div>
          <button onClick={onClose} disabled={pending} aria-label="Close" className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-paper">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {!result && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run();
              }}
              className="space-y-3"
            >
              <textarea
                autoFocus
                rows={4}
                value={goal}
                maxLength={3000}
                disabled={pending}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g. I want to start doing research on reinforcement learning for LLM reasoning. I know PPO, but I've never read the GRPO-era papers."
                className={`${inputClass} resize-y leading-relaxed`}
              />
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" checked={useHistory} disabled={pending} onChange={(e) => setUseHistory(e.target.checked)} className="mt-1 accent-ink" />
                <span>
                  Use what I&apos;ve studied in Confu
                  <span className="block text-xs text-muted">Your sessions, the papers you&apos;ve read and how deeply, and what the tutor knows you understand. Papers you already have are left out.</span>
                </span>
              </label>
              {error && <p className="animate-pop rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
              {pending ? (
                <div className="flex items-center gap-3 rounded-lg border border-line bg-paper px-4 py-3 text-sm">
                  <div className="indeterminate h-[3px] w-16 shrink-0 rounded-full bg-line" />
                  <span key={step} className="animate-fade">
                    {STEPS[step]}
                  </span>
                </div>
              ) : (
                <button disabled={goal.trim().length < 8} className={`${buttonClass} w-full py-2.5`}>
                  Suggest papers
                </button>
              )}
              <p className="text-xs text-muted">Every suggestion is a real paper found in Semantic Scholar, arXiv or OpenAlex. Reasons are AI-written, so skim the abstract too.</p>
            </form>
          )}

          {result && (
            <div className="space-y-6">
              {result.summary && <p className="border-l-2 border-ink pl-3 text-sm leading-relaxed">{result.summary}</p>}
              {result.items.length === 0 && <p className="text-sm text-muted">No good matches this time. Try describing your goal differently.</p>}
              {STAGES.map((stage) => {
                const items = result.items.map((it, i) => ({ it, i })).filter(({ it }) => it.stage === stage.key);
                if (!items.length) return null;
                return (
                  <section key={stage.key}>
                    <p className={eyebrowClass}>{stage.title}</p>
                    <p className="text-xs text-muted">{stage.hint}</p>
                    <ul className="mt-2 space-y-2">
                      {items.map(({ it, i }) => (
                        <li key={i}>
                          <label
                            className={`flex cursor-pointer gap-3 rounded-lg border px-4 py-3 transition ${picked.has(i) ? "border-ink bg-panel" : "border-line bg-paper opacity-70"}`}
                          >
                            <input
                              type="checkbox"
                              checked={picked.has(i)}
                              onChange={() =>
                                setPicked((s) => {
                                  const n = new Set(s);
                                  if (n.has(i)) n.delete(i);
                                  else n.add(i);
                                  return n;
                                })
                              }
                              className="mt-1 accent-ink"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-start justify-between gap-3">
                                <a
                                  href={it.paper.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="font-medium leading-snug hover:underline"
                                >
                                  {it.paper.title}
                                </a>
                                <span className="shrink-0 rounded border border-ink/30 px-1.5 py-px font-mono text-[10px] whitespace-nowrap">pass {it.pass}</span>
                              </span>
                              <span className="mt-0.5 block text-xs text-muted">
                                {[
                                  it.paper.authors.slice(0, 3).join(", ") + (it.paper.authors.length > 3 ? " et al." : ""),
                                  it.paper.year,
                                  it.paper.venue,
                                  it.paper.cited_by ? `${it.paper.cited_by.toLocaleString()} citations` : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                              {it.why && <span className="mt-1.5 block text-sm leading-relaxed">{it.why}</span>}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {result && (
          <div className="flex items-center justify-between gap-3 border-t border-ink px-6 py-4">
            <button onClick={() => setResult(null)} className={`${ghostButtonClass} py-1.5 text-xs`}>
              Change goal
            </button>
            <button
              disabled={!chosen.length}
              onClick={() => {
                onAdd(chosen);
                onClose();
              }}
              className={buttonClass}
            >
              Add {chosen.length} paper{chosen.length === 1 ? "" : "s"} to this session
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
