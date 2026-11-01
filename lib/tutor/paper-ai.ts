import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MODELS, modelBudget, parseJsonObject, type Groq } from "@/lib/groq";
import { docLabel, type OutlineItem } from "@/lib/types";

const TRIAGE_BUDGET = 14_000;

type PaperRow = { id: string; title: string; page_count: number };

async function pagesText(supabase: SupabaseClient, docId: string, pages: number[]) {
  const { data } = await supabase.from("document_pages").select("page_number, content").eq("document_id", docId).in("page_number", pages).order("page_number");
  return ((data ?? []) as { page_number: number; content: string }[]).map((p) => ({ page: p.page_number, text: p.content.replace(/\s+/g, " ").trim() }));
}

const Triage = z.object({
  papers: z.array(
    z.object({
      label: z.string(),
      pass: z.coerce.number().int().min(1).max(3),
      reason: z.string().max(400).catch(""),
    }),
  ),
});

// Suggest how deep each paper deserves to be read, given the research goal.
// onlyIds: just these documents (a study session's papers, not its textbooks).
export async function triagePapers(supabase: SupabaseClient, groq: Groq, sessionId: string, researchGoal: string, onlyIds?: string[]) {
  let query = supabase.from("documents").select("id, title, page_count").eq("session_id", sessionId).eq("status", "ready");
  if (onlyIds) query = query.in("id", onlyIds);
  const { data } = await query.order("position").order("created_at");
  const papers = ((data ?? []) as PaperRow[]).map((p, i) => ({ ...p, label: docLabel(i) }));
  if (!papers.length) return [];

  const perPaper = Math.max(600, Math.floor(TRIAGE_BUDGET / papers.length));
  const openings = await Promise.all(papers.map((p) => pagesText(supabase, p.id, [1, 2])));
  const block = papers
    .map((p, i) => `### ${p.label}: "${p.title}" (${p.page_count} pages)\n${openings[i].map((o) => o.text).join(" ").slice(0, perPaper)}`)
    .join("\n\n");

  const prompt = `A researcher is reading papers with Keshav's three-pass method. Decide how deep each paper deserves to be read.

RESEARCH GOAL:
"""
${researchGoal.slice(0, 3000)}
"""

PAPERS (opening of each: title, abstract, introduction):
${block}

Assign each paper a target pass:
- 3 = they will implement, re-derive or directly build on it (core methods for the goal).
- 2 = they need it for related work or to find the gap (close to their idea, but they won't rebuild it).
- 1 = background or tangential; a bird's-eye view is enough. Most papers should be 1 unless clearly central.

Give one short, specific reason per paper that refers to the goal. Plain text, no Markdown.
Return ONLY JSON: {"papers": [{"label": "D1", "pass": 1 | 2 | 3, "reason": "string"}]}`;

  const res = await groq.chat.completions.create({
    model: MODELS.chat,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.2,
    ...modelBudget(MODELS.chat, 2200),
  });
  const parsed = Triage.parse(parseJsonObject(res.choices[0]?.message?.content ?? ""));
  const byLabel = new Map(papers.map((p) => [p.label.toLowerCase(), p]));
  return parsed.papers
    .map((t) => ({ paper: byLabel.get(t.label.trim().toLowerCase()), pass: t.pass as 1 | 2 | 3, reason: t.reason }))
    .filter((t): t is { paper: (typeof papers)[number]; pass: 1 | 2 | 3; reason: string } => Boolean(t.paper));
}

const FiveCs = z.object({
  category: z.string().catch(""),
  context: z.string().catch(""),
  correctness: z.string().catch(""),
  contributions: z.string().catch(""),
  clarity: z.string().catch(""),
});

// A first-pass draft of the five Cs, from exactly what a first pass reads:
// title, abstract, introduction, headings, conclusion and references.
export async function draftFirstPass(supabase: SupabaseClient, groq: Groq, documentId: string) {
  const { data: doc } = await supabase.from("documents").select("title, page_count, outline").eq("id", documentId).single();
  if (!doc) throw new Error("Paper not found");
  const n = doc.page_count as number;
  const pages = await pagesText(supabase, documentId, [...new Set([1, 2, n - 1, n].filter((p) => p >= 1 && p <= n))]);
  const headings = ((doc.outline ?? []) as OutlineItem[]).map((o) => `${"  ".repeat(Math.min(o.level, 2))}${o.title}`).join("\n");

  const prompt = `Do a first pass (Keshav's method) on the paper "${doc.title}". Use only what a first pass reads.

${headings ? `SECTION HEADINGS:\n${headings}\n\n` : ""}START OF PAPER (title, abstract, introduction):
${pages.filter((p) => p.page <= 2).map((p) => p.text).join(" ").slice(0, 6000)}

END OF PAPER (conclusion, references):
${pages.filter((p) => p.page > 2).map((p) => p.text).join(" ").slice(0, 4000)}

Answer the five Cs in 1–3 plain sentences each:
- category: what kind of paper is it (new method, measurement, analysis, survey, position…)?
- context: which prior work or theory does it build on? Name specific papers or methods where visible.
- correctness: do the assumptions look valid from what you can see? Flag anything doubtful.
- contributions: what is actually new?
- clarity: is it well written and easy to follow?

Return ONLY JSON: {"category": "", "context": "", "correctness": "", "contributions": "", "clarity": ""}`;

  const res = await groq.chat.completions.create({
    model: MODELS.chat,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.2,
    ...modelBudget(MODELS.chat, 1400),
  });
  return FiveCs.parse(parseJsonObject(res.choices[0]?.message?.content ?? ""));
}
