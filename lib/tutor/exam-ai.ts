import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ExamQuestion, QuestionKind } from "@/lib/exam";
import { MODELS, modelBudget, parseJsonObject, type Groq } from "@/lib/groq";
import { docLabel } from "@/lib/types";

const PAGE_CHARS = 1700;
const MAX_PAGES = 6;

type Doc = { id: string; title: string; page_count: number; label: string };
type Page = { doc: Doc; page: number; text: string };

function middle(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const start = Math.floor((clean.length - max) / 2);
  return `…${clean.slice(start, start + max)}…`;
}

// Pick the pages to question: matches for weak topics, otherwise a random
// spread across the material (skipping near-empty pages like covers).
async function pickPages(supabase: SupabaseClient, sessionId: string, docs: Doc[], topics: string[]): Promise<Page[]> {
  const byId = new Map(docs.map((d) => [d.id, d]));
  if (topics.length) {
    const { data } = await supabase.rpc("search_session_pages", { p_session_id: sessionId, p_query: topics.join(" "), p_limit: MAX_PAGES });
    const hits = ((data ?? []) as { document_id: string; page_number: number; content: string }[])
      .filter((r) => byId.has(r.document_id) && r.content.length > 300)
      .map((r) => ({ doc: byId.get(r.document_id)!, page: r.page_number, text: r.content }));
    if (hits.length) return hits;
  }

  const candidates: { doc: Doc; page: number }[] = [];
  const total = docs.reduce((n, d) => n + d.page_count, 0);
  for (let i = 0; i < MAX_PAGES * 3 && total > 0; i++) {
    let r = Math.floor(Math.random() * total);
    const doc = docs.find((d) => (r -= d.page_count) < 0) ?? docs[0];
    const page = Math.floor(Math.random() * doc.page_count) + 1;
    if (!candidates.some((c) => c.doc.id === doc.id && c.page === page)) candidates.push({ doc, page });
  }
  const pages: Page[] = [];
  for (const doc of docs) {
    const wanted = candidates.filter((c) => c.doc.id === doc.id).map((c) => c.page);
    if (!wanted.length) continue;
    const { data } = await supabase.from("document_pages").select("page_number, content").eq("document_id", doc.id).in("page_number", wanted);
    for (const row of (data ?? []) as { page_number: number; content: string }[]) {
      if (row.content.replace(/\s+/g, " ").length > 400) pages.push({ doc, page: row.page_number, text: row.content });
    }
  }
  return pages.sort(() => Math.random() - 0.5).slice(0, MAX_PAGES);
}

const Question = z.object({
  kind: z.enum(["mcq", "short"]),
  question: z.string().min(5),
  options: z.array(z.string()).optional(),
  correct: z.coerce.number().int().optional(),
  answer: z.string().optional(),
  explanation: z.string().catch(""),
  topic: z.string().min(1).max(80),
  source: z.string().catch(""),
});

