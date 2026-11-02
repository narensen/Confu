import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SpaceView } from "@/components/community/SpaceView";

// A private space's link, or a subject's name (as SPACE_SLUG in lib/community).
const SPACE_SLUG = /^(s-[a-z0-9]{10}|[a-z][a-z0-9-]{1,38}[a-z0-9])$/;

export const metadata: Metadata = { title: "Space — Confu", robots: { index: false } };

export default function SpacePage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <Suspense fallback={<div className="skeleton h-80 rounded-2xl" />}>
        <Space params={params} />
      </Suspense>
    </main>
  );
}

async function Space({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SPACE_SLUG.test(slug)) notFound();
  return <SpaceView slug={slug} />;
}
