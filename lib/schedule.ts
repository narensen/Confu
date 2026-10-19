import type { PlanTopic, StudyPlan } from "@/lib/types";

const DAY = 86_400_000;

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

// Whole days from a to b (b - a).
export function daysBetween(a: string, b: string): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / DAY);
}

// Spread topics across the available days in proportion to their estimated
// effort, so the last topic lands on the deadline.
export function assignDueDates(estMinutes: number[], start: string, deadline: string): string[] {
  const days = Math.max(1, daysBetween(start, deadline) + 1);
  const total = estMinutes.reduce((a, b) => a + b, 0) || 1;
  let cumulative = 0;
  return estMinutes.map((m) => {
    cumulative += m;
    const dayIndex = Math.max(0, Math.ceil((cumulative / total) * days) - 1);
    return addDays(start, Math.min(dayIndex, days - 1));
  });
}

// 45 → "45 min", 90 → "1h 30m", 120 → "2h"
export function formatMinutes(total: number): string {
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function currentTopic(topics: PlanTopic[]): PlanTopic | null {
  return [...topics].sort((a, b) => a.position - b.position).find((t) => t.status !== "completed") ?? null;
}

export type ScheduleStatus = {
  completed: number;
  total: number;
  daysLeft: number;
  overdue: number;
  onTrack: boolean;
  label: string;
};

export function scheduleStatus(plan: StudyPlan, topics: PlanTopic[], today: string): ScheduleStatus {
  const completed = topics.filter((t) => t.status === "completed").length;
  const overdue = topics.filter((t) => t.status !== "completed" && t.due_date < today).length;
  const daysLeft = daysBetween(today, plan.deadline);
  let label: string;
  if (completed === topics.length && topics.length > 0) label = "Plan complete";
  else if (daysLeft < 0) label = `Deadline passed ${-daysLeft}d ago`;
  else if (overdue > 0) label = `${overdue} topic${overdue > 1 ? "s" : ""} behind`;
  else label = "On track";
  return { completed, total: topics.length, daysLeft, overdue, onTrack: overdue === 0 && daysLeft >= 0, label };
}
