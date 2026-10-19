import { looksLikeGroqKey, GROQ_KEY_HEADER, KEY_ERRORS } from "@/lib/ai-key";
import { groqClient } from "@/lib/groq";
import { createClient } from "@/lib/supabase/server";

// Checks a user's Groq key before the browser saves it for a session. Signed-in
// users only, so this can't be used as an open key checker. The key is not stored.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const key = request.headers.get(GROQ_KEY_HEADER)?.trim() ?? "";
  if (!looksLikeGroqKey(key)) {
    return Response.json({ error: "That doesn't look like a Groq API key (they start with gsk_).", code: KEY_ERRORS.invalid }, { status: 400 });
  }

  try {
    await groqClient(key).models.list();
    return Response.json({ ok: true });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 401 || status === 403) {
      return Response.json({ error: "Groq rejected this key. Copy it again from console.groq.com/keys.", code: KEY_ERRORS.invalid }, { status: 401 });
    }
    return Response.json({ error: "Couldn't reach Groq to check the key. Try again." }, { status: 502 });
  }
}
