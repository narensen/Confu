"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Streak and a 20-week study heatmap. A day counts when you read for a minute
// or did something (asked, highlighted, practised, reviewed), in your own
// time zone. Hidden until there's something to show.

type Day = { day: string; seconds: number; actions: number };
const WEEKS = 20;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtMins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`);

export function StudyStreak() {
  const [days, setDays] = useState<Map<string, Day> | null>(null);

  useEffect(() => {
    let live = true;
    void createClient()
      .rpc("my_study_days", { p_days: WEEKS * 7 + 7, p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone })
      .then(({ data, error }) => {
        if (!live || error) return;
        setDays(new Map(((data ?? []) as Day[]).map((d) => [d.day, d])));
      });
    return () => {
      live = false;
    };
  }, []);

  if (!days || days.size === 0) return null;

  const active = (d?: Day) => Boolean(d && (d.actions > 0 || d.seconds >= 60));
  const today = new Date();
  const back = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d;
  };
  // Current streak: counts back from today (or from yesterday if today hasn't started yet).
  let streak = 0;
  for (let n = active(days.get(iso(today))) ? 0 : 1; active(days.get(iso(back(n)))); n++) streak++;
  let best = 0;
  let run = 0;
  for (let n = WEEKS * 7; n >= 0; n--) {
    run = active(days.get(iso(back(n)))) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const weekMinutes = Math.round([...Array(7)].reduce((s, _, n) => s + (days.get(iso(back(n)))?.seconds ?? 0), 0) / 60);
  const todayActive = active(days.get(iso(today)));

  // Grid: weeks as columns (Monday first), the last column ending today.
  const end = new Date(today);
  const start = new Date(end);
  start.setDate(start.getDate() - ((end.getDay() + 6) % 7) - (WEEKS - 1) * 7);
  const columns: { date: Date; day?: Day }[][] = [];
  for (let w = 0; w < WEEKS; w++) {
    const col: { date: Date; day?: Day }[] = [];
    for (let r = 0; r < 7; r++) {
      const d = new Date(start);
      d.setDate(start.getDate() + w * 7 + r);
      col.push({ date: d, day: days.get(iso(d)) });
    }
    columns.push(col);
  }
  const level = (d?: Day) => {
    if (!d) return 0;
    const score = d.seconds / 60 + d.actions * 3;
    return score <= 0 ? 0 : score < 10 ? 1 : score < 30 ? 2 : score < 60 ? 3 : 4;
  };
  const ALPHA = [0.06, 0.25, 0.45, 0.7, 0.95];

  return (
    <section aria-label="Study streak" className="animate-enter mt-4 flex flex-col gap-5 rounded-2xl border border-ink bg-panel p-5 lg:flex-row lg:items-center">
      <div className="shrink-0">
        <p className="text-4xl font-semibold tracking-tight">
          {streak}
          <span className="ml-2 text-sm font-normal text-muted">{streak === 1 ? "day" : "day"} streak</span>
        </p>
        <p className="mt-1 text-xs text-muted">
          Best {best} · {fmtMins(weekMinutes)} this week
        </p>
        {!todayActive && streak > 0 && <p className="mt-2 text-xs font-medium">Study today to keep it going.</p>}
        {!todayActive && streak === 0 && <p className="mt-2 text-xs font-medium">Start a new streak today.</p>}
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="flex w-max gap-[3px]" role="img" aria-label={`Study activity over the last ${WEEKS} weeks. Current streak ${streak} days, best ${best}.`}>
          {columns.map((col, w) => (
            <div key={w} className="flex flex-col gap-[3px]">
              {col.map(({ date, day }) => {
                const future = date > today;
                const isToday = iso(date) === iso(today);
                const mins = Math.round((day?.seconds ?? 0) / 60);
                return (
                  <span
                    key={iso(date)}
                    title={future ? "" : `${date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}: ${mins ? `${fmtMins(mins)} reading` : "no reading"}${day?.actions ? `, ${day.actions} actions` : ""}`}
                    className={`block size-3 rounded-[3px] ${isToday ? "ring-2 ring-yellow-400 ring-offset-1" : ""}`}
                    style={{ background: future ? "transparent" : `color-mix(in srgb, var(--ink) ${ALPHA[level(day)] * 100}%, transparent)` }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-muted">
          Less
          {ALPHA.map((a) => (
            <span key={a} className="size-2.5 rounded-[2px]" style={{ background: `color-mix(in srgb, var(--ink) ${a * 100}%, transparent)` }} />
          ))}
          More
        </div>
      </div>
    </section>
  );
}
