import { z } from "zod";
import { logError } from "@/lib/log";
import { buildGraph, LIBRARY_LIMITS, type Graph, type SessionPaper } from "@/lib/openalex";
import { isPaperDoc } from "@/lib/paper";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const Body = z.object({ refresh: z.boolean().default(false) });
const FRESH_DAYS = 7;

type Row = {
  id: string;
  title: string;
  kind: string;
  archived_at?: string | null;
  documents: { id: string; title: string; meta: Record<string, unknown> | null; created_at: string }[];
  paper_reviews: { document_id: string }[];
};
export type LibrarySessionInfo = { id: string; title: string; kind: string; papers: number };

// The personal literature map: the papers in all of a student's sessions
// (archived ones aside), the foundations they share and the newer work citing
// them, with each node tagged by the sessions it connects. Kept for a week,
// or until the papers change.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const { data, error } = await supabase
    .from("study_sessions")
    .select("*, documents(id, title, meta, created_at), paper_reviews(document_id)")
    .neq("kind", "exam")
    .order("updated_at", { ascending: false });
  if (error) {
    logError("library graph query failed", error);
    return Response.json({ error: "Couldn't load your papers." }, { status: 500 });
  }

  // Papers: everything in a Papers session; in a study session, the PDFs read
  // as papers (passes started, or found by DOI / arXiv id). Newest first.
  const sessions: LibrarySessionInfo[] = [];
  const papers: (SessionPaper & { added: string; meta: Record<string, unknown> | null })[] = [];
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  for (const s of (data ?? []) as Row[]) {
    if (s.archived_at) continue;
    const reviewed = Object.fromEntries(s.paper_reviews.map((r) => [r.document_id, true]));
    const mine = s.documents.filter((d) => s.kind === "paper" || isPaperDoc(d, reviewed));
    if (!mine.length) continue;
    sessions.push({ id: s.id, title: s.title, kind: s.kind, papers: mine.length });
    for (const d of mine) {
      papers.push({
        docId: d.id,
        sessionId: s.id,
        title: d.title,
        doi: str(d.meta?.doi),
        arxiv: str(d.meta?.arxiv_id),
        openalex: str(d.meta?.openalex_id),
        year: typeof d.meta?.year === "number" ? d.meta.year : null,
        added: d.created_at,
        meta: d.meta,
      });
    }
  }
  if (!papers.length) return Response.json({ graph: null, sessions });
  papers.sort((a, b) => b.added.localeCompare(a.added));
  const docKey = papers.map((p) => p.docId).sort().join(",");

  if (!parsed.data.refresh) {
    const { data: cached } = await supabase.from("library_graphs").select("doc_key, graph, built_at").eq("user_id", userId).maybeSingle();
    if (cached && cached.doc_key === docKey && Date.now() - Date.parse(cached.built_at as string) < FRESH_DAYS * 86_400_000) {
      return Response.json({ graph: cached.graph as Graph, sessions, cached: true, total: papers.length });
    }
  }

  try {
    const { graph, resolved } = await buildGraph(papers, LIBRARY_LIMITS);
    // Remember each paper's OpenAlex id: the next build (and the session maps) start faster.
    await Promise.all(
      papers
        .filter((p) => resolved[p.docId] && p.openalex !== resolved[p.docId])
        .map((p) => supabase.from("documents").update({ meta: { ...(p.meta ?? {}), openalex_id: resolved[p.docId] } }).eq("id", p.docId)),
    );
    const saved = await supabase.from("library_graphs").upsert({ user_id: userId, doc_key: docKey, graph, built_at: graph.built }, { onConflict: "user_id" });
    if (saved.error && saved.error.code !== "42P01" && saved.error.code !== "PGRST205") logError("library graph cache failed", saved.error);
    return Response.json({ graph, sessions, cached: false, total: papers.length });
  } catch (err) {
    logError("library graph failed", err);
    return Response.json({ error: "Couldn't map your literature just now. Try again in a minute." }, { status: 502 });
  }
}
