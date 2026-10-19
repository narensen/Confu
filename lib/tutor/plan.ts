import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { groq, MODELS, parseJsonObject } from "@/lib/groq";
import { assignDueDates, daysBetween } from "@/lib/schedule";
import { docLabel, type Level, type OutlineItem } from "@/lib/types";

// Strip Markdown so model-written labels render cleanly in our own components.
function plain(s: string): string {
  return s
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*(#+|[-*>]|\d+[.)])\s+/gm, "")
    .replace(/^(phase|step|topic)\s*\d+\s*[:.–-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

const text = (max: number) => z.string().transform(plain).pipe(z.string().max(max));

const page = z.preprocess(
  (v) => (v === null || v === undefined || v === "" ? null : Number(v)),
  z.number().int().nullable(),
);

const Resource = z.object({
  type: z.enum(["lecture", "video", "reading", "course", "practice"]).catch("reading"),
  title: text(200).pipe(z.string().min(1)),
  search: text(200).pipe(z.string().min(2)),
});

const Topic = z.object({
  title: text(160).pipe(z.string().min(1)),
  source: z.enum(["pdf", "external"]).catch("pdf"),
  // Which PDF ("D1", "D2", …) a "pdf" topic's pages refer to.
  material: z.string().nullable().optional().catch(null),
  page_start: page.optional().default(null),
  page_end: page.optional().default(null),
  objectives: z.array(text(300)).min(1).max(6),
  key_concepts: z.array(text(80)).max(10).catch([]),
  est_minutes: z.coerce.number().int().min(5).max(900).catch(45),
  resources: z.array(Resource).max(3).catch([]),
});

const PlanSchema = z.object({
  goal_title: text(100).pipe(z.string().min(1)),
  goal_summary: text(500).catch(""),
  overview: text(800).catch(""),
  phases: z
    .array(
      z.object({
        title: text(120).pipe(z.string().min(1)),
        description: text(400).catch(""),
        topics: z.array(Topic).min(1).max(10),
      }),
    )
    .min(1)
    .max(6),
});

const MAP_BUDGET = 16_000;
const MAX_TOPICS = 24;

type Doc = { id: string; title: string; page_count: number; outline: OutlineItem[] | null };

// A compact map of one document: its outline (when the PDF has one) plus the
// opening words of each page, sampled to fit the budget.
async function documentMap(supabase: SupabaseClient, doc: Doc, budget: number) {
  const outline = doc.outline ?? [];
  const outlineText = outline.length
    ? outline
        .slice(0, Math.max(20, Math.floor(budget / 120)))
        .map((o) => `${"  ".repeat(Math.min(o.level, 3))}- ${o.title} → p. ${o.page}`)
        .join("\n")
    : "";

  const remaining = budget - outlineText.length;
  const perPage = 150;
  const step = Math.max(1, Math.ceil((doc.page_count * (perPage + 10)) / Math.max(remaining, 1500)));
  const { data } = await supabase.rpc("page_snippets", { p_document_id: doc.id, p_chars: perPage });
  const snippets = ((data ?? []) as { page_number: number; snippet: string }[])
    .filter((p) => p.snippet.trim() && (p.page_number - 1) % step === 0)
    .map((p) => `p.${p.page_number}: ${p.snippet.trim()}`)
    .join("\n");

  return `${outlineText ? `Table of contents:\n${outlineText}\n` : ""}Page openings${step > 1 ? ` (every ${step} pages)` : ""}:\n${snippets}`;
}

export async function generatePlan(
  supabase: SupabaseClient,
  input: {
    userId: string;
    sessionId: string;
    goal: string;
    materials: string;
    level: Level;
    startDate: string;
    deadline: string;
    minutesPerDay: number;
  },
) {
  const { userId, sessionId, goal, materials, level, startDate, deadline, minutesPerDay } = input;

  const { data: docRows, error } = await supabase
    .from("documents")
    .select("id, title, page_count, outline")
    .eq("session_id", sessionId)
    .eq("status", "ready")
    .order("position")
    .order("created_at");
  if (error) throw new Error(error.message);
  const docs = (docRows ?? []) as Doc[];
  const labelled = docs.map((d, i) => ({ ...d, label: docLabel(i) }));

  const days = Math.max(1, daysBetween(startDate, deadline) + 1);
  const budget = days * minutesPerDay;
  const perDoc = docs.length ? Math.floor(MAP_BUDGET / docs.length) : 0;
  const maps = await Promise.all(labelled.map((d) => documentMap(supabase, d, perDoc)));
  const materialsBlock = labelled.length
    ? labelled.map((d, i) => `### ${d.label}: "${d.title}" (${d.page_count} pages)\n${maps[i]}`).join("\n\n")
    : "(no PDFs uploaded yet — plan entirely from outside resources)";

  const prompt = `Design a study plan for ONE student.

THE STUDENT'S GOAL (the source of truth — the plan exists to achieve this):
"""
${goal.slice(0, 8000)}
"""
${materials ? `\nOTHER MATERIALS THE STUDENT IS USING (lectures, courses, books):\n"""\n${materials.slice(0, 2000)}\n"""\n` : ""}
LEVEL: ${level}
TIME: ${days} day(s) × ${+(minutesPerDay / 60).toFixed(2)} h/day ≈ ${budget} minutes total

PRIMARY MATERIALS — the student's PDFs, labelled D1, D2, …:
${materialsBlock}

How to plan:
- Start from the GOAL, not the PDFs. Work out everything the student must understand and be able to do to reach it.
- Use the PDFs wherever they cover what the goal needs: source "pdf", "material" set to the PDF's label (e.g. "D1"), and an exact contiguous page range inside that PDF. When several PDFs cover the same idea, pick the clearest one.
- When the goal needs something the PDFs don't cover (prerequisites, missing subtopics, practice, real-world application), add a topic with source "external", material null and page_start/page_end null.
- Skip PDF sections that don't serve the goal (front matter, references, off-goal chapters).
- Group topics into 2–5 phases that build on each other (e.g. foundations → core ideas → application). 3–15 topics in total, prerequisites first.
- Objectives are checkable and aim at deep understanding: "Explain why…", "Derive…", "Predict what happens if…", "Apply … to …". 2–4 per topic.
- key_concepts: the essential terms for the topic (≤ 8).
- resources: OUTSIDE material only, never the student's PDFs. 0–2 per topic, and every "external" topic needs at least one. Prefer the student's own listed materials, then well-known real resources (university lecture series, standard textbooks, official documentation, practice sets). Give a search query that will find it, never a URL. If you are not sure a specific title exists, describe it generically instead of inventing one.
- est_minutes: realistic for a ${level} learner. The total should fit ~${budget} minutes; if the goal can't fit, prioritise what matters most for it.
- Write every field as plain text: no Markdown, no bullet characters, and no "Phase 1:" or "Topic 2." prefixes.

Return ONLY JSON in this shape:
{
  "goal_title": "≤ 8 words naming the goal",
  "goal_summary": "1–2 sentences: what the student will be able to do at the end",
  "overview": "2–3 sentences on the learning path and why it is ordered this way",
  "phases": [
    {
      "title": "short phase name",
      "description": "1–2 sentences on what this phase achieves",
      "topics": [
        {
          "title": "string",
          "source": "pdf" | "external",
          "material": "D1" | null,
          "page_start": number | null,
          "page_end": number | null,
          "objectives": ["string"],
          "key_concepts": ["string"],
          "est_minutes": number,
          "resources": [{ "type": "lecture" | "video" | "reading" | "course" | "practice", "title": "string", "search": "search query" }]
        }
      ]
    }
  ]
}`;

  const res = await groq.chat.completions.create({
    model: MODELS.chat,
    messages: [
      {
        role: "system",
        content:
          "You are an expert curriculum designer. You build focused, goal-driven study plans that use the student's own material where it helps and fill its gaps with well-chosen outside material.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
    max_completion_tokens: 9000,
    reasoning_effort: "medium",
  });

  const parsed = PlanSchema.parse(parseJsonObject(res.choices[0]?.message?.content ?? ""));

  // Models sometimes list one of the student's PDFs as a "resource"; the page badge already covers that.
  const titleKeys = docs.map((d) => d.title.toLowerCase());
  const isAPdf = (r: { title: string; search: string }) =>
    [r.title, r.search].some((s) => {
      const x = s.toLowerCase();
      return titleKeys.some((k) => x.includes(k)) || /\(pdf\)|\bpages? \d/.test(x);
    });

  const byLabel = new Map(labelled.map((d) => [d.label.toLowerCase(), d]));
  const topics = parsed.phases
    .flatMap((phase, phaseIndex) => phase.topics.map((t) => ({ ...t, phase: phaseIndex })))
    .slice(0, MAX_TOPICS)
    .map((t) => ({ ...t, resources: t.resources.filter((r) => !isAPdf(r)) }))
    .map((t) => {
      // With one PDF the label is implied; otherwise it must name a real one.
      const doc = byLabel.get((t.material ?? "").trim().toLowerCase()) ?? (labelled.length === 1 ? labelled[0] : undefined);
      // A "pdf" topic without a usable PDF and pages is really an external one.
      if (t.source === "pdf" && doc && t.page_start !== null) {
        const clamp = (n: number) => Math.min(Math.max(1, n), Math.max(1, doc.page_count));
        const a = clamp(t.page_start);
        const b = clamp(t.page_end ?? t.page_start);
        return { ...t, source: "pdf" as const, document_id: doc.id, page_start: Math.min(a, b), page_end: Math.max(a, b) };
      }
      return { ...t, source: "external" as const, document_id: null, page_start: null, page_end: null };
    });
  const dueDates = assignDueDates(
    topics.map((t) => t.est_minutes),
    startDate,
    deadline,
  );

  // Replace any existing plan for this session (topics cascade).
  await supabase.from("study_plans").delete().eq("session_id", sessionId);

  const { data: plan, error: planError } = await supabase
    .from("study_plans")
    .insert({
      user_id: userId,
      session_id: sessionId,
      goal,
      goal_title: parsed.goal_title,
      goal_summary: parsed.goal_summary,
      materials,
      phases: parsed.phases.map((p) => ({ title: p.title, description: p.description })),
      level,
      start_date: startDate,
      deadline,
      minutes_per_day: minutesPerDay,
      overview: parsed.overview,
    })
    .select("id")
    .single();
  if (planError || !plan) throw new Error(planError?.message ?? "Could not save plan");

  const { error: topicsError } = await supabase.from("plan_topics").insert(
    topics.map((t, i) => ({
      plan_id: plan.id,
      user_id: userId,
      position: i,
      phase: t.phase,
      source: t.source,
      document_id: t.document_id,
      title: t.title,
      objectives: t.objectives,
      key_concepts: t.key_concepts,
      resources: t.resources,
      page_start: t.page_start,
      page_end: t.page_end,
      est_minutes: t.est_minutes,
      due_date: dueDates[i],
    })),
  );
  if (topicsError) throw new Error(topicsError.message);

  return plan.id as string;
}
