import { after } from "next/server";
import { z } from "zod";
import { aiErrorResponse, resolveAi } from "@/lib/ai-access";
import { cueFor, type ReviewItem } from "@/lib/review";
import { createClient } from "@/lib/supabase/server";
import { gradeShortAnswer } from "@/lib/tutor/exam-ai";

export const maxDuration = 30;

const Body = z.object({
  itemId: z.uuid(),
  answer: z.string().max(4000),
});

// Optional: the tutor marks a review answer. The student has already answered
// on their own; this only checks it against the item and their PDF.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  if (!parsed.data.answer.trim()) return Response.json({ score: 0, feedback: "Write your answer first, then check it." });

  // Row-level security: only the student's own items are visible.
  const { data: item } = await supabase
    .from("review_items")
    .select("session_id, document_id, page_number, source, prompt, question, answer")
    .eq("id", parsed.data.itemId)
    .maybeSingle<Pick<ReviewItem, "session_id" | "document_id" | "page_number" | "source" | "prompt" | "question" | "answer">>();
  if (!item) return Response.json({ error: "Review item not found" }, { status: 404 });

  // Ground the check in the page it came from, when there is one.
  let pageText = "";
  if (item.document_id && item.page_number) {
    const { data } = await supabase
      .from("document_pages")
      .select("content")
      .eq("document_id", item.document_id)
      .eq("page_number", item.page_number)
      .maybeSingle<{ content: string }>();
    pageText = (data?.content ?? "").slice(0, 3000);
  }

  const cue = cueFor(item);
  const question = [cue.quote ? `"${cue.quote}"` : "", cue.question].filter(Boolean).join("\n");
  const expected = [
    item.source === "highlight" ? `The full passage: "${item.prompt}"` : "",
    item.source === "misconception" ? `The student once believed this, which is wrong: "${item.prompt}". A full-credit answer states the correct idea and why the belief is wrong.` : "",
    item.answer ? `${item.source === "asked" ? "The tutor's earlier explanation" : "Key points"}:\n${item.answer}` : "",
    pageText ? `From the student's PDF (p. ${item.page_number}):\n${pageText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 6000);

  const access = await resolveAi(supabase, userId, item.session_id, "grade");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  try {
    return Response.json(await gradeShortAnswer(access.groq, { question, expected: expected || cue.question, answer: parsed.data.answer }));
  } catch (err) {
    return aiErrorResponse(err, "Couldn't check that answer. Try again.");
  }
}
