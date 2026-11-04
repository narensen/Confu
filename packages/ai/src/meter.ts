import type { FetchLike } from "./fetch-like";

// Token usage of every request made through a client, reported as each one
// finishes (streamed answers report it in their last chunk). Observes the
// responses without changing them.

export type Usage = { model: string; promptTokens: number; completionTokens: number; totalTokens: number };
type Raw = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };

const toUsage = (model: string, u: Raw): Usage => {
  const prompt = u.prompt_tokens ?? 0;
  const completion = u.completion_tokens ?? 0;
  return { model, promptTokens: prompt, completionTokens: completion, totalTokens: u.total_tokens ?? prompt + completion };
};

async function usageFromStream(body: ReadableStream<Uint8Array>): Promise<Raw | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: Raw | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:") || !line.includes("usage")) continue;
      try {
        const chunk = JSON.parse(line.slice(5).trim()) as { usage?: Raw; x_groq?: { usage?: Raw } };
        usage = chunk.x_groq?.usage ?? chunk.usage ?? usage;
      } catch {}
    }
  }
  return usage;
}

export function meteredFetch(next: FetchLike, onUsage: (u: Usage) => void): FetchLike {
  return async (input, init) => {
    const res = await next(input, init);
    let model = "unknown";
    try {
      model = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model ?? model;
    } catch {}
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && type.includes("text/event-stream") && res.body) {
      const [forCaller, forMeter] = res.body.tee();
      void usageFromStream(forMeter).then((u) => u && onUsage(toUsage(model, u)), () => {});
      return new Response(forCaller, { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    if (res.ok && type.includes("application/json")) {
      void res
        .clone()
        .json()
        .then((b: { usage?: Raw }) => b.usage && onUsage(toUsage(model, b.usage)), () => {});
    }
    return res;
  };
}
