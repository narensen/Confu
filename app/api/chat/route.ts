import { after } from "next/server";
import { z } from "zod";
import { groqErrorResponse, resolveGroq } from "@/lib/ai-access";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
import { MODELS, modelBudget, stripReasoning } from "@/lib/groq";
import { createReasoningFilter } from "@/lib/visible-text";
import { currentTopic, scheduleStatus, toISODate } from "@/lib/schedule";
import { createClient } from "@/lib/supabase/server";
import { loadTutorState, retrieveContext } from "@/lib/tutor/context";
import { citeLabelsForTurn, displayUserTurn } from "@/lib/tutor/format";
import { updateLearnerMemory } from "@/lib/tutor/memory";
import type { PageRef } from "@/lib/tutor/context";
import { buildPaperInstruction, buildPaperSystemPrompt } from "@/lib/tutor/paper-prompts";
import { buildExamSystemPrompt } from "@/lib/tutor/exam-prompts";
import { daysUntil, topicStats, type Attempt } from "@/lib/exam";
import { CITE_FALLBACK, keepCited, retrievedKeys } from "@/lib/tutor/keep-cited";
import { PAPER_TOOLS, runPaperTool, type Source } from "@/lib/tutor/tools";
import { buildSystemPrompt, buildUserInstruction } from "@/lib/tutor/prompts";
import { TUTOR_ACTIONS } from "@/lib/types";
import { emptyReview } from "@/lib/paper";
import { logError } from "@/lib/log";

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
  // Files this question may cite. Absent means the whole session, as before.
  documentIds: z.array(z.uuid()).max(60).optional(),
});

const HISTORY_TURNS = 8;

