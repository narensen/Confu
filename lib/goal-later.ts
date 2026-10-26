"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { PaperMeta } from "@/lib/pdf/add-paper";

// What a study goal names that isn't in the session yet: papers Confu couldn't
// pin down (with what the goal says about them, to search by) and lectures or
// pages not brought in. Shown in the session's "To add" tab until the student
// adds or removes them. Kept in this browser, per session.

export type GoalHint = { name: string; title?: string; doi?: string; arxiv?: string };
export type GoalLink = { url: string; kind: "youtube" | "web" };
export type Later = { papers: GoalHint[]; links: GoalLink[] };
// What /api/paper/from-goal returns for each paper the goal names.
export type GoalPaper = GoalHint & { paper: PaperMeta | null; candidates: PaperMeta[] };

const EMPTY: Later = { papers: [], links: [] };
const EVENT = "confu:goal-later";
const keyOf = (sessionId: string) => `confu:goal-later:${sessionId}`;

function read(sessionId: string): Later {
  try {
    const raw = localStorage.getItem(keyOf(sessionId));
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Later) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function write(sessionId: string, later: Later) {
  try {
    if (later.papers.length || later.links.length) localStorage.setItem(keyOf(sessionId), JSON.stringify(later));
    else localStorage.removeItem(keyOf(sessionId));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

const sameHint = (a: GoalHint, b: GoalHint) => a.name.trim().toLowerCase() === b.name.trim().toLowerCase();

export function addLater(sessionId: string, more: Partial<Later>) {
  const now = read(sessionId);
  write(sessionId, {
    papers: [...now.papers, ...(more.papers ?? []).filter((p) => !now.papers.some((q) => sameHint(p, q)))],
    links: [...now.links, ...(more.links ?? []).filter((l) => !now.links.some((q) => q.url === l.url))],
  });
}

export function removeLater(sessionId: string, gone: { papers?: string[]; links?: string[] }) {
  const now = read(sessionId);
  const names = new Set((gone.papers ?? []).map((n) => n.trim().toLowerCase()));
  write(sessionId, {
    papers: now.papers.filter((p) => !names.has(p.name.trim().toLowerCase())),
    links: now.links.filter((l) => !(gone.links ?? []).includes(l.url)),
  });
}

const subscribe = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
};

export function useLater(sessionId: string): Later {
  // The stored string is the snapshot (stable while unchanged); the server has none.
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(keyOf(sessionId)) ?? "";
      } catch {
        return "";
      }
    },
    () => "",
  );
  return useMemo(() => {
    try {
      return raw ? { ...EMPTY, ...(JSON.parse(raw) as Later) } : EMPTY;
    } catch {
      return EMPTY;
    }
  }, [raw]);
}
