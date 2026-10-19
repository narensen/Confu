import { z } from "zod";
import { parseIdentifier, resolvePaper, type PaperMeta } from "@/lib/scholar";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const Body = z.object({ query: z.string().trim().min(2).max(4000) });

// Turn arXiv IDs, DOIs, URLs or a title into paper metadata. Several
// identifiers (one per line) are resolved together; a title returns candidates.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter an arXiv ID, DOI, link or title." }, { status: 400 });

  const lines = parsed.data.query
    .split(/[\n,]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const identifiers = lines.filter((l) => parseIdentifier(l).kind !== "query");

  // A list of identifiers: resolve each one (in order, gently on the APIs).
  if (lines.length > 1 && identifiers.length === lines.length) {
    const results: { input: string; paper: PaperMeta | null }[] = [];
    for (const input of lines.slice(0, 15)) results.push({ input, paper: (await resolvePaper(input))[0] ?? null });
    return Response.json({ mode: "batch", results });
  }

  const papers = await resolvePaper(lines.join(" "));
  const single = parseIdentifier(lines.join(" ")).kind !== "query";
  return Response.json({ mode: single ? "single" : "search", results: papers.map((paper) => ({ input: parsed.data.query, paper })) });
}
