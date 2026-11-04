import type { LearnerMemory, PlanTopic } from "../types";

// The tutor's private notes on the student, updated by a small model after
// each exchange. This is what lets the tutor build on what was covered
// instead of repeating itself, and what feeds topic mastery. Pure: the
// caller asks the model and stores the result.

export function memoryPrompt(input: { memory: LearnerMemory; topic: PlanTopic | null; userTurn: string; passage?: string | null; assistantReply: string }): string {
  const { memory, topic, userTurn, assistantReply } = input;
  const passage = input.passage?.replace(/\s+/g, " ").trim().slice(0, 400);
  return `You maintain a tutor's private notes about ONE student working toward a learning goal. Update the notes from the latest exchange.

CURRENT NOTES (JSON):
${JSON.stringify(memory)}

CURRENT TOPIC: ${topic ? `${topic.title}\nObjectives: ${topic.objectives.join("; ")}\nCurrent mastery estimate: ${topic.mastery.toFixed(2)}` : "none"}

LATEST EXCHANGE
Student: ${userTurn.replace(/\s+/g, " ").trim().slice(0, 500)}
${passage ? `Passage they asked about: ${passage}\n` : ""}Tutor: ${assistantReply.slice(0, 900)}

Return ONLY a JSON object:
{
  "summary": "≤60 words: who this learner is right now — level, how they learn best, what to do next. Rewrite, don't append.",
  "understood_add": ["concepts the STUDENT demonstrated they understand (only with evidence from the student's own words)"],
  "struggling_add": ["concepts the student is confused about"],
  "misconceptions_add": ["specific wrong beliefs the student expressed"],
  "open_questions_add": ["questions the STUDENT asked that remain unresolved (never the tutor's own check questions)"],
  "resolved": ["items from struggling / misconceptions / open_questions that this exchange resolved"],
  "explained_add": ["short names of concepts the TUTOR explained in this reply"],
  "topic_mastery": 0.0-1.0 or null  // the student's mastery of the CURRENT TOPIC objectives; null unless the student answered a question or explained something themselves
}
Be conservative: asking a question is not understanding. Keep items short (≤8 words) and specific.`;
}

const CAPS = { understood: 30, struggling: 12, misconceptions: 10, open_questions: 10, explained: 40 };

// A list of short strings from the model, or [] for anything else.
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.length <= 200).slice(0, 8) : []);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function matches(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return x === y || (x.length > 4 && y.includes(x)) || (y.length > 4 && x.includes(y));
}
function merge(existing: string[], add: string[], remove: string[], cap: number): string[] {
  const kept = existing.filter((e) => !remove.some((r) => matches(e, r)) && !add.some((a) => matches(e, a)));
  return [...kept, ...add.map((a) => a.trim()).filter(Boolean)].slice(-cap);
}

// The new notes, and the topic's new mastery (null: unchanged), from the
// model's JSON. Anything malformed is ignored, field by field.
export function applyMemoryUpdate(memory: LearnerMemory, topic: PlanTopic | null, raw: unknown): { next: LearnerMemory; mastery: number | null } {
  const u = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const summary = typeof u.summary === "string" ? u.summary.slice(0, 800) : "";
  const understoodAdd = strings(u.understood_add);
  const strugglingAdd = strings(u.struggling_add);
  const resolvedList = strings(u.resolved);
  const resolved = [...resolvedList, ...understoodAdd];
  const next: LearnerMemory = {
    summary: summary || memory.summary,
    understood: merge(memory.understood, understoodAdd, strugglingAdd, CAPS.understood),
    struggling: merge(memory.struggling, strugglingAdd, resolved, CAPS.struggling),
    misconceptions: merge(memory.misconceptions, strings(u.misconceptions_add), resolvedList, CAPS.misconceptions),
    open_questions: merge(memory.open_questions, strings(u.open_questions_add), resolvedList, CAPS.open_questions),
    explained: merge(memory.explained, strings(u.explained_add), [], CAPS.explained),
  };
  const m = typeof u.topic_mastery === "number" && u.topic_mastery >= 0 && u.topic_mastery <= 1 ? u.topic_mastery : null;
  const mastery = topic && m !== null ? Math.round((topic.mastery === 0 ? m : 0.5 * topic.mastery + 0.5 * m) * 100) / 100 : null;
  return { next, mastery };
}
