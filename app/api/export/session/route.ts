import { connection } from "next/server";
import { colorOf, HIGHLIGHT_COLORS } from "@/lib/highlights";
import { PASSES } from "@/lib/paper";
import { cueFor, revealFor, type ReviewItem } from "@/lib/review";
import { createClient } from "@/lib/supabase/server";

// A session to take elsewhere. format=md: one Markdown file (opens in
// Obsidian, Notion, any editor): the goal, the plan with what's done, every
// highlight and note by file, and the paper pass notes. format=anki: the
// session's review cards as an Anki import file (File → Import).
export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const format = url.searchParams.get("format") === "anki" ? "anki" : "md";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Invalid session" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Row-level security: only the student's own session and its rows.
  const { data: session } = await supabase.from("study_sessions").select("id, title, kind").eq("id", id).maybeSingle();
  if (!session) return Response.json({ error: "Session not found" }, { status: 404 });
  const slug = session.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "confu-session";

  if (format === "anki") {
    const { data } = await supabase.from("review_items").select("source, prompt, question, answer, page_number").eq("session_id", id).eq("suspended", false);
    const cell = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
    const tag = `confu::${slug}`;
    const rows = ((data ?? []) as Pick<ReviewItem, "source" | "prompt" | "question" | "answer" | "page_number">[]).flatMap((item) => {
      const cue = cueFor(item);
      const back = revealFor(item);
      if (!back) return [];
      const front = [cue.quote ? `“${cue.quote}”` : "", cue.question].filter(Boolean).join("<br><br>");
      return [`${cell(front)}\t${cell(`${back.label}: ${back.body}`)}\t${tag} confu::${item.source}`];
    });
    const body = ["#separator:tab", "#html:true", "#tags column:3", ...rows].join("\n");
    return new Response(body, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${slug}-anki.txt"`, "Cache-Control": "no-store" },
    });
  }

  const [{ data: plan }, { data: docRows }] = await Promise.all([
    supabase.from("study_plans").select("id, goal, goal_title, goal_summary, deadline, minutes_per_day, phases").eq("session_id", id).maybeSingle(),
    supabase.from("documents").select("id, title, position, source_url, meta").eq("session_id", id).order("position").order("created_at"),
  ]);
  const docs = (docRows ?? []) as { id: string; title: string; source_url: string | null; meta: Record<string, unknown> | null }[];
  const docIds = docs.map((d) => d.id);
  const label = new Map(docs.map((d, i) => [d.id, `D${i + 1}`]));
  const [{ data: topicRows }, { data: highlightRows }, { data: reviewRows }, { data: savedRows }] = await Promise.all([
    plan ? supabase.from("plan_topics").select("title, phase, status, source, document_id, page_start, page_end, objectives").eq("plan_id", plan.id).order("position") : Promise.resolve({ data: [] }),
    docIds.length ? supabase.from("highlights").select("document_id, kind, page_number, color, selected_text, vlm_description, note").in("document_id", docIds).order("page_number") : Promise.resolve({ data: [] }),
    docIds.length ? supabase.from("paper_reviews").select("document_id, passes_done, pass1, pass2, pass3").in("document_id", docIds) : Promise.resolve({ data: [] }),
    // Tutor answers the student saved (migration 0041; none before it).
    supabase.from("saved_answers").select("question, answer, created_at").eq("session_id", id).order("created_at"),
  ]);

  const out: string[] = [`# ${session.title}`, "", `_Exported from Confu on ${new Date().toISOString().slice(0, 10)}._`, ""];
  const one = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

  if (plan) {
    out.push("## Goal", "", `**${one(plan.goal_title) || "Study goal"}**`, "");
    if (plan.goal_summary) out.push(one(plan.goal_summary), "");
    out.push(`Deadline ${plan.deadline} · ${+(plan.minutes_per_day / 60).toFixed(2)} h a day`, "");
    const topics = (topicRows ?? []) as { title: string; phase: number; status: string; source: string; document_id: string | null; page_start: number | null; page_end: number | null; objectives: string[] }[];
    const phases = ((plan.phases as { title: string }[] | null) ?? []).map((p) => p.title);
    out.push("## Plan", "");
    let phase = -1;
    for (const t of topics) {
      if (t.phase !== phase) {
        phase = t.phase;
        out.push(`### ${phases[phase] ?? `Phase ${phase + 1}`}`, "");
      }
      const where =
        t.source === "pdf" && t.document_id && t.page_start
          ? ` (${label.get(t.document_id) ?? "PDF"} ${t.page_start === t.page_end ? `p. ${t.page_start}` : `pp. ${t.page_start}–${t.page_end}`})`
          : "";
      out.push(`- [${t.status === "completed" ? "x" : " "}] ${one(t.title)}${where}`);
      for (const o of t.objectives ?? []) out.push(`  - ${one(o)}`);
    }
    out.push("");
  }

  if (docs.length) {
    out.push("## Files", "");
    for (const d of docs) out.push(`- ${label.get(d.id)}: ${one(d.title)}${d.source_url ? ` (${d.source_url})` : ""}`);
    out.push("");
  }

  const highlights = (highlightRows ?? []) as { document_id: string; kind: string; page_number: number; color: string; selected_text: string | null; vlm_description: string | null; note: string | null }[];
  if (highlights.length) {
    out.push("## Highlights and notes", "");
    for (const d of docs) {
      const mine = highlights.filter((h) => h.document_id === d.id);
      if (!mine.length) continue;
      out.push(`### ${label.get(d.id)}: ${one(d.title)}`, "");
      for (const h of mine) {
        if (h.kind === "region") out.push(`- Figure, p. ${h.page_number}: ${one((h.vlm_description ?? "").split("\n")[0]).slice(0, 300)}`);
        else out.push(`- p. ${h.page_number} · ${HIGHLIGHT_COLORS[colorOf(h.color)].label}: “${one(h.selected_text)}”`);
        if (h.note) out.push(`  - Note: ${one(h.note)}`);
      }
      out.push("");
    }
  }

  const saved = (savedRows ?? []) as { question: string | null; answer: string; created_at: string }[];
  if (saved.length) {
    out.push("## Saved from the tutor", "");
    for (const a of saved) {
      out.push(`### ${one(a.question?.replace(/[*_`#>]/g, "")) || "Saved answer"}`, "", `_Saved ${a.created_at.slice(0, 10)}_`, "", a.answer.trim(), "");
    }
  }

  const reviews = (reviewRows ?? []) as { document_id: string; passes_done: number; pass1: Record<string, string>; pass2: Record<string, string>; pass3: Record<string, string> }[];
  const withNotes = reviews.filter((r) => [r.pass1, r.pass2, r.pass3].some((p) => Object.values(p ?? {}).some((v) => typeof v === "string" && v.trim())));
  if (withNotes.length) {
    out.push("## Paper notes", "");
    for (const r of withNotes) {
      const d = docs.find((x) => x.id === r.document_id);
      out.push(`### ${one(d?.title) || "Paper"}`, "");
      for (const pass of PASSES) {
        const notes = (r as unknown as Record<string, Record<string, string>>)[`pass${pass.n}`] ?? {};
        const filled = pass.fields.filter((f) => typeof notes[f.key] === "string" && notes[f.key].trim());
        if (!filled.length) continue;
        out.push(`**Pass ${pass.n}: ${pass.name}**`, "");
        for (const f of filled) out.push(`- ${f.label}: ${notes[f.key].trim().replace(/\n+/g, " ")}`);
        out.push("");
      }
    }
  }

  return new Response(out.join("\n").trim() + "\n", {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${slug}.md"`, "Cache-Control": "no-store" },
  });
}
