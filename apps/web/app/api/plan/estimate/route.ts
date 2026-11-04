import { after } from "next/server";
import { z } from "zod";
import { hasOwnAccess, resolveAi } from "@/lib/ai-access";
import { MODELS, modelBudget, parseJsonObject } from "@confu/ai/groq";
import { logError } from "@/lib/log";
import { materialsEstimate, type PaceEstimate } from "@/lib/pace";
import { isPaperDoc } from "@confu/core/paper";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

const Body = z.object({
  sessionId: z.uuid(),
  goal: z.string().trim().min(5).max(8000),
  level: z.enum(["beginner", "intermediate", "advanced"]),
});
const Refined = z.object({ hours: z.coerce.number(), low: z.coerce.number(), high: z.coerce.number(), why: z.string().catch("") });

// How many hours a goal needs, for the pace calibrator: from the session's
// PDFs and what the goal lists, then (on the student's own AI, or the owner's, so a
// free-trial prompt isn't spent on it) refined by the AI for the goal's scope.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { sessionId, goal, level } = parsed.data;

  // Every PDF with a page count, including ones still being indexed.
  const [{ data: docs }, { data: reviews }] = await Promise.all([
    supabase.from("documents").select("id, page_count, meta").eq("session_id", sessionId).neq("status", "failed"),
    supabase.from("paper_reviews").select("document_id").eq("session_id", sessionId),
  ]);
  const reviewed = Object.fromEntries((reviews ?? []).map((r) => [r.document_id as string, true]));
  const rows = (docs ?? []) as { id: string; page_count: number; meta: Record<string, unknown> | null }[];
  const papers = rows.filter((d) => isPaperDoc(d, reviewed));
  const base = materialsEstimate({ books: rows.filter((d) => !papers.includes(d) && d.page_count > 0).map((d) => d.page_count), paperPdfs: papers.length, goal, level });

  if (!(await hasOwnAccess(supabase, userId, sessionId))) return Response.json(base);
  const access = await resolveAi(supabase, userId, sessionId, "plan");
  if ("error" in access) return Response.json(base);
  after(() => access.meter.flush());

  try {
    const res = await access.groq.chat.completions.create({
      model: MODELS.fast,
      messages: [{ role: "user", content: estimatePrompt(goal, level, base) }],
      response_format: { type: "json_object" },
      temperature: 0,
      ...modelBudget(MODELS.fast, 500),
    });
    const r = Refined.parse(parseJsonObject(res.choices[0]?.message?.content ?? ""));
    const hours = Math.round(Math.min(1000, Math.max(1, r.hours)));
    const estimate: PaceEstimate = {
      ...base,
      hours,
      low: Math.round(Math.min(hours, Math.max(1, r.low))),
      high: Math.round(Math.max(hours, Math.min(1500, r.high))),
      why: r.why.trim().slice(0, 200),
      source: "ai",
    };
    return Response.json(estimate);
  } catch (err) {
    logError("pace estimate failed", err);
    return Response.json(base);
  }
}

function estimatePrompt(goal: string, level: string, base: PaceEstimate) {
  return `A student will study toward this goal on their own:
"""
${goal.slice(0, 6000)}
"""
Their background: ${level}.
Their materials, with rough focused-study times: ${base.parts.length ? base.parts.map((p) => `${p.label}: ~${p.hours} h`).join("; ") : "none listed yet"}.

Estimate the total focused study hours they need to reach the goal, including practice and review. Start from the materials; if the goal needs ground they don't cover (or no materials are listed), add the time it takes to learn it from good outside resources. Be realistic, not optimistic.

Return ONLY JSON: {"hours": number, "low": number, "high": number, "why": "one sentence, under 20 words, on what drives the estimate"}`;
}
