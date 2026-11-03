import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Connection } from "./connection";
import { ownError } from "./openai-compat";

// Claude through Anthropic's own SDK and Messages API. Confu's call sites
// speak the OpenAI chat format (through the Groq SDK), so this sits where the
// network would be: it takes a chat-completions request, asks Claude, and
// answers with a chat-completions response (JSON, or a stream of chunks),
// usage included so the meter counts it.

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type Block = Anthropic.Beta.Messages.BetaContentBlockParam;
type Tool = Anthropic.Beta.Messages.BetaTool;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type StreamEvent = Anthropic.Beta.Messages.BetaRawMessageStreamEvent;
type StopReason = Anthropic.Beta.Messages.BetaStopReason;

type ChatPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type ChatMessage = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content?: string | ChatPart[] | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};
type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  max_completion_tokens?: number;
  max_tokens?: number;
  reasoning_effort?: string;
  response_format?: { type: string };
  tools?: { type: "function"; function: { name: string; description?: string; parameters?: Record<string, unknown> } }[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
};

// Models that can retry a declined request on another model, server-side
// (Anthropic's recommended fallback for the refusal's category).
const SERVER_FALLBACK = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;
// Models that take output_config.effort.
const TAKES_EFFORT = /^claude-(fable|mythos|opus|sonnet|haiku)-(?:[5-9]|4-[6-9])/;
// Thinking counts toward max_tokens; Confu's budgets are for the visible answer.
const THINKING_ROOM = 2048;

const textOf = (content: ChatMessage["content"]): string =>
  typeof content === "string" ? content : (content ?? []).map((p) => (p.type === "text" ? p.text : "")).join("");

function userBlocks(content: ChatMessage["content"]): Block[] {
  if (typeof content === "string" || content == null) return content ? [{ type: "text", text: content }] : [];
  const blocks: Block[] = [];
  for (const part of content) {
    if (part.type === "text") {
      if (part.text) blocks.push({ type: "text", text: part.text });
      continue;
    }
    const url = part.image_url.url;
    const data = /^data:(image\/(?:png|jpeg|gif|webp));base64,([\s\S]+)$/.exec(url);
    if (data) blocks.push({ type: "image", source: { type: "base64", media_type: data[1] as "image/png", data: data[2] } });
    else if (/^https?:\/\//.test(url)) blocks.push({ type: "image", source: { type: "url", url } });
  }
  return blocks;
}

function toParams(req: ChatRequest): CreateParams & { betas?: string[] } {
  const system: string[] = [];
  const messages: MessageParam[] = [];
  const push = (role: "user" | "assistant", blocks: Block[]) => {
    if (!blocks.length) return;
    const last = messages[messages.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) (last.content as Block[]).push(...blocks);
    else messages.push({ role, content: blocks });
  };
  for (const m of req.messages) {
    if (m.role === "system" || m.role === "developer") {
      const text = textOf(m.content).trim();
      if (text) system.push(text);
    } else if (m.role === "user") {
      push("user", userBlocks(m.content));
    } else if (m.role === "assistant") {
      const text = textOf(m.content).trim();
      const calls: Block[] = (m.tool_calls ?? []).map((c) => ({ type: "tool_use", id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) }));
      push("assistant", [...(text ? [{ type: "text" as const, text }] : []), ...calls]);
    } else if (m.role === "tool" && m.tool_call_id) {
      push("user", [{ type: "tool_result", tool_use_id: m.tool_call_id, content: textOf(m.content) || "(empty)" }]);
    }
  }
  // The conversation must open with the student. A history cut short can start with an answer.
  if (messages[0]?.role === "assistant") messages.unshift({ role: "user", content: "(Our conversation so far.)" });
  if (req.response_format?.type === "json_object") system.push("Reply with a single JSON object and nothing else.");

  const model = req.model;
  const max = req.max_completion_tokens ?? req.max_tokens ?? 4096;
  const tools: Tool[] | undefined = req.tools?.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: (t.function.parameters ?? { type: "object", properties: {} }) as Tool["input_schema"],
    // Stream tool input as it's written, rather than in one burst at the end.
    ...(req.stream ? { eager_input_streaming: true } : {}),
  }));
  const choice = req.tool_choice;
  const tool_choice =
    !tools || !choice
      ? undefined
      : choice === "none"
        ? ({ type: "none" } as const)
        : choice === "auto"
          ? ({ type: "auto" } as const)
          : choice === "required"
            ? ({ type: "any" } as const)
            : ({ type: "tool", name: choice.function.name } as const);
  const fallback = SERVER_FALLBACK.test(model);

  return {
    model,
    max_tokens: Math.min(64_000, max + THINKING_ROOM),
    messages,
    ...(system.length ? { system: system.join("\n\n") } : {}),
    ...(tools?.length ? { tools } : {}),
    ...(tool_choice ? { tool_choice } : {}),
    // Thinking stays at the model's default; effort keeps it short.
    ...(TAKES_EFFORT.test(model) ? { output_config: { effort: req.reasoning_effort === "medium" ? ("medium" as const) : ("low" as const) } } : {}),
    // A request Claude declines is retried server-side on the model Anthropic recommends for it.
    ...(fallback ? { fallbacks: "default" as const, betas: ["server-side-fallback-2026-07-01"] } : {}),
  };
}

