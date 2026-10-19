import { after } from "next/server";
import { z } from "zod";
import { groq, MODELS } from "@/lib/groq";
import { currentTopic, scheduleStatus, toISODate } from "@/lib/schedule";
import { createClient } from "@/lib/supabase/server";
import { loadTutorState, retrieveContext } from "@/lib/tutor/context";
import { displayUserTurn } from "@/lib/tutor/format";
import { updateLearnerMemory } from "@/lib/tutor/memory";
import { buildSystemPrompt, buildUserInstruction } from "@/lib/tutor/prompts";

export const maxDuration = 60;

const Body = z.object({
  sessionId: z.uuid(),
  documentId: z.uuid().nullable().optional(), // the PDF currently open
  action: z.enum(["chat", "ask", "summarize", "context", "simplify", "figure", "quiz", "teach"]),
  message: z.string().max(4000).optional(),
  page: z.number().int().positive().nullable().optional(),
  topicId: z.uuid().nullable().optional(),
  selection: z
    .object({ text: z.string().min(1).max(8000), page: z.number().int().positive(), documentId: z.uuid() })
    .nullable()
    .optional(),
  highlightId: z.uuid().nullable().optional(),
});

const HISTORY_TURNS = 8;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid request", { status: 400 });
  const { sessionId, documentId = null, action, message, page = null, topicId, selection = null, highlightId = null } = parsed.data;
  if (action === "chat" && !message?.trim() && !selection) return new Response("Empty message", { status: 400 });

  const state = await loadTutorState(supabase, sessionId);
  if (!state.session) return new Response("Not found", { status: 404 });
  const { materials } = state;
  const labelOf = (id: string | null | undefined) => materials.find((m) => m.id === id)?.label;

  const topic = state.topics.find((t) => t.id === topicId) ?? currentTopic(state.topics);
  const schedule = state.plan ? scheduleStatus(state.plan, state.topics, toISODate(new Date())) : null;

  let figure: { docId: string; page: number; label?: string; description: string } | null = null;
  if (highlightId) {
    const { data } = await supabase
      .from("highlights")
      .select("document_id, page_number, vlm_description")
      .eq("id", highlightId)
      .maybeSingle();
    if (data?.vlm_description) {
      figure = { docId: data.document_id, page: data.page_number, label: labelOf(data.document_id), description: data.vlm_description };
    }
  }

  const sel = selection && labelOf(selection.documentId) ? { ...selection, label: labelOf(selection.documentId) } : null;
  const current = documentId && page && labelOf(documentId) ? { docId: documentId, page, label: labelOf(documentId)! } : null;
  const focus = sel ? { docId: sel.documentId, page: sel.page } : figure ? { docId: figure.docId, page: figure.page } : null;

  const query = [
    message,
    sel?.text,
    figure?.description?.slice(0, 300),
    action === "teach" || action === "quiz" ? `${topic?.title ?? ""} ${topic?.key_concepts.join(" ") ?? ""}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const [{ excerpts, figures }, history] = await Promise.all([
    retrieveContext(supabase, { sessionId, materials, action, query, current, focus, topic, highlightId }),
    supabase
      .from("messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_TURNS),
  ]);

  const system = buildSystemPrompt({
    sessionTitle: state.session.title,
    materials,
    plan: state.plan,
    topics: state.topics,
    topic,
    schedule,
    memory: state.memory,
    excerpts,
    figures,
    current: current ? { label: current.label, page: current.page } : null,
  });
  const instruction = buildUserInstruction({ action, message, materials, selection: sel, topic, figure });
  const multi = materials.length > 1;
  const display = displayUserTurn({
    action,
    message,
    selection: sel,
    figurePage: figure?.page,
    docLabel: multi ? (sel?.label ?? figure?.label) : undefined,
    topicTitle: topic?.title,
  });

  const pastTurns = ((history.data ?? []) as { role: "user" | "assistant"; content: string }[])
    .reverse()
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1800) }));

  let completion;
  try {
    completion = await groq.chat.completions.create({
      model: MODELS.chat,
      messages: [{ role: "system", content: system }, ...pastTurns, { role: "user", content: instruction }],
      stream: true,
      temperature: 0.5,
      max_completion_tokens: 2500,
      reasoning_effort: "medium",
      include_reasoning: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Model request failed";
    return new Response(msg, { status: 502 });
  }

  let resolveDone: (text: string) => void;
  const done = new Promise<string>((r) => (resolveDone = r));
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let reply = "";
      try {
        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            reply += delta;
            controller.enqueue(encoder.encode(delta));
          }
        }
      } catch {
        const note = "\n\n_(The answer was cut off — please try again.)_";
        reply += note;
        controller.enqueue(encoder.encode(note));
      } finally {
        controller.close();
        resolveDone(reply);
      }
    },
  });

  // Persist the exchange and update the learner model once the stream ends.
  after(async () => {
    const reply = await done;
    if (!reply.trim()) return;
    const base = {
      user_id: userId,
      session_id: sessionId,
      document_id: focus?.docId ?? current?.docId ?? null,
      topic_id: topic?.id ?? null,
      highlight_id: highlightId,
      action,
      page_number: focus?.page ?? current?.page ?? null,
    };
    await supabase.from("messages").insert({ ...base, role: "user", content: display });
    await supabase.from("messages").insert({ ...base, role: "assistant", content: reply });

    if (topic?.status === "not_started") {
      await supabase.from("plan_topics").update({ status: "in_progress" }).eq("id", topic.id);
    }
    try {
      await updateLearnerMemory(supabase, {
        userId,
        sessionId,
        memory: state.memory,
        topic,
        userTurn: instruction,
        assistantReply: reply,
      });
    } catch (err) {
      console.error("memory update failed", err);
    }
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
