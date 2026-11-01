import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { SpaceView } from "@/components/community/SpaceView";

const SLUG = /^s-[a-z0-9]{10}$/;

export const metadata: Metadata = { title: "Learning space — Confu", robots: { index: false } };

export default async function SpacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) notFound();
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <SpaceView slug={slug} />
      </main>
    </div>
  );
}
