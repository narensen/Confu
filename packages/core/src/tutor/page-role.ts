// A course file often puts the questions on one page and the answers on another.
// The tutor was citing the question page, because that is the page open on
// screen and the one the search hits first. These helpers tell the two apart.

export type PageRole = "question" | "answer" | "mixed";

const STOP = new Set(
  "the a an and or of to in on for is are was were be been it this that with as by at from what why how which can does do i me my about into than then there their each also more most such than when where who whom whose".split(
    " ",
  ),
);

// A line that is an exam prompt, not a sentence that happens to contain "what".
const PROMPT =
  /(?:^|\n)\s*(?:\(?\d{1,2}[.)]|Q\s?\d{1,2}[:.)]|[a-h][.)])?\s*(explain|describe|define|state|what|why|how|discuss|compare|outline|calculate|show that|give|list|name|identify|distinguish|derive|prove|evaluate|comment on)\b/gi;

const QUESTION_HEAD = /\b(questions?|problems?|exercises?|problem sheet|past paper|exam paper)\b/i;
// "Answer all questions" is a question sheet. "Answers" or "Answer:" is the solution.
const ANSWER_HEAD = /\b(answers|solutions?|mark scheme|marking scheme|model answers?|worked solutions?|answer key)\b|(?:^|\n)\s*answer\s*[:—–-]/i;

export function pageTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9α-ω]+/i)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

export function termOverlap(a: string, b: string): number {
  const want = new Set(pageTerms(a));
  if (!want.size) return 0;
  const have = new Set(pageTerms(b));
  let n = 0;
  for (const t of want) if (have.has(t)) n++;
  return n;
}

export function pageKind(text: string): PageRole {
  const raw = text.replace(/\s+/g, " ").trim();
  if (raw.length < 40) return "mixed";
  const head = raw.slice(0, 500);
  const answerHead = ANSWER_HEAD.test(head);
  const questionHead = QUESTION_HEAD.test(head);
  const prompts = text.match(PROMPT)?.length ?? 0;
  const words = raw.split(/\s+/).length;
  const marks = (raw.match(/\?/g) ?? []).length;

  // Numbered lines that are only a prompt, against the prose around them.
  // Wrapped answer paragraphs have lots of non-numbered lines, so they don't count.
  let shortPrompts = 0;
  let promptWords = 0;
  let otherWords = 0;
  for (const line of text.split(/\n/)) {
    const t = line.trim();
    if (!t) continue;
    const n = t.split(/\s+/).length;
    if (/^(?:\(?\d{1,2}[.)]|Q\s?\d+)/.test(t) && n < 28) {
      shortPrompts++;
      promptWords += n;
    } else otherWords += n;
  }
  const questionSheet = shortPrompts >= 3 && otherWords < promptWords * 1.5;

  // "Answer all questions" on a problem sheet is not an answer page.
  if (answerHead && words > 80 && prompts < 3 && !questionSheet) return "answer";
  if (questionHead && !answerHead && (prompts >= 2 || marks >= 2 || questionSheet)) return "question";
  // Several short prompts, and not much writing after each: a question sheet.
  if (questionSheet || (prompts >= 3 && words / prompts < 90)) return "question";
  if (marks >= 4 && prompts >= 2 && words / marks < 45) return "question";
  // A page of explanation, with at most one prompt: where the answer is written.
  if (prompts <= 1 && marks <= 2 && words >= 80) return "answer";
  return "mixed";
}

// Higher is a better page to cite for this question. Question sheets score -1.
export function answerRank(text: string, query: string): number {
  if (pageKind(text) === "question") return -1;
  const shared = termOverlap(text, query);
  if (shared < 2) return -1;
  return (pageKind(text) === "answer" ? 8 : 0) + shared;
}

export type CitedPage = { label: string; page: number; text: string; kind?: PageRole };

const CITE = /\b(?:(D\d{1,2})[,\s·]*)?(pp?\.)\s?(\d{1,4})(?:\s?[–-]\s?\d{1,4})?/gi;

// When a paragraph cites the question sheet, point it at the answer page in
// the same file whose text the paragraph actually uses.
export function preferAnswerCitations(text: string, pages: CitedPage[], multi: boolean): string {
  const questions = pages.filter((p) => p.kind === "question");
  const answers = pages.filter((p) => p.kind === "answer");
  if (!questions.length || !answers.length) return text;

  return text
    .split(/(\n\s*\n)/)
    .map((part) => {
      if (/^\n\s*\n$/.test(part)) return part;
      return part.replace(new RegExp(CITE.source, "gi"), (match, label: string | undefined, _dot: string, start: string) => {
        const page = Number(start);
        const lab = label?.toUpperCase();
        const asked = questions.find((q) => q.page === page && (!multi || !lab || q.label.toUpperCase() === lab));
        if (!asked) return match;
        const file = (lab || asked.label).toUpperCase();
        const pool = answers.filter((a) => !multi || a.label.toUpperCase() === file);
        let best: CitedPage | null = null;
        let bestScore = 3;
        for (const candidate of pool) {
          const score = termOverlap(part, candidate.text);
          if (score > bestScore) {
            best = candidate;
            bestScore = score;
          }
        }
        if (!best) return match;
        return multi ? `${best.label.toUpperCase()} p. ${best.page}` : `p. ${best.page}`;
      });
    })
    .join("");
}
