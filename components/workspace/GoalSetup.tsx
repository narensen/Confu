"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass, labelClass } from "@/components/ui";
import { JSON_HEADERS, notifyAiUsed, readAiError } from "@/lib/ai-errors";
import { deadlineFor, hoursADayFor, type PaceEstimate } from "@/lib/pace";
import { addDays, toISODate } from "@/lib/schedule";
import type { Level, StudyPlan } from "@/lib/types";
import { PaceCalibrator } from "./PaceCalibrator";
import type { PlanSetup } from "./PlanPanel";

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
  return `Help me write a learning goal for a study platform. I'll do the learning myself, so the goal should describe what I'll study and practise, not ask for answers. Ask me questions first if you need to, then write the goal in Markdown with exactly these ### headings:

### Outcome
What I want to be able to do or explain when I'm done (be concrete).

### Why
What I need it for (exam, project, job, research…).

### Background
What I already know and where I'm weak.

### Materials
My PDFs are ${pdfs}. Then list everything else I'm using, precisely:
- Research papers: for EVERY paper, its FULL title AND its DOI. The DOI is compulsory. For arXiv papers use arXiv's DOI, 10.48550/arXiv.<id> (for example 10.48550/arXiv.1707.06347). Never give only a nickname like "PPO" or "DAPO". Don't guess a DOI: if you can't find one, write "DOI: not found" so I can look it up.
- Courses and lectures: the name AND the YouTube link of EACH lecture video I'll watch (each video's own link, not only the playlist). Only if it isn't on YouTube, say so and give its page URL.
- Books, guides and articles: title, author, and a link if they're online.

### Scope
What's in and what's out.

### Success check
How I'll know I've reached the goal.

Keep it under 500 words.`;
}

// Did the AI follow the starter prompt? Counted from the text alone, so it
// shows while the student pastes, before anything is built.
const DOI = /\b10\.\d{4,9}\/[^\s"<>)\]]+/gi;
const YOUTUBE = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch|playlist|live|embed|shorts)|youtu\.be\/)[^\s<>)\]"']*/gi;
const LINK = /https?:\/\/[^\s<>)\]"']+/gi;
const NO_DOI = /\bDOI\b[:\s]*(?:not found|unknown|n\/?a|none|missing)/gi;

export function checkGoal(text: string) {
  const dois = new Set((text.match(DOI) ?? []).map((d) => d.replace(/[.,;]+$/, "").toLowerCase()));
  const youtube = new Set(text.match(YOUTUBE) ?? []);
  const other = new Set((text.match(LINK) ?? []).filter((u) => !youtube.has(u) && !/doi\.org|arxiv\.org/i.test(u)));
  return {
    dois: dois.size,
    youtube: youtube.size,
    other: other.size,
    missingDois: (text.match(NO_DOI) ?? []).length,
    mentionsPapers: /\bpapers?\b/i.test(text),
    mentionsCourses: /\b(courses?|lectures?)\b/i.test(text),
  };
}

