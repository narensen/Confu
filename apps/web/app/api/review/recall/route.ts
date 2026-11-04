import { after } from "next/server";
import { z } from "zod";
import { aiErrorResponse, resolveAi } from "@/lib/ai-access";
import { MODELS, modelBudget, parseJsonObject } from "@confu/ai/groq";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

const Body = z.object({ topicId: z.uuid() });
const Questions = z.object({
  questions: z
    .array(z.object({ q: z.string().trim().min(5), answer: z.string().trim().catch("") }))
    .min(1)
    .max(5),
});
const MAX_PAGES = 8;

// A quick recall check for a topic just finished: three questions to answer
// from memory, each with a short model answer to compare against. Built from
// the topic's pages when it has them, else its objectives. The student marks
// themselves; nothing here teaches.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const { data: topic } = await supabase
    .from("plan_topics")
    .select("title, objectives, key_concepts, document_id, page_start, page_end, study_plans(session_id, level)")
    .eq("id", parsed.data.topicId)
    .maybeSingle<{
      title: string;
      objectives: string[];
      key_concepts: string[];
      document_id: string | null;
      page_start: number | null;
      page_end: number | null;
      study_plans: { session_id: string; level: string } | null;
    }>();
  if (!topic?.study_plans) return Response.json({ error: "Topic not found" }, { status: 404 });

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
    pages = ((data ?? []) as { page_number: number; content: string }[])
      .map((p) => `[p. ${p.page_number}]\n${p.content}`)
      .join("\n\n")
      .slice(0, 9000);
  }

  const access = await resolveAi(supabase, userId, topic.study_plans.session_id, "quiz");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  try {
    const res = await access.groq.chat.completions.create({
      model: MODELS.chat,
      messages: [{ role: "user", content: recallPrompt(topic, topic.study_plans.level, pages) }],
      response_format: { type: "json_object" },
      temperature: 0.3,
      ...modelBudget(MODELS.chat, 1200),
    });
    const { questions } = Questions.parse(parseJsonObject(res.choices[0]?.message?.content ?? ""));
    return Response.json({ questions: questions.slice(0, 3) });
  } catch (err) {
    if ((err as { status?: number })?.status) return aiErrorResponse(err, "Couldn't write the questions. Try again.");
    logError("recall check failed", err);
    return Response.json({ error: "Couldn't write the questions. Try again." }, { status: 502 });
  }
}

function recallPrompt(t: { title: string; objectives: string[]; key_concepts: string[] }, level: string, pages: string) {
  return `A ${level} student just finished studying the topic "${t.title}".
${t.objectives.length ? `What they should be able to do:\n${t.objectives.map((o) => `- ${o}`).join("\n")}\n` : ""}${t.key_concepts.length ? `Key ideas: ${t.key_concepts.join(", ")}\n` : ""}${pages ? `\nThe pages they read:\n"""\n${pages}\n"""\n` : ""}
Write 3 short recall questions they should be able to answer from memory, without looking. Test understanding, not trivia: ask them to explain why, describe how, predict what happens if, or apply an idea${pages ? ", using what's on these pages" : ""}. Each should be answerable in one to three sentences. For each, give a model answer in at most 50 words.

Return ONLY JSON: {"questions": [{"q": "", "answer": ""}]}`;
}
