import "server-only";
import { findCitingPapers, forModel, parseIdentifier, resolvePaper, searchPapers } from "@/lib/scholar";

// Tools the tutor can call in paper sessions: finding papers that are useful
// to the researcher. No general web search; it's costly and off-purpose.

export const PAPER_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_papers",
      description:
        "Search the scholarly literature (Semantic Scholar / arXiv / OpenAlex). Use for related work, alternatives, follow-ups, or to check whether an idea has been done.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keywords or a paper title" },
          limit: { type: "integer", description: "Max results, 1-8", minimum: 1, maximum: 8 },
          from_year: { type: "integer", description: "Only papers from this year onward" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_paper",
      description: "Look up one paper's metadata and abstract by arXiv ID, DOI, URL or exact title.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "arXiv ID (e.g. 2402.03300), DOI, URL or title" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_citing_papers",
      description:
        "Find papers that cite a given paper, optionally filtered by topic. Use to see what came after a paper, who builds on it, or whether a gap is already addressed.",
      parameters: {
        type: "object",
        properties: {
          paper: { type: "string", description: "arXiv ID, DOI or title of the cited paper" },
          topic: { type: "string", description: "Optional keywords to filter the citing papers" },
          limit: { type: "integer", minimum: 1, maximum: 8 },
        },
        required: ["paper"],
      },
    },
  },
];

export type Source = { title: string; url: string };

export type ToolRun = { label: string; result: unknown; sources: Source[] };

const clampLimit = (n: unknown, d: number) => Math.min(8, Math.max(1, Number(n) || d));

export async function runPaperTool(name: string, rawArgs: string): Promise<ToolRun> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    return { label: `Calling ${name}`, result: { error: "Arguments were not valid JSON." }, sources: [] };
  }

  try {
    if (name === "search_papers") {
      const query = String(args.query ?? "").trim();
      const papers = await searchPapers(query, clampLimit(args.limit, 5), args.from_year ? Number(args.from_year) : undefined);
      return {
        label: `Searching papers: “${query.slice(0, 60)}”`,
        result: papers.length ? papers.map(forModel) : { note: "No results." },
        sources: papers.map((p) => ({ title: p.title, url: p.url })),
      };
    }

    if (name === "get_paper") {
      const id = String(args.id ?? "").trim();
      const [paper] = await resolvePaper(id);
      return {
        label: `Looking up ${id.slice(0, 60)}`,
        result: paper ? forModel(paper) : { error: "Paper not found." },
        sources: paper ? [{ title: paper.title, url: paper.url }] : [],
      };
    }

    if (name === "find_citing_papers") {
      const ref = String(args.paper ?? "").trim();
      const parsed = parseIdentifier(ref);
      const [known] = parsed.kind === "query" ? [] : await resolvePaper(ref);
      const target = known ?? { title: ref };
      const topic = args.topic ? String(args.topic) : undefined;
      const res = await findCitingPapers(target, topic, clampLimit(args.limit, 6));
      return {
        label: `Finding papers that cite “${target.title.slice(0, 50)}”${topic ? ` on ${topic.slice(0, 30)}` : ""}`,
        result: { cited_paper: target.title, total_citations: res.total, source: res.source, note: res.note, citing: res.citing.map(forModel) },
        sources: res.citing.map((p) => ({ title: p.title, url: p.url })),
      };
    }
  } catch (err) {
    return { label: `Calling ${name}`, result: { error: err instanceof Error ? err.message : "Tool failed." }, sources: [] };
  }
  return { label: `Calling ${name}`, result: { error: `Unknown tool ${name}.` }, sources: [] };
}
