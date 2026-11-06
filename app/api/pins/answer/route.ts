import { after } from "next/server";
import { z } from "zod";
import { groqErrorResponse, resolveGroq } from "@/lib/ai-access";
import { MODELS, modelBudget, stripReasoning } from "@/lib/groq";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

const Body = z.object({ pinId: z.uuid() });

// The first person to ask pays. A pin that already has an answer is returned
// as it is, with no model call, so the next classmate doesn't pay again.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const loaded = await supabase.rpc("pin_to_answer", { p_id: parsed.data.pinId });
  if (loaded.error) {
    const missing = /pin_to_answer|schema cache|Could not find the function/i.test(loaded.error.message);
    return Response.json({ error: missing ? "Pins need migration 0028 to be run." : loaded.error.message }, { status: missing ? 500 : 400 });
  }
  const pin = loaded.data as { session_id: string; document_id: string; page_number: number; quote: string; question: string; answer: string | null } | null;
  if (!pin?.session_id) return Response.json({ error: "That pin isn't yours." }, { status: 404 });
  if (pin.answer?.trim()) return Response.json({ answer: pin.answer });

  const { data: pageRow } = await supabase.from("document_pages").select("content").eq("document_id", pin.document_id).eq("page_number", pin.page_number).maybeSingle();
  const pageText = ((pageRow?.content as string | undefined) ?? "").replace(/\s+/g, " ").trim().slice(0, 3500);
  const quote = (pin.quote ?? "").trim().slice(0, 500);
  if (pageText.length < 40 && quote.length < 20) {
    return Response.json({ error: "That page doesn't have text to answer from yet." }, { status: 422 });
  }

  const access = await resolveGroq(supabase, userId, pin.session_id, "chat");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  try {
    const res = await access.groq.chat.completions.create({
      model: MODELS.chat,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: `Answer the student's question using only the page below. If the page doesn't say, say you can't tell from this page. Under 120 words. No preamble.

PAGE:
${pageText || "(no page text)"}

PASSAGE:
${quote || "(none)"}

QUESTION:
${pin.question?.trim() || "What is the point of this passage?"}`,
        },
      ],
      ...modelBudget(MODELS.chat, 700),
    });
    const answer = stripReasoning(res.choices[0]?.message?.content ?? "").trim().slice(0, 2000);
    if (!answer) return Response.json({ error: "Couldn't answer from that page. Try again." }, { status: 502 });
    const saved = await supabase.rpc("set_pin_answer", { p_id: parsed.data.pinId, p_answer: answer });
    if (saved.error || typeof saved.data !== "string") return Response.json({ error: "Couldn't save the answer." }, { status: 500 });
    return Response.json({ answer: saved.data });
  } catch (err) {
    return groqErrorResponse(err, "Couldn't answer from that page. Try again.");
  }
}
