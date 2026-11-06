import type { PackContent } from "@/lib/packs";
import type { Template } from "@confu/core/templates";

// The course templates live in @confu/core, shared with the on-device app.
export { TEMPLATES, templateBySlug, type Template } from "@confu/core/templates";

export const templateContent = (t: Template): PackContent => ({ v: 1, sources: t.sources, plan: null, topics: [], highlights: [], passes: [], goal: t.goal });
