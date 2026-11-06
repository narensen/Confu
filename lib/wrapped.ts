// Wrapped (migration 0025): a month of studying in numbers.

export type Wrapped = {
  month: string; // YYYY-MM-01
  minutes: number;
  active_days: number;
  days_in_month: number;
  longest_streak: number;
  best_day: { day: string; minutes: number } | null;
  questions: number;
  highlights: number;
  answers: number;
  reviews: number;
  topics_done: number;
  papers_read: number;
  top_session: string | null;
  hours: number[]; // 24 counts of things done, by hour of day
  days: { day: string; minutes: number; actions: number }[];
};

export const monthName = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
export const monthYear = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
export const duration = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`);

// Which month to show by default: last month during the first days of a new one.
export function defaultMonth(now = new Date()) {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - (now.getDate() <= 5 ? 1 : 0), 1));
  return d.toISOString().slice(0, 7);
}

export function persona(hours: number[]) {
  const total = hours.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const peak = hours.indexOf(Math.max(...hours));
  const label = peak >= 5 && peak < 11 ? "an early bird" : peak >= 11 && peak < 17 ? "a daytime studier" : peak >= 17 && peak < 22 ? "an evening studier" : "a night owl";
  const h = peak % 12 === 0 ? 12 : peak % 12;
  return { peak, label, time: `${h} ${peak < 12 ? "am" : "pm"}` };
}
