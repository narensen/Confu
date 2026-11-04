import { after } from "next/server";
import { z } from "zod";
import { aiErrorResponse, resolveAi } from "@/lib/ai-access";
import { createClient } from "@/lib/supabase/server";
import { generateQuiz } from "@/lib/tutor/exam-ai";

export const maxDuration = 60;

const Body = z.object({
  sessionId: z.uuid(),
  documentId: z.uuid().nullable().optional(),
  topics: z.array(z.string().max(80)).max(8).default([]),
  count: z.number().int().min(1).max(10).default(5),
  mix: z.enum(["mixed", "mcq", "short"]).default("mixed"),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { sessionId, documentId = null, topics, count, mix } = parsed.data;

  const access = await resolveAi(supabase, userId, sessionId, "quiz");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  try {
    return Response.json({ questions: await generateQuiz(supabase, access.groq, { sessionId, documentId, topics, count, mix }) });
  } catch (err) {
    if ((err as { status?: number })?.status) return aiErrorResponse(err, "Couldn't make questions. Try again.");
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't make questions. Try again." }, { status: 502 });
  }
}
