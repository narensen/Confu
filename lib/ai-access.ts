import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GROQ_KEY_HEADER, KEY_ERRORS, looksLikeGroqKey } from "@/lib/ai-key";
import { groqClient, SERVER_GROQ_KEY, type Groq } from "@/lib/groq";

export async function getRole(supabase: SupabaseClient, userId: string): Promise<"admin" | null> {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role === "admin" ? "admin" : null;
}

// Decide which Groq key a request runs on. Admins use the server key; everyone
// else must send their own key for the session. The user's key is used for
// this request only and is never stored or logged.
export async function resolveGroq(
  supabase: SupabaseClient,
  userId: string,
  request: Request,
): Promise<{ groq: Groq } | { error: Response }> {
  if ((await getRole(supabase, userId)) === "admin") {
    if (!SERVER_GROQ_KEY) return { error: Response.json({ error: "The server's Groq key is not configured." }, { status: 500 }) };
    return { groq: groqClient(SERVER_GROQ_KEY) };
  }

  const key = request.headers.get(GROQ_KEY_HEADER)?.trim();
  if (!key) {
    return {
      error: Response.json({ error: "Add your Groq API key for this session to use the tutor.", code: KEY_ERRORS.required }, { status: 428 }),
    };
  }
  if (!looksLikeGroqKey(key)) {
    return { error: Response.json({ error: "That doesn't look like a Groq API key (they start with gsk_).", code: KEY_ERRORS.invalid }, { status: 401 }) };
  }
  return { groq: groqClient(key) };
}

// Turn a Groq SDK failure into a response the client understands. A rejected
// key is reported distinctly so the client can ask for a new one.
export function groqErrorResponse(err: unknown, fallback: string): Response {
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) {
    return Response.json({ error: "Groq rejected this API key. Check it and enter it again.", code: KEY_ERRORS.invalid }, { status: 401 });
  }
  if (status === 429) {
    return Response.json({ error: "Groq's rate limit was reached for this key. Wait a minute and try again." }, { status: 429 });
  }
  console.error(fallback, err);
  return Response.json({ error: fallback }, { status: 502 });
}
