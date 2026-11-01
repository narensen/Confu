import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { RoomsLobby } from "@/components/rooms/RoomsLobby";
import { eyebrowClass } from "@/components/ui";

export const metadata: Metadata = { title: "Study rooms — Confu", robots: { index: false } };

export default function RoomsPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <div className="animate-enter max-w-3xl">
          <p className={eyebrowClass}>Study rooms</p>
          <h1 className="mt-1 font-serif text-4xl tracking-tight sm:text-5xl">Study alongside others</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            A shared focus timer and people working with you. Join a room, then go back to your library or a session: the room&apos;s timer, and its voice if you&apos;re
            talking, stay in the header.
          </p>
        </div>
        <RoomsLobby />
      </main>
    </div>
  );
}
