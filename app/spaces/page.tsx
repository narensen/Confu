import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { SpacesView } from "@/components/community/SpacesView";
import { eyebrowClass } from "@/components/ui";

export const metadata: Metadata = { title: "Learning spaces — Confu", robots: { index: false } };

export default function SpacesPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
        <div className="animate-enter">
          <p className={eyebrowClass}>Learning spaces</p>
          <h1 className="mt-1 font-serif text-4xl tracking-tight sm:text-5xl">A private place to ask</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Make a space, send the link, and the people who join can ask questions there. It stays off the public threads. A study room is still the place for a shared timer and voice.
          </p>
        </div>
        <SpacesView />
      </main>
    </div>
  );
}
