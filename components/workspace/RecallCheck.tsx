"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";
import { JSON_HEADERS, notifyAiUsed, readAiError } from "@/lib/ai-errors";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/telemetry";
import type { PlanTopic } from "@/lib/types";

type Question = { q: string; answer: string };
type Rating = "again" | "hard" | "good";

const OFFER_KEY = "confu:recall-offer"; // "off": don't offer after "Mark done"

export function recallOffered() {
  try {
    return localStorage.getItem(OFFER_KEY) !== "off";
  } catch {
    return true;
  }
}

const RATINGS: { id: Rating; label: string }[] = [
  { id: "again", label: "Missed it" },
  { id: "hard", label: "Shaky" },
  { id: "good", label: "Got it" },
];

// "Lock it in": a quick recall check on a topic just finished. Answering from
// memory (not re-reading) is what makes it stick. The student reveals each
// model answer and marks themselves; the topic's review card is scheduled by
// how it went, and anything missed comes back on its own.
export function RecallCheck({ topic, sessionId, offer, onClose }: { topic: PlanTopic; sessionId: string; offer: boolean; onClose: () => void }) {
  const [stage, setStage] = useState<"offer" | "loading" | "asking" | "done" | "error">(offer ? "offer" : "loading");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [i, setI] = useState(0);
  const [draft, setDraft] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [neverOffer, setNeverOffer] = useState(false);

  // Ask for the questions (no state changes here; see show).
  function requestQuestions(): Promise<Question[] | string> {
    return fetch("/api/review/recall", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ topicId: topic.id }) })
      .then(async (res) => (res.ok ? ((await res.json()) as { questions: Question[] }).questions : await readAiError(res)))
      .catch(() => "Couldn't reach Confu. Check your connection and try again.")
      .finally(notifyAiUsed);
  }

  function show(got: Question[] | string) {
    if (typeof got === "string") {
      setError(got);
      setStage("error");
    } else {
      setQuestions(got);
      setStage("asking");
    }
  }

  function start() {
    setStage("loading");
    track("recall.start", { offered: offer });
    void requestQuestions().then(show);
  }

  // Opened straight to the questions ("Check myself" on a finished topic).
  useEffect(() => {
    if (!offer) void requestQuestions().then(show);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function close() {
    if (neverOffer) {
      try {
        localStorage.setItem(OFFER_KEY, "off");
      } catch {}
    }
    onClose();
  }

  async function rate(r: Rating) {
    const all = [...ratings, r];
    setRatings(all);
    setDraft("");
    setRevealed(false);
    if (all.length < questions.length) return setI(i + 1);
    setStage("done");
    track("recall.done", { got: all.filter((x) => x === "good").length, of: all.length });
    // The topic comes back sooner or later depending on how it went, and each
    // question missed (or shaky) becomes a review card of its own.
    const supabase = createClient();
    const overall: Rating = all.includes("again") ? "again" : all.includes("hard") ? "hard" : "good";
    const { data: item } = await supabase.from("review_items").select("id").eq("source", "topic").eq("source_key", topic.id).maybeSingle();
    if (item) await supabase.rpc("review_answer", { p_item: item.id, p_rating: overall });
    const missed = questions.filter((_, k) => all[k] !== "good");
    if (missed.length) {
      await supabase.from("review_items").upsert(
        missed.map((q) => ({
          session_id: sessionId,
          document_id: topic.document_id,
          page_number: topic.page_start,
          source: "mistake",
          source_key: `recall:${topic.id}:${q.q.trim().toLowerCase().slice(0, 400)}`,
          prompt: q.q.slice(0, 2000),
          question: "From a quick check you did",
          answer: q.answer.slice(0, 4000),
        })),
        { onConflict: "user_id,source,source_key", ignoreDuplicates: true },
      );
    }
  }

  const q = questions[i];
  const got = ratings.filter((r) => r === "good").length;

  return createPortal(
    <div className="animate-fade fixed inset-0 z-60 flex items-center justify-center bg-scrim p-3 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-labelledby="recall-title" className="animate-pop flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard">
        <div className="flex items-start justify-between gap-4 border-b border-ink px-6 pt-5 pb-4">
          <div className="min-w-0">
            <p className={eyebrowClass}>{stage === "asking" ? `Question ${i + 1} of ${questions.length}` : "Quick check"}</p>
            <h2 id="recall-title" className="mt-1 font-serif text-2xl leading-snug">
              {stage === "offer" ? "Topic done. Lock it in?" : topic.title}
            </h2>
          </div>
          <button onClick={close} aria-label="Close" className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-paper">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {stage === "offer" && (
            <div className="space-y-3 text-sm leading-relaxed">
              <p>
                Three quick questions on <span className="font-medium">“{topic.title}”</span>, answered from memory. Pulling it back out of your head, not
                re-reading it, is what makes it stick.
              </p>
              <p className="text-muted">You check yourself against a model answer. Anything you miss comes back in review.</p>
              <label className="flex items-center gap-2 pt-1 text-xs text-muted">
                <input type="checkbox" checked={neverOffer} onChange={(e) => setNeverOffer(e.target.checked)} className="size-3.5 accent-[var(--ink)]" />
                Don&apos;t offer this when I mark topics done (it&apos;s still on each finished topic)
              </label>
            </div>
          )}

          {stage === "loading" && (
            <div role="status" className="space-y-2 py-6 text-center">
              <p className="text-sm text-muted">Writing three questions from what you read…</p>
              <div className="indeterminate mx-auto h-[3px] w-40 rounded-full bg-line" />
            </div>
          )}

          {stage === "error" && <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}

          {stage === "asking" && q && (
            <div className="space-y-3">
              <p className="font-serif text-xl leading-snug">{q.q}</p>
              <textarea
                autoFocus
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Your answer, from memory (writing it is optional, thinking it through isn't)"
                className={`${inputClass} resize-y`}
              />
              {revealed ? (
                <div className="animate-enter space-y-3">
                  <div className="rounded-lg border border-line bg-paper px-3 py-2.5 text-sm leading-relaxed">
                    <p className={eyebrowClass}>Model answer</p>
                    <p className="mt-1">{q.answer}</p>
                  </div>
                  <p className="text-xs text-muted">How did yours compare?</p>
                  <div className="grid grid-cols-3 gap-2">
                    {RATINGS.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => void rate(r.id)}
                        className={r.id === "good" ? `${buttonClass} justify-center py-2` : `${ghostButtonClass} justify-center py-2`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setRevealed(true)} className={`${buttonClass} py-2`}>
                  Show the answer
                </button>
              )}
            </div>
          )}

          {stage === "done" && (
            <div className="space-y-2 py-2 text-sm leading-relaxed">
              <p className="font-serif text-2xl">
                {got} of {questions.length} solid
              </p>
              <p className="text-muted">
                {got === questions.length
                  ? "It'll come back for a quick review in a few days, to keep it."
                  : "The ones you missed come back in review tomorrow, with their answers. That's how they stick."}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink px-6 py-4">
          {stage === "offer" ? (
            <>
              <button type="button" onClick={close} className={`${ghostButtonClass} py-1.5`}>
                Not now
              </button>
              <button type="button" onClick={start} className={`${buttonClass} py-1.5`}>
                Check myself
              </button>
            </>
          ) : stage === "error" ? (
            <>
              <button type="button" onClick={close} className={`${ghostButtonClass} py-1.5`}>
                Close
              </button>
              <button type="button" onClick={start} className={`${buttonClass} py-1.5`}>
                Try again
              </button>
            </>
          ) : (
            <button type="button" onClick={close} className={stage === "done" ? `${buttonClass} py-1.5` : `${ghostButtonClass} py-1.5`}>
              {stage === "done" ? "Done" : "Stop"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
