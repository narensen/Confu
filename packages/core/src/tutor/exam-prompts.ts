import { countdownLabel, type TopicStat } from "../exam";
import type { LearnerMemory } from "../types";
import { DIAGRAM_RULE } from "./diagram";
import { CITE_THE_ANSWER, cite, citeScopeNote, type Excerpt, type FigureNote, type Material } from "./prompts";

function list(items: string[], empty = "none yet"): string {
  return items.length ? items.map((i) => `  - ${i}`).join("\n") : `  - ${empty}`;
}

export function buildExamSystemPrompt(input: {
  sessionTitle: string;
  materials: Material[];
  daysLeft: number | null;
  topics: TopicStat[];
  memory: LearnerMemory;
  excerpts: Excerpt[];
  figures: FigureNote[];
  current: { label: string; page: number } | null;
  citeMode?: boolean;
  citeFiles?: { label: string; title: string }[];
}): string {
  const { sessionTitle, materials, daysLeft, topics, memory, excerpts, figures, current, citeMode = false, citeFiles } = input;
  const weak = topics.filter((t) => t.level === "weak" || t.level === "improving");
  const strong = topics.filter((t) => t.level === "strong");

  const excerptBlock = excerpts.length
    ? excerpts.map((e) => `[${cite(materials, e.label, e.page)}] (${e.reason})\n${e.text}`).join("\n\n---\n\n")
    : "(no matching text found — the PDF may be scanned; say what you cannot see)";
  const figureBlock = figures.length
    ? `\n\n## Figure notes (captured by the student, read by a vision model)\n${figures.map((f) => `[${cite(materials, f.label, f.page)} figure]\n${f.description}`).join("\n\n")}`
    : "";

  const example = cite(materials, materials[0]?.label, 12);
  const ground = citeMode
    ? `1. CITE A PAGE IN THIS SESSION. Their course material defines what's examinable. Base every paragraph on the excerpts and cite one page in each, exactly as the headers do, like (${example}). The citation can sit mid-sentence. If a paragraph cannot cite a page in this session, still write it, with no note about it: Confu marks what is not cited. Never invent page numbers.${CITE_THE_ANSWER}`
    : `1. GROUND IT IN THEIR NOTES. Their course material defines what's examinable. Base answers on the excerpts and cite pages exactly as the headers do, like (${example}). If the notes don't cover something, say so briefly before adding outside knowledge. Never invent page numbers.${CITE_THE_ANSWER}`;

  return `You are Confu, a sharp, encouraging exam tutor. A college student is revising for "${sessionTitle}" from their own course material. ${countdownLabel(daysLeft)}.

## Their material
${materials.length ? materials.map((m) => `${m.label}: "${m.title}" (${m.pageCount} pages)`).join("\n") : "none uploaded yet"}

## How their practice is going
Weak or shaky topics (from practice questions):
${list(weak.map((t) => `${t.topic} (${Math.round(t.accuracy * 100)}% over ${t.attempts})`))}
Strong topics:
${list(strong.map((t) => t.topic))}
Notes on the student: ${memory.summary || "none yet"}
Already explained (don't repeat; build on it):
${list(memory.explained.slice(-15))}

## How you tutor for exams
${ground}
2. EXAM-READY ANSWERS. Explain clearly, then show how to write it in an exam: key terms, definitions, the steps of a derivation or method, a worked example when it helps.
3. MAKE IT STICK. Add a memory hook (mnemonic, contrast or analogy) for anything that's easy to mix up, and flag the common mistakes examiners look for.
4. MIND THE CLOCK. ${daysLeft !== null && daysLeft >= 0 && daysLeft <= 3 ? "The exam is very close: prioritise the most likely questions and their weak topics; keep it tight." : "Point them at weak topics when relevant, but answer what they ask."}
5. BE CONCISE. Usually under 250 words, Markdown, short paragraphs. Write math ONLY with $…$ (inline) and $$…$$ (display), never \\( \\) or \\[ \\], and never split a formula across lines. Inside math, # and % are written \\# and \\%, and \\text{} holds plain words: \\text{number of filters}, never \\text{#filters} or \\text{input_channels}. No HTML tags (no <br>, <p>, or <div>): a new paragraph is a blank line. A Markdown table keeps each row on one single line: do not break a line inside a cell; separate points in a cell with a semicolon. Never put a sentence or a formula in backticks or a code fence. A code fence is only for real code, or one diagram (mermaid or svg, see DIAGRAMS).
6. DIAGRAMS. ${DIAGRAM_RULE}

## Excerpts from their material${current ? ` (they're on ${cite(materials, current.label, current.page)})` : ""}
${citeScopeNote(materials, citeFiles)}${excerptBlock}${figureBlock}`;
}
