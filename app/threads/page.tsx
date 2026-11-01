import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { ThreadsView } from "@/components/community/ThreadsView";
import { eyebrowClass } from "@/components/ui";

export const metadata: Metadata = { title: "Threads — Confu", robots: { index: false } };

export default function ThreadsPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <div className="animate-enter max-w-3xl">
          <p className={eyebrowClass}>Threads</p>
          <h1 className="mt-1 font-serif text-4xl tracking-tight sm:text-5xl">Stuck? Someone&apos;s been there.</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Ask about a class, a paper, or a problem you can&apos;t crack, in the subject it belongs to. Vote up what helped, and mark the reply that answered it.
          </p>
        </div>
        <ThreadsView />
      </main>
    </div>
  );
}
