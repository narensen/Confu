"use client";

import { useSyncExternalStore } from "react";

// Commands a page adds to the command palette (Ctrl/Cmd+K) while it's open:
// the workspace's tools, folding the tutor, full screen and so on. The
// palette lists them first, above places and sessions.

export type Command = {
  id: string;
  label: string;
  hint?: string; // a second line, e.g. what it does
  keys?: string; // its shortcut, shown on the right
  run: () => void;
};

const owners = new Map<string, Command[]>();
const listeners = new Set<() => void>();
let snapshot: Command[] = [];

function rebuild() {
  snapshot = [...owners.values()].flat();
  for (const fn of listeners) fn();
}

// Returns the cleanup: call it when the page (or its state) goes away.
export function registerCommands(owner: string, commands: Command[]) {
  owners.set(owner, commands);
  rebuild();
  return () => {
    if (owners.get(owner) !== commands) return;
    owners.delete(owner);
    rebuild();
  };
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const EMPTY: Command[] = [];

export function usePageCommands(): Command[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
}

export const OPEN_PALETTE_EVENT = "confu:open-palette";

export function openPalette() {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}
