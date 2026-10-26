"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";
import { deadlineFor, hoursADayFor, roundQuarter } from "@/lib/pace";
import { daysBetween } from "@/lib/schedule";
import type { PlanTopic, StudyPlan } from "@/lib/types";

// The dial: a knob spun around a 300° track (open at the bottom) from 15
// minutes to 6 hours a day. Drag it, scroll on it, or use the arrow keys.
const MIN = 0.25;
const MAX = 6;
const SWEEP = 300;
const START = -SWEEP / 2; // degrees from the top, clockwise
const SIZE = 284;
const C = SIZE / 2;
const R = 92;
const INK = "#0d0d0c";
const TRACK = "#e1e0d9";
const FOCUS = "#facc15";

const PRESETS = [
  { label: "Light", hours: 0.75 },
  { label: "Steady", hours: 1.5 },
  { label: "Intensive", hours: 3 },
] as const;

const angleOf = (v: number) => START + ((Math.min(MAX, Math.max(MIN, v)) - MIN) / (MAX - MIN)) * SWEEP;
const point = (deg: number, r = R) => {
  const rad = (deg * Math.PI) / 180;
  return { x: C + r * Math.sin(rad), y: C - r * Math.cos(rad) };
};
function arc(from: number, to: number) {
  const a = point(from);
  const b = point(to);
  return `M ${a.x} ${a.y} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
}
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, roundQuarter(v)));
const perDay = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${+h.toFixed(2)} h`);
const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

function Dial({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });

  // Scroll to spin. A native listener, so the page doesn't scroll instead.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { value: v, onChange: set } = latest.current;
      set(clamp(v + (e.deltaY < 0 ? 0.25 : -0.25)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function fromPointer(e: React.PointerEvent) {
    const box = svg.current!.getBoundingClientRect();
    const dx = e.clientX - box.left - (box.width / 2);
    const dy = e.clientY - box.top - (box.height / 2);
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    // In the gap at the bottom: stay at whichever end is nearer the knob.
    if (deg < START || deg > -START) return onChange(value > (MIN + MAX) / 2 ? MAX : MIN);
    onChange(clamp(MIN + ((deg - START) / SWEEP) * (MAX - MIN)));
  }

  const knob = point(angleOf(value));
  const ticks = Array.from({ length: Math.round((MAX - MIN) / 0.25) + 1 }, (_, i) => MIN + i * 0.25);

  return (
    <svg
      ref={svg}
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="slider"
      tabIndex={0}
      aria-label="Hours a day"
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={value}
      aria-valuetext={`${perDay(value)} a day`}
      className="touch-none outline-none select-none"
      style={{ cursor: dragging ? "grabbing" : "grab" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        fromPointer(e);
      }}
      onPointerMove={(e) => dragging && fromPointer(e)}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(e) => {
        const step = { ArrowUp: 0.25, ArrowRight: 0.25, ArrowDown: -0.25, ArrowLeft: -0.25, PageUp: 1, PageDown: -1 }[e.key];
        if (step) onChange(clamp(value + step));
        else if (e.key === "Home") onChange(MIN);
        else if (e.key === "End") onChange(MAX);
        else return;
        e.preventDefault();
      }}
    >
      {ticks.map((t) => {
        const major = t % 1 === 0;
        const a = point(angleOf(t), R + 13);
        const b = point(angleOf(t), R + (major ? 21 : 17));
        return <line key={t} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={t <= value ? INK : TRACK} strokeWidth={major ? 2 : 1} strokeLinecap="round" />;
      })}
      {[1, 2, 3, 4, 5, 6].map((h) => {
        const p = point(angleOf(h), R + 33);
        return (
          <text key={h} x={p.x} y={p.y + 3.5} textAnchor="middle" className="fill-muted font-mono text-[10px]">
            {h}h
          </text>
        );
      })}
      <path d={arc(START, -START)} fill="none" stroke={TRACK} strokeWidth={12} strokeLinecap="round" />
      <path d={arc(START, angleOf(value))} fill="none" stroke={INK} strokeWidth={12} strokeLinecap="round" />
      {(focused || dragging) && <circle cx={knob.x} cy={knob.y} r={19} fill="none" stroke={FOCUS} strokeWidth={4} />}
      <circle cx={knob.x} cy={knob.y} r={14} fill="#ffffff" stroke={INK} strokeWidth={2.5} />
      <text x={C} y={C - 2} textAnchor="middle" className="fill-ink font-sans text-[34px] font-semibold tracking-tight">
        {perDay(value)}
      </text>
      <text x={C} y={C + 20} textAnchor="middle" className="fill-muted font-sans text-[12px]">
        a day
      </text>
    </svg>
  );
}

