import { addDays, daysBetween } from "@/lib/schedule";
import type { Level } from "@/lib/types";

// How long a goal takes, and the pace that fits it: total hours, hours a day
// and a deadline, where choosing one of the last two sets the other.

export type PacePart = { label: string; hours: number };
export type PaceEstimate = { hours: number; low: number; high: number; parts: PacePart[]; why: string; source: "materials" | "ai" };

// Rough focused-study times, by background: a textbook page read to
// understand it, a paper read properly (two or three passes), a lecture
// watched with notes, a web page or guide.
const MIN_PER_PAGE: Record<Level, number> = { beginner: 5, intermediate: 3.5, advanced: 2.5 };
const HOURS_PER_PAPER: Record<Level, number> = { beginner: 4, intermediate: 3, advanced: 2 };
const HOURS_PER_LECTURE = 1.5;
const HOURS_PER_PAGE_LINK = 0.75;
const PRACTICE = 0.35; // practice and review, on top of the reading

const DOI = /\b10\.\d{4,9}\/[^\s"<>)\]]+/gi;
const ARXIV = /\b(?:arxiv[:\s]*|arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5})/gi;
const YOUTUBE = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch|live|embed|shorts)|youtu\.be\/)[^\s<>)\]"']*/gi;
const LINK = /https?:\/\/[^\s<>)\]"']+/gi;

const round1 = (h: number) => Math.round(h * 2) / 2;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// From the session's PDFs and what the goal lists. Free and instant; the AI
// (when it doesn't cost a free-trial prompt) refines it for the goal's scope.
export function materialsEstimate(input: { books: number[]; paperPdfs: number; goal: string; level: Level }): PaceEstimate {
  const { books, paperPdfs, goal, level } = input;
  const ids = new Set([...(goal.match(DOI) ?? []).map((d) => d.toLowerCase()), ...[...goal.matchAll(ARXIV)].map((m) => m[1])]);
  const listedPapers = Math.max(0, ids.size - paperPdfs); // papers named in the goal, not uploaded yet
  const lectures = new Set(goal.match(YOUTUBE) ?? []).size;
  const pageLinks = new Set((goal.match(LINK) ?? []).filter((u) => !/youtube\.com|youtu\.be|doi\.org|arxiv\.org/i.test(u))).size;
  const pages = books.reduce((a, b) => a + b, 0);
  const papers = paperPdfs + listedPapers;

  const parts: PacePart[] = [];
  if (pages) parts.push({ label: `${plural(books.length, "PDF", "PDFs")}, ${pages.toLocaleString("en-US")} pages`, hours: round1((pages * MIN_PER_PAGE[level]) / 60) });
  if (papers) parts.push({ label: plural(papers, "paper", "papers"), hours: papers * HOURS_PER_PAPER[level] });
  if (lectures) parts.push({ label: plural(lectures, "lecture", "lectures"), hours: lectures * HOURS_PER_LECTURE });
  if (pageLinks) parts.push({ label: plural(pageLinks, "page or guide", "pages and guides"), hours: round1(pageLinks * HOURS_PER_PAGE_LINK) });
  const reading = parts.reduce((a, p) => a + p.hours, 0);
  if (reading) parts.push({ label: "Practice and review", hours: round1(reading * PRACTICE) });
  const hours = Math.max(0, Math.round(reading * (1 + PRACTICE)));
  return { hours, low: Math.round(hours * 0.8), high: Math.round(hours * 1.3), parts, why: "", source: "materials" };
}

export const roundQuarter = (h: number) => Math.round(h * 4) / 4;
export const MIN_HOURS_A_DAY = 0.25;
export const MAX_HOURS_A_DAY = 10;

// The deadline that a daily pace reaches (the last study day), from today.
export function deadlineFor(totalHours: number, hoursADay: number, today: string) {
  const days = Math.max(1, Math.ceil(totalHours / Math.max(MIN_HOURS_A_DAY, hoursADay)));
  return addDays(today, days - 1);
}

// The daily pace a deadline needs.
export function hoursADayFor(totalHours: number, today: string, deadline: string) {
  const days = Math.max(1, daysBetween(today, deadline) + 1);
  return Math.min(MAX_HOURS_A_DAY, Math.max(MIN_HOURS_A_DAY, roundQuarter(totalHours / days)));
}
