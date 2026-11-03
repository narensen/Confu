import { after } from "next/server";
import { z } from "zod";
import { aiErrorResponse, resolveAi } from "@/lib/ai-access";
import { MODELS, modelBudget, stripReasoning } from "@/lib/groq";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

const Body = z.object({ topicId: z.uuid() });
const MAX_PAGES = 10;

// An audio overview of a topic: a two-minute spoken preview to listen to
// before reading (on a walk, on the bus). It orients rather than teaches:
// what the topic is about, why it matters for the goal, what to watch for.
// The browser reads it aloud; this only writes the script.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const { data: topic } = await supabase
    .from("plan_topics")
    .select("title, objectives, key_concepts, source, document_id, page_start, page_end, study_plans(session_id, level, goal_title, goal_summary)")
    .eq("id", parsed.data.topicId)
    .maybeSingle<{
      title: string;
      objectives: string[];
      key_concepts: string[];
      source: string;
      document_id: string | null;
      page_start: number | null;
      page_end: number | null;
      study_plans: { session_id: string; level: string; goal_title: string | null; goal_summary: string | null } | null;
    }>();
  const plan = topic?.study_plans;
  if (!topic || !plan) return Response.json({ error: "Topic not found" }, { status: 404 });

  let pages = "";
  if (topic.document_id && topic.page_start) {
    const last = Math.min(topic.page_end ?? topic.page_start, topic.page_start + MAX_PAGES - 1);
    const { data } = await supabase
      .from("document_pages")
      .select("page_number, content")
      .eq("document_id", topic.document_id)
      .gte("page_number", topic.page_start)
      .lte("page_number", last)
      .order("page_number");
    pages = ((data ?? []) as { page_number: number; content: string }[]).map((p) => p.content).join("\n\n").slice(0, 8000);
  }

  const access = await resolveAi(supabase, userId, plan.session_id, "chat");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  const where = topic.page_start ? `pages ${topic.page_start}${topic.page_end && topic.page_end !== topic.page_start ? ` to ${topic.page_end}` : ""}` : "this topic";
  try {
    const res = await access.groq.chat.completions.create({
      model: MODELS.chat,
      messages: [
        {
          role: "user",
          content: `Write a spoken preview of 230 to 280 words (two minutes read aloud; no longer), for a ${plan.level} student about to study "${topic.title}"${plan.goal_title ? ` as part of their goal: ${plan.goal_title}` : ""}.
${topic.objectives.length ? `By the end they should be able to:\n${topic.objectives.map((o) => `- ${o}`).join("\n")}\n` : ""}${topic.key_concepts.length ? `Key ideas: ${topic.key_concepts.join(", ")}\n` : ""}${pages ? `\nWhat they're about to read (${where}):\n"""\n${pages}\n"""\n` : ""}
Orient them, don't teach it all: say what the topic is about and why it matters for their goal, name the few ideas to watch for and how they connect, and end with one question to keep in mind while reading ${pages ? where : "about it"}.

It will be read aloud by a speech engine, so write plain flowing sentences: no headings, lists, Markdown, symbols or equations (say "x squared", "the sum of"). Speak to them directly ("you"). Return only the script.`,
        },
      ],
      temperature: 0.5,
      ...modelBudget(MODELS.chat, 1100),
    });
    const script = stripReasoning(res.choices[0]?.message?.content ?? "").replace(/[#*_`>]/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (script.length < 80) throw new Error("empty script");
    return Response.json({ script: script.slice(0, 4000) });
  } catch (err) {
    if ((err as { status?: number })?.status) return aiErrorResponse(err, "Couldn't write the overview. Try again.");
    logError("topic overview failed", err);
    return Response.json({ error: "Couldn't write the overview. Try again." }, { status: 502 });
  }
}
