"use client";

import { useEffect, useState } from "react";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass, labelClass } from "@/components/ui";
import { addDays, toISODate } from "@/lib/schedule";
import type { Level, StudyPlan } from "@/lib/types";

const STEPS = [
  "Reading your goal…",
  "Mapping your PDFs…",
  "Finding what the PDFs don't cover…",
  "Choosing lectures and resources…",
  "Sequencing phases…",
  "Pacing it to your deadline…",
];

function starterPrompt(docTitles: string[]) {
  const pdfs = docTitles.length ? docTitles.map((t) => `"${t}"`).join(", ") : "(none yet)";
  return `Help me write a learning goal for a study platform. Ask me questions first if you need to, then write the goal in Markdown with these sections:

1. Outcome: what I want to be able to do or explain when I'm done (be concrete).
2. Why: what I need it for (exam, project, job, research…).
3. Background: what I already know and where I'm weak.
4. Materials: my PDFs are ${pdfs}. List any lectures, courses or books I'm also using.
5. Scope: what's in and what's out.
6. Success check: how I'll know I've reached the goal.

Keep it under 400 words.`;
}

export function GoalSetup({
  sessionId,
  docTitles,
  existing,
  onCreated,
  onCancel,
}: {
  sessionId: string;
  docTitles: string[];
  existing?: StudyPlan | null;
  onCreated: () => void;
  onCancel?: () => void;
}) {
  const today = toISODate(new Date());
  const [goal, setGoal] = useState(existing?.goal ?? "");
  const [materials, setMaterials] = useState(existing?.materials ?? "");
  const [deadline, setDeadline] = useState(existing && existing.deadline >= today ? existing.deadline : addDays(today, 14));
  // Students think in hours a day; the API and database store minutes.
  const [hours, setHours] = useState(String(existing ? existing.minutes_per_day / 60 : 1));
  const minutesPerDay = Math.round(Number(hours) * 60);
  const [level, setLevel] = useState<Level>(existing?.level ?? "intermediate");
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 3200);
    return () => window.clearInterval(id);
  }, [pending]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStep(0);
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, goal, materials, level, startDate: today, deadline, minutesPerDay }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not create a plan");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a plan");
    } finally {
      setPending(false);
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(starterPrompt(docTitles));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  if (pending) {
    return (
      <div className="animate-enter flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
        <p className={eyebrowClass}>Building your plan</p>
        <p key={step} className="animate-enter font-serif text-2xl">
          {STEPS[step]}
        </p>
        <div className="indeterminate h-[3px] w-56 rounded-full bg-line" />
        <p className="max-w-xs text-xs text-muted">This usually takes 15–30 seconds.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="animate-enter space-y-6">
      <header>
        <p className={eyebrowClass}>{existing ? "Re-plan" : "Step 1 of 1"}</p>
        <h2 className="mt-1 font-serif text-2xl leading-tight">
          {existing ? "Change your goal" : "What do you want to be able to do?"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          The goal drives everything. Your PDFs are the main material, but the plan also covers what they leave out, with
          lectures and resources to fill the gaps.
        </p>
      </header>

      <div className="rounded-xl border border-dashed border-ink/40 bg-paper p-4 text-sm">
        <p className="font-medium">Tip: draft your goal with any AI</p>
        <p className="mt-1 leading-relaxed text-muted">
          A detailed goal makes a much better plan. Ask ChatGPT, Claude, Gemini or any other assistant to help you write one,
          then paste it below. Markdown is fine.
        </p>
        <button type="button" onClick={copyPrompt} className={`${ghostButtonClass} mt-3 py-1.5 text-xs`}>
          {copied ? "✓ Copied" : "Copy a starter prompt"}
        </button>
      </div>

      <label className="block">
        <span className={labelClass}>Your goal</span>
        <textarea
          required
          minLength={5}
          maxLength={8000}
          rows={8}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder={"e.g. Understand PCA well enough to explain it in my lab meeting and apply it to our assay data.\n\nOr paste a detailed goal written with another AI."}
          className={`${inputClass} resize-y font-[inherit] leading-relaxed`}
        />
        <span className="mt-1 block text-right font-mono text-[11px] text-muted">{goal.length.toLocaleString()} / 8,000</span>
      </label>

      <label className="block">
        <span className={labelClass}>
          Other materials <span className="font-normal text-muted">(optional)</span>
        </span>
        <textarea
          rows={2}
          maxLength={2000}
          value={materials}
          onChange={(e) => setMaterials(e.target.value)}
          placeholder="Lectures, courses or books you're also using, e.g. MIT 18.06 (Strang), StatQuest PCA videos"
          className={`${inputClass} resize-y`}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelClass}>Deadline</span>
          <input type="date" required min={today} value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Hours / day</span>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              required
              min={0.25}
              max={10}
              step={0.25}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className={`${inputClass} pr-10`}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-xs text-muted">hrs</span>
          </div>
        </label>
      </div>

      <fieldset>
        <legend className={labelClass}>Your background in this subject</legend>
        <div className="relative grid grid-cols-3 rounded-lg border border-ink p-1">
          <span
            aria-hidden
            className="absolute inset-y-1 left-1 rounded-md bg-ink transition-transform duration-300 ease-fluid"
            style={{
              width: "calc((100% - 0.5rem) / 3)",
              transform: `translateX(${["beginner", "intermediate", "advanced"].indexOf(level) * 100}%)`,
            }}
          />
          {(["beginner", "intermediate", "advanced"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLevel(l)}
              className={`relative z-10 rounded-md py-1.5 text-xs font-medium capitalize transition-colors duration-300 ${
                level === l ? "text-white" : "text-muted hover:text-ink"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </fieldset>

      {existing && (
        <p className="rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-warn">
          Re-planning replaces your current topics and their progress. Your conversation and tutor memory are kept.
        </p>
      )}
      {error && <p className="animate-pop rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <button className={`${buttonClass} flex-1 py-2.5`}>{existing ? "Rebuild plan" : "Build my plan"}</button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={ghostButtonClass}>
            Cancel
          </button>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        Plans and suggested resources are generated by AI and can contain mistakes. Review them and adjust your goal if
        something looks off.
      </p>
    </form>
  );
}
