import { z } from "zod";
import { groq, MODELS } from "@/lib/groq";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const MAX_IMAGE_BYTES = 3_500_000; // Groq accepts base64 images up to 4MB

const Body = z.object({
  documentId: z.uuid(),
  page: z.number().int().positive(),
  rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  image: z.string().regex(/^data:image\/(jpeg|png);base64,/),
});

// "General highlight": a captured region (figure, table, equation, diagram)
// is described by a vision model, stored, and becomes tutor context.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { documentId, page, rect, image } = parsed.data;

  const base64 = image.slice(image.indexOf(",") + 1);
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return Response.json({ error: "Selection is too large — capture a smaller region." }, { status: 413 });
  }

  const [{ data: doc }, { data: pageRow }] = await Promise.all([
    supabase.from("documents").select("title").eq("id", documentId).maybeSingle(),
    supabase.from("document_pages").select("content").eq("document_id", documentId).eq("page_number", page).maybeSingle(),
  ]);
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });

  let description: string;
  try {
    const res = await groq.chat.completions.create({
      model: MODELS.vision,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `This image is a region a student captured from page ${page} of "${doc.title}". A tutor will use your notes to teach it, so be precise and complete.

Write Markdown notes with:
1. **What it is** — figure, chart, table, diagram, equation, structure, etc.
2. **Contents** — every label, axis (with units), legend entry, symbol, arrow and value you can read. Transcribe equations in LaTeX ($…$) and tables as Markdown tables.
3. **What it shows** — trends, comparisons, relationships or the process depicted.
4. **Key takeaway** — the point the author is most likely making.

Only describe what is visible; use the page text below solely to resolve references (e.g. "Fig. 3", symbol definitions). If something is illegible, say so.

Page text (for reference):
"""
${(pageRow?.content ?? "").slice(0, 3000)}
"""`,
            },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      temperature: 0.2,
      max_completion_tokens: 1500,
      reasoning_format: "hidden",
    });
    description = res.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    console.error("vision request failed", err);
    return Response.json({ error: "The vision model could not read this region. Try again." }, { status: 502 });
  }
  if (!description) return Response.json({ error: "The vision model returned nothing." }, { status: 502 });

  const id = crypto.randomUUID();
  const ext = image.startsWith("data:image/png") ? "png" : "jpg";
  const imagePath = `${userId}/highlights/${id}.${ext}`;
  const upload = await supabase.storage
    .from("documents")
    .upload(imagePath, bytes, { contentType: ext === "png" ? "image/png" : "image/jpeg" });

  const { data: highlight, error } = await supabase
    .from("highlights")
    .insert({
      id,
      user_id: userId,
      document_id: documentId,
      kind: "region",
      page_number: page,
      color: "blue",
      rects: [rect],
      image_path: upload.error ? null : imagePath,
      vlm_description: description,
    })
    .select("*")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ highlight });
}
