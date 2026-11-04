import type { Metadata } from "next";
import { Suspense } from "react";
import { RoomView } from "@/components/rooms/RoomView";

export const metadata: Metadata = { title: "Study room — Confu", robots: { index: false } };

export default function RoomPage({ params }: PageProps<"/rooms/[slug]">) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <Suspense fallback={<div className="skeleton h-80 rounded-2xl" />}>
        <Room params={params} />
      </Suspense>
    </main>
  );
}

async function Room({ params }: { params: PageProps<"/rooms/[slug]">["params"] }) {
  const { slug } = await params;
  return <RoomView slug={slug.toLowerCase()} />;
}
