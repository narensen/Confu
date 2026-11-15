"use client";

import { useSyncExternalStore } from "react";
import { friendNotices, subscribeInVoice, touchPresence } from "@/lib/friends";
import { subscribeRoom } from "@/lib/rooms";

// How many friend requests and room invites are waiting (the yellow count on
// Community in the nav and the phone tab bar). Also the heartbeat that tells
// friends you're online, in a room, or in voice. One shared poller, however
// many places show the count; it runs while any of them is on screen.

let count = 0;
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

function start() {
  let live = true;
  const sync = () => {
    void friendNotices().then((notices) => {
      if (!live || !notices) return;
      count = notices.incoming + notices.invites;
      for (const fn of listeners) fn();
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
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (listeners.size === 1) stop = start();
  return () => {
    listeners.delete(fn);
    if (!listeners.size) {
      stop?.();
      stop = null;
    }
  };
}

export function useFriendNotices() {
  return useSyncExternalStore(
    subscribe,
    () => count,
    () => 0,
  );
}
