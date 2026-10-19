import { connection } from "next/server";
import { MODELS } from "@/lib/groq";
import { createClient } from "@/lib/supabase/server";
import { freshUsage, sessionKeyRef } from "@/lib/usage-probe";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Usage of the key a session runs on, for the in-session meter.
// ?check=1 asks Groq directly (throttled) instead of relying on past requests.
export async function GET(request: Request) {
  await connection();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const raw = params.get("sessionId");
  const sessionId = raw && UUID.test(raw) ? raw : null;

  const keyRef = await sessionKeyRef(supabase, userId, sessionId);
  if (!keyRef) return Response.json({ keyRef: null, main: null }, { headers: { "Cache-Control": "no-store" } });

  const usage = await freshUsage(supabase, userId, sessionId, keyRef, { force: params.get("check") === "1" });
  // The tutor model is what most usage goes to, so the meter follows it.
  const main = usage?.models.find((m) => m.model === MODELS.chat) ?? null;
  return Response.json({ keyRef, main }, { headers: { "Cache-Control": "no-store" } });
}