// Text actions on a selected passage that send it to spaced review.
const ASKED_ACTIONS = new Set<string>(["ask", "summarize", "context", "simplify"]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid request", { status: 400 });
  const { sessionId, documentId = null, action, message, page = null, topicId, selection = null, highlightId = null, documentIds } = parsed.data;
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
  const citeMode = state.citeMode;
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

  // Chosen files, in session order. A highlighted passage, a captured figure,
  // and the topic being taught stay in even if that chip was off.
  const known = new Set(materials.map((m) => m.id));
  let scope: string[] | null = null;
  if (documentIds?.length) {
    const picked = new Set(documentIds.filter((id) => known.has(id)));
    if (sel && known.has(sel.documentId)) picked.add(sel.documentId);
    if (figure && known.has(figure.docId)) picked.add(figure.docId);
    if (topic?.document_id && known.has(topic.document_id) && (action === "teach" || action === "quiz" || action === "diagram")) {
      picked.add(topic.document_id);
    }
    const ordered = materials.map((m) => m.id).filter((id) => picked.has(id));
    if (ordered.length) scope = ordered;
  }

  const paperId = sel?.documentId ?? figure?.docId ?? (scope && documentId && !scope.includes(documentId) ? scope[0] : documentId);
  // In a study session, the pass coaching works on whichever paper is open.
  const passAction = action.startsWith("pass");
  const paper = isPaper || passAction ? materials.find((m) => m.id === paperId) : undefined;
  const review = paper ? (state.reviews.get(paper.id) ?? emptyReview(paper.id)) : undefined;

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
    action === "teach" || action === "quiz" || action === "diagram" ? `${topic?.title ?? ""} ${topic?.key_concepts.join(" ") ?? ""}` : "",
    paper && action.startsWith("pass") ? `${paper.title} ${action === "pass2_figures" ? "figure table results experiments" : action.startsWith("pass3") ? "method assumption derivation experiment limitation" : ""}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const [{ excerpts, figures }, history] = await Promise.all([
    retrieveContext(supabase, { sessionId, materials, action, query, current, focus, topic, highlightId, extraPages, scopeIds: scope }),
    supabase
      .from("messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_TURNS),
  ]);

  const chosenIds = new Set(scope ?? []);
  const citeFiles = scope ? materials.filter((m) => chosenIds.has(m.id)).map((m) => ({ label: m.label, title: m.title })) : undefined;
  const shownCurrent = current && (!scope || scope.includes(current.docId)) ? { label: current.label, page: current.page } : null;
  const citeLabels = citeLabelsForTurn(citeFiles?.map((f) => f.label) ?? [], current?.label);

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
        current: shownCurrent,
        citeMode,
        citeFiles,
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
        current: shownCurrent,
        citeMode,
        citeFiles,
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
        current: shownCurrent,
        citeMode,
        citeFiles,
      });
  const instruction =
    ((isPaper || passAction) && buildPaperInstruction(action, paper, review, message)) ||
    buildUserInstruction({ action, message, materials, selection: sel, topic, figure });
  const multi = materials.length > 1;
  const display = displayUserTurn({
    action,
    message,
    selection: sel,
    figurePage: figure?.page,
    docLabel: multi ? (sel?.label ?? figure?.label) : undefined,
    topicTitle: isPaper || (passAction && paper) ? paper?.title : topic?.title,
    citeLabels,
  });

  // Strip first, then cut. A stored scratchpad is usually the start of the
  // message; slicing first would keep the scratchpad and drop the answer,
  // and the next turn would reason about it again.
  const pastTurns = ((history.data ?? []) as { role: "user" | "assistant"; content: string }[])
    .reverse()
    .map((m) => ({
      role: m.role,
      content: (m.role === "assistant" ? stripReasoning(m.content) : m.content).slice(0, 1800).trim(),
    }))
    .filter((m) => m.content);

  // Paper sessions get tools for finding papers. One tool round, then an
  // answer: a second hop resends the whole prompt and its reasoning budget.
  const tools = isPaper && !citeMode ? PAPER_TOOLS : undefined;
  const MAX_TOOL_ROUNDS = 1;
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
      ...modelBudget(MODELS.chat, 1800),
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
        // Cite mode keeps the meter on the stream and holds the tutor text
        // until the filter has run. Status lines still go out as they happen.
        if (!citeMode) controller.enqueue(encoder.encode(text));
      };
      const status = (label: string) => controller.enqueue(encoder.encode(`\u001e${JSON.stringify({ type: "status", label })}\n`));

      try {
        let completion = firstRound;
        for (let round = 0; ; round++) {
          const calls: { id: string; name: string; args: string }[] = [];
          const visible = createReasoningFilter();
          let roundText = "";
          let hitCap = false;
          const take = (delta: string) => {
            const shown = visible.push(delta);
            if (!shown) return;
            roundText += shown;
            write(shown);
          };
          for await (const chunk of completion) {
            const choice = chunk.choices[0];
            if (choice?.finish_reason === "length") hitCap = true;
            const delta = choice?.delta;
            if (delta?.content) take(delta.content);
            for (const tc of delta?.tool_calls ?? []) {
              const call = (calls[tc.index] ??= { id: "", name: "", args: "" });
              if (tc.id) call.id = tc.id;
              if (tc.function?.name) call.name += tc.function.name;
              if (tc.function?.arguments) call.args += tc.function.arguments;
            }
          }
          const tail = visible.finish();
          if (tail) {
            roundText += tail;
            write(tail);
          }
          const pending = calls.filter((c) => c.name);
          // Stop even if the model asks for another tool. Another round would
          // resend the whole prompt, and a model that keeps calling tools would
          // never stop.
          const lastRound = !pending.length || !tools || round >= MAX_TOOL_ROUNDS;
          if (hitCap && lastRound) write("\n\n_(Stopped here so this stays short. Ask me to continue.)_");
          if (lastRound) break;

          messages.push({
            role: "assistant",
            content: roundText.trim() || null,
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
        if (sources.length && !citeMode) {
          write(`\n\n**Sources**\n${sources.slice(0, 10).map((x) => `- [${x.title.replace(/[[\]]/g, "")}](${x.url})`).join("\n")}`);
        }
      } catch {
        write("\n\n_(The answer was cut off — please try again.)_");
      } finally {
        if (citeMode) {
          const retrieved = retrievedKeys(
            multi,
            [...excerpts, ...figures].map((e) => ({ label: e.label, page: e.page })),
          );
          const filtered = keepCited(reply, retrieved, multi).trim();
          reply = filtered || CITE_FALLBACK;
          controller.enqueue(encoder.encode(reply));
        }
        controller.close();
        resolveDone(reply);
      }
    },
  });

  // Persist the exchange and update the learner model once the stream ends.
  after(async () => {
    const reply = await done;
    // Record the answer's usage now, so meters update right away; the
    // progress-notes update below is recorded when it finishes.
    await access.meter.flush();
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

    // A passage the student asked about comes back in spaced review, with
    // their question and the explanation they got.
    if (sel && ASKED_ACTIONS.has(action) && sel.text.trim().length >= 25) {
      const passage = sel.text.replace(/\s+/g, " ").trim();
      const { error } = await supabase.from("review_items").upsert(
        {
          user_id: userId,
          session_id: sessionId,
          document_id: sel.documentId,
          page_number: sel.page,
          source: "asked",
          source_key: `${sel.documentId}:${sel.page}:${passage.toLowerCase().slice(0, 400)}`,
          prompt: passage.slice(0, 1200),
          question: action === "ask" ? (message ?? "").trim().slice(0, 1000) : "",
          answer: reply.split("\n\n**Sources**")[0].trim().slice(0, 4000),
        },
        { onConflict: "user_id,source,source_key", ignoreDuplicates: true },
      );
      if (error) logError("review item (asked) not saved", error);
    }

    if (topic?.status === "not_started") {
      await supabase.from("plan_topics").update({ status: "in_progress" }).eq("id", topic.id);
    }
    try {
      await updateLearnerMemory(supabase, groq, {
        userId,
        sessionId,
        memory: state.memory,
        topic,
        // The display turn, not the full instruction. The instruction repeats
        // the passage and the excerpts already sent with the answer.
        userTurn: display,
        passage: sel?.text,
        assistantReply: reply,
      });
    } catch (err) {
      logError("memory update failed", err);
    }
    await access.meter.flush();
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
