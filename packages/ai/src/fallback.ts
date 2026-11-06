import type { FetchLike } from "./fetch-like";
import type { Connection } from "./connection";
import { ownError } from "./openai-compat";
import { PROVIDERS, type ProviderId } from "./providers";

// When the model a request names is busy (rate-limited, overloaded, or an
// OpenRouter free model whose shared pool is full), the same request goes to
// another model the student can use instead of failing. A free model only
// ever hands over to other free models: switching to a paid one would spend
// the student's credit without asking.

// Models tried after the first one, at most.
const MAX_SWITCHES = 3;

export const isFreeModel = (model: string) => model.endsWith(":free");

// Providers whose default models sit on a free tier, so falling back to them costs nothing extra.
const FREE_TIER_DEFAULTS: ProviderId[] = ["groq", "gemini"];

// Not worth another model: the account or key itself is the problem.
const ACCOUNT_PROBLEM = /insufficient_quota|exceeded your current quota|credit balance|out of credit|insufficient credits|requires more credits/i;

// A failure another model may not have.
export async function isBusy(res: Response, provider: ProviderId, model: string): Promise<boolean> {
  if (res.ok || res.headers.has("x-confu-message")) return false;
  if (![429, 502, 503, 529, 404].includes(res.status)) return false;
  const text = await res.clone().text().catch(() => "");
  if (ACCOUNT_PROBLEM.test(text)) return false;
  if (res.status === 429 || res.status === 503 || res.status === 529) return true;
  // OpenRouter: the model's upstream failed, or a free model was taken down.
  if (provider !== "openrouter") return false;
  if (res.status === 502) return true;
  return isFreeModel(model) && /no endpoints/i.test(text);
}

type Part = { type?: string };
type Body = { model?: unknown; messages?: { content?: unknown }[] };

// Requests with a picture need a model that can see.
const wantsImages = (body: Body) =>
  Array.isArray(body.messages) && body.messages.some((m) => Array.isArray(m?.content) && (m.content as Part[]).some((p) => p?.type === "image_url"));

type CatalogRow = {
  id?: string;
  context_length?: number;
  created?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[]; tokenizer?: string | null };
};

// OpenRouter's catalog is public and changes often (free models come and
// go), so it's read live when needed and kept for a few minutes.
const FRESH_MS = 10 * 60_000;
// Page text and tutor history need room; tiny contexts can't take the request.
const MIN_CONTEXT = 16_000;
let catalog: { at: number; base: string; rows: CatalogRow[] } | null = null;

export async function freeModels(baseUrl: string, vision: boolean): Promise<string[]> {
  if (!catalog || catalog.base !== baseUrl || Date.now() - catalog.at > FRESH_MS) {
    try {
      const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: CatalogRow[] };
      catalog = { at: Date.now(), base: baseUrl, rows: Array.isArray(json.data) ? json.data : [] };
    } catch {
      return [];
    }
  }
  return catalog.rows
    .filter((r) => {
      const a = r.architecture;
      if (typeof r.id !== "string" || !isFreeModel(r.id) || a?.tokenizer === "Router") return false;
      if (a?.output_modalities && !a.output_modalities.includes("text")) return false;
      if (vision && !a?.input_modalities?.includes("image")) return false;
      return (r.context_length ?? 0) >= MIN_CONTEXT;
    })
    // Bigger contexts tend to be the bigger models; newest breaks ties.
    .sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0) || (b.created ?? 0) - (a.created ?? 0))
    .map((r) => r.id as string);
}

// For tests: forget the cached catalog.
export const resetFreeModels = () => {
  catalog = null;
};

// Other models to try, best first: the student's own picks for the other
// jobs, then models known to work on this provider.
export async function alternatives(conn: Connection, model: string, vision: boolean): Promise<string[]> {
  const own = vision ? [conn.models.vision] : [conn.models.chat, conn.models.vision, conn.models.fast];
  let list: string[];
  if (conn.provider === "openrouter" && isFreeModel(model)) {
    list = [...own.filter(isFreeModel), ...(await freeModels(conn.baseUrl, vision))];
  } else {
    const d = PROVIDERS[conn.provider].defaults;
    const defaults = FREE_TIER_DEFAULTS.includes(conn.provider) ? (vision ? [d.vision] : [d.chat, d.vision, d.fast]) : [];
    list = [...own, ...defaults];
  }
  return [...new Set(list)].filter((m) => m && m !== model);
}

// Shown when every model tried was busy.
function allBusy(conn: Connection, tried: string[], status: number): Response {
  const names = tried.join(", ");
  const message = isFreeModel(tried[0])
    ? `OpenRouter's free models are all busy right now (tried ${names}). They're shared between everyone; try again in a minute, or pick a paid model under Your AI.`
    : `${conn.provider === "custom" ? "Your model server" : PROVIDERS[conn.provider].name} is busy on every model Confu tried (${names}). Try again in a minute.`;
  return ownError(status === 529 || status === 503 ? 503 : 429, message, conn.provider);
}

// The response that answered, marked with the model that wrote it.
function answeredBy(res: Response, model: string, busy: string): Response {
  const headers = new Headers(res.headers);
  headers.set("x-confu-model", model);
  headers.set("x-confu-busy-model", busy);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const discard = (res: Response) => void res.body?.cancel().catch(() => {});

export function withFallback(conn: Connection, next: FetchLike): FetchLike {
  return async (input, init) => {
    const first = await next(input, init);
    if (first.ok || typeof init?.body !== "string") return first;
    let body: Body;
    try {
      body = JSON.parse(init.body) as Body;
    } catch {
      return first;
    }
    const model = typeof body.model === "string" ? body.model : "";
    if (!model || !(await isBusy(first, conn.provider, model))) return first;

    const others = (await alternatives(conn, model, wantsImages(body))).slice(0, MAX_SWITCHES);
    // Nothing else to try: the provider's own words say it best.
    if (!others.length) return first;

    discard(first);
    const tried = [model];
    for (const alt of others) {
      tried.push(alt);
      const res = await next(input, { ...init, body: JSON.stringify({ ...body, model: alt }) });
      if (res.ok) return answeredBy(res, alt, model);
      // A rejected key or an empty account won't be fixed by another model.
      if ([401, 402, 403].includes(res.status) || res.headers.has("x-confu-message")) return res;
      discard(res);
    }
    return allBusy(conn, tried, first.status);
  };
}
