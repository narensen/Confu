import { z } from "zod";
import { decodeHtml, ImportError, safeFetch } from "@/lib/import/safe-fetch";
import { courseLinks, extractArticle } from "@/lib/import/web";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const Body = z.object({ url: z.string().trim().min(4).max(2000), mode: z.enum(["page", "links"]).default("page") });

// Import a web page: its readable text as blocks (the browser typesets them
// into a PDF), or, with mode "links", the pages of the course/docs it belongs
// to. A link straight to a PDF returns the PDF itself.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Sign in to import pages." }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Paste a link to a web page." }, { status: 400 });
  const raw = /^https?:\/\//i.test(parsed.data.url) ? parsed.data.url : `https://${parsed.data.url}`;

  try {
    const res = await safeFetch(raw, { maxBytes: 50 * 1024 * 1024 });
    const isPdf = /application\/pdf/i.test(res.contentType) || (res.body[0] === 0x25 && res.body[1] === 0x50 && res.body[2] === 0x44 && res.body[3] === 0x46);
    if (isPdf) {
      if (parsed.data.mode === "links") return Response.json({ error: "That link is a PDF, not a course page. Import it as a single page." }, { status: 400 });
      const name = decodeURIComponent(new URL(res.url).pathname.split("/").pop() || "document.pdf").slice(0, 120);
      return new Response(res.body as BodyInit, { headers: { "Content-Type": "application/pdf", "X-Confu-Filename": encodeURIComponent(name), "Cache-Control": "no-store" } });
    }
    if (!/html|xml|text\/plain/i.test(res.contentType)) return Response.json({ error: "That link isn't a web page or a PDF." }, { status: 400 });
    if (res.body.byteLength > 5 * 1024 * 1024) return Response.json({ error: "That page is too large to import." }, { status: 400 });
    const html = decodeHtml(res.body, res.contentType);

    if (parsed.data.mode === "links") return Response.json({ kind: "links", url: res.url, ...courseLinks(html, res.url) });

    const article = extractArticle(html, res.url);
    if (article.words < 60) {
      return Response.json(
        { error: "Couldn't find readable text on that page. It may need JavaScript or a login. Try the browser's Print > Save as PDF, then upload that." },
        { status: 422 },
      );
    }
    return Response.json({ kind: "article", url: res.url, ...article });
  } catch (err) {
    if (err instanceof ImportError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
