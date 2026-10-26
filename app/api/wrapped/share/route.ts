import { randomBytes } from "node:crypto";
import { z } from "zod";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), showName: z.boolean().default(true) });

// Share a month's Wrapped: a snapshot of its numbers at a private link
// (/w/<token>). Sharing again updates it; DELETE takes it down.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  if (!claims?.sub) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { month, showName } = parsed.data;

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", claims.sub).maybeSingle();
  const p = profile as { full_name?: string | null; timezone?: string | null } | null;
  const { data: stats, error } = await supabase.rpc("my_wrapped", { p_month: `${month}-01`, p_tz: p?.timezone || "UTC" });
  if (error || !stats) {
    logError("wrapped share failed", error);
    return Response.json({ error: /my_wrapped/.test(error?.message ?? "") ? "Wrapped needs migration 0025 to be run." : "Couldn't share it." }, { status: 500 });
  }
  const { data: existing } = await supabase.from("wrapped_shares").select("token").eq("user_id", claims.sub).eq("month", `${month}-01`).maybeSingle();
  const token = (existing?.token as string | undefined) ?? randomBytes(16).toString("hex");
  const name = showName ? (p?.full_name?.trim().split(/\s+/)[0] ?? null) : null;
  const { error: saveError } = await supabase
    .from("wrapped_shares")
    .upsert({ token, month: `${month}-01`, stats, display_name: name }, { onConflict: "token" });
  if (saveError) {
    logError("wrapped share save failed", saveError);
    return Response.json({ error: "Couldn't share it." }, { status: 500 });
  }
  return Response.json({ token });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: "Invalid request" }, { status: 400 });
  await supabase.from("wrapped_shares").delete().eq("user_id", auth.claims.sub).eq("month", `${month}-01`);
  return Response.json({ ok: true });
}
