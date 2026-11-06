"use client";

import { useSyncExternalStore } from "react";

// Light, dark, or the system's setting (the default). The choice is applied
// as <html data-theme>, before first paint by the script in app/layout.tsx.
export type Theme = "system" | "light" | "dark";
const KEY = "confu:theme";
const EVENT = "confu:theme";

// Runs in <head> before the page paints, so a dark-mode page never flashes light.
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function read(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function setTheme(t: Theme) {
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {}
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
};

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, read, () => "system");
}
