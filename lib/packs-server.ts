import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createAnon } from "@supabase/supabase-js";
import { cache } from "react";
import type { Pack, PackContent, PackSource } from "@/lib/packs";
import { addDays, toISODate } from "@/lib/schedule";
import { papersByArxivIds } from "@/lib/scholar";
import { createClient } from "@/lib/supabase/server";

// A pack by its link. Without cookies (for metadata and images, the same for
// everyone), or as the signed-in viewer (to know whether it's theirs).
export const getPackPublic = cache(async (slug: string): Promise<Pack | null> => {
  const anon = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data } = await anon.rpc("get_pack", { p_slug: slug.slice(0, 120) });
  return ((data ?? []) as Pack[])[0] ?? null;
});

export const getPackForViewer = cache(async (slug: string): Promise<Pack | null> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_pack", { p_slug: slug.slice(0, 120) });
  return ((data ?? []) as Pack[])[0] ?? null;
});

// Short course code, if 0028 has been run. Missing function: no code, page still works.
export const courseCodeFor = cache(async (slug: string): Promise<string | null> => {
  const anon = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.rpc("course_of", { p_slug: slug.slice(0, 120) });
  if (error || typeof data !== "string" || !data) return null;
  return data;
});

// Lines of the section paper, if 0030 has been run. Missing function: no lines.
export const sectionScopeFor = cache(async (slug: string): Promise<string[]> => {
  const anon = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.rpc("section_scope", { p_slug: slug.slice(0, 120) });
  if (error || !Array.isArray(data)) return [];
  return data.filter((line): line is string => typeof line === "string" && line.trim().length > 0).slice(0, 8);
});

// Create the session a pack or a door card copies into. The caller records the
// copy and deletes the session if a later step throws.
// linkOnly indexes are titles and URLs the copier confirms. They are not fetched.
export async function insertSessionFromPackContent(
  supabase: SupabaseClient,
  opts: { title: string; kind: "study" | "paper" | "exam"; content: PackContent; linkOnly?: number[] },
): Promise<string> {
  const content = opts.content;
  const sources = (content.sources ?? []).slice(0, 60);
  const quiet = new Set(opts.linkOnly ?? []);
  const fresh = new Map(
    (await papersByArxivIds(sources.filter((s) => s.kind === "paper" && s.arxiv_id).map((s) => s.arxiv_id!)).catch(() => [])).map((p) => [p.arxiv_id, p]),
  );

  const base = {
    title: opts.title.slice(0, 200),
    kind: opts.kind,
    draft_goal: content.plan ? "" : (content.goal ?? "").slice(0, 4000),
  };
  const payload = { ...base, ...(opts.kind === "paper" ? { cite_mode: true } : {}) };
  let inserted = await supabase.from("study_sessions").insert(payload).select("id").single();
  if (inserted.error && opts.kind === "paper" && inserted.error.code === "42703" && /cite_mode/i.test(inserted.error.message)) {
    inserted = await supabase.from("study_sessions").insert(base).select("id").single();
  }
  if (inserted.error?.code === "42703") throw new Error("Copying needs migration 0024 to be run.");
  if (inserted.error || !inserted.data) throw inserted.error ?? new Error("Couldn't create the session.");
  const sessionId = inserted.data.id as string;

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
      const packSource = quiet.has(i) ? undefined : ({ ...s, abstract: undefined } as PackSource);
      return {
        id: ids[i],
        session_id: sessionId,
        position: i,
        title: s.title.slice(0, 300),
        storage_path: null,
        page_count: s.kind === "paper" ? 1 : 0,
        outline: [],
        status: "ready" as const,
        source_url: s.url,
        meta: packSource ? { ...paper, pack_source: packSource } : paper,
      };
    });
    const ins = await supabase.from("documents").insert(docs);
    if (ins.error) throw ins.error;
    const pages = docs
      .filter((d) => "abstract" in d.meta && d.meta.abstract)
      .map((d) => ({
        document_id: d.id,
        page_number: 1,
        content: `${d.title}\n${((d.meta as { authors?: string[] }).authors ?? []).slice(0, 8).join(", ")}\n\nAbstract\n${(d.meta as { abstract?: string }).abstract}`,
      }));
    if (pages.length) {
      const pg = await supabase.from("document_pages").insert(pages);
      if (pg.error) throw pg.error;
    }
  }

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
  return sessionId;
}
