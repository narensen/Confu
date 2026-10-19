import { after } from "next/server";
import { z } from "zod";
import { groqErrorResponse, resolveGroq } from "@/lib/ai-access";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
import { MODELS } from "@/lib/groq";
import { currentTopic, scheduleStatus, toISODate } from "@/lib/schedule";
import { createClient } from "@/lib/supabase/server";
import { loadTutorState, retrieveContext } from "@/lib/tutor/context";
import { displayUserTurn } from "@/lib/tutor/format";
import { updateLearnerMemory } from "@/lib/tutor/memory";
import type { PageRef } from "@/lib/tutor/context";
import { buildPaperInstruction, buildPaperSystemPrompt } from "@/lib/tutor/paper-prompts";
import { buildExamSystemPrompt } from "@/lib/tutor/exam-prompts";
import { daysUntil, topicStats, type Attempt } from "@/lib/exam";
import { PAPER_TOOLS, runPaperTool, type Source } from "@/lib/tutor/tools";
import { buildSystemPrompt, buildUserInstruction } from "@/lib/tutor/prompts";
import { TUTOR_ACTIONS } from "@/lib/types";

export const maxDuration = 60;

const Body = z.object({
  sessionId: z.uuid(),
  documentId: z.uuid().nullable().optional(), // the PDF currently open
  action: z.enum(TUTOR_ACTIONS),
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

  const access = await resolveGroq(supabase, userId, sessionId, "chat");
  if ("error" in access) return access.error;
  const { groq } = access;

  const state = await loadTutorState(supabase, sessionId);
  if (!state.session) return new Response("Not found", { status: 404 });
  const { materials } = state;
  const labelOf = (id: string | null | undefined) => materials.find((m) => m.id === id)?.label;

  const isPaper = state.session.kind === "paper";
  const isExam = state.session.kind === "exam";
  // Paper and exam sessions have no topic plan.
  const topic = isPaper || isExam ? null : (state.topics.find((t) => t.id === topicId) ?? currentTopic(state.topics));
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

  const paperId = sel?.documentId ?? figure?.docId ?? documentId;
  const paper = isPaper ? materials.find((m) => m.id === paperId) : undefined;
  const review = paper ? state.reviews.get(paper.id) : undefined;

  // Each pass reads different parts of the paper: pass 1 the abstract,
  // introduction and conclusion; later passes the setup plus whatever matches.
  const extraPages: PageRef[] = [];
  if (paper && action.startsWith("pass")) {
    const n = paper.pageCount;
    const pages = action === "pass1_check" ? [1, 2, n - 1, n] : action.startsWith("pass2") ? [1] : [1, 2];
    for (const p of new Set(pages.filter((x) => x >= 1 && x <= n))) {
      extraPages.push({ docId: paper.id, page: p, reason: p >= n - 1 && n > 2 ? "end of the paper (conclusion)" : "start of the paper", max: 2200 });
    }
  }

  const query = [
    message,
    sel?.text,
    figure?.description?.slice(0, 300),
    action === "teach" || action === "quiz" ? `${topic?.title ?? ""} ${topic?.key_concepts.join(" ") ?? ""}` : "",
    paper && action.startsWith("pass") ? `${paper.title} ${action === "pass2_figures" ? "figure table results experiments" : action.startsWith("pass3") ? "method assumption derivation experiment limitation" : ""}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const [{ excerpts, figures }, history] = await Promise.all([
    retrieveContext(supabase, { sessionId, materials, action, query, current, focus, topic, highlightId, extraPages }),
    supabase
      .from("messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_TURNS),
  ]);

  const examTopics = isExam
    ? topicStats(
        ((await supabase.from("exam_attempts").select("topic, score, created_at").eq("session_id", sessionId).order("created_at", { ascending: false }).limit(300))
          .data ?? []) as Attempt[],
      )
    : [];

  const system = isExam
    ? buildExamSystemPrompt({
        sessionTitle: state.session.title,
        materials,
        daysLeft: daysUntil(state.session.exam_date, toISODate(new Date())),
        topics: examTopics,
        memory: state.memory,
        excerpts,
        figures,
        current: current ? { label: current.label, page: current.page } : null,
      })
    : isPaper
    ? buildPaperSystemPrompt({
        sessionTitle: state.session.title,
        researchGoal: state.session.research_goal,
        materials,
        reviews: state.reviews,
        focusDocId: paper?.id ?? null,
        memory: state.memory,
        excerpts,
        figures,
        current: current ? { label: current.label, page: current.page } : null,
      })
    : buildSystemPrompt({
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
  const instruction =
    (isPaper && buildPaperInstruction(action, paper, review, message)) ||
    buildUserInstruction({ action, message, materials, selection: sel, topic, figure });
  const multi = materials.length > 1;
  const display = displayUserTurn({
    action,
    message,
    selection: sel,
    figurePage: figure?.page,
    docLabel: multi ? (sel?.label ?? figure?.label) : undefined,
    topicTitle: isPaper ? paper?.title : topic?.title,
  });

  const pastTurns = ((history.data ?? []) as { role: "user" | "assistant"; content: string }[])
    .reverse()
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1800) }));

  // Paper sessions get tools for finding papers.
  const tools = isPaper ? PAPER_TOOLS : undefined;
  const MAX_TOOL_ROUNDS = 2;
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    ...pastTurns,
    { role: "user", content: instruction },
  ];
  const askModel = (round: number) =>
    groq.chat.completions.create({
      model: MODELS.chat,
      messages,
      stream: true,
      temperature: 0.5,
      max_completion_tokens: 2500,
      reasoning_effort: "medium",
      include_reasoning: false,
      // On the last round, force an answer from what's been gathered.
      ...(tools ? { tools, tool_choice: round < MAX_TOOL_ROUNDS ? ("auto" as const) : ("none" as const) } : {}),
    });

  let firstRound;
  try {
    firstRound = await askModel(0);
  } catch (err) {
    after(() => access.meter.flush()); // still record the limits Groq reported
    return groqErrorResponse(err, "The tutor couldn't answer right now. Try again.");
  }

  let resolveDone: (text: string) => void;
  const done = new Promise<string>((r) => (resolveDone = r));
  const encoder = new TextEncoder();

  // Text streams as-is. Status updates (e.g. "Searching papers…") are sent as
  // \u001e{json}\n records, which the client shows but doesn't keep.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let reply = "";
      const sources: Source[] = [];
      const write = (text: string) => {
        if (!text) return;
        reply += text;
        controller.enqueue(encoder.encode(text));
      };
      const status = (label: string) => controller.enqueue(encoder.encode(`\u001e${JSON.stringify({ type: "status", label })}\n`));

      try {
        let completion = firstRound;
        for (let round = 0; ; round++) {
          const calls: { id: string; name: string; args: string }[] = [];
          let roundText = "";
          for await (const chunk of completion) {
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
              roundText += delta.content;
              write(delta.content);
            }
            for (const tc of delta?.tool_calls ?? []) {
              const call = (calls[tc.index] ??= { id: "", name: "", args: "" });
              if (tc.id) call.id = tc.id;
              if (tc.function?.name) call.name += tc.function.name;
              if (tc.function?.arguments) call.args += tc.function.arguments;
            }
          }
          const pending = calls.filter((c) => c.name);
          if (!pending.length || !tools) break;

          messages.push({
            role: "assistant",
            content: roundText || null,
            tool_calls: pending.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args } })),
          });
          for (const call of pending) {
            const run = await runPaperTool(call.name, call.args);
            status(run.label);
            for (const src of run.sources) if (!sources.some((x) => x.url === src.url)) sources.push(src);
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(run.result).slice(0, 8000) });
          }
          status("Reading the results…");
          completion = await askModel(round + 1);
        }
        if (sources.length) {
          write(`\n\n**Sources**\n${sources.slice(0, 10).map((x) => `- [${x.title.replace(/[[\]]/g, "")}](${x.url})`).join("\n")}`);
        }
      } catch {
        write("\n\n_(The answer was cut off — please try again.)_");
      } finally {
        controller.close();
        resolveDone(reply);
      }
    },
  });

  // Persist the exchange and update the learner model once the stream ends.
  after(async () => {
    const reply = await done;
    if (!reply.trim()) return access.meter.flush();
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
      await updateLearnerMemory(supabase, groq, {
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
    await access.meter.flush();
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
