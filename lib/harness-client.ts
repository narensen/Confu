"use client";

import { BRIDGE_ORIGIN, type HarnessId, type TeachEffort, type TutorEngine } from "@/lib/harnesses";

const ENGINE_KEY = "confu:tutor-engine";
const EFFORT_KEY = "confu:tutor-effort";
const TOKEN_KEY = "confu:bridge-token";

export type BridgeHarness = { id: HarnessId; name: string; installed: boolean; version: string | null };
export type BridgeHealth = { ok: true; os: string; harnesses: BridgeHarness[] };

export type TutorLink = {
  id: TutorEngine;
  effort: TeachEffort;
  connected: boolean;
  installed: boolean;
};

export const GROQ_LINK: TutorLink = { id: "groq", effort: "low", connected: false, installed: true };

export function loadTutorLink(): TutorLink {
  if (typeof localStorage === "undefined") return GROQ_LINK;
  const id = localStorage.getItem(ENGINE_KEY);
  const effort = localStorage.getItem(EFFORT_KEY) === "medium" ? "medium" : "low";
  const engine: TutorEngine = id === "claude" || id === "codex" || id === "antigravity" || id === "grok" ? id : "groq";
  // The bridge no longer asks for a code. Drop any code saved by an older page.
  localStorage.removeItem(TOKEN_KEY);
  return { id: engine, effort, connected: false, installed: engine === "groq" };
}

export function saveTutorLink(link: Pick<TutorLink, "id" | "effort">) {
  localStorage.setItem(ENGINE_KEY, link.id);
  localStorage.setItem(EFFORT_KEY, link.effort);
  localStorage.removeItem(TOKEN_KEY);
}

// A hosted page calling 127.0.0.1 needs this so Chrome treats it as loopback
// and asks once for permission, instead of blocking it as mixed content.
const loopback = { targetAddressSpace: "loopback" } as RequestInit;

export async function probeBridge(): Promise<BridgeHealth | null> {
  const res = await fetch(`${BRIDGE_ORIGIN}/health`, { ...loopback, cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as BridgeHealth;
}

export async function teachWithHarness(
  link: TutorLink,
  lesson: { system: string; history: { role: string; content: string }[]; instruction: string },
  onChunk: (text: string) => void,
): Promise<string> {
  if (link.id === "groq") throw new Error("Pick a harness first.");
  const res = await fetch(`${BRIDGE_ORIGIN}/teach`, {
    ...loopback,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ harness: link.id, effort: link.effort, ...lesson }),
  });
  if (!res.ok || !res.body) throw new Error((await res.text()) || "The harness didn't answer.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let answer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    answer += decoder.decode(value, { stream: true });
    onChunk(answer);
  }
  answer += decoder.decode();
  if (!answer.trim()) throw new Error("The harness sent an empty lesson.");
  return answer;
}
