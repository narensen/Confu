"use client";

import { useSyncExternalStore } from "react";
import { THEME_KEY } from "@/lib/head-script";

// Light, dark, or the system's setting (the default). The choice is applied
// as <html data-theme>, before first paint by HEAD_SCRIPT (lib/head-script.ts).
export type Theme = "system" | "light" | "dark";
const KEY = THEME_KEY;
export const THEME_EVENT = "confu:theme";

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
  window.dispatchEvent(new Event(THEME_EVENT));
}

const subscribe = (fn: () => void) => {
  window.addEventListener(THEME_EVENT, fn);
  return () => window.removeEventListener(THEME_EVENT, fn);
};

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, read, () => "system");
}
