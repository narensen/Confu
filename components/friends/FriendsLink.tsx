"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { friendNotices, subscribeInVoice, touchPresence } from "@/lib/friends";
import { subscribeRoom } from "@/lib/rooms";

// Header entry. Also the heartbeat that tells friends you're online, in a
// room, or in voice. A yellow count is requests plus room invites waiting.
export function FriendsLink() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let live = true;
    const sync = () => {
      void friendNotices().then((notices) => {
        if (!live || !notices) return;
        setCount(notices.incoming + notices.invites);
        void touchPresence();
      });
    };
    sync();
    const offRoom = subscribeRoom(sync);
    const offVoice = subscribeInVoice(() => void touchPresence());
    const poll = window.setInterval(sync, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      offRoom();
      offVoice();
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <Link
      href="/friends"
      aria-label={count > 0 ? `Friends, ${count} waiting` : "Friends"}
      className="mr-1 inline-flex items-center rounded-md px-2 py-1 text-sm font-medium text-muted transition hover:bg-paper hover:text-ink"
    >
      Friends
      {count > 0 && (
        <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded bg-yellow-300 px-1 font-mono text-[10px] leading-4 font-medium">{count > 9 ? "9+" : count}</span>
      )}
    </Link>
  );
}
