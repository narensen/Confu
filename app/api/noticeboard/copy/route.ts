import { z } from "zod";
import { logError } from "@/lib/log";
import type { PackContent, PackPlan, PackSource, PackTopic } from "@/lib/packs";
import { insertSessionFromPackContent } from "@/lib/packs-server";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({ code: z.string().trim().regex(/^[a-z0-9]{4,10}$/) });

type Item = { title: string; url: string; kind: "paper" | "web" | "youtube" | "sample"; license: "cc" | "open" | "link" };
type Card = { title: string; kind: "study" | "exam" | "paper"; items: Item[]; plan: { plan: PackPlan; topics: PackTopic[] } | null };

// Copy the list into a session. Nothing is downloaded here. link items are not auto-fetched.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Sign in to copy this." }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const { data, error } = await supabase.rpc("get_noticeboard", { p_code: parsed.data.code });
  const card = data as Card | null;
  if (error || !card?.items?.length) return Response.json({ error: "That card wasn't found." }, { status: 404 });

  const sources: PackSource[] = card.items.map((item) => ({
    kind: item.kind,
    title: item.title,
    url: item.url,
    ...(item.kind === "paper" && /arxiv\.org\/(?:abs|pdf)\//.test(item.url)
      ? { arxiv_id: item.url.split("/").pop()?.replace(/\.pdf$/, "") ?? null }
      : {}),
  }));
  const linkOnly = card.items.flatMap((item, i) => (item.license === "link" ? [i] : []));
  const stored = card.plan?.plan && Array.isArray(card.plan.topics) ? card.plan : null;
  const content: PackContent = {
    v: 1,
    sources,
    plan: stored?.plan ?? null,
    topics: stored?.topics ?? [],
    highlights: [],
    passes: [],
    goal: stored?.plan.goal,
  };

  let sessionId: string | null = null;
  try {
    sessionId = await insertSessionFromPackContent(supabase, { title: card.title, kind: card.kind, content, linkOnly });
    return Response.json({ sessionId });
  } catch (err) {
    if (sessionId) await supabase.from("study_sessions").delete().eq("id", sessionId);
    logError("noticeboard copy", err);
    const message = err instanceof Error ? err.message : "";
    if (/migration 0024/.test(message)) return Response.json({ error: message }, { status: 500 });
    return Response.json({ error: "Couldn't start a session from that card." }, { status: 500 });
  }
}
