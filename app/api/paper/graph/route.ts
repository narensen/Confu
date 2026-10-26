import { z } from "zod";
import { logError } from "@/lib/log";
import { buildGraph, type Graph } from "@/lib/openalex";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const Body = z.object({ sessionId: z.uuid(), docIds: z.array(z.uuid()).min(1).max(15), refresh: z.boolean().default(false) });
const FRESH_DAYS = 14;

// The literature map for a session's papers: built from OpenAlex (and
// Semantic Scholar), then kept for two weeks or until the papers change.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Add a paper first." }, { status: 400 });
  const { sessionId, docIds, refresh } = parsed.data;

  const { data: rows } = await supabase.from("documents").select("id, title, meta").eq("session_id", sessionId).in("id", docIds);
  const docs = (rows ?? []) as { id: string; title: string; meta: Record<string, unknown> | null }[];
  if (!docs.length) return Response.json({ error: "Those papers aren't in this session." }, { status: 404 });
  const docKey = docs.map((d) => d.id).sort().join(",");

  if (!refresh) {
    const { data: cached } = await supabase.from("paper_graphs").select("doc_key, graph, built_at").eq("session_id", sessionId).maybeSingle();
    if (cached && cached.doc_key === docKey && Date.now() - Date.parse(cached.built_at as string) < FRESH_DAYS * 86_400_000) {
      return Response.json({ graph: cached.graph as Graph, cached: true });
    }
  }

  try {
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    const { graph, resolved } = await buildGraph(
      docs.map((d) => ({
        docId: d.id,
        title: d.title,
        doi: str(d.meta?.doi),
        arxiv: str(d.meta?.arxiv_id),
        openalex: str(d.meta?.openalex_id),
        year: typeof d.meta?.year === "number" ? d.meta.year : null,
      })),
    );
    // Remember each paper's OpenAlex id (the weekly email's new-paper alerts use it too).
    await Promise.all(
      docs
        .filter((d) => resolved[d.id] && d.meta?.openalex_id !== resolved[d.id])
        .map((d) => supabase.from("documents").update({ meta: { ...(d.meta ?? {}), openalex_id: resolved[d.id] } }).eq("id", d.id)),
    );
    const saved = await supabase.from("paper_graphs").upsert({ session_id: sessionId, doc_key: docKey, graph, built_at: graph.built }, { onConflict: "session_id" });
    if (saved.error && saved.error.code !== "42P01" && saved.error.code !== "PGRST205") logError("paper graph cache failed", saved.error);
    return Response.json({ graph, cached: false });
  } catch (err) {
    logError("paper graph failed", err);
    return Response.json({ error: "Couldn't map the literature just now. Try again in a minute." }, { status: 502 });
  }
}
