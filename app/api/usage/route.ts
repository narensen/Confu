import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { meterUsage } from "@/lib/usage-probe";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What the usage meters show. ?sessionId= picks the session's key (Free);
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
  const main = await meterUsage(supabase, userId, sessionId, { force: params.get("check") === "1" });
  return Response.json({ main }, { headers: { "Cache-Control": "no-store" } });
}
