import type { Metadata } from "next";
import { LibraryMap } from "@/components/paper/LibraryMap";

export const metadata: Metadata = { title: "Your literature — Confu", robots: { index: false } };

export default function MapPage() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-5 sm:px-5">
      <LibraryMap />
    </main>
  );
}