// "Custom pace" in the Plan tab: spin the dial for hours a day (or pick a
// deadline) and the remaining topics are rescheduled to fit. The plan itself
// stays as it is.
export function CustomPace({
  plan,
  topics,
  onApply,
  onClose,
}: {
  plan: StudyPlan;
  topics: PlanTopic[];
  onApply: (minutesPerDay: number, deadline: string) => Promise<void>;
  onClose: () => void;
}) {
  const [today] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const left = topics.filter((t) => t.status !== "completed");
  const remaining = left.reduce((a, t) => a + t.est_minutes, 0) / 60;
  const [hours, setHours] = useState(() => clamp(plan.minutes_per_day / 60));
  const [deadline, setDeadline] = useState(() => deadlineFor(remaining, clamp(plan.minutes_per_day / 60), today));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = Math.max(1, daysBetween(today, deadline) + 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function spin(h: number) {
    setHours(h);
    setDeadline(deadlineFor(remaining, h, today));
  }

  return createPortal(
    <div className="animate-fade fixed inset-0 z-60 flex items-center justify-center bg-ink/40 p-3 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="pace-title" className="animate-pop flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard">
        <div className="flex items-start justify-between gap-4 border-b border-ink px-6 pt-5 pb-4">
          <div>
            <p className={eyebrowClass}>Custom pace</p>
            <h2 id="pace-title" className="mt-1 font-serif text-2xl">
              Spin to set your pace
            </h2>
            <p className="mt-1 text-sm text-muted">
              {left.length
                ? `About ${Math.round(remaining)} hours left across ${left.length} ${left.length === 1 ? "topic" : "topics"}.`
                : "Every topic is done."}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-paper">
            ✕
          </button>
        </div>

        {left.length > 0 && (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="flex justify-center">
              <Dial value={hours} onChange={spin} />
            </div>
            <p className="mt-1 text-center text-sm" aria-live="polite">
              Done by <span className="font-medium">{day(deadline)}</span>
              <span className="text-muted">
                {" "}
                · {days} {days === 1 ? "day" : "days"}
              </span>
            </p>

            <div className="mt-4 grid grid-cols-3 gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => spin(p.hours)}
                  aria-pressed={hours === p.hours}
                  className={`rounded-lg border px-2 py-1.5 text-center text-xs transition ${hours === p.hours ? "border-ink bg-ink text-white" : "border-ink/25 hover:border-ink"}`}
                >
                  <span className="block font-medium">{p.label}</span>
                  <span className={hours === p.hours ? "text-white/70" : "text-muted"}>{perDay(p.hours)}</span>
                </button>
              ))}
            </div>

            <label className="mt-4 flex items-center justify-between gap-3 text-sm">
              <span className="text-muted">Or pick a deadline</span>
              <input
                type="date"
                min={today}
                value={deadline}
                onChange={(e) => {
                  const d = e.target.value;
                  if (!d || d < today) return;
                  setDeadline(d);
                  setHours(Math.min(MAX, hoursADayFor(remaining, today, d)));
                }}
                className={`${inputClass} w-auto py-1.5`}
              />
            </label>
            {hoursADayFor(remaining, today, deadline) > MAX && (
              <p className="mt-2 text-xs text-warn">That deadline needs more than {MAX} hours a day. A later one will stick better.</p>
            )}
            {error && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-ink px-6 py-4">
          <button type="button" onClick={onClose} className={`${ghostButtonClass} py-1.5`}>
            Cancel
          </button>
          {left.length > 0 && (
            <button
              type="button"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                setError(null);
                try {
                  await onApply(Math.round(hours * 60), deadline);
                  onClose();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Couldn't save the new pace.");
                  setPending(false);
                }
              }}
              className={`${buttonClass} py-1.5`}
            >
              {pending ? "Rescheduling…" : "Apply pace"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
