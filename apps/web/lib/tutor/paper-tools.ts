import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MODELS, modelBudget, parseJsonObject, stripReasoning, type Groq } from "@confu/ai/groq";
import { notesText, type PaperReview } from "@confu/core/paper";

// Paper tools run on request: a related-work draft built from the student's
// own pass notes, and a side-by-side comparison. Both work only from what's
// in the session (abstracts, opening pages, notes), never invented sources.

export type ToolPaper = { id: string; title: string; authors: string[]; year: number | null; abstract: string; opening: string; notes: string };

export async function loadToolPapers(supabase: SupabaseClient, sessionId: string, docIds: string[]): Promise<ToolPaper[]> {
  const [{ data: docs }, { data: reviews }, { data: pages }] = await Promise.all([
    supabase.from("documents").select("id, title, meta, position").eq("session_id", sessionId).in("id", docIds).order("position"),
    supabase.from("paper_reviews").select("*").eq("session_id", sessionId).in("document_id", docIds),
    supabase.from("document_pages").select("document_id, page_number, content").in("document_id", docIds).lte("page_number", 2),
  ]);
  const byDoc = new Map(((reviews ?? []) as PaperReview[]).map((r) => [r.document_id, r]));
  return ((docs ?? []) as { id: string; title: string; meta: Record<string, unknown> | null }[]).map((d) => {
    const m = d.meta ?? {};
    const review = byDoc.get(d.id);
    const notes = review ? notesText(review) : "";
    return {
      id: d.id,
      title: d.title,
      authors: Array.isArray(m.authors) ? (m.authors as string[]) : [],
      year: typeof m.year === "number" ? m.year : null,
      abstract: typeof m.abstract === "string" ? m.abstract.slice(0, 2500) : "",
      opening: ((pages ?? []) as { document_id: string; page_number: number; content: string }[])
        .filter((p) => p.document_id === d.id)
        .sort((a, b) => a.page_number - b.page_number)
        .map((p) => p.content)
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 3000),
      notes: notes === "No notes yet." ? "" : notes.slice(0, 3000),
    };
  });
}

const describe = (p: ToolPaper, key: string) =>
  `[@${key}] "${p.title}"${p.authors.length ? ` by ${p.authors.slice(0, 3).join(", ")}${p.authors.length > 3 ? " et al." : ""}` : ""}${p.year ? ` (${p.year})` : ""}
Abstract: ${p.abstract || "(none)"}
${p.notes ? `The student's own notes:\n${p.notes}` : `Opening pages: ${p.opening.slice(0, 1500) || "(none)"}`}`;

export async function draftRelatedWork(groq: Groq, papers: ToolPaper[], keys: string[], goal: string) {
  const prompt = `Write a related-work section for a student's research, from the papers below. Use ONLY these papers and what is said about them here; do not mention any other work. Cite with the keys exactly as given, like [@vaswani2017attention], every time a paper is discussed.

THE STUDENT'S RESEARCH GOAL:
"""
${goal.slice(0, 2000) || "(not given: organise by theme)"}
"""

PAPERS:
${papers.map((p, i) => describe(p, keys[i])).join("\n\n")}

Write 2 to 4 paragraphs that group the papers by theme or approach (not one paragraph per paper), say how they relate to each other, and end by pointing out the gap or open question the student's goal addresses. Prefer the student's own notes where they exist. Academic register, plain Markdown, no headings, no bullet lists, no bibliography.`;
  const res = await groq.chat.completions.create({
    model: MODELS.chat,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    ...modelBudget(MODELS.chat, 1600),
  });
  const text = stripReasoning(res.choices[0]?.message?.content ?? "").trim();
  // Only real keys survive: anything else the model cites is dropped.
  const known = new Set(keys);
  return text.replace(/\[@([^\]\s;,]+)\]/g, (m, k: string) => (known.has(k) ? m : "")).replace(/\s+([.,;])/g, "$1");
}

export const COMPARE_FIELDS = [
  { key: "problem", label: "Problem" },
  { key: "approach", label: "Approach" },
  { key: "data", label: "Data and setup" },
  { key: "results", label: "Key results" },
  { key: "limitations", label: "Limitations" },
] as const;

const Compare = z.object({
  papers: z.array(
    z.object({
      index: z.coerce.number().int(),
      problem: z.string().catch(""),
      approach: z.string().catch(""),
      data: z.string().catch(""),
      results: z.string().catch(""),
      limitations: z.string().catch(""),
    }),
  ),
});

export type CompareRow = { id: string; title: string; year: number | null; cells: Record<(typeof COMPARE_FIELDS)[number]["key"], string> };

export async function comparePapers(groq: Groq, papers: ToolPaper[]): Promise<CompareRow[]> {
  const prompt = `Compare these research papers side by side, from the text given (abstracts, opening pages and the student's notes). For each paper fill: problem, approach, data (datasets, setup or evaluation), results (the headline findings, with numbers when given), limitations (stated or evident). One or two short sentences each. If something isn't in the text, write "Not stated". Don't invent numbers.

${papers.map((p, i) => `### Paper ${i}: "${p.title}"${p.year ? ` (${p.year})` : ""}\nAbstract: ${p.abstract || "(none)"}\nOpening: ${p.opening.slice(0, 1800)}\n${p.notes ? `Student's notes:\n${p.notes.slice(0, 1500)}` : ""}`).join("\n\n")}

Return ONLY JSON: {"papers": [{"index": 0, "problem": "", "approach": "", "data": "", "results": "", "limitations": ""}]}`;
  const res = await groq.chat.completions.create({
    model: MODELS.chat,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.2,
    ...modelBudget(MODELS.chat, 3600),
  });
  const parsed = Compare.parse(parseJsonObject(res.choices[0]?.message?.content ?? ""));
  return papers.map((p, i) => {
    const row = parsed.papers.find((x) => x.index === i);
    const cell = (v: string | undefined) => (v ?? "").trim().slice(0, 500) || "Not stated";
    return {
      id: p.id,
      title: p.title,
      year: p.year,
      cells: { problem: cell(row?.problem), approach: cell(row?.approach), data: cell(row?.data), results: cell(row?.results), limitations: cell(row?.limitations) },
    };
  });
}