// Papers, lectures and books go in the goal's own ### Materials section.
const MATERIALS_HEADING = /^\s*(?:#{1,6}\s*|\d+\.\s*|\*\*)?(?:other\s+)?materials\b/im;
const MATERIAL_LINES = ["- Papers (full title and DOI): ", "- Lectures and courses (YouTube links): ", "- Books and articles: "];
const MATERIALS_SECTION = `### Materials\n${MATERIAL_LINES.join("\n")}`;
// The goal always starts from this, the same sections the starter prompt asks for.
const TEMPLATE = `### Outcome\n\n\n### Why\n\n\n### Background\n\n\n${MATERIALS_SECTION}\n\n### Scope\n\n\n### Success check\n`;

// Every goal has its Materials section, whatever was pasted or deleted.
function ensureMaterials(goal: string) {
  if (!goal.trim()) return TEMPLATE;
  return MATERIALS_HEADING.test(goal) ? goal : `${goal.trimEnd()}\n\n${MATERIALS_SECTION}`;
}

// What the student actually wrote: the goal without the template's headings and prompts.
function writtenPart(goal: string) {
  const prompts = new Set(MATERIAL_LINES.map((l) => l.trim()));
  return goal
    .split("\n")
    .filter((l) => !/^\s*#{1,6}\s/.test(l) && !prompts.has(l.trim()))
    .join(" ")
    .trim();
}

// Plans (and drafts) from before kept materials in a separate field: fold
// them into the goal so nothing is lost on a re-plan.
function withMaterials(goal: string, materials?: string | null) {
  const extra = materials?.trim();
  if (!extra || goal.includes(extra)) return goal;
  return `${goal.trimEnd()}\n\n### Materials\n${extra}`;
}

type Draft = { goal: string; materials?: string; deadline: string; hours: string; level: Level };
const draftKey = (sessionId: string) => `confu:goal-draft:${sessionId}`;

function readDraft(sessionId: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(sessionId));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function clearDraft(sessionId: string) {
  try {
    localStorage.removeItem(draftKey(sessionId));
  } catch {}
}

type Props = {
  sessionId: string;
  docTitles: string[];
  existing?: StudyPlan | null;
  draftGoal?: string; // from a template or pack
  setup: PlanSetup;
  onCreated: () => void;
  onCancel?: () => void;
};

const noSubscribe = () => () => {};

// The server can't see the draft saved in the browser, so the form mounts
// again once hydrated, this time with it.
export function GoalSetup(props: Props) {
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  return <GoalForm key={hydrated ? "browser" : "server"} {...props} restore={hydrated} />;
}

function GoalForm({ sessionId, docTitles, existing, draftGoal, setup, onCreated, onCancel, restore }: Props & { restore: boolean }) {
  const today = toISODate(new Date());
  const [saved] = useState(() => (restore ? readDraft(sessionId) : null));
  const base = ensureMaterials(existing ? withMaterials(existing.goal, existing.materials) : (draftGoal ?? ""));
  const [goal, setGoal] = useState(saved ? ensureMaterials(withMaterials(saved.goal, saved.materials)) : base);
  const written = writtenPart(goal);
  const [deadline, setDeadline] = useState(
    saved && saved.deadline >= today ? saved.deadline : existing && existing.deadline >= today ? existing.deadline : addDays(today, 14),
  );
  // Students think in hours a day; the API and database store minutes.
  const [hours, setHours] = useState(saved?.hours ?? String(existing ? existing.minutes_per_day / 60 : 1));
  const minutesPerDay = Math.round(Number(hours) * 60);
  const [level, setLevel] = useState<Level>(saved?.level ?? existing?.level ?? "intermediate");

  // The pace calibrator: how long the goal takes, then hours a day or a
  // deadline, whichever the student set last, with the other following.
  const ESTIMATE_FROM = 40; // characters of goal written
  const [estimate, setEstimate] = useState<PaceEstimate | null>(null);
  // Optional: left closed, the plan is sized to the goal at about an hour a
  // day, and the pace is tuned afterwards from the Plan tab (Custom pace).
  // A re-plan starts open, keeping the deadline the student already has.
  const [paceOpen, setPaceOpen] = useState(Boolean(existing));
  const [estimating, setEstimating] = useState(() => restore && paceOpen && written.length >= ESTIMATE_FROM); // a goal already there is estimated on open
  const anchor = useRef<"hours" | "deadline">(existing || saved ? "deadline" : "hours");
  const asked = useRef({ n: 0, goal: "", level: "" });
  const pace = useRef({ hours, deadline });
  useEffect(() => {
    pace.current = { hours, deadline };
  }, [hours, deadline]);

  // Ask for the estimate (no state changes here; see applyEstimate).
  function requestEstimate(text: string, lvl: Level) {
    const n = ++asked.current.n;
    asked.current.goal = text;
    asked.current.level = lvl;
    return fetch("/api/plan/estimate", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ sessionId, goal: text, level: lvl }) })
      .then((res) => (res.ok ? (res.json() as Promise<PaceEstimate>) : null))
      .catch(() => null)
      .then((est) => ({ n, est }));
  }

  // The newest answer wins; the pace follows whichever the student set last.
  function applyEstimate({ n, est }: { n: number; est: PaceEstimate | null }) {
    if (n !== asked.current.n) return;
    setEstimate(est);
    setEstimating(false);
    if (!est?.hours) return;
    const now = pace.current;
    if (anchor.current === "deadline" && now.deadline >= today) setHours(String(hoursADayFor(est.hours, today, now.deadline)));
    else setDeadline(deadlineFor(est.hours, Number(now.hours) || 1, today));
  }

  function runEstimate(text = goal, lvl = level) {
    if (writtenPart(text).length < ESTIMATE_FROM) return;
    setEstimating(true);
    void requestEstimate(text, lvl).then(applyEstimate);
  }

  useEffect(() => {
    // Once, on open, for a goal that's already written; after that it's on blur.
    if (estimating) void requestEstimate(goal, level).then(applyEstimate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeHours(h: string) {
    anchor.current = "hours";
    setHours(h);
    if (estimate?.hours && Number(h) > 0) setDeadline(deadlineFor(estimate.hours, Number(h), today));
  }

  function changeDeadline(d: string) {
    anchor.current = "deadline";
    setDeadline(d);
    if (estimate?.hours && d >= today) setHours(String(hoursADayFor(estimate.hours, today, d)));
  }
  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState(false);
  const { job, setJob } = setup;
  const building = job?.state === "building";
  const check = checkGoal(goal);

  // Keep what's typed, so leaving the tab (or the page) doesn't lose it.
  useEffect(() => {
    if (!restore) return; // the server-render pass would wipe the real draft
    try {
      if (goal.trim() === base.trim()) {
        localStorage.removeItem(draftKey(sessionId));
      } else {
        localStorage.setItem(draftKey(sessionId), JSON.stringify({ goal, deadline, hours, level } satisfies Draft));
      }
    } catch {}
  }, [restore, sessionId, goal, base, deadline, hours, level]);

  useEffect(() => {
    if (!building) return;
    const id = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 3200);
    return () => window.clearInterval(id);
  }, [building]);

  // Runs to the end even if the form unmounts (the student switched tabs):
  // the job state lives in the workspace.
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const final = ensureMaterials(goal);
    setGoal(final);
    if (setup.upload) {
      setJob({ state: "queued" });
      await setup.settled();
    }
    setStep(0);
    setJob({ state: "building" });
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ sessionId, goal: final, level, startDate: today, ...(paceOpen ? { deadline, minutesPerDay } : {}) }),
      });
      if (!res.ok) throw new Error(await readAiError(res));
      clearDraft(sessionId);
      setJob(null);
      onCreated();
    } catch (err) {
      setJob({ state: "failed", error: err instanceof Error ? err.message : "Could not create a plan" });
    } finally {
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

  if (job?.state === "queued") {
    return (
      <div className="animate-enter flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
        <p className={eyebrowClass}>Plan queued</p>
        <p className="max-w-sm font-serif text-2xl leading-snug">Your plan builds as soon as your PDFs are in.</p>
        <div className="indeterminate h-[3px] w-56 rounded-full bg-line" />
        <p className="max-w-xs text-xs text-muted" aria-live="polite">
          {setup.upload}
        </p>
        <p className="max-w-xs text-xs text-muted">You can read or switch tabs meanwhile. Keep this browser tab open.</p>
      </div>
    );
  }

  if (building) {
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
        <h2 className="mt-1 font-serif text-2xl leading-tight">{existing ? "Change your goal" : "What do you want to learn?"}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Write your goal and Confu turns it into a plan: which pages to read, which papers and lectures, in what order,
          at a pace that fits you.{setup.upload ? " Your PDFs keep uploading while you write; the plan waits for them." : ""}
        </p>
      </header>

      <div className="rounded-xl border border-dashed border-ink/40 bg-paper p-4 text-sm">
        <p className="font-medium">Tip: draft your goal with any AI</p>
        <p className="mt-1 leading-relaxed text-muted">
          A detailed goal makes a much better plan. Ask ChatGPT, Claude, Gemini or any other assistant to help you write one,
          then paste it below. The prompt asks for each paper&apos;s DOI and each course&apos;s YouTube link, so Confu can add them for you.
        </p>
        <button type="button" onClick={copyPrompt} className={`${ghostButtonClass} mt-3 py-1.5 text-xs`}>
          {copied ? "✓ Copied" : "Copy a starter prompt"}
        </button>
      </div>

      <div>
        <label htmlFor="goal-text" className={labelClass}>
          Your goal
        </label>
        <p className="-mt-1 mb-2 text-xs text-muted">Fill in the sections, or paste over them with a goal written by another AI. Materials always stays in.</p>
        <textarea
          id="goal-text"
          required
          minLength={5}
          maxLength={8000}
          rows={16}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onBlur={() => {
            const full = ensureMaterials(goal);
            setGoal(full);
            // Written (or changed) the goal: work out the pace for it.
            if (paceOpen && (full !== asked.current.goal || level !== asked.current.level)) runEstimate(full);
          }}
          className={`${inputClass} resize-y font-[inherit] leading-relaxed`}
        />
        <div className="mt-1 flex items-start justify-between gap-3">
          <GoalCheck check={check} show={written.length > 40} />
          <span className="shrink-0 font-mono text-[11px] text-muted">{goal.length.toLocaleString()} / 8,000</span>
        </div>
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
              onClick={() => {
                setLevel(l);
                if (estimate || estimating) runEstimate(goal, l);
              }}
              className={`relative z-10 rounded-md py-1.5 text-xs font-medium capitalize transition-colors duration-300 ${
                level === l ? "text-white" : "text-muted hover:text-ink"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </fieldset>

      {paceOpen ? (
        <div>
          <PaceCalibrator
            estimate={estimate}
            estimating={estimating}
            canEstimate={written.length >= ESTIMATE_FROM}
            onEstimate={() => runEstimate()}
            hours={hours}
            deadline={deadline}
            today={today}
            onHours={changeHours}
            onDeadline={changeDeadline}
          />
          {!existing && (
            <button type="button" onClick={() => setPaceOpen(false)} className="mt-2 text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
              Let Confu decide the pace
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setPaceOpen(true);
            if (!estimate) runEstimate();
          }}
          className="w-full rounded-xl border border-dashed border-ink/40 px-4 py-3 text-left transition hover:border-ink"
        >
          <span className="block text-sm font-medium">Set my own pace (optional)</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted">
            Otherwise Confu sizes the plan to your goal at about an hour a day. You can change the pace any time with Custom pace in the Plan tab.
          </span>
        </button>
      )}

      {existing && (
        <p className="rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-warn">
          Re-planning replaces your current topics and their progress. Your conversation and tutor memory are kept.
        </p>
      )}
      {job?.state === "failed" && <p className="animate-pop rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{job.error}</p>}

      <div className="flex gap-2">
        <button disabled={written.length < 5} className={`${buttonClass} flex-1 py-2.5`}>
          {setup.upload ? "Build my plan when they're in" : existing ? "Rebuild plan" : "Build my plan"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={() => {
              clearDraft(sessionId);
              setJob(null);
              onCancel();
            }}
            className={ghostButtonClass}
          >
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

function GoalCheck({ check, show }: { check: ReturnType<typeof checkGoal>; show: boolean }) {
  if (!show) return <span />;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const found = [
    check.dois && plural(check.dois, "paper DOI", "paper DOIs"),
    check.youtube && plural(check.youtube, "YouTube link", "YouTube links"),
    check.other && plural(check.other, "other link", "other links"),
  ].filter(Boolean);
  const notes = [
    check.missingDois > 0 &&
      `${plural(check.missingDois, "paper says", "papers say")} “DOI: not found”. Look ${check.missingDois === 1 ? "it" : "them"} up on doi.org or arxiv.org; otherwise Confu searches by title.`,
    !check.dois && check.mentionsPapers && "No DOIs yet. Papers with a DOI are found exactly; without one, Confu searches by name.",
    !check.youtube && check.mentionsCourses && "No YouTube links. Add them to bring lectures in with their transcripts.",
  ].filter((n): n is string => Boolean(n));
  return (
    <span className="min-w-0 text-xs leading-relaxed" aria-live="polite">
      {found.length > 0 && (
        <span className="block text-muted">
          <span className="font-medium text-ok">✓</span> Found {found.join(" · ")}
        </span>
      )}
      {notes.map((n) => (
        <span key={n} className="block text-warn">
          {n}
        </span>
      ))}
    </span>
  );
}
