"use client";

import { useMemo, useSyncExternalStore } from "react";

// The PDFs open as tabs above the viewer, per session. Every PDF lives in the
// session's Files list; a tab opens only when the student opens one (from
// Files, the plan, a citation…), never just because a PDF was added, and
// closing it only hides it. Kept in this browser. A session with no list
// yet shows every PDF as a tab (as before tabs could be closed).

const EVENT = "confu:open-tabs";
const keyOf = (sessionId: string) => `confu:open-tabs:${sessionId}`;
const legacyKey = (sessionId: string) => `confu:closed-tabs:${sessionId}`; // the earlier closed-tabs list

function get(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

// The open tabs: the saved list, or (none saved yet) every PDF but any closed earlier.
function current(sessionId: string, all: string[]): string[] {
  const open = get(keyOf(sessionId));
  if (open) return open;
  const closed = get(legacyKey(sessionId)) ?? [];
  return all.filter((id) => !closed.includes(id));
}

function save(sessionId: string, ids: string[]) {
  try {
    localStorage.setItem(keyOf(sessionId), JSON.stringify(ids));
    localStorage.removeItem(legacyKey(sessionId));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

// Before PDFs are added: fix the open tabs as they are, so the new ones
// aren't opened along with them.
export function keepTabs(sessionId: string, all: string[]) {
  if (!get(keyOf(sessionId))) save(sessionId, current(sessionId, all));
}

export function openTab(sessionId: string, docId: string, all: string[]) {
  const ids = current(sessionId, all);
  if (!ids.includes(docId) || !get(keyOf(sessionId))) save(sessionId, ids.includes(docId) ? ids : [...ids, docId]);
}

export function closeTab(sessionId: string, docId: string, all: string[]) {
  save(sessionId, current(sessionId, all).filter((id) => id !== docId));
}

// The tab strip's order. Labels (D1, D2) stay with the file; only the strip moves.
export function reorderTabs(sessionId: string, orderedIds: string[], all: string[]) {
  const open = current(sessionId, all);
  const keep = new Set(open);
  const next = orderedIds.filter((id) => keep.has(id));
  for (const id of open) if (!next.includes(id)) next.push(id);
  save(sessionId, next);
}

// Open files in the saved tab order. Without a saved list, document order.
export function orderOpenDocs<T extends { id: string }>(docs: T[], tabs: TabState): T[] {
  const open = docs.filter((d) => isOpenIn(tabs, d.id));
  if (!tabs.open) return open;
  const rank = new Map([...tabs.open].map((id, i) => [id, i]));
  return [...open].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
}

const subscribe = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
};

// The saved open tabs, or (none saved yet) the PDFs closed earlier.
export type TabState = { open: Set<string> | null; closed: Set<string> };

function parse(raw: string): TabState {
  const [open, closed] = raw.split("\u0000");
  try {
    return { open: open ? new Set(JSON.parse(open) as string[]) : null, closed: new Set(closed ? (JSON.parse(closed) as string[]) : []) };
  } catch {
    return { open: null, closed: new Set() };
  }
}

export const isOpenIn = (tabs: TabState, docId: string) => (tabs.open ? tabs.open.has(docId) : !tabs.closed.has(docId));

// The server renders every PDF open.
export function useOpenTabs(sessionId: string): TabState {
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return `${localStorage.getItem(keyOf(sessionId)) ?? ""}\u0000${localStorage.getItem(legacyKey(sessionId)) ?? ""}`;
      } catch {
        return "\u0000";
      }
    },
    () => "\u0000",
  );
  return useMemo(() => parse(raw), [raw]);
}
