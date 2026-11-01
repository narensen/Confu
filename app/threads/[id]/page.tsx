import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { ThreadView } from "@/components/community/ThreadView";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Thread — Confu", robots: { index: false } };

export default function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <Suspense fallback={<div className="skeleton mt-6 h-80 rounded-2xl" />}>
          <Thread params={params} />
        </Suspense>
      </main>
    </div>
  );
}

async function Thread({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <ThreadView id={id} />;
}
