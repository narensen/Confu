import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { groqClient, MODELS, modelBudget, parseJsonObject } from "@confu/ai/groq";
import { poolFetch, poolSize } from "@/lib/groq-pool";
import { logError } from "@/lib/log";

// The check on every thread and reply (migration 0039), in two steps:
//
// 1. Jev (TypeSafe's decision model, https://docs.typesafe.ai) screens it.
//    It doesn't write text: it answers typed questions with probabilities,
//    fast and cheaply. We ask how likely the post is to state something
//    wrong, how well reasoned it is, and whether it's spam or abuse.
// 2. Above JEV_FIX_THRESHOLD (0.5), a language model on Confu's own keys
//    looks again ("accept when confident, escalate when unsure"). If it
//    agrees, it explains the mistake and, for a reply, writes the corrected
//    reply. If it doesn't, the post stands.
//
// Readers see the correction labelled, with the original one click away; the
// author is told. Very likely spam or abuse (JEV_HIDE_THRESHOLD) is hidden for
// the owner to review. Never runs on a student's own key or trial.

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_KEY = process.env.TYPESAFE_API_KEY;
const JEV_MODEL = process.env.JEV_MODEL || "jev-latest";
const FIX_AT = Number(process.env.JEV_FIX_THRESHOLD) || 0.5;
const HIDE_AT = Number(process.env.JEV_HIDE_THRESHOLD) || 0.9;

export const moderationConfigured = Boolean(JEV_KEY);

export type CheckStatus = "ok" | "flagged" | "corrected" | "hidden" | "error";

type Claimed = {
  id: string;
  kind: "question" | "reply";
  author_id: string;
  thread_id: string;
  title: string | null;
  body: string;
  question_title: string | null;
  question_body: string | null;
  subject: string | null;
};

type Scores = { incorrect: number; rational: number | null; harmful: number; model: string };

const clip = (text: string | null | undefined, max: number) => {
  const t = (text ?? "").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};
const prob = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

const RATIONAL_LEVELS = [
  "Confused or unsupported: claims without reasons, or reasoning that doesn't follow",
  "Partly reasoned: some support, with gaps or leaps",
  "Clear and well reasoned: each claim follows from stated reasons, steps or evidence",
];

