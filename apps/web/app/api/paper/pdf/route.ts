import { z } from "zod";
import { fetchPublicPdf } from "@/lib/scholar";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const Body = z.object({ url: z.url() });

// Fetch an open-access PDF for the browser to index and store. Signed-in users
// only; fetchPublicPdf refuses private addresses, non-PDFs and huge files.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid link." }, { status: 400 });

  try {
    const bytes = await fetchPublicPdf(parsed.data.url);
    return new Response(bytes as unknown as BodyInit, { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't fetch the PDF." }, { status: 422 });
  }
}
