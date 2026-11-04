import { after } from "next/server";
import { z } from "zod";
import { aiErrorResponse, resolveAi } from "@/lib/ai-access";
import { MODELS, modelBudget, stripReasoning } from "@confu/ai/groq";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const MAX_IMAGE_BYTES = 3_500_000; // within every provider's limit for a base64 image (Groq's is the lowest, 4MB)

const Body = z.object({
  documentId: z.uuid(),
  page: z.number().int().positive(),
  image: z.string().regex(/^data:image\/(jpeg|png);base64,/),
});

// Scanned or handwritten pages have no text layer, so the tutor can't search
// or cite them. The vision model transcribes the page image and the text is
// stored as that page's content, exactly like a text PDF's.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { documentId, page, image } = parsed.data;
  if (Buffer.byteLength(image.slice(image.indexOf(",") + 1), "base64") > MAX_IMAGE_BYTES) {
    return Response.json({ error: "Page image is too large." }, { status: 413 });
  }

  const { data: doc } = await supabase.from("documents").select("title, session_id").eq("id", documentId).maybeSingle();
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });

  // A retry, or a page that already has a text layer, must not call the vision
  // model again. Checked before the trial counter, so it doesn't spend a page.
  const { data: pageRow } = await supabase
    .from("document_pages")
    .select("content")
    .eq("document_id", documentId)
    .eq("page_number", page)
    .maybeSingle();
  const already = (pageRow?.content ?? "").trim();
  if (already.length >= 25) return Response.json({ chars: already.length });

  const access = await resolveAi(supabase, userId, doc.session_id, "ocr");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  let text: string;
  try {
    const res = await access.groq.chat.completions.create({
      model: MODELS.vision,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Transcribe page ${page} of "${doc.title}", a scanned or photographed page of study material (possibly handwritten).

Rules:
- Write out all the text exactly as it appears, in reading order. Keep headings, numbered questions and lists as Markdown.
- Equations in LaTeX ($…$ inline, $$…$$ for display). Tables as Markdown tables.
- For a diagram or figure, write one line: [Figure: what it shows, with its labels].
- Mark anything you can't read as [illegible]. Never guess or add content that isn't on the page.
- Output only the transcription, with no preamble.`,
            },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      temperature: 0,
      ...modelBudget(MODELS.vision, 2200),
    });
    text = stripReasoning(res.choices[0]?.message?.content ?? "").trim();
  } catch (err) {
    return aiErrorResponse(err, "Couldn't read this page.");
  }

  const { error } = await supabase.from("document_pages").update({ content: text }).eq("document_id", documentId).eq("page_number", page);
  if (error) return Response.json({ error: "Couldn't save the page text." }, { status: 500 });
  return Response.json({ chars: text.length });
}
