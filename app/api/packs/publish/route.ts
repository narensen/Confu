import { z } from "zod";
import { logError } from "@/lib/log";
import { packSlug, sourceOf, type PackContent, type PackHighlight, type PackTopic } from "@/lib/packs";
import { daysBetween } from "@/lib/schedule";
import { createClient } from "@/lib/supabase/server";
import type { PlanTopic, StudyPlan } from "@/lib/types";

const Body = z.object({
  sessionId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(""),
  showName: z.boolean().default(true),
  visibility: z.enum(["public", "unlisted"]).default("unlisted"),
  classMode: z.boolean().default(false),
  includeHighlights: z.boolean().default(true),
  asRoadmap: z.boolean().default(false),
});

const MAX_HIGHLIGHTS = 300;

// Publish (or update) a session as a study pack: a snapshot of its sources,
// plan, paper targets and, if wanted, text highlights. Never the
// conversation, notes from passes, figures or uploaded files.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  if (!claims?.sub) return Response.json({ error: "Sign in to share a session." }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const o = parsed.data;

  const { data: session } = await supabase.from("study_sessions").select("id, kind").eq("id", o.sessionId).maybeSingle();
  if (!session) return Response.json({ error: "Session not found." }, { status: 404 });

  const [{ data: docRows }, { data: plan }, { data: reviews }, { data: profile }] = await Promise.all([
    supabase.from("documents").select("id, title, page_count, source_url, meta").eq("session_id", o.sessionId).order("position").order("created_at"),
    supabase.from("study_plans").select("*").eq("session_id", o.sessionId).maybeSingle(),
    supabase.from("paper_reviews").select("document_id, target_pass").eq("session_id", o.sessionId),
    supabase.from("profiles").select("full_name").eq("id", claims.sub).maybeSingle(),
  ]);
  const docs = (docRows ?? []) as { id: string; title: string; page_count: number; source_url: string | null; meta: Record<string, unknown> | null }[];
  const index = new Map(docs.map((d, i) => [d.id, i]));

  const p = plan as StudyPlan | null;
  if (o.asRoadmap && !p) return Response.json({ error: "Add a plan to this session before sharing it as a roadmap." }, { status: 400 });
  const topics = p ? (((await supabase.from("plan_topics").select("*").eq("plan_id", p.id).order("position")).data ?? []) as PlanTopic[]) : [];
  let highlights: PackHighlight[] = [];
  if (o.includeHighlights && docs.length) {
    const { data } = await supabase
      .from("highlights")
      .select("document_id, page_number, selected_text, note, color, rects")
      .in("document_id", docs.map((d) => d.id))
      .eq("kind", "text")
      .order("page_number")
      .limit(MAX_HIGHLIGHTS);
    highlights = ((data ?? []) as { document_id: string; page_number: number; selected_text: string | null; note: string | null; color: string; rects: unknown }[]).map((h) => ({
      doc: index.get(h.document_id) ?? 0,
      page: h.page_number,
      text: h.selected_text?.slice(0, 2000) ?? null,
      note: h.note?.slice(0, 2000) ?? null,
      color: h.color,
      rects: h.rects,
    }));
  }

  const content: PackContent = {
    v: 1,
    sources: docs.map(sourceOf),
    plan: p
      ? {
          goal: p.goal,
          goal_title: p.goal_title,
          goal_summary: p.goal_summary,
          materials: p.materials,
          phases: p.phases,
          level: p.level,
          days: Math.max(1, daysBetween(p.start_date, p.deadline)),
          minutes_per_day: p.minutes_per_day,
          overview: p.overview,
        }
      : null,
    topics: topics.map(
      (t): PackTopic => ({
        phase: t.phase,
        title: t.title,
        objectives: t.objectives,
        key_concepts: t.key_concepts,
        resources: t.resources ?? [],
        source: t.source,
        doc: t.document_id ? (index.get(t.document_id) ?? null) : null,
        page_start: t.page_start,
        page_end: t.page_end,
        est_minutes: t.est_minutes,
        day: p ? Math.max(0, daysBetween(p.start_date, t.due_date)) : 0,
      }),
    ),
    highlights,
    passes: ((reviews ?? []) as { document_id: string; target_pass: number }[])
      .filter((r) => index.has(r.document_id))
      .map((r) => ({ doc: index.get(r.document_id)!, target: Math.min(3, Math.max(1, r.target_pass)) as 1 | 2 | 3 })),
    ...(o.asRoadmap ? { roadmap: true as const } : {}),
  };

  const first = ((profile?.full_name as string | null) ?? "").trim().split(/\s+/)[0] || null;
  const row = {
    session_id: o.sessionId,
    kind: session.kind,
    title: o.title,
    description: o.description,
    author_name: o.showName ? first : null,
    visibility: o.visibility,
    class_mode: o.classMode,
    content,
  };

  const { data: existing } = await supabase.from("packs").select("id, slug").eq("session_id", o.sessionId).maybeSingle();
  if (existing) {
    const { error } = await supabase.from("packs").update(row).eq("id", existing.id);
    if (error) return failed(error);
    return Response.json({ slug: existing.slug, updated: true });
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = packSlug(o.title);
    const { error } = await supabase.from("packs").insert({ ...row, slug });
    if (!error) return Response.json({ slug, updated: false });
    if (error.code !== "23505") return failed(error); // only retry a taken link
  }
  return Response.json({ error: "Couldn't make a link for the pack. Try again." }, { status: 500 });
}

// Unpublish: the page goes away. Copies people already made stay theirs.
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
  if (!z.uuid().safeParse(sessionId).success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { error } = await supabase.from("packs").delete().eq("session_id", sessionId);
  if (error) return failed(error);
  return Response.json({ ok: true });
}

function failed(error: { code?: string; message: string }) {
  if (error.code === "42P01" || error.code === "PGRST205") return Response.json({ error: "Study packs need migration 0024 to be run." }, { status: 500 });
  logError("pack publish failed", error);
  return Response.json({ error: "Couldn't publish the pack. Try again." }, { status: 500 });
}
