import { z } from "zod";
import { logError } from "@/lib/log";
import type { Pack, PackContent, PackSource } from "@/lib/packs";
import { addDays, toISODate } from "@/lib/schedule";
import { papersByArxivIds } from "@/lib/scholar";
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

  const sources = (content.sources ?? []).slice(0, 60);
  // Papers: fresh details (authors, abstract) from arXiv in one request.
  const fresh = new Map(
    (await papersByArxivIds(sources.filter((s) => s.kind === "paper" && s.arxiv_id).map((s) => s.arxiv_id!)).catch(() => [])).map((p) => [p.arxiv_id, p]),
  );

  const { data: session, error: sessionError } = await supabase
    .from("study_sessions")
    .insert({ title: title.slice(0, 200), kind, draft_goal: content.plan ? "" : (content.goal ?? "").slice(0, 4000) })
    .select("id")
    .single();
  if (sessionError || !session) {
    logError("pack copy: session", sessionError);
    return Response.json({ error: sessionError?.code === "42703" ? "Copying needs migration 0024 to be run." : "Couldn't create the session." }, { status: 500 });
  }
  const sessionId = session.id as string;

  try {
    const ids = sources.map(() => crypto.randomUUID());
    if (sources.length) {
      const docs = sources.map((s, i) => {
        const p = s.arxiv_id ? fresh.get(s.arxiv_id) : undefined;
        const paper =
          s.kind === "paper"
            ? {
                authors: p?.authors ?? s.authors ?? [],
                year: p?.year ?? s.year ?? null,
                venue: p?.venue ?? s.venue ?? null,
                doi: p?.doi ?? s.doi ?? null,
                arxiv_id: s.arxiv_id ?? null,
                abstract: p?.abstract ?? s.abstract ?? null,
                pdf_url: s.pdf_url ?? p?.pdf_url ?? null,
              }
            : {};
        return {
          id: ids[i],
          session_id: sessionId,
          position: i,
          title: s.title.slice(0, 300),
          storage_path: null,
          page_count: s.kind === "paper" ? 1 : 0,
          outline: [],
          status: "ready",
          source_url: s.url,
          // pack_source: what to fetch (see PackSources in the workspace).
          meta: { ...paper, pack_source: { ...s, abstract: undefined } as PackSource },
        };
      });
      const ins = await supabase.from("documents").insert(docs);
      if (ins.error) throw ins.error;
      // A paper's abstract is searchable (and quotable by the tutor) before its PDF arrives.
      const pages = docs
        .filter((d) => d.meta.abstract)
        .map((d) => ({ document_id: d.id, page_number: 1, content: `${d.title}\n${(d.meta.authors ?? []).slice(0, 8).join(", ")}\n\nAbstract\n${d.meta.abstract}` }));
      if (pages.length) {
        const pg = await supabase.from("document_pages").insert(pages);
        if (pg.error) throw pg.error;
      }
    }

    // Papers get their three passes (the author's target, if they set one).
    const targets = new Map((content.passes ?? []).map((p) => [p.doc, p.target]));
    const reviews = sources.flatMap((s, i) => (s.kind === "paper" ? [{ document_id: ids[i], session_id: sessionId, target_pass: targets.get(i) ?? 1 }] : []));
    if (reviews.length) {
      const rv = await supabase.from("paper_reviews").insert(reviews);
      if (rv.error) throw rv.error;
    }

    if (content.plan) {
      const today = toISODate(new Date());
      const plan = content.plan;
      const { data: p, error } = await supabase
        .from("study_plans")
        .insert({
          session_id: sessionId,
          goal: plan.goal,
          goal_title: plan.goal_title,
          goal_summary: plan.goal_summary,
          materials: plan.materials,
          phases: plan.phases,
          level: plan.level,
          start_date: today,
          deadline: addDays(today, Math.max(1, plan.days)),
          minutes_per_day: plan.minutes_per_day,
          overview: plan.overview,
        })
        .select("id")
        .single();
      if (error || !p) throw error ?? new Error("plan");
      const topics = (content.topics ?? []).slice(0, 200).map((t, i) => {
        const doc = t.doc !== null && t.doc < ids.length ? ids[t.doc] : null;
        return {
          plan_id: p.id,
          position: i,
          phase: t.phase,
          source: doc ? t.source : "external",
          document_id: doc,
          title: t.title,
          objectives: t.objectives,
          key_concepts: t.key_concepts,
          resources: t.resources,
          page_start: doc ? t.page_start : null,
          page_end: doc ? t.page_end : null,
          est_minutes: t.est_minutes,
          due_date: addDays(today, Math.min(Math.max(0, t.day), Math.max(1, plan.days))),
        };
      });
      if (topics.length) {
        const tp = await supabase.from("plan_topics").insert(topics);
        if (tp.error) throw tp.error;
      }
    }

    const highlights = (content.highlights ?? [])
      .filter((h) => h.doc < ids.length)
      .slice(0, 300)
      .map((h) => ({ document_id: ids[h.doc], kind: "text", page_number: h.page, selected_text: h.text, note: h.note, color: h.color, rects: h.rects ?? [] }));
    if (highlights.length) {
      const hl = await supabase.from("highlights").insert(highlights);
      if (hl.error) throw hl.error;
    }

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
    await supabase.from("study_sessions").delete().eq("id", sessionId);
    logError("pack copy failed", err);
    return Response.json({ error: "Couldn't copy it into your library. Try again." }, { status: 500 });
  }
}
