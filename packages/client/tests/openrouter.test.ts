import { describe, expect, test } from "bun:test";
import type { AddKey, DeviceKeys } from "@confu/client/keys";
import { finishOpenRouter, openRouterAuthUrl } from "@confu/client/openrouter";

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

const added: AddKey[] = [];
const keys = { add: async (input: AddKey) => (added.push(input), { ok: true }) } as unknown as DeviceKeys;

describe("OpenRouter in the browser", () => {
  test("sends the student to openrouter.ai with an S256 challenge of the kept verifier", async () => {
    const storage = memoryStorage();
    const url = new URL(await openRouterAuthUrl("https://confu.lol/app", "s1", storage));
    expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
    expect(url.searchParams.get("callback_url")).toBe("https://confu.lol/app");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const { v, s } = JSON.parse(storage.m.get("confu.openrouter")!);
    expect(s).toBe("s1");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
    expect(url.searchParams.get("code_challenge")).toBe(Buffer.from(digest).toString("base64url"));
  });

  test("trades the code for a key and keeps it as an OpenRouter connection", async () => {
    const storage = memoryStorage();
    await openRouterAuthUrl("https://confu.lol/app", null, storage);
    const { v } = JSON.parse(storage.m.get("confu.openrouter")!);
    let sent: Record<string, string> = {};
    const fetcher = async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({ key: "sk-or-v1-abc" });
    };
    expect(await finishOpenRouter(keys, "the-code", storage, fetcher)).toMatchObject({ ok: true });
    expect(sent).toEqual({ code: "the-code", code_verifier: v, code_challenge_method: "S256" });
    expect(added.at(-1)).toEqual({ provider: "openrouter", key: "sk-or-v1-abc", sessionId: null, via: "oauth" });
    expect(storage.m.has("confu.openrouter")).toBe(false); // used once
  });

  test("refuses a code with no sign-in started here, or a stale one", async () => {
    const storage = memoryStorage();
    expect(await finishOpenRouter(keys, "x", storage)).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
    storage.setItem("confu.openrouter", JSON.stringify({ v: "abc", s: null, at: Date.now() - 20 * 60_000 }));
    expect(await finishOpenRouter(keys, "x", storage)).toMatchObject({ ok: false });
  });

  test("a refused exchange says so", async () => {
    const storage = memoryStorage();
    await openRouterAuthUrl("https://confu.lol/app", null, storage);
    const fetcher = async () => Response.json({ error: "bad code" }, { status: 403 });
    expect(await finishOpenRouter(keys, "x", storage, fetcher)).toMatchObject({ ok: false, error: expect.stringMatching(/didn't approve/) });
  });
});
