import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportsLimits, transportFor, withModels } from "@/lib/ai/connection";
import { PROVIDERS, isProviderId, type ProviderId } from "@/lib/ai/providers";
import { KEY_ERRORS } from "@/lib/ai-key";
import { loadConnection } from "@/lib/ai-keys";
import { groqClient, type Groq } from "@/lib/groq";
import { poolFetch, poolSize } from "@/lib/groq-pool";
import type { Role } from "@/lib/roles";
import { createMeter, type Feature, type KeyRef, type Meter } from "@/lib/usage";
import { logError } from "@/lib/log";

// Who pays for a request:
//   the student's own AI (a key or a connected OpenRouter account), always first;
//   the owner: those server keys (GROQ_API_KEYS) still answer when their own
//   AI can't (rate limit, no credit, a missing model, or the provider is down);
//   anyone else without one: a few free prompts on the server's keys, once.

// Usage is tracked per actual key: 'server' for the owner on the server's
// keys, 'trial' for free prompts, 'key:<id>' for a student's own key
// (replacing a key creates a new id).
export const SERVER_KEY_REF: KeyRef = "server";
export const TRIAL_KEY_REF: KeyRef = "trial";

// Accounts with no AI of their own can try Confu on the server's keys:
// 10 prompts, plus 20 scanned pages read, once. The database counts them
// (use_trial in migration 0014); these numbers are only for display.
export const TRIAL_PROMPTS = 10;
export const TRIAL_PAGES = 20;

export type TrialState = { promptsUsed: number; pagesUsed: number };

// null when the trial isn't set up (migration 0014) or there are no server keys.
export async function trialState(supabase: SupabaseClient, userId: string): Promise<TrialState | null> {
  if (!poolSize()) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  const row = data as { trial_prompts_used?: number; trial_pages_used?: number } | null;
  if (error || !row || row.trial_prompts_used === undefined) return null;
  return { promptsUsed: row.trial_prompts_used, pagesUsed: row.trial_pages_used ?? 0 };
}

export async function trialPromptsLeft(supabase: SupabaseClient, userId: string): Promise<number> {
  const t = await trialState(supabase, userId);
  return t ? Math.max(0, TRIAL_PROMPTS - t.promptsUsed) : 0;
}

export const userKeyRef = (keyId: string): KeyRef => `key:${keyId}`;

// 'admin' is set by hand in the database; users can't change their own role.
export async function getRole(supabase: SupabaseClient, userId: string): Promise<Role> {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return (data as { role?: string | null } | null)?.role === "admin" ? "admin" : null;
}

// Whether the owner's requests can run on the server's keys.
export const serverKeysReady = () => poolSize() > 0;

// AI that doesn't spend a free prompt: the student's own, or the owner on
// the server's keys. For extras (like the pace estimate) that shouldn't use
// up the trial.
export async function hasOwnAccess(supabase: SupabaseClient, userId: string, sessionId: string | null) {
  if (await loadConnection(supabase, userId, sessionId)) return true;
  return serverKeysReady() && (await getRole(supabase, userId)) === "admin";
}

export type AiAccess = { groq: Groq; meter: Meter; provider: ProviderId };

// The owner's own AI failed in a way the server's Groq keys can still cover.
// A rejected key (401/403) is not one of these: that has to be fixed in Settings.
async function providerCannotServe(res: Response): Promise<boolean> {
  if (res.ok) return false;
  if ([402, 404, 408, 409, 429, 500, 502, 503, 504, 529].includes(res.status)) return true;
  if (res.status !== 400) return false;
  const text = await res.clone().text().catch(() => "");
  return /model/i.test(text) && /not found|does not exist|no endpoints|invalid|unknown|not supported|decommissioned|deprecated/i.test(text);
}

