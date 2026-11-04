import { describeAiError, KEY_ERRORS } from "@confu/ai/errors";
import { MODELS, modelBudget, parseJsonObject, stripReasoning, type ChatCompletionMessageParam, type Groq } from "@confu/ai/groq";
import { daysUntil, topicStats, type Attempt } from "@confu/core/exam";
import { emptyReview } from "@confu/core/paper";
import { currentTopic, scheduleStatus, toISODate } from "@confu/core/schedule";
import { buildExamSystemPrompt } from "@confu/core/tutor/exam-prompts";
import { citeLabelsForTurn, displayUserTurn } from "@confu/core/tutor/format";
import { keepCited, retrievedKeys } from "@confu/core/tutor/keep-cited";
import { applyMemoryUpdate, memoryPrompt } from "@confu/core/tutor/memory";
import { preferAnswerCitations } from "@confu/core/tutor/page-role";
import { buildPaperInstruction, buildPaperSystemPrompt } from "@confu/core/tutor/paper-prompts";
import { buildSystemPrompt, buildUserInstruction } from "@confu/core/tutor/prompts";
import { retrieveContext, type PageRef } from "@confu/core/tutor/retrieve";
import { savedBlock } from "@confu/core/tutor/saved";
import type { LearnerMemory, PlanTopic, SavedAnswer, TutorAction } from "@confu/core/types";
import { createReasoningFilter } from "@confu/core/visible-text";
import type { Store } from "@confu/storage/store";
import { deviceAi } from "../ai";
import type { DeviceKeys } from "../keys";
import { storePageSource } from "./source";
import { loadTutorState } from "./state";

// The tutor's answer to one turn, on the device: the same steps as the
// server's /api/chat. Load the session, pick the pages, build the prompt,
// stream the answer (with one round of paper tools in a paper session),
// then save the exchange and update the progress notes.

export type AskInput = {
  sessionId: string;
  documentId?: string | null; // the PDF currently open
  action: TutorAction;
  message?: string;
  page?: number | null;
  topicId?: string | null;
  selection?: { text: string; page: number; documentId: string } | null;
  highlightId?: string | null;
  documentIds?: string[]; // files this question may cite; absent means the whole session
};

export type Source = { title: string; url: string };
// Paper-search tools, when this device can reach the scholarly databases.
export type PaperTools = {
  definitions: unknown[];
  run(name: string, args: string): Promise<{ label: string; sources: Source[]; result: unknown }>;
};

export type TutorEvent =
  | { type: "text"; text: string } // a piece of the answer as it arrives (all at once in cite mode)
  | { type: "status"; label: string } // e.g. "Searching papers…": shown, not kept
  | { type: "done"; reply: string; userTurn: string; notes: Promise<void> } // notes: the progress-notes update, still running
  | { type: "error"; error: string; code?: string };

const HISTORY_TURNS = 8;
const MAX_TOOL_ROUNDS = 1;
// Text actions on a selected passage that send it to spaced review.
const ASKED_ACTIONS = new Set<string>(["ask", "summarize", "context", "simplify"]);

