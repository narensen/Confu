import { DIAGRAM_FENCE } from "./diagram";
import type { SavedAnswer } from "../types";

// Saved answers in the tutor's context. They are the student's own pick of
// what mattered, so they are always sent, newest first, after the chat that
// produced them is long gone (or cleared).

const EACH = 1400; // characters per answer
const TOTAL = 7000; // characters for the whole block

function plain(answer: string): string {
  return answer
    .replace(DIAGRAM_FENCE, (block) => (/^```mermaid/i.test(block) ? block : "(a drawn diagram)"))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function savedBlock(saved: Pick<SavedAnswer, "question" | "answer" | "created_at">[]): string {
  if (!saved.length) return "";
  const parts: string[] = [];
  let used = 0;
  for (const [i, s] of saved.entries()) {
    const body = plain(s.answer);
    const cut = body.length > EACH ? `${body.slice(0, EACH).trimEnd()}…` : body;
    const asked = s.question?.replace(/\s+/g, " ").trim().slice(0, 200);
    const part = `[Saved ${i + 1}${asked ? ` · they asked: "${asked}"` : ""}]\n${cut}`;
    if (used + part.length > TOTAL && parts.length) break;
    parts.push(part);
    used += part.length;
  }
  return `

## Answers the student saved
The student kept these answers from this session. They stay relevant for the whole session, even after the chat is cleared. Treat them as settled ground: stay consistent with them, build on them, and point back to them ("the answer you saved on …") instead of explaining the same thing again. If one turns out to be wrong, say so plainly and correct it. A saved answer is not a page: never cite it as one.

${parts.join("\n\n")}`;
}

/** How a saved answer is matched to the message it came from: its text. */
export function answerKey(text: string): string {
  return text.trim().slice(0, 12000);
}
