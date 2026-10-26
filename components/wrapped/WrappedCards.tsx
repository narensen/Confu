"use client";

import { useState } from "react";
import { eyebrowClass } from "@/components/ui";
import { duration, monthName, monthYear, persona, type Wrapped } from "@/lib/wrapped";

// A month in numbers. Single-series charts in ink (no legend needed): a
// calendar heatmap of minutes per day (one hue, light to dark) and a
// time-of-day bar chart with only its peak labelled. Every value also has a
// hover/focus readout and a table view below.

const ALPHA = [0.05, 0.22, 0.42, 0.66, 0.92];
const level = (d: { minutes: number; actions: number }) => {
  const score = d.minutes + d.actions * 3;
  return score <= 0 ? 0 : score < 15 ? 1 : score < 40 ? 2 : score < 90 ? 3 : 4;
};
const dayLabel = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;

export function WrappedCards({ w, name }: { w: Wrapped; name?: string | null }) {
  const p = persona(w.hours);
  const quiet = w.minutes === 0 && w.active_days === 0;
  const tiles: [string, string][] = [
    [`${w.active_days}`, `of ${w.days_in_month} days active`],
    [`${w.longest_streak}`, w.longest_streak === 1 ? "day, longest streak" : "days, longest streak"],
    [`${w.questions}`, w.questions === 1 ? "question asked" : "questions asked"],
    [`${w.highlights}`, w.highlights === 1 ? "passage highlighted" : "passages highlighted"],
    [`${w.topics_done}`, w.topics_done === 1 ? "topic completed" : "topics completed"],
    [`${w.reviews}`, w.reviews === 1 ? "review done" : "reviews done"],
    ...(w.answers ? ([[`${w.answers}`, "practice answers"]] as [string, string][]) : []),
    ...(w.papers_read ? ([[`${w.papers_read}`, w.papers_read === 1 ? "paper read" : "papers read"]] as [string, string][]) : []),
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-ink bg-ink p-8 text-white shadow-[8px_8px_0_0_#facc15] sm:p-10">
        <p className="font-mono text-xs tracking-[0.2em] text-white/60 uppercase">{name ? `${name}'s` : "Your"} {monthYear(w.month)} in Confu</p>
        {quiet ? (
          <p className="mt-6 font-serif text-4xl leading-tight">A quiet month. The next one starts with ten minutes.</p>
        ) : (
          <>
            <p className="mt-6 font-sans text-6xl font-semibold tracking-tight sm:text-7xl">{duration(w.minutes)}</p>
            <p className="mt-2 text-lg text-white/70">studied in {monthName(w.month)}</p>
            {p && (
              <p className="mt-6 max-w-xl font-serif text-2xl leading-snug">
                You&apos;re {p.label}: most of your studying happened around <span className="text-yellow-300">{p.time}</span>.
              </p>
            )}
            {w.top_session && (
              <p className="mt-3 text-white/70">
                Most of it went into <span className="font-medium text-white">{w.top_session}</span>.
              </p>
            )}
          </>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(([value, label]) => (
          <div key={label} className="rounded-2xl border border-ink bg-panel p-4">
            <p className="font-sans text-3xl font-semibold">{value}</p>
            <p className="mt-0.5 text-sm text-muted">{label}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <MonthHeatmap w={w} />
        <HourChart hours={w.hours} />
      </div>

      {w.best_day && (
        <p className="text-sm text-muted">
          Best day: <span className="font-medium text-ink">{dayLabel(w.best_day.day)}</span>, {duration(w.best_day.minutes)}.
        </p>
      )}

      <details className="rounded-2xl border border-ink/20 bg-panel px-5 py-3 text-sm [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer list-none font-medium">See every day as a table</summary>
        <table className="mt-3 w-full">
          <thead>
            <tr className="border-b border-line text-left font-mono text-[10px] tracking-wider text-muted uppercase">
              <th className="py-1.5 font-medium">Day</th>
              <th className="py-1.5 text-right font-medium">Minutes</th>
              <th className="py-1.5 text-right font-medium">Things done</th>
            </tr>
          </thead>
          <tbody>
            {w.days.map((d) => (
              <tr key={d.day} className="border-b border-line/60 last:border-0">
                <td className="py-1">{dayLabel(d.day)}</td>
                <td className="py-1 text-right font-mono text-xs tabular-nums">{d.minutes}</td>
                <td className="py-1 text-right font-mono text-xs tabular-nums">{d.actions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function MonthHeatmap({ w }: { w: Wrapped }) {
  const [hover, setHover] = useState<number | null>(null);
  const first = new Date(`${w.month.slice(0, 7)}-01T00:00:00Z`).getUTCDay(); // Sunday = 0
  const lead = (first + 6) % 7; // weeks start on Monday
  const cells: ({ day: string; minutes: number; actions: number } | null)[] = [...Array(lead).fill(null), ...w.days];
  const shown = hover !== null ? cells[hover] : null;
  return (
    <section className="rounded-2xl border border-ink bg-panel p-5">
      <p className={eyebrowClass}>Day by day</p>
      <p className="mt-1 h-5 text-sm" aria-live="polite">
        {shown ? (
          <>
            <span className="font-medium">{duration(shown.minutes)}</span> <span className="text-muted">· {shown.actions} things done · {dayLabel(shown.day)}</span>
          </>
        ) : (
          <span className="text-muted">Darker days, more studying. Hover a day.</span>
        )}
      </p>
      <div className="mt-3 grid grid-cols-7 gap-1.5 text-center font-mono text-[10px] text-muted" aria-hidden>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1.5" role="list">
        {cells.map((c, i) =>
          c ? (
            <div
              key={c.day}
              role="listitem"
              tabIndex={0}
              aria-label={`${dayLabel(c.day)}: ${duration(c.minutes)}, ${c.actions} things done`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className={`aspect-square rounded-md outline-none ${hover === i ? "ring-2 ring-yellow-400" : ""}`}
              style={{ background: `rgba(13,13,12,${ALPHA[level(c)]})` }}
            />
          ) : (
            <span key={`pad-${i}`} />
          ),
        )}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 font-mono text-[10px] text-muted" aria-hidden>
        Less
        {ALPHA.map((a) => (
          <span key={a} className="size-3 rounded-sm" style={{ background: `rgba(13,13,12,${a})` }} />
        ))}
        More
      </div>
    </section>
  );
}

function HourChart({ hours }: { hours: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...hours);
  const peak = hours.indexOf(Math.max(...hours));
  const H = 200;
  const HEAD = 18; // room above the tallest bar for its label
  const total = hours.reduce((a, b) => a + b, 0);
  return (
    <section className="rounded-2xl border border-ink bg-panel p-5">
      <p className={eyebrowClass}>Time of day</p>
      <p className="mt-1 h-5 text-sm" aria-live="polite">
        {hover !== null ? (
          <>
            <span className="font-medium">{hours[hover]}</span> <span className="text-muted">things done around {hourLabel(hover)}</span>
          </>
        ) : total ? (
          <span className="text-muted">Questions, highlights, answers and reviews, by hour.</span>
        ) : (
          <span className="text-muted">Nothing logged yet this month.</span>
        )}
      </p>
      <div className="relative mt-3" style={{ height: H + 18 }}>
        <div className="absolute inset-x-0 border-t border-[#e1e0d9]" style={{ top: H }} aria-hidden />
        <div className="absolute inset-x-0 top-0 flex items-end gap-[2px]" style={{ height: H }}>
          {hours.map((n, h) => (
            <div
              key={h}
              role="img"
              tabIndex={0}
              aria-label={`${hourLabel(h)}: ${n} things done`}
              onPointerEnter={() => setHover(h)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(h)}
              onBlur={() => setHover(null)}
              className="relative flex h-full flex-1 items-end justify-center outline-none"
            >
              {h === peak && n > 0 && (
                <span className="absolute font-mono text-[10px] whitespace-nowrap text-ink" style={{ bottom: Math.max(3, (n / max) * (H - HEAD)) + 4 }}>
                  {hourLabel(h)}
                </span>
              )}
              <span
                className={`block w-full max-w-[18px] rounded-t-[4px] ${hover === h ? "bg-yellow-400" : n ? "bg-ink" : "bg-transparent"}`}
                style={{ height: n ? Math.max(3, (n / max) * (H - HEAD)) : 0 }}
              />
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 flex justify-between font-mono text-[10px] text-muted" style={{ top: H + 4 }} aria-hidden>
          <span>12 am</span>
          <span>6 am</span>
          <span>12 pm</span>
          <span>6 pm</span>
          <span>11 pm</span>
        </div>
      </div>
    </section>
  );
}