function parseArgs(args: string): Record<string, unknown> {
  try {
    const v = JSON.parse(args || "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const FINISH: Partial<Record<StopReason, string>> = { end_turn: "stop", stop_sequence: "stop", tool_use: "tool_calls", max_tokens: "length", refusal: "content_filter" };
const DECLINED = "Claude declined to answer this. Try asking it another way, or pick a different model in Settings.";

type Usage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };
const usageOf = (input: number, output: number): Usage => ({ prompt_tokens: input, completion_tokens: output, total_tokens: input + output });

function toCompletion(msg: Anthropic.Beta.Messages.BetaMessage) {
  // After a fallback, only what comes after the last switch belongs to the answer.
  const lastSwitch = msg.content.map((b) => b.type).lastIndexOf("fallback");
  const blocks = msg.content.slice(lastSwitch + 1);
  let text = blocks.map((b) => (b.type === "text" ? b.text : "")).join("");
  const calls =
    msg.stop_reason === "tool_use"
      ? blocks.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, type: "function" as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }] : []))
      : [];
  if (msg.stop_reason === "refusal" && !text.trim()) text = DECLINED;
  const u = msg.usage;
  const input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  return {
    id: msg.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: msg.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) },
        finish_reason: (msg.stop_reason && FINISH[msg.stop_reason]) ?? "stop",
      },
    ],
    usage: usageOf(input, u.output_tokens ?? 0),
  };
}

