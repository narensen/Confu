import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { FriendsView } from "@/components/friends/FriendsView";
import { eyebrowClass } from "@/components/ui";

export const metadata: Metadata = { title: "Friends — Confu", robots: { index: false } };

export default function FriendsPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
        <div className="animate-enter">
          <p className={eyebrowClass}>Friends</p>
          <h1 className="mt-1 font-serif text-4xl tracking-tight sm:text-5xl">Study with people you know</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Add someone with their code or the email on their account. You&apos;ll see when they&apos;re online or in a room, and you can invite them into a private one.
            Voice, if you want it, stays in that room.
          </p>
        </div>
        <FriendsView />
      </main>
    </div>
  );
}
