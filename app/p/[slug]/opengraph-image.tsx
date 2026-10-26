import { getPackPublic } from "@/lib/packs-server";
import { ogCard, OG_SIZE } from "@/lib/og/card";

export const alt = "A study pack on Confu";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const pack = await getPackPublic((await params).slug);
  if (!pack) return ogCard({ eyebrow: "Study pack", title: "A study pack on Confu" });
  const n = pack.content.sources?.length ?? 0;
  return ogCard({
    eyebrow: pack.kind === "paper" ? "Paper pack" : pack.kind === "exam" ? "Exam pack" : "Study pack",
    title: pack.title,
    sub: pack.author_name ? `Shared by ${pack.author_name}` : undefined,
    footer: `${n} ${n === 1 ? "source" : "sources"}${pack.content.plan ? " · with a study plan" : ""} · copy it free`,
  });
}
