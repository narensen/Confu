import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { LibraryMap } from "@/components/paper/LibraryMap";

export const metadata: Metadata = { title: "Your literature — Confu" };

export default function MapPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-5 sm:px-5">
        <LibraryMap />
      </main>
    </div>
  );
}
