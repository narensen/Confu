import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewSession } from "@/components/review/ReviewSession";
import { requireUser } from "@/lib/dal";

export const metadata: Metadata = { title: "Review — Confu" };

export default function ReviewPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-10 pb-24 sm:pt-14">
      <Suspense fallback={<div className="skeleton h-80 rounded-2xl border border-ink/20" />}>
        <SignedIn>
          <ReviewSession />
        </SignedIn>
      </Suspense>
    </main>
  );
}

async function SignedIn({ children }: { children: React.ReactNode }) {
  await requireUser();
  return children;
}
