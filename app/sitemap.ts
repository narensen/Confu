import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";
import { TEMPLATES } from "@/lib/templates";

// Public pages for search engines. Study packs are listed once they're public
// (their own pages), and private pages never are.
export default function sitemap(): MetadataRoute.Sitemap {
  const page = (path: string, priority: number) => ({ url: `${SITE.url}${path}`, priority });
  return [
    page("", 1),
    page("/pricing", 0.8),
    page("/templates", 0.8),
    ...TEMPLATES.map((t) => page(`/templates/${t.slug}`, 0.7)),
    page("/packs", 0.6),
    page("/roadmaps", 0.6),
    page("/changelog", 0.5),
    page("/privacy", 0.3),
    page("/terms", 0.3),
  ];
}
