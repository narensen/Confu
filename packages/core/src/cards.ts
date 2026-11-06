import { createEmptyCard, fsrs, Rating, type Card, type Grade, type State } from "ts-fsrs";

// Flashcards: written by the AI from the student's pages (each citing its
// page), then scheduled with FSRS, the spaced-repetition model Anki uses.

export type CardDraft = { front: string; back: string; page: number | null };

// The scheduling fields as stored (ISO dates), matching the cards table.
export type CardSchedule = {
  due: string;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
};

export const GRADES = [
  { grade: 1, label: "Again", key: "1" },
  { grade: 2, label: "Hard", key: "2" },
  { grade: 3, label: "Good", key: "3" },
  { grade: 4, label: "Easy", key: "4" },
] as const;

export function cardsPrompt(input: { pages: { page: number; text: string }[]; count: number; title: string; focus?: string | null }) {
  const pages = input.pages.map((p) => `[p. ${p.page}]\n${p.text.slice(0, 3000)}`).join("\n\n");
  return [
    {
      role: "system" as const,
      content: [
        "You write flashcards for spaced repetition from a student's study material.",
        "Each card tests one idea: a definition, a fact, a cause and effect, a formula and when it applies, a step in a method. Prefer understanding over trivia.",
        "front: a question a student can answer from memory in a few seconds. back: the answer in one or two short sentences. Use $…$ for math and $\\ce{…}$ for chemistry.",
        "page: the page number the card comes from, as shown in [p. N].",
        "Use only the material given. Don't repeat a card. Write in the material's language.",
        'Reply with JSON only: {"cards":[{"front":"…","back":"…","page":3}]}',
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: `Write ${input.count} flashcards from "${input.title}"${input.focus ? `, about: ${input.focus}` : ""}.\n\n${pages}`,
    },
  ];
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

// The model's JSON, checked: only well-formed cards, no duplicates, pages
// that exist.
export function parseCards(raw: string, validPages: Set<number>): CardDraft[] {
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    return [];
  }
  const list = (data as { cards?: unknown })?.cards;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: CardDraft[] = [];
  for (const c of list) {
    const front = clean((c as Record<string, unknown>)?.front, 400);
    const back = clean((c as Record<string, unknown>)?.back, 800);
    const page = Number((c as Record<string, unknown>)?.page);
    const key = front.toLowerCase();
    if (!front || !back || seen.has(key)) continue;
    seen.add(key);
    out.push({ front, back, page: Number.isInteger(page) && validPages.has(page) ? page : null });
  }
  return out.slice(0, 60);
}

const scheduler = fsrs({ enable_fuzz: true });

const toCard = (s: CardSchedule): Card => ({
  due: new Date(s.due),
  stability: s.stability,
  difficulty: s.difficulty,
  scheduled_days: s.scheduled_days,
  learning_steps: s.learning_steps,
  reps: s.reps,
  lapses: s.lapses,
  state: s.state as State,
  last_review: s.last_review ? new Date(s.last_review) : undefined,
});

const fromCard = (c: Card): CardSchedule => ({
  due: c.due.toISOString(),
  stability: c.stability,
  difficulty: c.difficulty,
  scheduled_days: c.scheduled_days,
  learning_steps: c.learning_steps,
  reps: c.reps,
  lapses: c.lapses,
  state: c.state,
  last_review: c.last_review ? c.last_review.toISOString() : null,
});

export const newSchedule = (now = new Date()): CardSchedule => fromCard(createEmptyCard(now));

// The schedule after answering with `grade` (1 Again … 4 Easy).
export function grade(s: CardSchedule, g: 1 | 2 | 3 | 4, now = new Date()): CardSchedule {
  return fromCard(scheduler.next(toCard(s), now, g as Grade).card);
}

// When each answer would bring the card back, for the buttons ("10 min", "4 d").
export function preview(s: CardSchedule, now = new Date()): Record<1 | 2 | 3 | 4, string> {
  const r = scheduler.repeat(toCard(s), now);
  const when = (g: Grade) => interval(now, r[g].card.due);
  return { 1: when(Rating.Again), 2: when(Rating.Hard), 3: when(Rating.Good), 4: when(Rating.Easy) };
}

export function interval(from: Date, to: Date): string {
  const min = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d} d`;
  const mo = Math.round(d / 30);
  return mo < 12 ? `${mo} mo` : `${Math.round(d / 365)} y`;
}