export async function* askTutor(deps: { store: Store; keys: DeviceKeys; tools?: PaperTools }, input: AskInput): AsyncGenerator<TutorEvent> {
  const { store, keys } = deps;
  const { sessionId, documentId = null, action, message, page = null, topicId, selection = null, highlightId = null, documentIds } = input;
  if (action === "chat" && !message?.trim() && !selection) return yield { type: "error", error: "Write a question first." };

  const ai = await deviceAi(store, keys, sessionId, "chat");
  if (!ai) return yield { type: "error", error: "Connect your own AI to use the tutor: an API key, or your OpenRouter account.", code: KEY_ERRORS.required };
  const { groq } = ai;

  const state = await loadTutorState(store, sessionId);
  if (!state.session) return yield { type: "error", error: "This session isn't on this device." };
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
    const h = await store.get<{ document_id: string; page_number: number; vlm_description: string | null }>("highlights", { id: highlightId });
    if (h?.vlm_description) figure = { docId: h.document_id, page: h.page_number, label: labelOf(h.document_id), description: h.vlm_description };
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
    if (topic?.document_id && known.has(topic.document_id) && (action === "teach" || action === "quiz" || action === "diagram")) picked.add(topic.document_id);
    const ordered = materials.map((m) => m.id).filter((id) => picked.has(id));
    if (ordered.length) scope = ordered;
  }

  const paperId = sel?.documentId ?? figure?.docId ?? (scope && documentId && !scope.includes(documentId) ? scope[0] : documentId);
  const passAction = action.startsWith("pass");
  const paper = isPaper || passAction ? materials.find((m) => m.id === paperId) : undefined;
  const review = paper ? (state.reviews.get(paper.id) ?? emptyReview(paper.id)) : undefined;

  // Each pass reads different parts of the paper.
  const extraPages: PageRef[] = [];
  if (paper && passAction) {
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
    paper && passAction ? `${paper.title} ${action === "pass2_figures" ? "figure table results experiments" : action.startsWith("pass3") ? "method assumption derivation experiment limitation" : ""}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const [{ excerpts, figures }, history, keptAnswers] = await Promise.all([
    retrieveContext(storePageSource(store), { sessionId, materials, action, query, current, focus, topic, highlightId, extraPages, scopeIds: scope }),
    // A cleared chat keeps its rows (study days stay on the streak) without the words.
    store.query<{ role: "user" | "assistant"; content: string }>(
      `SELECT role, content FROM messages WHERE session_id = ? AND content <> '' ORDER BY created_at DESC LIMIT ?`,
      [sessionId, HISTORY_TURNS],
    ),
    store.list<Pick<SavedAnswer, "question" | "answer" | "created_at">>("saved_answers", { session_id: sessionId }, { order: "created_at", desc: true, limit: 12 }),
  ]);

  const chosenIds = new Set(scope ?? []);
  const citeFiles = scope ? materials.filter((m) => chosenIds.has(m.id)).map((m) => ({ label: m.label, title: m.title })) : undefined;
  const shownCurrent = current && (!scope || scope.includes(current.docId)) ? { label: current.label, page: current.page } : null;
  const citeLabels = citeLabelsForTurn(citeFiles?.map((f) => f.label) ?? [], current?.label);
  const examTopics = isExam
    ? topicStats(await store.list<Attempt>("exam_attempts", { session_id: sessionId }, { order: "created_at", desc: true, limit: 300 }))
    : [];

  const shared = { memory: state.memory, excerpts, figures, current: shownCurrent, citeMode, citeFiles, materials };
  const prompt = isExam
    ? buildExamSystemPrompt({ ...shared, sessionTitle: state.session.title, daysLeft: daysUntil(state.session.exam_date, toISODate(new Date())), topics: examTopics })
    : isPaper
      ? buildPaperSystemPrompt({ ...shared, sessionTitle: state.session.title, researchGoal: state.session.research_goal, reviews: state.reviews, focusDocId: paper?.id ?? null })
      : buildSystemPrompt({ ...shared, sessionTitle: state.session.title, plan: state.plan, topics: state.topics, topic, schedule });
  const system = prompt + savedBlock(keptAnswers);
  const instruction = ((isPaper || passAction) && buildPaperInstruction(action, paper, review, message)) || buildUserInstruction({ action, message, materials, selection: sel, topic, figure });
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
  // Strip first, then cut: a stored scratchpad is usually the start of a message.
  const pastTurns = history
    .reverse()
    .map((m) => ({ role: m.role, content: (m.role === "assistant" ? stripReasoning(m.content) : m.content).slice(0, 1800).trim() }))
    .filter((m) => m.content);

  // Paper sessions get tools for finding papers, when this device has them.
  const tools = isPaper && !citeMode && deps.tools ? deps.tools : undefined;
  const messages: ChatCompletionMessageParam[] = [{ role: "system", content: system }, ...pastTurns, { role: "user", content: instruction }];
  const askModel = (round: number) =>
    groq.chat.completions.create({
      model: MODELS.chat,
      messages,
      stream: true,
      temperature: 0.5,
      ...modelBudget(MODELS.chat, 1800),
      // On the last round, force an answer from what's been gathered.
      ...(tools ? { tools: tools.definitions as never, tool_choice: round < MAX_TOOL_ROUNDS ? ("auto" as const) : ("none" as const) } : {}),
    });

  let completion;
  try {
    completion = await askModel(0);
  } catch (err) {
    const problem = describeAiError(err, "The tutor couldn't answer right now. Try again.");
    return yield { type: "error", error: problem.error, code: problem.code };
  }

  let reply = "";
  const sources: Source[] = [];
  const pieces: TutorEvent[] = [];
  const write = (text: string) => {
    if (!text) return;
    reply += text;
    // Cite mode holds the text until the filter has run.
    if (!citeMode) pieces.push({ type: "text", text });
  };
  try {
    for (let round = 0; ; round++) {
      const calls: { id: string; name: string; args: string }[] = [];
      const visible = createReasoningFilter();
      let roundText = "";
      let hitCap = false;
      for await (const chunk of completion) {
        const choice = chunk.choices[0];
        if (choice?.finish_reason === "length") hitCap = true;
        if (choice?.delta?.content) {
          const shown = visible.push(choice.delta.content);
          if (shown) {
            roundText += shown;
            write(shown);
          }
        }
        for (const tc of choice?.delta?.tool_calls ?? []) {
          const call = (calls[tc.index] ??= { id: "", name: "", args: "" });
          if (tc.id) call.id = tc.id;
          if (tc.function?.name) call.name += tc.function.name;
          if (tc.function?.arguments) call.args += tc.function.arguments;
        }
        yield* pieces.splice(0);
      }
      const tail = visible.finish();
      if (tail) {
        roundText += tail;
        write(tail);
      }
      const pending = calls.filter((c) => c.name);
      // Stop even if the model asks for another tool: another round resends the whole prompt.
      const lastRound = !pending.length || !tools || round >= MAX_TOOL_ROUNDS;
      if (hitCap && lastRound) write("\n\n_(Stopped here so this stays short. Ask me to continue.)_");
      yield* pieces.splice(0);
      if (lastRound) break;
      messages.push({
        role: "assistant",
        content: roundText.trim() || null,
        tool_calls: pending.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args } })),
      });
      for (const call of pending) {
        const run = await tools.run(call.name, call.args);
        yield { type: "status", label: run.label };
        for (const src of run.sources) if (!sources.some((x) => x.url === src.url)) sources.push(src);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(run.result).slice(0, 8000) });
      }
      yield { type: "status", label: "Reading the results…" };
      completion = await askModel(round + 1);
    }
    if (sources.length && !citeMode) write(`\n\n**Sources**\n${sources.slice(0, 10).map((x) => `- [${x.title.replace(/[[\]]/g, "")}](${x.url})`).join("\n")}`);
  } catch {
    write("\n\n_(The answer was cut off — please try again.)_");
  }
  yield* pieces.splice(0);

  if (citeMode) {
    const retrieved = retrievedKeys(multi, [...excerpts, ...figures].map((e) => ({ label: e.label, page: e.page })));
    const filtered = keepCited(preferAnswerCitations(reply, excerpts, multi), retrieved, multi).trim();
    reply = filtered || reply.trim() || "The tutor didn't send an answer. Try again.";
    yield { type: "text", text: reply };
  }
  if (!reply.trim()) return yield { type: "error", error: "The tutor didn't send an answer. Try again." };

  // Save the exchange, then update the progress notes in the background.
  const base = {
    session_id: sessionId,
    document_id: focus?.docId ?? current?.docId ?? null,
    topic_id: topic?.id ?? null,
    highlight_id: highlightId,
    action,
    page_number: focus?.page ?? current?.page ?? null,
  };
  const now = Date.now();
  await store.put("messages", { ...base, role: "user", content: display, created_at: new Date(now).toISOString() });
  await store.put("messages", { ...base, role: "assistant", content: reply, created_at: new Date(now + 1).toISOString() });
  // A passage the student asked about comes back in spaced review.
  if (sel && ASKED_ACTIONS.has(action) && sel.text.trim().length >= 25) {
    const passage = sel.text.replace(/\s+/g, " ").trim();
    const sourceKey = `${sel.documentId}:${sel.page}:${passage.toLowerCase().slice(0, 400)}`;
    const [exists] = await store.list("review_items", { source: "asked", source_key: sourceKey }, { limit: 1 });
    if (!exists) {
      await store.put("review_items", {
        session_id: sessionId,
        document_id: sel.documentId,
        page_number: sel.page,
        source: "asked",
        source_key: sourceKey,
        prompt: passage.slice(0, 1200),
        question: action === "ask" ? (message ?? "").trim().slice(0, 1000) : "",
        answer: reply.split("\n\n**Sources**")[0].trim().slice(0, 4000),
      });
    }
  }
  if (topic?.status === "not_started") await store.put("plan_topics", { id: topic.id, status: "in_progress", updated_at: new Date().toISOString() });

  const notes = updateNotes(store, groq, { sessionId, memory: state.memory, topic, userTurn: display, passage: sel?.text, assistantReply: reply }).catch(() => {});
  yield { type: "done", reply, userTurn: display, notes };
}

// The progress notes, from a small model (MODELS.fast stands for the student's pick).
async function updateNotes(
  store: Store,
  groq: Groq,
  input: { sessionId: string; memory: LearnerMemory; topic: PlanTopic | null; userTurn: string; passage?: string | null; assistantReply: string },
) {
  const res = await groq.chat.completions.create({
    model: MODELS.fast,
    messages: [{ role: "user", content: memoryPrompt(input) }],
    response_format: { type: "json_object" },
    temperature: 0.2,
    ...modelBudget(MODELS.fast, 700),
  });
  const { next, mastery } = applyMemoryUpdate(input.memory, input.topic, parseJsonObject(res.choices[0]?.message?.content ?? "{}"));
  await store.put("learner_memory", { session_id: input.sessionId, ...next, updated_at: new Date().toISOString() });
  if (input.topic && mastery !== null) await store.put("plan_topics", { id: input.topic.id, mastery, updated_at: new Date().toISOString() });
}
