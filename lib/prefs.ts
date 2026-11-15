"use client";

import { useSyncExternalStore } from "react";
import { THEME_EVENT } from "@/lib/theme";

// Small per-device preferences, kept in localStorage and shared between the
// workspace and Settings → Appearance: the reading theme, and whether the
// workspace's one-key shortcuts are on.

export type ReaderTheme = "light" | "sepia" | "night";
// "auto": the page follows the app (night in dark mode, light otherwise).
export type ReaderPref = "auto" | ReaderTheme;

const READER_KEY = "confu:reader-theme";
const SINGLE_KEYS_KEY = "confu:single-keys";
const EVENT = "confu:prefs";

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function put(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
};

export function readerPref(): ReaderPref {
  const v = get(READER_KEY);
  return v === "light" || v === "sepia" || v === "night" ? v : "auto";
}

export function setReaderPref(pref: ReaderPref) {
  put(READER_KEY, pref === "auto" ? null : pref);
}

export function useReaderPref(): ReaderPref {
  return useSyncExternalStore(subscribe, readerPref, () => "auto");
}

// One-key shortcuts (t, p, f, h, [ ]…) can be turned off, so a stray key
// press never moves things around (WCAG 2.1.4). Modifier shortcuts and Esc
// keep working.
export function singleKeysOn(): boolean {
  return get(SINGLE_KEYS_KEY) !== "off";
}

export function setSingleKeys(on: boolean) {
  put(SINGLE_KEYS_KEY, on ? null : "off");
}

export function useSingleKeys(): boolean {
  return useSyncExternalStore(subscribe, singleKeysOn, () => true);
}

// Whether the app is drawn dark right now: the account menu's choice, or the
// system's setting when none is chosen.
const DARK_QUERY = "(prefers-color-scheme: dark)";

function appDark(): boolean {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "dark") return true;
  if (chosen === "light") return false;
  return window.matchMedia(DARK_QUERY).matches;
}

const subscribeDark = (fn: () => void) => {
  const m = window.matchMedia(DARK_QUERY);
  m.addEventListener("change", fn);
  window.addEventListener(THEME_EVENT, fn);
  return () => {
    m.removeEventListener("change", fn);
    window.removeEventListener(THEME_EVENT, fn);
  };
};

export function useAppDark(): boolean {
  return useSyncExternalStore(subscribeDark, appDark, () => false);
}

// The theme the page is actually drawn in.
export function useReaderTheme(): ReaderTheme {
  const pref = useReaderPref();
  const dark = useAppDark();
  return pref === "auto" ? (dark ? "night" : "light") : pref;
}
