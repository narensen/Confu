import { LIMITS, TEMPLATE_DOCS, type TemplateId } from "./script";

// The guide a model reads before writing an explainer video: the job, the
// exact JSON, every template with a filled-in example, and the mistakes
// models made in test runs (packages/app/video-lab). It's Markdown because
// models follow Markdown structure well; it's code so it ships with the app.
//
// When a test run shows a new common mistake, add a line to MISTAKES (and,
// when it can be fixed safely after the fact, a repair in repair.ts).

export const GUIDE_VERSION = 2;

const MISTAKES: string[] = [
  "Writing anything outside the JSON, including a ``` code fence, an apology, or a request for more detail. The reply is the raw JSON object. The subject can be history or science; this is still a JSON-writing task.",
  "Inventing a template name (example, rule, equilibrium, shift, elasticity). Only the templates listed above exist. A worked example is definition, steps, or number. A rule is quote or points.",
  'Numbers as text: write "value": 62, not "value": "62%". Put the % in "unit".',
  "LaTeX or Markdown in any text: no $, no \\frac, no **bold**. Write x², √x, a/b, ≤, π.",
  "Inventing statistics: bars, line and number need numbers that appear in the material.",
  'A sentence, a date, or two formulas in plot. plot is one function of x on one line, like "x^2 - 2*x". A sentence is quote. Events with years are timeline. Supply and demand (two formulas) are equation, not plot.',
  "A scene with no narration. Every scene needs spoken lines or it is dropped.",
  "Too little speech. Each line is about 12 to 25 words, and each scene runs about 18 seconds. A two-minute video is not one minute of talk.",
  "Code with long lines. At most 12 lines, each under 64 characters, or the type is too small to read.",
  "Narration that ignores the picture: say what is on screen, in the order it appears.",
  "Repeating a scene, or the same point in two scenes.",
];

// Templates offered to a model. "html" is left out for models that can't be trusted with it.
export function templateCatalog(allow: TemplateId[] = TEMPLATE_DOCS.map((t) => t.id)): string {
  return TEMPLATE_DOCS.filter((t) => allow.includes(t.id))
    .map((t) => `### ${t.id}\n${t.use}\n\`\`\`json\n${JSON.stringify({ template: t.id, ...t.example, narration: "[…]" })}\n\`\`\``)
    .join("\n\n");
}

export function videoGuide(opts: { scenes: number; allowHtml?: boolean } = { scenes: 8 }): string {
  const allow = TEMPLATE_DOCS.map((t) => t.id).filter((id) => opts.allowHtml || id !== "html");
  return `# How to write an explainer video

You turn a student's study material into a short animated explainer video. The video is a list of scenes. In each scene, one picture (a **template**) animates on screen while two hosts talk about it:
- **A** explains clearly, with concrete examples.
- **B** is a curious student: asks the question a learner would ask, reacts, and sums up.

You write only JSON. Confu draws and animates every template; you choose the template and fill in its words and numbers.

## The JSON

\`\`\`json
{
  "title": "Principal Component Analysis",
  "scenes": [
    {
      "template": "title",
      "title": "Principal Component Analysis",
      "subtitle": "Finding the directions where data varies most",
      "narration": [
        { "speaker": "A", "text": "Today we're looking at PCA, a way to shrink big data without losing what matters." },
        { "speaker": "B", "text": "Shrink it how? Doesn't throwing data away lose information?" }
      ]
    },
    {
      "template": "steps",
      "title": "Doing PCA",
      "steps": ["Centre the data", "Compute the covariance matrix", "Find its eigenvectors", "Keep the top M"],
      "narration": [
        { "speaker": "A", "text": "There are four steps. First, centre the data so its mean is zero." },
        { "speaker": "A", "text": "Then compute the covariance matrix and find its eigenvectors." },
        { "speaker": "B", "text": "And we keep only the top few of those?" },
        { "speaker": "A", "text": "Exactly, the ones with the biggest eigenvalues." }
      ]
    }
  ]
}
\`\`\`

## Rules

1. Reply with one JSON object and nothing else. No code fence, no greeting, no apology. Double quotes everywhere. No comments, no trailing commas.
2. Write about ${opts.scenes} scenes. The first scene uses "title". The last scene uses "recap" (three things to remember).
3. Every scene has "template", its fields (exactly as in the examples below), and "narration". The template value is one of the names below. Do not invent a name for the topic.
4. "narration" is a list of 2–4 lines, each {"speaker": "A" or "B", "text": "…"}. Each line is one or two spoken sentences of about 12 to 25 words, under ${LIMITS.narration.chars} characters. A scene should take about 18 seconds to say. Alternate A and B.
5. Narration is spoken aloud: plain words, no symbols to read out, no lists, no stage directions like (laughs). Say formulas in words ("x squared").
6. The narration talks about what is on screen, in the order it appears. If the scene lists three steps, the hosts go through those three steps.
7. On-screen text is short: titles under ${LIMITS.title} characters, each point, step or stage under ${LIMITS.item} characters (a few words, not a sentence).
8. Use only facts from the material. Use "bars", "line" or "number" only when the material gives the numbers. Otherwise use "points", "steps", "compare" or "map".
9. Use "plot" only for one real function of x on one line (like "x^2 - 2*x" or "sin(x)"), written with x, numbers, + - * / ^ and functions such as sin, cos, exp, ln, sqrt. Never a sentence, never two equations, never a function of p or t.
10. Vary the templates: use the one that shows the idea best, and don't use the same template more than twice in a row.

## Templates

${templateCatalog(allow)}

## Mistakes to avoid

${MISTAKES.map((m) => `- ${m}`).join("\n")}
`;
}

export type VideoInput = { title: string; pages: { page: number; text: string }[]; minutes: number; focus?: string | null; allowHtml?: boolean };

// Scenes for the length asked: about 18 seconds each.
export const scenesFor = (minutes: number) => Math.max(4, Math.min(LIMITS.scenes.max, Math.round(minutes * 3.5)));

// The material as the model sees it, and as the repair step checks numbers against.
export function videoMaterial(pages: { page: number; text: string }[], budget = 9000): string {
  const per = Math.max(600, Math.floor(budget / Math.max(1, pages.length)));
  return pages
    .map((p) => `[p. ${p.page}]\n${p.text.replace(/\s+/g, " ").trim().slice(0, per)}`)
    .join("\n\n")
    .slice(0, budget);
}

export function videoPrompt(input: VideoInput) {
  const scenes = scenesFor(input.minutes);
  return [
    { role: "system" as const, content: videoGuide({ scenes, allowHtml: input.allowHtml }) },
    {
      role: "user" as const,
      content: `Material: "${input.title}"${input.focus ? `\nFocus on: ${input.focus}` : ""}\nLength: about ${input.minutes} minute${input.minutes === 1 ? "" : "s"}, ${scenes} scenes, roughly ${scenes * 40} spoken words.\n\n${videoMaterial(input.pages)}\n\nWrite the video as JSON now. One JSON object, no code fence, no explanation.`,
    },
  ];
}
