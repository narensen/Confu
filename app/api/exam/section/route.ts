import { after } from "next/server";
import { z } from "zod";
import { groqErrorResponse, resolveGroq } from "@/lib/ai-access";
import { createClient } from "@/lib/supabase/server";
import { generateSectionPaper, publicSectionQuestion, type SectionQuestion } from "@/lib/tutor/exam-ai";

export const maxDuration = 60;

const Line = z.string().trim().min(1).max(80);
const Body = z.object({
  sessionId: z.uuid(),
  lines: z.array(Line).min(1).max(8),
});

const Stored = z.object({
  id: z.string().min(1),
  kind: z.literal("mcq"),
  question: z.string().min(1),
  options: z.array(z.string().min(1)).length(4),
  correct: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(1),
  topic: z.string().trim().min(1).max(80),
  documentId: z.string().nullable(),
  sourceTitle: z.string().trim().min(1),
  page: z.number().int().min(1).max(5000),
});

// The rep generates the section paper once. Classmates never call this.
// The response is stems only. The key is stored by the RPC.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const { sessionId, lines } = parsed.data;

  const saved = await supabase.rpc("save_section_lines", { p_session: sessionId, p_lines: lines });
  if (saved.error) return Response.json({ error: saved.error.message }, { status: 400 });

  const access = await resolveGroq(supabase, userId, sessionId, "quiz");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  let made: SectionQuestion[];
  try {
    made = await generateSectionPaper(supabase, access.groq, { sessionId, lines });
  } catch (err) {
    if ((err as { status?: number })?.status) return groqErrorResponse(err, "Couldn't make questions. Try again.");
    const message = err instanceof Error ? err.message : "Couldn't make questions this time. Try again.";
    return Response.json({ error: message }, { status: 502 });
  }

  const checked = z.array(Stored).length(10).safeParse(made);
  if (!checked.success) return Response.json({ error: "Couldn't make questions this time. Try again." }, { status: 502 });

  const stored = await supabase.rpc("store_section_paper", { p_session: sessionId, p_questions: checked.data });
  if (stored.error) return Response.json({ error: stored.error.message }, { status: 400 });
  return Response.json({ questions: checked.data.map((q) => publicSectionQuestion(q as SectionQuestion)) });
}
