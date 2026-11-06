import { after } from "next/server";
import { z } from "zod";
import { groqErrorResponse, resolveGroq } from "@/lib/ai-access";
import { MODELS, modelBudget, parseJsonObject } from "@/lib/groq";
import type { PackPlan, PackTopic } from "@/lib/packs";
import { createClient } from "@/lib/supabase/server";

const Item = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.string().trim().min(1).max(2000),
  kind: z.enum(["paper", "web", "youtube", "sample"]),
  license: z.enum(["cc", "open", "link"]),
});

const Create = z.object({
  title: z.string().trim().min(1).max(120),
  kind: z.enum(["study", "exam", "paper"]),
  items: z.array(Item).min(1).max(12),
});

const PlanBody = z.object({
  code: z.string().trim().regex(/^[a-z0-9]{4,10}$/),
  plan: z.literal(true),
});

const Topic = z.object({
  title: z.string().trim().min(1).max(160),
  objectives: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
  key_concepts: z.array(z.string().trim().max(80)).max(10).default([]),
  est_minutes: z.coerce.number().int().min(5).max(900).default(45),
});

const PlanJson = z.object({
  goal: z.string().trim().min(1).max(4000),
  goal_title: z.string().trim().min(1).max(120),
  goal_summary: z.string().trim().max(500).default(""),
  materials: z.string().trim().max(500).default(""),
  overview: z.string().trim().max(800).default(""),
  level: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
  days: z.coerce.number().int().min(1).max(120).default(14),
  minutes_per_day: z.coerce.number().int().min(10).max(240).default(40),
  phases: z.array(z.object({ title: z.string().trim().min(1).max(120), description: z.string().trim().max(400).default("") })).min(1).max(6),
  topics: z.array(Topic).min(1).max(24),
});

// Create a door card, or spend one plan call on titles and URLs the owner wrote.
// GET is the public page. It does not come through here and it does not call Groq.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => null);

  const plan = PlanBody.safeParse(body);
  if (plan.success) return writePlan(supabase, userId, plan.data.code);

  const created = Create.safeParse(body);
  if (!created.success) return Response.json({ error: created.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const { data, error } = await supabase.rpc("create_noticeboard", {
    p_title: created.data.title,
    p_kind: created.data.kind,
    p_items: created.data.items,
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ code: data });
}

async function writePlan(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, code: string) {
  const { data, error } = await supabase.rpc("get_noticeboard", { p_code: code });
  const card = data as { title?: string; kind?: string; items?: { title: string; url: string; kind: string; license: string }[] } | null;
  if (error || !card?.items?.length) return Response.json({ error: error?.message ?? "That card wasn't found." }, { status: 404 });

  const access = await resolveGroq(supabase, userId, null, "plan");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  const list = card.items.map((item, i) => `${i + 1}. ${item.title} (${item.kind}, ${item.license}) ${item.url}`).join("\n");
  try {
    const res = await access.groq.chat.completions.create({
      model: MODELS.chat,
      messages: [
        {
          role: "user",
          content: `Write a study plan from this reading list only. Do not add links that are not here. There are no page numbers yet.

TITLE: ${card.title}
KIND: ${card.kind}
LIST:
${list}

Return ONLY JSON: {"goal":"","goal_title":"","goal_summary":"","materials":"","overview":"","level":"beginner","days":14,"minutes_per_day":40,"phases":[{"title":"","description":""}],"topics":[{"title":"","objectives":[""],"key_concepts":[""],"est_minutes":40}]}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      ...modelBudget(MODELS.chat, 5200),
    });
    const parsed = PlanJson.safeParse(parseJsonObject(res.choices[0]?.message?.content ?? ""));
    if (!parsed.success) return Response.json({ error: "That plan didn't check out. Try again." }, { status: 502 });
    const v = parsed.data;
    const plan: PackPlan = {
      goal: v.goal,
      goal_title: v.goal_title,
      goal_summary: v.goal_summary,
      materials: v.materials,
      phases: v.phases,
      level: v.level,
      days: v.days,
      minutes_per_day: v.minutes_per_day,
      overview: v.overview,
    };
    const topics: PackTopic[] = v.topics.map((t, i) => ({
      phase: Math.min(v.phases.length - 1, Math.floor((i / v.topics.length) * v.phases.length)),
      title: t.title,
      objectives: t.objectives,
      key_concepts: t.key_concepts,
      resources: [],
      source: "external",
      doc: null,
      page_start: null,
      page_end: null,
      est_minutes: t.est_minutes,
      day: Math.min(v.days, Math.round(((i + 1) / v.topics.length) * v.days)),
    }));
    const saved = await supabase.rpc("set_noticeboard_plan", { p_code: code, p_plan: { plan, topics } });
    if (saved.error) return Response.json({ error: saved.error.message }, { status: 400 });
    return Response.json({ ok: true });
  } catch (err) {
    return groqErrorResponse(err, "Couldn't write a plan. Try again.");
  }
}
