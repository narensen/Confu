"use client";

import { eyebrowClass, inputClass, labelClass } from "@/components/ui";
import { deadlineFor, MAX_HOURS_A_DAY, MIN_HOURS_A_DAY, type PaceEstimate } from "@/lib/pace";
import { daysBetween } from "@/lib/schedule";

const PRESETS = [
  { label: "Light", hours: 0.75 },
  { label: "Steady", hours: 1.5 },
  { label: "Intensive", hours: 3 },
] as const;

const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};
const perDay = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${h % 1 ? h.toFixed(2).replace(/0$/, "") : h} h`);

// "How long will this take, and at what pace?" Once the goal is written,
// Confu estimates the hours it needs; the student sets either hours a day or
// a deadline, and the other follows. Without an estimate it's two plain fields.
export function PaceCalibrator({
  estimate,
  estimating,
  canEstimate,
  onEstimate,
  hours,
  deadline,
  today,
  onHours,
  onDeadline,
}: {
  estimate: PaceEstimate | null;
  estimating: boolean;
  canEstimate: boolean; // enough goal written to estimate from
  onEstimate: () => void;
  hours: string;
  deadline: string;
  today: string;
  onHours: (h: string) => void;
  onDeadline: (d: string) => void;
}) {
  const total = estimate?.hours ?? 0;
  const h = Number(hours) || 0;
  const days = Math.max(1, daysBetween(today, deadline) + 1);
  const tooMuch = h > 6;

  return (
    <section className="rounded-xl border border-ink bg-paper/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className={eyebrowClass}>Your pace</p>
        {canEstimate && !estimating && (
          <button type="button" onClick={onEstimate} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
            {estimate ? "Recalculate" : "Estimate"}
          </button>
        )}
      </div>

      {estimating ? (
        <div role="status" className="mt-2 space-y-2">
          <p className="text-sm text-muted">Working out how long this goal takes…</p>
          <div className="indeterminate h-[3px] w-40 rounded-full bg-line" />
        </div>
      ) : total > 0 ? (
        <div className="mt-1">
          <p className="font-serif text-2xl leading-tight">
            About {total} hours <span className="font-sans text-sm text-muted">({estimate!.low}–{estimate!.high} h)</span>
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{estimate!.why || "From your PDFs and the materials in your goal, with time to practise."}</p>
          {estimate!.parts.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              {estimate!.parts.map((p) => (
                <li key={p.label} className="rounded-md border border-ink/20 bg-panel px-2 py-0.5">
                  {p.label} <span className="font-mono text-muted">~{p.hours} h</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-1 text-xs leading-relaxed text-muted">
          {canEstimate
            ? "List your papers, lectures and books under ### Materials and Confu works out how long it takes. Or set your own pace."
            : "Write your goal and Confu works out how long it takes, then suggests a pace."}
        </p>
      )}

      {total > 0 && !estimating && (
        <div className="mt-4 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Pace">
          {PRESETS.map((p) => {
            const on = h === p.hours;
            return (
              <button
                key={p.label}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onHours(String(p.hours))}
                className={`rounded-lg border px-2 py-1.5 text-left transition ${on ? "border-ink bg-ink text-white" : "border-ink/25 bg-panel hover:border-ink"}`}
              >
                <span className="block text-xs font-medium">{p.label}</span>
                <span className={`block text-[11px] ${on ? "text-white/70" : "text-muted"}`}>
                  {perDay(p.hours)} a day · {day(deadlineFor(total, p.hours, today))}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelClass}>Hours a day</span>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              required
              min={MIN_HOURS_A_DAY}
              max={MAX_HOURS_A_DAY}
              step={0.25}
              value={hours}
              onChange={(e) => onHours(e.target.value)}
              className={`${inputClass} pr-10`}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-xs text-muted">hrs</span>
          </div>
        </label>
        <label className="block">
          <span className={labelClass}>Deadline</span>
          <input type="date" required min={today} value={deadline} onChange={(e) => onDeadline(e.target.value)} className={inputClass} />
        </label>
      </div>
      {total > 0 && (
        <input
          type="range"
          min={MIN_HOURS_A_DAY}
          max={6}
          step={0.25}
          value={Math.min(6, h || MIN_HOURS_A_DAY)}
          onChange={(e) => onHours(e.target.value)}
          aria-label="Hours a day"
          className="mt-3 w-full accent-[var(--ink)]"
        />
      )}

      {total > 0 && !estimating && h > 0 && (
        <p className="mt-2 text-sm" aria-live="polite">
          {perDay(h)} a day gets you there by <span className="font-medium">{day(deadline)}</span>
          <span className="text-muted">
            {" "}
            · {days} {days === 1 ? "day" : "days"}, {Math.round(h * days)} of ~{total} hours
          </span>
        </p>
      )}
      {tooMuch && <p className="mt-2 text-xs text-warn">More than 6 hours a day is hard to keep up. A later deadline tends to stick better.</p>}
    </section>
  );
}
