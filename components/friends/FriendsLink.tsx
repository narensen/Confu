"use client";

import { useEffect, useState } from "react";
import { friendNotices, subscribeInVoice, touchPresence } from "@/lib/friends";
import { subscribeRoom } from "@/lib/rooms";

// How many friend requests and room invites are waiting (the yellow count on
// Friends in the header). Also the heartbeat that tells friends you're
// online, in a room, or in voice: mount it once, in the header.
export function useFriendNotices() {
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

  return count;
}