export async function generateQuiz(
  supabase: SupabaseClient,
  groq: Groq,
  opts: { sessionId: string; documentId: string | null; topics: string[]; count: number; mix: "mixed" | QuestionKind },
): Promise<ExamQuestion[]> {
  const { sessionId, documentId, topics, count, mix } = opts;
  const { data: docRows } = await supabase
    .from("documents")
    .select("id, title, page_count")
    .eq("session_id", sessionId)
    .eq("status", "ready")
    .order("position")
    .order("created_at");
  const all = ((docRows ?? []) as Omit<Doc, "label">[]).map((d, i) => ({ ...d, label: docLabel(i) }));
  const docs = documentId ? all.filter((d) => d.id === documentId) : all;
  if (!docs.length) throw new Error("Add your study material first.");

  const [pages, history] = await Promise.all([
    pickPages(supabase, sessionId, docs, topics),
    supabase.from("exam_attempts").select("question, topic").eq("session_id", sessionId).order("created_at", { ascending: false }).limit(40),
  ]);
  if (!pages.length) throw new Error("Couldn't find readable text in your PDFs. Scanned PDFs need text to make questions.");

  const recent = (history.data ?? []) as { question: string; topic: string }[];
  const knownTopics = [...new Set(recent.map((r) => r.topic))].slice(0, 30);
  const kinds =
    mix === "mcq" ? "all multiple choice" : mix === "short" ? "all short answer" : "a mix: roughly two thirds multiple choice, one third short answer";

  const prompt = `You set exam questions for a college student revising from their own course material.

COURSE MATERIAL (excerpts, each labelled with its source):
${pages.map((p) => `[${p.doc.label} p. ${p.page}] from "${p.doc.title}"\n${middle(p.text, PAGE_CHARS)}`).join("\n\n---\n\n")}

Write ${count} exam-style questions, ${kinds}.${topics.length ? `\nFocus on these topics the student is weak on: ${topics.join("; ")}.` : ""}
Rules:
- Every question must be answerable from ONE excerpt above; set "source" to its label exactly, e.g. "D1 p. 12". Never use outside facts.
- Test understanding and application, the way a college exam would: explain, compare, calculate, apply. Avoid trivia like page titles or author names.
- Multiple choice: exactly 4 options, one clearly correct, three plausible distractors based on real misconceptions. "correct" is the 0-based index of the right option. Don't use "all of the above".
- Short answer: answerable in 2–4 sentences; give a model "answer" a marker would accept.
- "explanation": under 60 words, why the answer is right (and for MCQ, why the tempting wrong option is wrong). Refer to options by their text, never by number or letter.
- "topic": 2–5 words naming the concept tested.${knownTopics.length ? ` Reuse these names when they fit: ${knownTopics.join("; ")}.` : ""}
${recent.length ? `- Don't repeat these recent questions:\n${recent.slice(0, 20).map((r) => `  - ${r.question.slice(0, 120)}`).join("\n")}` : ""}
- Plain text, no Markdown. Write math with $…$.

Return ONLY JSON: {"questions": [{"kind": "mcq" | "short", "question": "", "options": ["", "", "", ""], "correct": 0, "answer": "", "explanation": "", "topic": "", "source": "D1 p. 12"}]}`;

  const res = await groq.chat.completions.create({
    model: MODELS.chat,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.6,
    ...modelBudget(MODELS.chat, 3600),
  });
  const parsed = z.object({ questions: z.array(z.unknown()) }).parse(parseJsonObject(res.choices[0]?.message?.content ?? ""));

  const byLabel = new Map(all.map((d) => [d.label.toLowerCase(), d]));
  const questions: ExamQuestion[] = [];
  for (const raw of parsed.questions) {
    const q = Question.safeParse(raw);
    if (!q.success) continue;
    const v = q.data;
    if (v.kind === "mcq" && (!v.options || v.options.length !== 4 || v.correct === undefined || v.correct < 0 || v.correct > 3)) continue;
    if (v.kind === "short" && !v.answer?.trim()) continue;
    const m = v.source.match(/(D\d+)\s*p\.?\s*(\d+)/i);
    const doc = m ? byLabel.get(m[1].toLowerCase()) : undefined;
    questions.push({
      id: crypto.randomUUID(),
      kind: v.kind,
      question: v.question.trim(),
      options: v.kind === "mcq" ? v.options!.map((o) => o.trim()) : undefined,
      correct: v.kind === "mcq" ? v.correct : undefined,
      answer: v.kind === "short" ? v.answer!.trim() : undefined,
      explanation: v.explanation.trim(),
      topic: v.topic.trim(),
      documentId: doc?.id ?? null,
      label: doc?.label ?? "",
      page: m && doc ? Number(m[2]) : null,
    });
  }
  if (!questions.length) throw new Error("Couldn't make questions this time. Try again.");
  return questions.slice(0, count);
}

const Grade = z.object({
  score: z.coerce.number().catch(0),
  feedback: z.string().catch(""),
});

// Mark a short answer against the model answer, like a fair examiner would.
export async function gradeShortAnswer(groq: Groq, input: { question: string; expected: string; answer: string }) {
  const res = await groq.chat.completions.create({
    model: MODELS.chat, // marking accuracy matters more than the small extra cost
    messages: [
      {
        role: "user",
        content: `You are a fair college examiner. Mark the student's answer against the model answer.

QUESTION: ${input.question}
MODEL ANSWER: ${input.expected}
STUDENT ANSWER: ${input.answer.slice(0, 2000)}

Give credit for the right idea in different words, but mark like a strict examiner:
- 1: all the key points, correct.
- 0.5: correct as far as it goes, but missing an important part.
- 0: empty, or contains a wrong result, a wrong final answer, or a key misconception, even if it mentions related ideas. Wrong is wrong.
"feedback": under 50 words, speaking to the student: what they got right, and exactly what's missing or wrong.
Return ONLY JSON: {"score": 0 | 0.5 | 1, "feedback": ""}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    ...modelBudget(MODELS.chat, 700),
  });
  const g = Grade.parse(parseJsonObject(res.choices[0]?.message?.content ?? "{}"));
  const score = g.score >= 0.75 ? 1 : g.score >= 0.25 ? 0.5 : 0;
  return { score, feedback: g.feedback.trim() };
}
