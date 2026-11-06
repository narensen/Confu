// Audio overviews: two voices talk a session through. The AI writes the
// script from the student's pages; the device's own voices read it (free,
// offline, nothing uploaded).

export type PodcastLine = { speaker: "A" | "B"; text: string };
export type PodcastScript = { title: string; lines: PodcastLine[] };

export function podcastPrompt(input: { title: string; pages: { page: number; text: string }[]; minutes: number; focus?: string | null }) {
  const pages = input.pages.map((p) => `[p. ${p.page}]\n${p.text.slice(0, 2500)}`).join("\n\n");
  const lines = Math.max(10, Math.min(80, Math.round(input.minutes * 9)));
  return [
    {
      role: "system" as const,
      content: [
        "You write a short study podcast: two hosts talk through a student's material so they understand and remember it.",
        "A explains; B is a sharp student who asks what a learner would ask, pushes on the hard parts, and sums up.",
        "Spoken English: short sentences, no Markdown, no lists, no math symbols (say formulas in words), no stage directions.",
        "Keep each line short, one or two sentences (under 200 characters), like real back-and-forth conversation.",
        "Use only the material given. Start with why it matters, cover the key ideas in order, end with a recap of three things to remember.",
        `About ${lines} lines in all.`,
        'Reply with JSON only: {"title":"…","lines":[{"speaker":"A","text":"…"},{"speaker":"B","text":"…"}]}',
      ].join("\n"),
    },
    { role: "user" as const, content: `Material: "${input.title}"${input.focus ? `\nFocus on: ${input.focus}` : ""}\n\n${pages}` },
  ];
}

export function parsePodcast(raw: string): PodcastScript | null {
  let data: { title?: unknown; lines?: unknown };
  try {
    data = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(data.lines)) return null;
  const lines = data.lines
    .map((l) => ({ speaker: (l as { speaker?: unknown }).speaker === "B" ? ("B" as const) : ("A" as const), text: String((l as { text?: unknown }).text ?? "").replace(/\s+/g, " ").trim().slice(0, 600) }))
    .filter((l) => l.text)
    .slice(0, 120);
  if (!lines.length) return null;
  return { title: String(data.title ?? "").trim().slice(0, 120) || "Audio overview", lines };
}

// Natural voices (Groq's Orpheus) read at most 200 characters at a time:
// split a line at sentence ends, then commas, then spaces.
export const ORPHEUS = { model: "canopylabs/orpheus-v1-english", maxChars: 200, voices: { A: "hannah", B: "troy" } } as const;

export function speechChunks(text: string, max: number = ORPHEUS.maxChars): string[] {
  const out: string[] = [];
  let rest = text.replace(/\s+/g, " ").trim();
  while (rest.length > max) {
    const head = rest.slice(0, max + 1);
    const cut = [/[.!?]["')\]]?\s/g, /[,;:—]\s/g, /\s/g].map((re) => {
      let at = -1;
      for (const m of head.matchAll(re)) if (m.index! + m[0].trimEnd().length <= max && m.index! > max * 0.3) at = m.index! + m[0].trimEnd().length;
      return at;
    }).find((at) => at > 0) ?? max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
