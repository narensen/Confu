"use client";

import { BRIDGE_ORIGIN, type HarnessId, type TeachEffort, type TutorEngine } from "@/lib/harnesses";

const ENGINE_KEY = "confu:tutor-engine";
const EFFORT_KEY = "confu:tutor-effort";
const MODEL_KEY = "confu:tutor-models";
const TOKEN_KEY = "confu:bridge-token";
const CONSENT_KEY = "confu:local-tutors";

export type BridgeModel = { id: string; name: string };
export type BridgeHarness = {
  id: HarnessId;
  name: string;
  installed: boolean;
  version: string | null;
  model: string | null;
  modelName: string | null;
  models: BridgeModel[];
};
export type BridgeHealth = { ok: true; bridge?: number; os: string; autostart?: boolean; harnesses: BridgeHarness[] };

// Whether the student said Confu may look for tutors on this computer.
// null means they haven't been asked yet.
export type LocalConsent = "yes" | "no" | null;

export function loadConsent(): LocalConsent {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(CONSENT_KEY);
  return v === "yes" || v === "no" ? v : null;
}

export function saveConsent(v: "yes" | "no") {
  localStorage.setItem(CONSENT_KEY, v);
}

// Did the student pick a tutor themselves? Picking Confu on purpose means
// a harness found later must not take over.
export function storedTutor(): TutorEngine | null {
  if (typeof localStorage === "undefined") return null;
  const id = localStorage.getItem(ENGINE_KEY);
  return id === "groq" || id === "claude" || id === "codex" || id === "antigravity" || id === "grok" ? id : null;
}

export type TutorLink = {
  id: TutorEngine;
  effort: TeachEffort;
  model: string | null;
  modelName: string | null;
  connected: boolean;
  installed: boolean;
};

export const GROQ_LINK: TutorLink = { id: "groq", effort: "low", model: null, modelName: null, connected: false, installed: true };

function modelMap(): Partial<Record<HarnessId, string>> {
  try {
    const parsed = JSON.parse(localStorage.getItem(MODEL_KEY) || "{}") as Partial<Record<HarnessId, string>>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function loadTutorLink(): TutorLink {
  if (typeof localStorage === "undefined") return GROQ_LINK;
  const id = localStorage.getItem(ENGINE_KEY);
  const effort = localStorage.getItem(EFFORT_KEY) === "medium" ? "medium" : "low";
  const engine: TutorEngine = id === "claude" || id === "codex" || id === "antigravity" || id === "grok" ? id : "groq";
  const model = engine === "groq" ? null : modelMap()[engine] || null;
  // The bridge no longer asks for a code. Drop any code saved by an older page.
  localStorage.removeItem(TOKEN_KEY);
  return { id: engine, effort, model, modelName: null, connected: false, installed: engine === "groq" };
}

export function saveTutorLink(link: Pick<TutorLink, "id" | "effort" | "model">) {
  localStorage.setItem(ENGINE_KEY, link.id);
  localStorage.setItem(EFFORT_KEY, link.effort);
  localStorage.removeItem(TOKEN_KEY);
  if (link.id !== "groq") {
    const map = modelMap();
    if (link.model) map[link.id] = link.model;
    else delete map[link.id];
    localStorage.setItem(MODEL_KEY, JSON.stringify(map));
  }
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
  signal?: AbortSignal,
): Promise<string> {
  if (link.id === "groq") throw new Error("Pick a harness first.");
  const res = await fetch(`${BRIDGE_ORIGIN}/teach`, {
    ...loopback,
    signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ harness: link.id, effort: link.effort, model: link.model, ...lesson }),
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
