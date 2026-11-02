import type { Metadata } from "next";
import { SpacesView } from "@/components/community/SpacesView";
import { eyebrowClass } from "@/components/ui";

export const metadata: Metadata = { title: "Spaces — Confu", robots: { index: false } };

export default function SpacesPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
      <div className="animate-enter max-w-3xl">
        <p className={eyebrowClass}>Spaces</p>
        <h1 className="mt-1 font-serif text-4xl tracking-tight sm:text-5xl">Find the people studying what you study</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Every subject has an open space for questions. Follow the ones you&apos;re working on, or make a private space for your class or group.
        </p>
      </div>
      <SpacesView />
    </main>
  );
}
