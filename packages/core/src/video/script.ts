// Explainer videos: the AI writes a storyboard, a list of scenes. Each scene
// is one animated template (a bar chart, a function plot, a process…) filled
// with the student's material, plus what the two hosts say over it. The
// templates do the drawing and the motion, so even a small model can't
// produce a broken picture: it only fills in words and numbers.

export type Speaker = "A" | "B";
export type Line = { speaker: Speaker; text: string };

export type Pair = { label: string; value: number };
export type XY = { x: number; y: number };

export type SceneBody =
  | { template: "title"; title: string; subtitle: string }
  | { template: "points"; title: string; points: string[] }
  | { template: "definition"; term: string; meaning: string; example: string }
  | { template: "equation"; title: string; formula: string; parts: { symbol: string; meaning: string }[] }
  | { template: "steps"; title: string; steps: string[] }
  | { template: "compare"; title: string; left: { label: string; points: string[] }; right: { label: string; points: string[] } }
  | { template: "bars"; title: string; unit: string; bars: Pair[] }
  | { template: "line"; title: string; x_label: string; y_label: string; points: XY[] }
  | { template: "plot"; title: string; expression: string; x_min: number; x_max: number; note: string }
  | { template: "timeline"; title: string; events: { when: string; what: string }[] }
  | { template: "cycle"; title: string; stages: string[] }
  | { template: "map"; center: string; branches: string[] }
  | { template: "number"; value: number; unit: string; label: string }
  | { template: "quote"; text: string; by: string }
  | { template: "code"; title: string; language: string; code: string; focus: number[] }
  | { template: "recap"; title: string; points: string[] }
  | { template: "html"; title: string; html: string };

export type TemplateId = SceneBody["template"];
export type Scene = SceneBody & { narration: Line[] };
export type VideoScript = { title: string; scenes: Scene[] };

// How much fits on a 16:9 frame and in a viewer's head at once. The repair
// step trims to these; the guide tells the model the same numbers.
export const LIMITS = {
  scenes: { min: 3, max: 14 },
  narration: { min: 1, max: 6, chars: 240 },
  title: 60,
  item: 90, // one point, step, stage, branch, event
  points: { min: 2, max: 5 },
  steps: { min: 2, max: 6 },
  bars: { min: 2, max: 8 },
  line: { min: 3, max: 40 },
  events: { min: 2, max: 6 },
  stages: { min: 3, max: 6 },
  branches: { min: 2, max: 6 },
  parts: { min: 0, max: 4 },
  side: { min: 1, max: 4 },
  code: { lines: 14, width: 64 },
  html: 6000,
} as const;

// The catalog the guide is written from: when to use each template, and a
// small filled-in example (the model copies shapes better than it follows prose).
export type TemplateDoc = { id: TemplateId; use: string; example: Record<string, unknown> };

export const TEMPLATE_DOCS: TemplateDoc[] = [
  { id: "title", use: "The opening scene. The topic and one line on why it matters.", example: { title: "Principal Component Analysis", subtitle: "Finding the directions where data varies most" } },
  { id: "points", use: "2–5 short key ideas that appear one by one.", example: { title: "Why centre the data?", points: ["The mean moves to zero", "Directions then measure spread, not position", "Otherwise PC1 just points at the mean"] } },
  { id: "definition", use: "One important term: what it means, and a concrete example.", example: { term: "Eigenvector", meaning: "A direction a matrix only stretches, never turns", example: "Stretching a rubber sheet sideways: the horizontal line stays horizontal" } },
  { id: "equation", use: "A formula, then what each symbol means. Write it in plain text.", example: { title: "Variance along u", formula: "Var = uᵀ S u", parts: [{ symbol: "u", meaning: "a unit direction" }, { symbol: "S", meaning: "the covariance matrix" }] } },
  { id: "steps", use: "A process or method, in order (2–6 steps).", example: { title: "Doing PCA", steps: ["Centre the data", "Compute the covariance matrix", "Find its eigenvectors", "Keep the top M"] } },
  { id: "compare", use: "Two things side by side: differences, pros and cons, before and after.", example: { title: "PCA vs feature selection", left: { label: "PCA", points: ["Makes new features", "Mixes all inputs"] }, right: { label: "Selection", points: ["Keeps original features", "Drops the rest"] } } },
  { id: "bars", use: "Comparing amounts. Only with numbers that are in the material.", example: { title: "Variance explained", unit: "%", bars: [{ label: "PC1", value: 62 }, { label: "PC2", value: 24 }, { label: "PC3", value: 9 }] } },
  { id: "line", use: "How something changes over time or with another quantity. Numbers from the material.", example: { title: "Error as components are added", x_label: "components", y_label: "error", points: [{ x: 1, y: 0.38 }, { x: 2, y: 0.14 }, { x: 3, y: 0.05 }, { x: 4, y: 0.02 }] } },
  { id: "plot", use: "The graph of one real function of x, on a single line. Not a sentence, not two equations, and not a function of another letter.", example: { title: "A parabola", expression: "x^2 - 2*x + 1", x_min: -2, x_max: 4, note: "Lowest point at x = 1" } },
  { id: "timeline", use: "Events in history or stages in time (2–6), each with when it happened.", example: { title: "Where PCA came from", events: [{ when: "1901", what: "Pearson describes it" }, { when: "1933", what: "Hotelling names it" }] } },
  { id: "cycle", use: "A loop that repeats (3–6 stages), like a feedback loop or a life cycle.", example: { title: "The water cycle", stages: ["Evaporation", "Condensation", "Precipitation", "Collection"] } },
  { id: "map", use: "One central idea and the 2–6 ideas connected to it.", example: { center: "Dimensionality reduction", branches: ["PCA", "t-SNE", "Autoencoders", "Feature selection"] } },
  { id: "number", use: "One striking number from the material, with what it measures.", example: { value: 95, unit: "%", label: "of the variance kept by just two components" } },
  { id: "quote", use: "One sentence worth remembering, or a famous quote from the material.", example: { text: "Keep the directions where the data varies most.", by: "" } },
  { id: "code", use: "Short code from the material: at most 12 lines, each under 64 characters, with the lines to point at.", example: { title: "PCA in NumPy", language: "python", code: "X = X - X.mean(axis=0)\nS = np.cov(X.T)\nvals, vecs = np.linalg.eigh(S)", focus: [2, 3] } },
  { id: "recap", use: "The last scene: the three things to remember.", example: { title: "Remember", points: ["Centre first", "PCs are eigenvectors of the covariance", "Keep the top few"] } },
  {
    id: "html",
    use: "Only when no template fits: a small drawing in plain HTML/SVG (no scripts, no images). Add data-step=\"1\", \"2\", … to parts that should appear in order.",
    example: { title: "A vector projected onto u", html: '<svg viewBox="0 0 400 240"><line x1="40" y1="200" x2="360" y2="40" class="accent" data-step="1"/><circle cx="250" cy="70" r="6" data-step="2"/></svg>' },
  },
];

export const TEMPLATE_IDS = TEMPLATE_DOCS.map((t) => t.id);
export const isTemplateId = (v: unknown): v is TemplateId => typeof v === "string" && (TEMPLATE_IDS as string[]).includes(v);

// Every scene's on-screen heading, for chapters and captions.
export function sceneHeading(s: SceneBody): string {
  switch (s.template) {
    case "definition":
      return s.term;
    case "map":
      return s.center;
    case "number":
      return `${s.value}${s.unit}`;
    case "quote":
      return s.text;
    default:
      return s.title;
  }
}