// Decide what a request runs on. The returned client speaks the OpenAI chat
// format whatever the provider (lib/ai/connection.ts); the meter records
// usage (and, where the provider reports them, its limits). Call
// meter.flush() once the route's AI work is done.
export async function resolveAi(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | null,
  feature: Feature,
): Promise<AiAccess | { error: Response }> {
  const own = await loadConnection(supabase, userId, sessionId);
  if (own) {
    const personal = createMeter(supabase, {
      userId,
      sessionId,
      keyRef: userKeyRef(own.id),
      feature,
      baseFetch: transportFor(own),
      trackQuota: reportsLimits(own.provider),
    });
    // The transport sets the real key per request; the SDK just needs a placeholder.
    // withModels swaps the job's model, but leaves the caller's body alone, so a
    // retry can still send the server's own Groq model.
    const personalFetch = withModels(own.models, personal.fetch);
    const serverToo = serverKeysReady() && (await getRole(supabase, userId)) === "admin";
    if (!serverToo) return { groq: groqClient("connection", personalFetch), meter: personal, provider: own.provider };

    const server = createMeter(supabase, { userId, sessionId, keyRef: SERVER_KEY_REF, feature, baseFetch: poolFetch, trackQuota: false });
    const fetch: typeof globalThis.fetch = async (input, init) => {
      try {
        const res = await personalFetch(input, init);
        if (!(await providerCannotServe(res))) return res;
        try {
          const retry = await server.fetch(input, init);
          return retry.ok ? retry : res;
        } catch {
          return res;
        }
      } catch (err) {
        try {
          return await server.fetch(input, init);
        } catch {
          throw err;
        }
      }
    };
    return {
      groq: groqClient("connection", fetch),
      meter: { fetch, flush: async () => { await personal.flush(); await server.flush(); } },
      provider: own.provider,
    };
  }

  if (serverKeysReady() && (await getRole(supabase, userId)) === "admin") {
    const meter = createMeter(supabase, { userId, sessionId, keyRef: SERVER_KEY_REF, feature, baseFetch: poolFetch, trackQuota: false });
    return { groq: groqClient("gsk_pool", meter.fetch), meter, provider: "groq" };
  }

  // Nothing connected yet: each request uses one free prompt (or scanned
  // page) on the server's keys, until they're gone.
  const allowed = serverKeysReady() && (await supabase.rpc("use_trial", { kind: feature === "ocr" ? "page" : "prompt" })).data === true;
  if (allowed) {
    const meter = createMeter(supabase, { userId, sessionId, keyRef: TRIAL_KEY_REF, feature, baseFetch: poolFetch, trackQuota: false });
    return { groq: groqClient("gsk_pool", meter.fetch), meter, provider: "groq" };
  }
  const tried = (await trialState(supabase, userId)) !== null;
  return {
    error: Response.json(
      {
        error: tried
          ? feature === "ocr"
            ? "You've used the free scanned-page reading. Connect your own AI to read more."
            : `You've used your ${TRIAL_PROMPTS} free prompts. Connect your own AI to keep going: an API key, or your OpenRouter account.`
          : "Connect your own AI to use the tutor: an API key, or your OpenRouter account.",
        // Out of free pages only: not a reason to ask for a key in the middle of a session.
        code: tried && feature === "ocr" ? "TRIAL_PAGES_USED" : KEY_ERRORS.required,
      },
      { status: 428 },
    ),
  };
}

// Turn a provider failure into a response the client understands. A
// rejected key is reported distinctly so the client can ask for a new one.
export function aiErrorResponse(err: unknown, fallback: string): Response {
  const e = err as { status?: number; message?: string; headers?: Headers | Record<string, string> };
  const status = e?.status;
  const message = String(e?.message ?? "");
  const header = (name: string) => {
    const h = e?.headers;
    if (!h) return null;
    return typeof (h as Headers).get === "function" ? (h as Headers).get(name) : ((h as Record<string, string>)[name] ?? null);
  };
  const raw = header("x-confu-provider");
  const provider = isProviderId(raw) ? raw : null;
  const name = provider === "custom" ? "Your model server" : provider ? PROVIDERS[provider].name : "The AI provider";
  const own = header("x-confu-message");

  if (own) return Response.json({ error: decodeURIComponent(own) }, { status: status && status >= 400 ? status : 502 });
  if (!provider && /type.?:?\s*"?pool|Confu's keys|server Groq keys/i.test(message)) {
    return Response.json({ error: "The free prompts are busy right now. Try again in a minute, or connect your own AI." }, { status: 503 });
  }
  if (status === 401 || status === 403) {
    return Response.json(
      { error: `${name} rejected the saved ${provider === "openrouter" ? "connection" : "API key"}. Replace it in Settings or below.`, code: KEY_ERRORS.invalid },
      { status: 401 },
    );
  }
  if (status === 402 || (status === 429 && /insufficient_quota|exceeded your current quota|credit balance|out of credit/i.test(message))) {
    return Response.json({ error: `${name} says the account is out of credit. Add some there, or connect a different AI in Settings.` }, { status: 402 });
  }
  if ((status === 400 || status === 404) && /model/i.test(message) && /not (?:be )?found|does not exist|not exist|invalid model|unknown model|no endpoints|not supported|decommissioned|deprecated/i.test(message)) {
    return Response.json({ error: `${name} doesn't offer the model picked for this. Choose another in Settings → Your AI.` }, { status: 400 });
  }
  if (status === 429) {
    if (/tokens per day|TPD/i.test(message)) {
      return Response.json(
        { error: "This Groq key has used its daily token allowance. It frees up gradually over the next hours; see Settings → Usage.", code: "GROQ_DAILY_LIMIT" },
        { status: 429 },
      );
    }
    return Response.json({ error: `${name}'s rate limit was reached. Wait a minute and try again.` }, { status: 429 });
  }
  if (status === 529 || status === 503) return Response.json({ error: `${name} is overloaded right now. Try again in a minute.` }, { status: 503 });
  logError(fallback, err);
  return Response.json({ error: fallback }, { status: 502 });
}
