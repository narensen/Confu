import { MODELS, modelBudget } from "@confu/ai/groq";
import type { Connection } from "@confu/ai/connection";
import { describeAiError } from "@confu/ai/errors";
import { PROVIDERS, type ProviderId } from "@confu/ai/providers";
import { GUIDE_VERSION, scenesFor, videoMaterial, videoPrompt } from "@confu/core/video/guide";
import { repairVideo } from "@confu/core/video/repair";
import type { Line, VideoScript } from "@confu/core/video/script";
import { timeline } from "@confu/core/video/timing";
import type { FileStore } from "@confu/storage/files";
import type { Store } from "@confu/storage/store";
import { aiFor } from "./ai";
import type { DeviceKeys } from "./keys";
import { touchSession } from "./library";
import { podcastAudioPaths } from "./speech";
import { pagesFor } from "./tools";
import type { LocalPodcast } from "./tools";

// Explainer videos on the device: the student's AI writes a storyboard from
// their pages (the guide in @confu/core/video/guide), the repair step makes
// it safe to draw, and it's kept like a podcast. Drawing, voicing and
// exporting happen in the app (packages/app/src/video).

export type LocalVideo = { id: string; session_id: string; title: string; script: VideoScript; model: string | null; created_at: string };
export type MadeVideo = LocalVideo & { issues: string[] };

const NO_AI = "Connect your AI first (the button at the top right).";

export const listVideos = (store: Store, sessionId: string) => store.list<LocalVideo>("videos", { session_id: sessionId }, { order: "created_at", desc: true });

// Models trusted to draw a custom scene in HTML when no template fits.
// Smaller ones only get the templates.
export function canDraw(provider: ProviderId, model: string): boolean {
  if (provider === "anthropic" || provider === "openai") return true;
  if (provider === "gemini") return !/lite|nano|gemma/i.test(model);
  return /gpt-oss-120b|kimi-k2|deepseek-(v3|r1|chat)|qwen3-(235b|coder-480b)|llama-4-maverick|claude|gpt-[45]|gemini-[\d.]+-(pro|flash)$|glm-4\.[5-9]/i.test(model) && !/:free$/.test(model);
}

// The narration of every scene, in order: what gets voiced.
export const videoLines = (v: Pick<LocalVideo, "script">): Line[] => v.script.scenes.flatMap((s) => s.narration);

// The voiced audio is kept under the video's id, piece by piece, like a podcast's.
export const asEpisode = (v: Pick<LocalVideo, "id" | "script">) => ({ id: v.id, script: videoLines(v) }) as Pick<LocalPodcast, "id" | "script">;

export type VideoRequest = { sessionId: string; documentId?: string | null; title: string; minutes?: number; focus?: string | null };

const WRITE_FAILED = "The AI couldn't write the video right now. Try again.";
// A storyboard is thousands of tokens. The client default (60s, and a timeout
// is retried) was cutting off slow models and starting the same request over.
const WRITE_TIMEOUT_MS = 180_000;
const TEMPLATES = "title, points, definition, equation, steps, compare, bars, line, plot, timeline, cycle, map, number, quote, code, recap";

// Groq and some local servers reject json_object for a model. The words stay
// in the provider error; describeAiError would replace them with WRITE_FAILED.
function jsonModeRejected(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err ?? "");
  return /response_format|json_object|json mode|response format|failed to (?:generate|parse) json/i.test(msg);
}

type Follow = { role: "assistant" | "user"; content: string };

