import { z } from "zod";
import { resolveGroq } from "@/lib/ai-access";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { keepCited, retrievedKeys } from "@/lib/tutor/keep-cited";
import { updateLearnerMemory } from "@/lib/tutor/memory";
import { EMPTY_MEMORY, TUTOR_ACTIONS, type LearnerMemory, type PlanTopic } from "@/lib/types";

const ASKED_ACTIONS = new Set<string>(["ask", "summarize", "context", "simplify"]);

const Body = z.object({
  sessionId: z.uuid(),
  action: z.enum(TUTOR_ACTIONS),
  display: z.string().min(1).max(8000),
  reply: z.string().min(1).max(40_000),
  documentId: z.uuid().nullable().optional(),
  page: z.number().int().positive().nullable().optional(),
  topicId: z.uuid().nullable().optional(),
  highlightId: z.uuid().nullable().optional(),
  citeMode: z.boolean().optional(),
  multi: z.boolean().optional(),
  retrieved: z.array(z.object({ label: z.string(), page: z.number().int().positive() })).max(80).optional(),
  selection: z
    .object({ text: z.string().min(1).max(8000), page: z.number().int().positive(), documentId: z.uuid() })
    .nullable()
    .optional(),
});

// The lesson was written by a harness on the student's computer. Store it
// the same way a Confu answer is stored, and note what they learned when a
// Groq key is available to write that note.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid request", { status: 400 });
  const { sessionId, action, display, documentId = null, page = null, topicId = null, highlightId = null, citeMode = false, multi = false, retrieved = [], selection = null } = parsed.data;

  const { data: session } = await supabase.from("study_sessions").select("id").eq("id", sessionId).maybeSingle();
  if (!session) return new Response("Not found", { status: 404 });

  let reply = parsed.data.reply.trim();
  if (citeMode) {
    const filtered = keepCited(reply, retrievedKeys(multi, retrieved), multi).trim();
    reply = filtered || reply;
  }

  const base = {
    user_id: userId,
    session_id: sessionId,
    document_id: selection?.documentId ?? documentId,
    topic_id: topicId,
    highlight_id: highlightId,
    action,
    page_number: selection?.page ?? page,
  };
  const userRow = await supabase.from("messages").insert({ ...base, role: "user", content: display });
  if (userRow.error) return Response.json({ error: "Couldn't save that lesson." }, { status: 500 });
  const answerRow = await supabase.from("messages").insert({ ...base, role: "assistant", content: reply });
  if (answerRow.error) return Response.json({ error: "Couldn't save that lesson." }, { status: 500 });

  if (selection && ASKED_ACTIONS.has(action) && selection.text.trim().length >= 25) {
    const passage = selection.text.replace(/\s+/g, " ").trim();
    const { error } = await supabase.from("review_items").upsert(
      {
        user_id: userId,
        session_id: sessionId,
        document_id: selection.documentId,
        page_number: selection.page,
        source: "asked",
        source_key: `${selection.documentId}:${selection.page}:${passage.toLowerCase().slice(0, 400)}`,
        prompt: passage.slice(0, 1200),
        question: action === "ask" ? display.trim().slice(0, 1000) : "",
        answer: reply.split("\n\n**Sources**")[0].trim().slice(0, 4000),
      },
      { onConflict: "user_id,source,source_key", ignoreDuplicates: true },
    );
    if (error) logError("review item (asked) not saved", error);
  }

  const { data: topicRow } = topicId ? await supabase.from("plan_topics").select("*").eq("id", topicId).maybeSingle() : { data: null };
  if (topicRow?.status === "not_started") await supabase.from("plan_topics").update({ status: "in_progress" }).eq("id", topicId!);

  const access = await resolveGroq(supabase, userId, sessionId, "chat");
  if (!("error" in access)) {
    try {
      const { data: memory } = await supabase.from("learner_memory").select("*").eq("session_id", sessionId).maybeSingle();
      await updateLearnerMemory(supabase, access.groq, {
        userId,
        sessionId,
        memory: { ...EMPTY_MEMORY, ...(memory as Partial<LearnerMemory> | null) },
        topic: (topicRow as PlanTopic | null) ?? null,
        userTurn: display,
        passage: selection?.text,
        assistantReply: reply,
      });
    } catch (err) {
      logError("memory update failed", err);
    }
    await access.meter.flush();
  }

  return Response.json({ reply });
}
