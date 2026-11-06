import { z } from "zod";
import { checkPost, moderationConfigured } from "@/lib/moderation";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const Body = z.object({ ids: z.array(z.string().uuid()).min(1).max(5) });

// A thread page asks for the check on posts that haven't had one yet (a new
// question or reply, or an edit). Each post is claimed once in the database,
// so asking twice, or from two pages, never checks it twice.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Sign in first." }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const admin = adminClient();
  if (!moderationConfigured || !admin) return Response.json({ skipped: true, results: {} });

  const ids = [...new Set(parsed.data.ids)];
  const statuses = await Promise.all(ids.map((id) => checkPost(admin, id)));
  return Response.json({ results: Object.fromEntries(ids.map((id, i) => [id, statuses[i]])) });
}
