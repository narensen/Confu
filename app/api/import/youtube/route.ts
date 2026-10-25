import { z } from "zod";
import { clock } from "@/lib/import/blocks";
import { chaptersFrom, fetchLecture, fetchOembed, lectureBlocks, parsePastedTranscript, videoIdFrom, YouTubeError } from "@/lib/import/youtube";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const Body = z.object({
  url: z.string().trim().max(500).default(""),
  transcript: z.string().max(2_000_000).optional(), // pasted from YouTube's "Show transcript"
  title: z.string().trim().max(300).optional(),
});

// A lecture video's transcript as timestamped blocks (the browser typesets
// them into a PDF). Uses YouTube's captions, or a pasted transcript.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Sign in to import lectures." }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Paste a YouTube link." }, { status: 400 });
  const { url, transcript, title } = parsed.data;
  const id = videoIdFrom(url);
  if (!id && !transcript) return Response.json({ error: "That isn't a YouTube link. Paste the video's address." }, { status: 400 });
  const sourceUrl = id ? `https://www.youtube.com/watch?v=${id}` : undefined;

  try {
    if (transcript?.trim()) {
      const segments = parsePastedTranscript(transcript);
      if (!segments.length) return Response.json({ error: "That transcript is empty." }, { status: 400 });
      const meta = id ? await fetchOembed(id) : null;
      const end = segments[segments.length - 1].start;
      return Response.json({
        title: title || meta?.title || "Lecture transcript",
        byline: [meta?.author, "YouTube", end ? `${clock(end)} long` : ""].filter(Boolean).join(" · "),
        sourceUrl,
        blocks: lectureBlocks(segments, [], id),
        automatic: false,
      });
    }
    const lecture = await fetchLecture(id!);
    const chapters = chaptersFrom(lecture.description);
    return Response.json({
      title: lecture.title,
      byline: [lecture.author, "YouTube", lecture.lengthSeconds ? `${Math.round(lecture.lengthSeconds / 60)} min` : "", lecture.automatic ? "automatic captions" : ""]
        .filter(Boolean)
        .join(" · "),
      sourceUrl,
      blocks: lectureBlocks(lecture.segments, chapters, id),
      automatic: lecture.automatic,
      chapters: chapters.length,
    });
  } catch (err) {
    if (err instanceof YouTubeError) return Response.json({ error: err.message, code: err.code }, { status: err.code === "NOT_FOUND" ? 404 : 422 });
    throw err;
  }
}
