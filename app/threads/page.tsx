import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { ThreadsView } from "@/components/community/ThreadsView";
import { eyebrowClass } from "@/components/ui";

export const metadata: Metadata = { title: "Threads — Confu", robots: { index: false } };

export default function ThreadsPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
        <div className="animate-enter">
          <p className={eyebrowClass}>Threads</p>
          <h1 className="mt-1 font-serif text-4xl tracking-tight sm:text-5xl">Ask anything</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            A question about a class, a paper, or something you&apos;re stuck on. Anyone signed in can answer. This isn&apos;t the tutor in a session, and it isn&apos;t a private space.
          </p>
        </div>
        <ThreadsView />
      </main>
    </div>
  );
}
