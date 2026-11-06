import { after } from "next/server";
import { z } from "zod";
import { groqErrorResponse, resolveGroq } from "@/lib/ai-access";
import { createClient } from "@/lib/supabase/server";
import { gradeShortAnswer } from "@/lib/tutor/exam-ai";

export const maxDuration = 30;

const Body = z.object({
  sessionId: z.uuid(),
  question: z.string().min(1).max(2000),
  expected: z.string().min(1).max(2000),
  answer: z.string().max(4000),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  if (!parsed.data.answer.trim()) return Response.json({ score: 0, feedback: "No answer given." });

  const access = await resolveGroq(supabase, userId, parsed.data.sessionId, "grade");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  try {
    return Response.json(await gradeShortAnswer(access.groq, parsed.data));
  } catch (err) {
    return groqErrorResponse(err, "Couldn't mark that answer. Try again.");
  }
}
