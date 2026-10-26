import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { RoomsLobby } from "@/components/rooms/RoomsLobby";
import { eyebrowClass } from "@/components/ui";

export const metadata: Metadata = { title: "Study rooms — Confu" };

export default function RoomsPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
        <div className="animate-enter">
          <p className={eyebrowClass}>Study rooms</p>
          <h1 className="mt-1 font-serif text-4xl tracking-tight sm:text-5xl">Study alongside others</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            A shared focus timer and a few people quietly working with you. No chat, no camera: just the gentle pressure of not being alone. Join a room,
            then go back to your library; the room and its timer stay at the top of the page.
          </p>
        </div>
        <RoomsLobby />
      </main>
    </div>
  );
}
