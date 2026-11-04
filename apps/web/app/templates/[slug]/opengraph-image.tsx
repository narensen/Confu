import { ogCard, OG_SIZE } from "@/lib/og/card";
import { templateBySlug, TEMPLATES } from "@/lib/templates";

export const alt = "A free study plan on Confu";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return TEMPLATES.map((t) => ({ slug: t.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const t = templateBySlug((await params).slug);
  if (!t) return ogCard({ eyebrow: "Template", title: "Free study plans on Confu" });
  return ogCard({ eyebrow: "Goal template", title: t.title, sub: t.tagline, footer: `${t.sources.length} free sources · ${t.weeks} ${t.weeks === 1 ? "week" : "weeks"}` });
}