async function askJev(post: Claimed): Promise<Scores> {
  const state = {
    community: "A study community where students ask and answer questions about what they're learning.",
    subject: post.subject ?? "General",
    post_kind: post.kind,
    ...(post.kind === "reply" ? { question_being_answered: `${post.question_title ?? ""}\n\n${clip(post.question_body, 3000)}` } : {}),
    post: post.kind === "question" ? `${post.title ?? ""}\n\n${clip(post.body, 6000)}` : clip(post.body, 6000),
  };
  const res = await fetch(JEV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${JEV_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: JEV_MODEL,
      state,
      questions: {
        incorrect: {
          type: "noul",
          instructions:
            "The post states something factually or logically wrong as if it were true: a wrong fact, definition, formula, calculation, step of reasoning or conclusion. Asking a question, saying you're unsure, or giving a clearly labelled opinion is not wrong.",
          criteria: {
            true: "At least one claim in the post is wrong",
            false: "Every claim is correct, or the post only asks, wonders or gives an opinion",
          },
        },
        rational: { type: "score", instructions: "How well reasoned the post is", criteria: RATIONAL_LEVELS },
        harmful: {
          type: "noul",
          instructions: "The post is spam or advertising, harassment, hate, sexual content, encourages self-harm, or asks for help cheating on an exam in progress.",
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { model?: string; answers?: Record<string, { noul?: number; score?: number }> };
  const answers = json.answers ?? {};
  const score = answers.rational?.score;
  return {
    incorrect: prob(answers.incorrect?.noul),
    harmful: prob(answers.harmful?.noul),
    // The score is the expected level (0 to 2): as a share of the top level.
    rational: typeof score === "number" ? prob(score / (RATIONAL_LEVELS.length - 1)) : null,
    model: String(json.model ?? JEV_MODEL),
  };
}

const Verdict = z.object({
  wrong: z.boolean(),
  note: z.string().max(2000).default(""),
  corrected: z.string().max(8000).default(""),
});

// The second look, and the fix. Null when the server's keys aren't set up.
async function escalate(post: Claimed, scores: Scores) {
  if (!poolSize()) return null;
  const groq = groqClient("gsk_pool", poolFetch);
  const reply = post.kind === "reply";
  const res = await groq.chat.completions.create({
    model: MODELS.chat,
    messages: [
      {
        role: "system",
        content:
          "You check posts in a study community for factual and logical mistakes, and fix them. Be careful and fair: only call something wrong if it is clearly wrong for the subject, not a simplification that's standard at a student's level, an opinion, or a detail left out. Write in plain, friendly English. Use Markdown, with maths in $…$ or $$…$$.",
      },
      {
        role: "user",
        content: `Subject: ${post.subject ?? "General"}
${reply ? `\nTHE QUESTION BEING ANSWERED:\n${post.question_title ?? ""}\n${clip(post.question_body, 3000)}\n` : ""}
THE ${reply ? "REPLY" : "QUESTION"} TO CHECK:
${reply ? "" : `${post.title ?? ""}\n`}${clip(post.body, 6000)}

A screening model puts the chance that this ${reply ? "reply" : "question"} contains a mistake at ${Math.round(scores.incorrect * 100)}%. Decide for yourself.

Return ONLY JSON: {"wrong": true|false, "note": "", "corrected": ""}
- wrong: true only if it states something false, or reasons incorrectly, as if it were right.
- note: if wrong, one to three short sentences for readers: what's wrong and what's right. Don't mention the screening model. Empty if not wrong.
${
  reply
    ? '- corrected: if wrong, the whole reply rewritten with the mistakes fixed. Keep the author\'s voice, structure and length, and everything that was right. Empty if not wrong.'
    : '- corrected: always "". (Don\'t rewrite questions: the note explains the mistaken premise to whoever answers.)'
}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    ...modelBudget(MODELS.chat, 3000),
  });
  const parsed = Verdict.safeParse(parseJsonObject(res.choices[0]?.message?.content ?? ""));
  if (!parsed.success) throw new Error("The fixer's answer didn't parse");
  return { ...parsed.data, model: res.model || MODELS.chat };
}

// Check one post, if it's waiting (another request may have taken it).
// Returns what happened, or null when there was nothing to do.
export async function checkPost(admin: SupabaseClient, id: string): Promise<CheckStatus | null> {
  if (!moderationConfigured) return null;
  const { data, error } = await admin.rpc("_claim_post_check", { p_id: id });
  if (error || !data) return null;
  const post = data as Claimed;

  const save = (status: CheckStatus, scores: Partial<Scores>, note: string | null, fix: string | null, model: string | null) =>
    admin.rpc("_save_post_check", {
      p_id: id,
      p_status: status,
      p_incorrect: scores.incorrect ?? null,
      p_rational: scores.rational ?? null,
      p_harmful: scores.harmful ?? null,
      p_note: note,
      p_fix: fix,
      p_model: model,
    });

  try {
    const scores = await askJev(post);
    if (scores.harmful >= HIDE_AT) {
      await save("hidden", scores, "Hidden automatically: it looked like spam or abuse.", null, scores.model);
      return "hidden";
    }
    if (scores.incorrect <= FIX_AT) {
      await save("ok", scores, null, null, scores.model);
      return "ok";
    }
    const verdict = await escalate(post, scores).catch((err: unknown) => {
      logError("moderation escalate", err);
      return undefined; // tried and failed: retry later
    });
    if (verdict === undefined) {
      await save("error", scores, null, null, scores.model);
      return "error";
    }
    if (verdict === null) {
      // No language model to look again: a plain warning, no rewrite.
      await save("flagged", scores, "Confu's check thinks this may contain a mistake. Read it with care, and check it against your notes.", null, scores.model);
      return "flagged";
    }
    const model = `${scores.model} + ${verdict.model}`;
    if (!verdict.wrong) {
      await save("ok", scores, null, null, model);
      return "ok";
    }
    const fix = post.kind === "reply" && verdict.corrected.trim() ? verdict.corrected.trim() : null;
    const status: CheckStatus = fix ? "corrected" : "flagged";
    await save(status, scores, verdict.note.trim() || "This may contain a mistake.", fix, model);
    return status;
  } catch (err) {
    logError("moderation check", err);
    await save("error", {}, null, null, null);
    return "error";
  }
}

// The daily job's sweep: posts nobody's page asked to check yet.
export async function sweepChecks(admin: SupabaseClient, limit = 40) {
  if (!moderationConfigured) return { checked: 0 };
  const { data } = await admin
    .from("posts")
    .select("id")
    .in("check_status", ["pending", "error"])
    .lt("check_attempts", 3)
    .lt("created_at", new Date(Date.now() - 2 * 60_000).toISOString())
    .order("created_at")
    .limit(limit);
  let checked = 0;
  for (const row of (data ?? []) as { id: string }[]) {
    if (await checkPost(admin, row.id)) checked += 1;
  }
  return { checked };
}