// Claude's events as chat-completion chunks. Text goes out as it arrives;
// tool calls are held until the message ends, so a call cut off by the
// output limit, or one made before a fallback, is never run.
function toChunks(events: AsyncIterable<StreamEvent>, requested: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const id = `msg_${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  let model = requested;
  const frame = (payload: Record<string, unknown>) => encoder.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, ...payload })}\n\n`);
  const delta = (d: Record<string, unknown>, finish: string | null = null) => frame({ choices: [{ index: 0, delta: d, finish_reason: finish }] });

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let input = 0;
      let output = 0;
      let sentText = false;
      let stop: StopReason | null = null;
      const blocks = new Map<number, { kind: "text" } | { kind: "tool"; id: string; name: string; json: string } | { kind: "other" }>();
      let calls: { id: string; name: string; json: string }[] = [];
      try {
        controller.enqueue(delta({ role: "assistant", content: "" }));
        for await (const e of events) {
          switch (e.type) {
            case "message_start": {
              model = e.message.model || model;
              const u = e.message.usage;
              input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
              output = u.output_tokens ?? 0;
              break;
            }
            case "content_block_start": {
              const b = e.content_block;
              if (b.type === "text") {
                blocks.set(e.index, { kind: "text" });
                if (b.text) {
                  sentText = true;
                  controller.enqueue(delta({ content: b.text }));
                }
              } else if (b.type === "tool_use") {
                blocks.set(e.index, { kind: "tool", id: b.id, name: b.name, json: "" });
              } else {
                // A fallback starts over: tool calls before it are not part of the answer.
                if (b.type === "fallback") calls = [];
                blocks.set(e.index, { kind: "other" });
              }
              break;
            }
            case "content_block_delta": {
              const block = blocks.get(e.index);
              if (e.delta.type === "text_delta" && block?.kind === "text" && e.delta.text) {
                sentText = true;
                controller.enqueue(delta({ content: e.delta.text }));
              } else if (e.delta.type === "input_json_delta" && block?.kind === "tool") {
                block.json += e.delta.partial_json;
              }
              break;
            }
            case "content_block_stop": {
              const block = blocks.get(e.index);
              if (block?.kind === "tool") calls.push({ id: block.id, name: block.name, json: block.json || "{}" });
              break;
            }
            case "message_delta":
              stop = e.delta.stop_reason ?? stop;
              if (e.usage?.output_tokens != null) output = e.usage.output_tokens;
              break;
          }
        }
        if (stop === "refusal") {
          controller.enqueue(delta({ content: sentText ? "\n\n_(Claude stopped partway through this answer.)_" : DECLINED }));
        }
        if (stop === "tool_use" && calls.length) {
          controller.enqueue(
            delta({ tool_calls: calls.map((c, index) => ({ index, id: c.id, type: "function", function: { name: c.name, arguments: c.json } })) }),
          );
        }
        controller.enqueue(delta({}, (stop && FINISH[stop]) ?? "stop"));
        controller.enqueue(frame({ choices: [], usage: usageOf(input, output) }));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

export function anthropicFetch(conn: Connection): typeof fetch {
  // Anthropic's SDK retries what's worth retrying (rate limits, overload);
  // the Groq SDK in front of it is told not to retry again.
  const client = new Anthropic({ apiKey: conn.key, maxRetries: 2 });
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!/\/chat\/completions$/.test(new URL(url).pathname) || typeof init?.body !== "string") {
      return ownError(404, "Confu doesn't use that part of the API with Claude.", "anthropic");
    }
    const req = JSON.parse(init.body) as ChatRequest;
    const params = toParams(req);
    const options = { signal: init.signal ?? undefined };
    try {
      if (req.stream) {
        const events = await client.beta.messages.create({ ...params, stream: true }, options);
        return new Response(toChunks(events, req.model), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      const msg = await client.beta.messages.create({ ...params, stream: false }, options);
      return Response.json(toCompletion(msg));
    } catch (err) {
      if (err instanceof Anthropic.APIError && typeof err.status === "number") {
        const retryAfter = err.headers?.get?.("retry-after");
        const body = { error: { message: err.message, type: (err.error as { error?: { type?: string } } | undefined)?.error?.type ?? "api_error" } };
        const headers = new Headers({ "content-type": "application/json", "x-confu-provider": "anthropic", "x-should-retry": "false" });
        if (retryAfter) headers.set("retry-after", retryAfter);
        return new Response(JSON.stringify(body), { status: err.status, headers });
      }
      throw err;
    }
  };
}

// The models this key can use, newest first as Anthropic lists them.
// Throws Anthropic.AuthenticationError for a rejected key.
export async function anthropicModels(key: string): Promise<string[]> {
  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 15_000 });
  const ids: string[] = [];
  for await (const m of client.models.list({ limit: 100 })) {
    ids.push(m.id);
    if (ids.length >= 200) break;
  }
  return ids;
}

export const isAnthropicAuthError = (err: unknown) => err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError;
