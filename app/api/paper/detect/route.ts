import { z } from "zod";
import { resolvePaper, sameTitle, searchPapers, titleWithin, type PaperMeta } from "@/lib/scholar";
import { PAPER_MAX_PAGES } from "@/lib/paper";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

export const maxDuration = 60;

const Body = z.object({ sessionId: z.uuid() });

// Study sessions: find which PDFs are research papers, so they get the
// three passes without being marked by hand. A PDF counts as a paper when
//   - its first page carries an arXiv stamp ("arXiv:2402.03300v3"), or
//   - Semantic Scholar / OpenAlex know a paper whose whole title is on its
//     first page (or matches its file name), and it has an abstract, or
//   - it's shaped like one: an abstract and an introduction up front and
//     references at the end, or
//   - the study goal names it and it has an abstract.
// The databases are asked once per PDF (meta.paper_check), and not at all
// while they're failing (a busy API never makes a paper "not a paper"); the
// other checks run every time, since they're free and the goal can change.
type Doc = { id: string; title: string; page_count: number; meta: Record<string, unknown> | null };

const ARXIV = /\barXiv:\s*(\d{4}\.\d{4,5})(v\d+)?/i;
const ARXIV_NAME = /^(\d{4}\.\d{4,5})(v\d+)?$/;
const DOI = /\b(10\.\d{4,9}\/[^\s"<>]+[^\s"<>.,;)])/;
const looksLikeFilename = (t: string) => !/\s/.test(t.trim()) || ARXIV_NAME.test(t.trim()) || /_|\d{4,}/.test(t);
const hasAbstract = (text: string) => /\babstract\b/i.test(text.slice(0, 6000));
const hasIntroduction = (text: string) => /\b(?:1\.?|I\.)?\s*introduction\b/i.test(text.slice(0, 12000));
const hasReferences = (text: string) => /\b(references|bibliography|works cited)\b/i.test(text);

