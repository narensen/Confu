import { z } from "zod";
import { logError } from "@/lib/log";
import type { Pack, PackContent } from "@/lib/packs";
import { insertSessionFromPackContent } from "@/lib/packs-server";
import { createClient } from "@/lib/supabase/server";
import { templateBySlug, templateContent } from "@/lib/templates";

export const maxDuration = 60;

const Body = z.object({
  slug: z.string().trim().max(120).optional(), // a study pack
  template: z.string().trim().max(120).optional(), // or a goal template
  share: z.boolean().default(false), // class mode: share progress with the pack's author
});

// Copy a study pack or a goal template into a new session of your own. The
// sources become documents to fetch (papers, pages, lectures) or to upload
// (the author's own files), so nothing is copied from anyone's storage. The
// plan, if there is one, starts today.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  if (!claims?.sub) return Response.json({ error: "Sign in to copy this." }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (!parsed.data.slug && !parsed.data.template)) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { slug, template, share } = parsed.data;

  let title: string;
  let kind: "study" | "paper" | "exam";
  let content: PackContent;
  if (template) {
    const t = templateBySlug(template);
    if (!t) return Response.json({ error: "That template doesn't exist." }, { status: 404 });
    title = t.title;
    kind = t.kind;
    content = templateContent(t);
  } else {
    const { data, error } = await supabase.rpc("get_pack", { p_slug: slug });
    if (error) return Response.json({ error: /get_pack/.test(error.message) ? "Study packs need migration 0024 to be run." : error.message }, { status: 500 });
    const pack = ((data ?? []) as Pack[])[0];
    if (!pack) return Response.json({ error: "That pack was unpublished or never existed." }, { status: 404 });
    title = pack.title;
    kind = pack.kind;
    content = pack.content;
  }

  let sessionId: string | null = null;
  try {
    sessionId = await insertSessionFromPackContent(supabase, { title, kind, content });
    if (slug) {
      const name = ((claims.user_metadata ?? {}) as { full_name?: string }).full_name?.trim().split(/\s+/)[0] ?? null;
      const rec = await supabase.rpc("record_pack_copy", { p_slug: slug, p_session: sessionId, p_share: share, p_name: name });
      if (rec.error) logError("pack copy: record", rec.error);
      else {
        const grant = await supabase.rpc("grant_class_rep", { p_slug: slug });
        if (grant.error && !/grant_class_rep|schema cache|Could not find the function/i.test(grant.error.message)) logError("pack copy: class rep", grant.error);
      }
    }
    return Response.json({ sessionId });
  } catch (err) {
    // Don't leave half a copy behind.
    if (sessionId) await supabase.from("study_sessions").delete().eq("id", sessionId);
    const message = err instanceof Error ? err.message : "";
    if (/migration 0024/.test(message)) return Response.json({ error: message }, { status: 500 });
    logError("pack copy failed", err);
    return Response.json({ error: "Couldn't copy it into your library. Try again." }, { status: 500 });
  }
}
