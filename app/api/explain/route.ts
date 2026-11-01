import { after } from "next/server";
import { z } from "zod";
import { groqErrorResponse, resolveGroq } from "@/lib/ai-access";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { gradeShortAnswer } from "@/lib/tutor/exam-ai";

export const maxDuration = 30;

const Body = z.object({
  sessionId: z.uuid(),
  documentId: z.uuid(),
  page: z.number().int().min(1).max(5000),
  topic: z.string().max(200).optional(),
  answer: z.string().max(4000),
});

// Score an explanation against the page. The words and the audio are not
// stored: the row keeps the score and the gap only.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { sessionId, documentId, page, topic, answer } = parsed.data;

  const said = answer.replace(/\s+/g, " ").trim();
  if (!said) {
    await remember(supabase, { sessionId, documentId, page, topic, score: 0, gap: "Nothing was said." });
    return Response.json({ score: 0, gap: "Nothing was said." });
  }

  const { data: owned } = await supabase.from("documents").select("id").eq("id", documentId).eq("session_id", sessionId).maybeSingle();
  if (!owned) return Response.json({ error: "That page isn't in this session." }, { status: 404 });
  const { data: pageRow } = await supabase.from("document_pages").select("content").eq("document_id", documentId).eq("page_number", page).maybeSingle();
  const pageText = ((pageRow?.content as string | undefined) ?? "").replace(/\s+/g, " ").trim().slice(0, 2000);
  if (pageText.length < 40) return Response.json({ error: "This page doesn't have text to explain against yet." }, { status: 422 });

  const access = await resolveGroq(supabase, userId, sessionId, "grade");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  try {
    const graded = await gradeShortAnswer(access.groq, {
      question: `Explain this page in your own words${topic?.trim() ? `, focusing on ${topic.trim()}` : ""}.`,
      expected: pageText,
      answer: said.slice(0, 2000),
    });
    const gap = (graded.feedback || "Nothing to add.").slice(0, 500);
    await remember(supabase, { sessionId, documentId, page, topic, score: graded.score, gap });
    return Response.json({ score: graded.score, gap });
  } catch (err) {
    return groqErrorResponse(err, "Couldn't score that explanation. Try again.");
  }
}

async function remember(
  supabase: Awaited<ReturnType<typeof createClient>>,
  row: { sessionId: string; documentId: string; page: number; topic?: string; score: number; gap: string },
) {
  const { error } = await supabase.from("explain_backs").insert({
    session_id: row.sessionId,
    document_id: row.documentId,
    page_number: row.page,
    topic: (row.topic ?? "").slice(0, 200),
    score: row.score,
    gap: row.gap.slice(0, 500),
  });
  // The score still goes back to the student. The words never get here.
  if (error && error.code !== "42P01" && error.code !== "PGRST205") logError("explain-back save", error);
}