// The paper's record, or null. Throws when a database couldn't be reached,
// so that's never mistaken for "not a paper".
async function lookup(doc: Doc, head: string): Promise<PaperMeta | null> {
  const id = ARXIV.exec(head)?.[1] ?? ARXIV_NAME.exec(doc.title.trim())?.[1];
  if (id) return (await resolvePaper(`arXiv:${id}`))[0] ?? null;
  const doi = DOI.exec(head)?.[1];
  if (doi) {
    const p = (await resolvePaper(doi))[0];
    if (p && titleWithin(p.title, head)) return p;
  }
  if (!hasAbstract(head)) return null;
  // Search by the file's title, then each of the first lines of the page on
  // its own (one is the title; authors drown it out), then the whole top. A hit must have its
  // whole title on the first page, or match the file's title.
  const top = head.split(/\babstract\b/i)[0];
  const lines = top.split(/\n+/).map((l) => l.trim()).filter((l) => l.split(/\s+/).length >= 3);
  const queries = [looksLikeFilename(doc.title) ? "" : doc.title, lines[0] ?? "", lines[1] ?? "", top.slice(0, 220)]
    .map((q) => q.replace(/\s+/g, " ").trim())
    .filter((q, i, all) => q.split(" ").length >= 3 && all.indexOf(q) === i);
  for (const query of queries.slice(0, 3)) {
    const found = await searchPapers(query.slice(0, 200), 5, undefined, { arxiv: false });
    const hit = found.find((p) => p.title.split(/\s+/).length >= 3 && (titleWithin(p.title, head.slice(0, 800)) || sameTitle(p.title, doc.title)));
    if (hit) return hit;
  }
  return null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { sessionId } = parsed.data;

  const [{ data: docRows }, { data: reviews }, { data: plan }] = await Promise.all([
    supabase.from("documents").select("id, title, page_count, meta").eq("session_id", sessionId).not("storage_path", "is", null),
    supabase.from("paper_reviews").select("document_id").eq("session_id", sessionId),
    supabase.from("study_plans").select("goal, goal_title").eq("session_id", sessionId).maybeSingle(),
  ]);
  const known = new Set((reviews ?? []).map((r) => r.document_id as string));
  const goal = `${plan?.goal_title ?? ""} ${plan?.goal ?? ""}`;
  const docs = ((docRows ?? []) as Doc[]).filter((d) => !known.has(d.id) && d.page_count > 0 && d.page_count <= PAPER_MAX_PAGES && d.meta?.paper_check !== "yes");
  if (!docs.length) return Response.json({ papers: [] });

  const { data: pages } = await supabase
    .from("document_pages")
    .select("document_id, page_number, content")
    .in("document_id", docs.map((d) => d.id))
    .lte("page_number", 2);
  const textOf = (id: string) =>
    ((pages ?? []) as { document_id: string; page_number: number; content: string }[])
      .filter((p) => p.document_id === id)
      .sort((a, b) => a.page_number - b.page_number)
      .map((p) => p.content)
      .join("\n");

  const batch = docs.slice(0, 8);
  // The last pages too: a references section is a paper's surest sign.
  const tails = await Promise.all(
    batch.map((d) =>
      supabase
        .from("document_pages")
        .select("content")
        .eq("document_id", d.id)
        .gte("page_number", Math.max(3, d.page_count - 2))
        .then(({ data }) => ((data ?? []) as { content: string }[]).map((p) => p.content).join("\n")),
    ),
  );

  const papers: { id: string; title: string; meta: Record<string, unknown> }[] = [];
  for (const [i, doc] of batch.entries()) {
    const head = textOf(doc.id);
    let paper: PaperMeta | null = null;
    let unreachable = false;
    if (!doc.meta?.paper_check) {
      try {
        paper = await lookup(doc, head);
      } catch (err) {
        unreachable = true;
        logError("paper detect lookup failed", err);
      }
    }
    // No network needed: an arXiv stamp on the first page, or a paper's shape.
    const stamped = ARXIV.exec(head)?.[1] ?? ARXIV_NAME.exec(doc.title.trim())?.[1] ?? null;
    const shaped = hasAbstract(head) && hasIntroduction(head) && hasReferences(tails[i] || head);
    const named = !doc.title.trim() || looksLikeFilename(doc.title) ? false : titleWithin(doc.title, goal) && hasAbstract(head);
    const inGoal = named || (paper ? titleWithin(paper.title, goal) : false);
    if (!paper && !stamped && !shaped && !inGoal) {
      if (!doc.meta?.paper_check && !unreachable) await supabase.from("documents").update({ meta: { ...(doc.meta ?? {}), paper_check: "no" } }).eq("id", doc.id);
      continue;
    }
    const doi = shaped ? (DOI.exec(head)?.[1] ?? null) : null;
    const meta = {
      ...(doc.meta ?? {}),
      paper_check: "yes",
      ...(paper
        ? { authors: paper.authors, year: paper.year, venue: paper.venue, doi: paper.doi, arxiv_id: paper.arxiv_id, abstract: paper.abstract, pdf_url: paper.pdf_url }
        : { ...(stamped ? { arxiv_id: stamped } : {}), ...(doi ? { doi } : {}) }),
    };
    // A file name ("1706.03762v7", "attention_final") gives way to the paper's title.
    const title = paper && looksLikeFilename(doc.title) ? paper.title.slice(0, 300) : doc.title;
    const [u, r] = await Promise.all([
      supabase.from("documents").update({ meta, title }).eq("id", doc.id),
      supabase.from("paper_reviews").upsert({ document_id: doc.id, session_id: sessionId }, { onConflict: "document_id", ignoreDuplicates: true }),
    ]);
    if (u.error || r.error) {
      logError("paper detect save failed", u.error ?? r.error);
      continue;
    }
    papers.push({ id: doc.id, title, meta });
  }
  return Response.json({ papers });
}
