"use client";

import { useSyncExternalStore } from "react";
import { MOTION_KEY as KEY } from "@/lib/head-script";

// Motion: follow the system's "reduce motion" setting (the default), or
// reduce it here whatever the system says (Settings → Appearance). The choice
// is applied as <html data-motion="reduce"> before first paint (HEAD_SCRIPT
// in lib/head-script.ts), and the CSS in globals.css stills animations for it
// just as it does for the system setting. Code that animates with JavaScript
// (GSAP, Flip, video) asks reduceMotion().

export type Motion = "system" | "reduce";
export const MOTION_EVENT = "confu:motion";
export const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

// Whether to keep things still right now: the choice here, or the system's.
export function reduceMotion(): boolean {
  if (typeof window === "undefined") return false;
  return document.documentElement.dataset.motion === "reduce" || window.matchMedia(REDUCE_QUERY).matches;
}

function read(): Motion {
  try {
    return localStorage.getItem(KEY) === "reduce" ? "reduce" : "system";
  } catch {
    return "system";
  }
}

export function setMotion(m: Motion) {
  try {
    if (m === "reduce") localStorage.setItem(KEY, "reduce");
    else localStorage.removeItem(KEY);
  } catch {}
  if (m === "reduce") document.documentElement.dataset.motion = "reduce";
  else delete document.documentElement.dataset.motion;
  window.dispatchEvent(new Event(MOTION_EVENT));
}

const subscribe = (fn: () => void) => {
  window.addEventListener(MOTION_EVENT, fn);
  return () => window.removeEventListener(MOTION_EVENT, fn);
};

export function useMotion(): Motion {
  return useSyncExternalStore(subscribe, read, () => "system");
}
