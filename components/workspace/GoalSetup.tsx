"use client";

import { useEffect, useMemo, useState } from "react";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass, labelClass } from "@/components/ui";
import { JSON_HEADERS, notifyAiUsed, readAiError } from "@/lib/ai-errors";
import { addDays, toISODate } from "@/lib/schedule";
import { createClient } from "@/lib/supabase/client";
import { chaptersOf, starterGoal, type Chapter, type StarterDoc, type StarterKind } from "@/lib/tutor/goal-starters";
import type { Level, OutlineItem, StudyPlan } from "@/lib/types";
import { track } from "@/lib/telemetry";

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
  // Starting points built from the PDFs' tables of contents.
  const [starterDocs, setStarterDocs] = useState<StarterDoc[]>([]);
  const [kind, setKind] = useState<StarterKind | null>(existing ? "own" : null);
  const [picked, setPicked] = useState<string[]>([]);
  const chapters = useMemo(() => starterDocs.flatMap(chaptersOf), [starterDocs]);

  useEffect(() => {
    let live = true;
    void createClient()
      .from("documents")
      .select("id, title, page_count, outline, position")
      .eq("session_id", sessionId)
      .eq("status", "ready")
      .order("position")
      .then(({ data }) => {
        if (!live || !data) return;
        const rows = data as { id: string; title: string; page_count: number; outline: OutlineItem[] | null }[];
        setStarterDocs(rows.map((d, i) => ({ id: d.id, label: `D${i + 1}`, title: d.title, pageCount: d.page_count, outline: d.outline ?? [] })));
      });
    return () => {
      live = false;
    };
  }, [sessionId]);

  function choose(k: StarterKind) {
    setKind(k);
    track("goal.starter", { kind: k });
    setGoal(k === "own" ? (existing?.goal ?? "") : starterGoal(k, starterDocs, chapters.filter((c) => picked.includes(c.key))));
  }

  function toggleChapter(c: Chapter) {
    const next = picked.includes(c.key) ? picked.filter((k) => k !== c.key) : [...picked, c.key];
    setPicked(next);
    setGoal(starterGoal("chapters", starterDocs, chapters.filter((x) => next.includes(x.key))));
  }

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
        headers: JSON_HEADERS,
        body: JSON.stringify({ sessionId, goal, materials, level, startDate: today, deadline, minutesPerDay }),
      });
      if (!res.ok) throw new Error(await readAiError(res));
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a plan");
    } finally {
      setPending(false);
      notifyAiUsed();
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
          {existing ? "Change your goal" : "Where do you want to start?"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Pick a starting point and Confu turns it into a plan: which pages to read, in what order, paced to your
          deadline. You can edit the goal before building it.
        </p>
      </header>

      <fieldset className="space-y-2">
        <legend className="sr-only">Starting point</legend>
        {(
          [
            ["whole", "The whole thing", starterDocs.length > 1 ? "All of your PDFs, start to finish." : starterDocs.length ? `All of “${starterDocs[0].title}”, start to finish.` : "Everything in your PDFs, start to finish."],
            ["chapters", "Specific chapters", chapters.length ? "Pick the parts you need from the table of contents." : "Name the chapters or pages you need."],
            ["overview", "Big picture first", "The main ideas and how they connect, then depth where it matters."],
            ["own", "Write my own goal", "Describe exactly what you want to be able to do."],
          ] as const
        ).map(([k, title, body]) => (
          <button
            key={k}
            type="button"
            onClick={() => choose(k)}
            aria-pressed={kind === k}
            className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition duration-200 ease-fluid ${
              kind === k ? "border-ink bg-panel shadow-[3px_3px_0_0_#facc15]" : "border-ink/25 hover:border-ink"
            }`}
          >
            <span className={`mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border ${kind === k ? "border-ink" : "border-ink/40"}`}>
              {kind === k && <span className="size-2 rounded-full bg-ink" />}
            </span>
            <span>
              <span className="block text-sm font-medium">{title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted">{body}</span>
            </span>
          </button>
        ))}
      </fieldset>

      {kind === "chapters" && chapters.length > 0 && (
        <div className="animate-enter">
          <p className={labelClass}>Which parts?</p>
          <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-line bg-paper p-2">
            {chapters.map((c) => {
              const on = picked.includes(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => toggleChapter(c)}
                  aria-pressed={on}
                  title={`${c.title} · p. ${c.page}`}
                  className={`max-w-full truncate rounded-md border px-2 py-1 text-left text-xs transition ${
                    on ? "border-ink bg-ink text-white" : "border-ink/25 bg-panel hover:border-ink"
                  }`}
                >
                  {starterDocs.length > 1 && <span className="mr-1 font-mono opacity-60">{c.docLabel}</span>}
                  {c.title}
                  <span className="ml-1.5 font-mono opacity-60">p. {c.page}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {kind === "own" && (
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
      )}

      {kind && (
        <>
        <label className="block">
          <span className={labelClass}>{kind === "own" ? "Your goal" : "Your goal (edit freely)"}</span>
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
        </>
      )}

      <div className="flex gap-2">
        <button disabled={!kind || goal.trim().length < 5} className={`${buttonClass} flex-1 py-2.5`}>
          {existing ? "Rebuild plan" : "Build my plan"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={ghostButtonClass}>
            Cancel
          </button>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        Plans and suggested resources are generated by AI and can contain mistakes. Review them and adjust your goal if
        something looks off. See the{" "}
        <a href="/terms" target="_blank" className="underline underline-offset-2">
          disclaimer
        </a>
        .
      </p>
    </form>
  );
}