// Writes a storyboard with a given connection. Exported so the test lab can
// run the exact same request against any model.
export async function writeVideo(
  store: Store,
  conn: Connection,
  input: VideoRequest & { pages: { page: number; text: string }[] },
): Promise<{ script: VideoScript | null; issues: string[]; raw: string; model: string }> {
  const ai = aiFor(store, conn, input.sessionId, "plan");
  const minutes = Math.max(1, Math.min(4, input.minutes ?? 2));
  const allowHtml = canDraw(conn.provider, conn.models.chat);
  const messages = videoPrompt({ title: input.title, pages: input.pages, minutes, focus: input.focus, allowHtml });
  const material = videoMaterial(input.pages);
  const scenes = scenesFor(minutes);
  const ask = async (temperature: number, follow: Follow[] = []) => {
    const send = (jsonMode: boolean) =>
      ai.groq.chat.completions.create(
        {
          model: MODELS.chat,
          messages: follow.length ? [...messages, ...follow] : messages,
          ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
          temperature,
          ...modelBudget(MODELS.chat, 7000),
        },
        { timeout: WRITE_TIMEOUT_MS, maxRetries: 0 },
      );
    try {
      return await send(true);
    } catch (err) {
      const msg = String((err as { message?: string })?.message ?? "");
      if (/timed? ?out/i.test(msg)) throw new Error("The video took too long to write. Try again, or pick a faster model under Your AI.");
      if (!jsonModeRejected(err)) throw new Error(describeAiError(err, WRITE_FAILED).error);
      // One try without JSON mode. The repair step already pulls JSON out of a fenced reply.
      try {
        return await send(false);
      } catch (err2) {
        throw new Error(describeAiError(err2, WRITE_FAILED).error);
      }
    }
  };
  let res = await ask(0.5);
  let raw = res.choices[0]?.message?.content ?? "";
  let out = repairVideo(raw, { title: input.title, material });
  if (!out.script) {
    // Same prompt again does not help a coding model that refused in prose.
    // Tell it the reply was unusable and that the job is to emit the JSON.
    res = await ask(0.2, [
      { role: "assistant", content: raw.trim().slice(0, 2000) || "(empty reply)" },
      {
        role: "user",
        content: `That reply was not a usable video. This is a code-generation task: reply with one JSON object and nothing else. No apology, no markdown fence. Any subject is fine, including history and science. Use only these templates: ${TEMPLATES}${allowHtml ? ", html" : ""}. Write ${scenes} scenes. The first is "title", the last is "recap". Every scene has 2 to 4 spoken lines, each 12 to 25 words.`,
      },
    ]);
    raw = res.choices[0]?.message?.content ?? "";
    const again = repairVideo(raw, { title: input.title, material });
    out = { script: again.script, issues: [...out.issues.map((i) => `try1:${i}`), ...again.issues] };
  } else if (timeline(out.script.scenes).total < minutes * 60 * 0.7) {
    const have = Math.round(timeline(out.script.scenes).total);
    const first = out;
    try {
      const longerRes = await ask(0.4, [
        { role: "assistant", content: raw.trim().slice(0, 8000) },
        {
          role: "user",
          content: `That storyboard would only run about ${have} seconds. Rewrite it as one JSON object for about ${minutes} minute${minutes === 1 ? "" : "s"}. Keep the same facts. Give every scene 3 or 4 spoken lines of 15 to 25 words. No markdown fence.`,
        },
      ]);
      const longerRaw = longerRes.choices[0]?.message?.content ?? "";
      const longer = repairVideo(longerRaw, { title: input.title, material });
      if (longer.script && timeline(longer.script.scenes).total > timeline(first.script!.scenes).total) {
        res = longerRes;
        raw = longerRaw;
        out = { script: longer.script, issues: [...first.issues, "length:rewritten", ...longer.issues] };
      } else out = { script: first.script, issues: [...first.issues, "length:still-short"] };
    } catch {
      out = { script: first.script, issues: [...first.issues, "length:rewrite-failed"] };
    }
  }
  return { ...out, raw, model: res.model ?? conn.models.chat };
}

export async function makeVideo(store: Store, keys: DeviceKeys, input: VideoRequest): Promise<MadeVideo> {
  const conn = await keys.connection(input.sessionId);
  if (!conn) throw new Error(NO_AI);
  const pages = await pagesFor(store, { sessionId: input.sessionId, documentId: input.documentId, max: 8 });
  if (!pages.length) throw new Error("Add a file with readable text first.");
  let made;
  try {
    made = await writeVideo(store, conn, { ...input, pages: pages.map((p) => ({ page: p.page, text: p.text })) });
  } catch (e) {
    // The main AI is busy: the Groq voice key, when there is one, writes it instead.
    const groq = conn.provider === "groq" ? null : await keys.groq(input.sessionId);
    if (!groq || !/busy|rate limit|overloaded/i.test(e instanceof Error ? e.message : "")) throw e;
    made = await writeVideo(store, { ...groq, models: PROVIDERS.groq.defaults }, { ...input, pages: pages.map((p) => ({ page: p.page, text: p.text })) });
  }
  if (!made.script) throw new Error("The AI didn't write a usable video. Try again, or pick a larger model under Your AI.");
  const row = await store.put("videos", { session_id: input.sessionId, title: made.script.title, script: { ...made.script, guide: GUIDE_VERSION }, model: made.model });
  await touchSession(store, input.sessionId);
  const video = (await store.get<LocalVideo>("videos", { id: row.id! }))!;
  return { ...video, issues: made.issues };
}

// The video and its voiced narration.
export async function deleteVideo(store: Store, files: FileStore, id: string) {
  const v = await store.get<LocalVideo>("videos", { id });
  if (v) for (const path of podcastAudioPaths(asEpisode(v) as LocalPodcast)) await files.remove(path);
  await store.remove("videos", { id });
}
