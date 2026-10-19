import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { groq, MODELS, parseJsonObject } from "@/lib/groq";
import type { LearnerMemory, PlanTopic } from "@/lib/types";

const str = z.array(z.string().max(200)).max(8).catch([]);

const MemoryUpdate = z.object({
  summary: z.string().max(800).catch(""),
  understood_add: str,
  struggling_add: str,
  misconceptions_add: str,
  open_questions_add: str,
  resolved: str,
  explained_add: str,
  topic_mastery: z.number().min(0).max(1).nullable().catch(null),
});

const CAPS = { understood: 30, struggling: 12, misconceptions: 10, open_questions: 10, explained: 40 };

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

// After each exchange, ask a small model to update the learner model.
// This is what lets the tutor build on what was already covered instead of
// repeating itself, and what feeds topic mastery.
export async function updateLearnerMemory(
  supabase: SupabaseClient,
  input: {
    userId: string;
    sessionId: string;
    memory: LearnerMemory;
    topic: PlanTopic | null;
    userTurn: string;
    assistantReply: string;
  },
) {
  const { userId, sessionId, memory, topic, userTurn, assistantReply } = input;

  const prompt = `You maintain a tutor's private notes about ONE student working toward a learning goal. Update the notes from the latest exchange.

CURRENT NOTES (JSON):
${JSON.stringify(memory)}

CURRENT TOPIC: ${topic ? `${topic.title}\nObjectives: ${topic.objectives.join("; ")}\nCurrent mastery estimate: ${topic.mastery.toFixed(2)}` : "none"}

LATEST EXCHANGE
Student: ${userTurn.slice(0, 2500)}
Tutor: ${assistantReply.slice(0, 3500)}

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

  const res = await groq.chat.completions.create({
    model: MODELS.fast,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_completion_tokens: 1200,
    reasoning_effort: "low",
  });

  const parsed = MemoryUpdate.safeParse(parseJsonObject(res.choices[0]?.message?.content ?? "{}"));
  if (!parsed.success) return;
  const u = parsed.data;

  const resolved = [...u.resolved, ...u.understood_add];
  const next: LearnerMemory = {
    summary: u.summary || memory.summary,
    understood: merge(memory.understood, u.understood_add, u.struggling_add, CAPS.understood),
    struggling: merge(memory.struggling, u.struggling_add, resolved, CAPS.struggling),
    misconceptions: merge(memory.misconceptions, u.misconceptions_add, u.resolved, CAPS.misconceptions),
    open_questions: merge(memory.open_questions, u.open_questions_add, u.resolved, CAPS.open_questions),
    explained: merge(memory.explained, u.explained_add, [], CAPS.explained),
  };

  const writes: PromiseLike<unknown>[] = [
    supabase.from("learner_memory").upsert({ session_id: sessionId, user_id: userId, ...next }),
  ];

  if (topic && u.topic_mastery !== null) {
    const mastery = topic.mastery === 0 ? u.topic_mastery : 0.5 * topic.mastery + 0.5 * u.topic_mastery;
    writes.push(
      supabase
        .from("plan_topics")
        .update({ mastery: Math.round(mastery * 100) / 100 })
        .eq("id", topic.id),
    );
  }

  await Promise.all(writes);
}
