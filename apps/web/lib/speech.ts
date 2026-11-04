"use client";

import { useSyncExternalStore } from "react";

// Reading an audio overview aloud with the browser's own voices (free, no
// audio files). Lives outside React, like the focus sounds, so it keeps going
// while the student switches tabs. Chrome stops long utterances partway, so
// the script is spoken a few sentences at a time; pausing stops and resumes
// at the current chunk, which works the same in every browser.

export type Speech = { title: string; status: "loading" | "playing" | "paused" | "failed"; rate: number; progress: number } | null;

let state: Speech = null;
let chunks: string[] = [];
let index = 0;
let rate = 1;
let run = 0; // bumped whenever speech is cut short, so stale callbacks do nothing
const listeners = new Set<() => void>();

function set(next: Speech) {
  state = next;
  for (const l of listeners) l();
}

export const speechSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

// The clearest English voice on offer: a "natural"/neural one, else Google's, else the default.
function voice() {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  return voices.find((v) => /natural|neural|premium|enhanced/i.test(v.name)) ?? voices.find((v) => /google/i.test(v.name)) ?? voices.find((v) => v.default) ?? voices[0];
}

function split(script: string) {
  const sentences = script.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g) ?? [script];
  const out: string[] = [];
  for (const s of sentences) {
    if (out.length && (out[out.length - 1] + s).length < 220) out[out.length - 1] += s;
    else out.push(s);
  }
  return out.map((c) => c.trim()).filter(Boolean);
}

function speakFrom(i: number) {
  const mine = ++run;
  window.speechSynthesis.cancel();
  index = i;
  const next = () => {
    if (mine !== run) return;
    if (index >= chunks.length) return set(null);
    const u = new SpeechSynthesisUtterance(chunks[index]);
    u.rate = rate;
    const v = voice();
    if (v) u.voice = v;
    u.onend = () => {
      if (mine !== run) return;
      index++;
      if (state) set({ ...state, progress: index / chunks.length });
      next();
    };
    // No voice to read with (some Linux browsers), or speech blocked: say so.
    u.onerror = (e) => {
      if (mine !== run || e.error === "interrupted" || e.error === "canceled") return;
      if (state) set({ ...state, status: "failed" });
    };
    window.speechSynthesis.speak(u);
  };
  next();
}

export function speechLoading(title: string) {
  run++;
  if (speechSupported()) window.speechSynthesis.cancel();
  set({ title, status: "loading", rate, progress: 0 });
}

export function speechPlay(title: string, script: string) {
  chunks = split(script);
  set({ title, status: "playing", rate, progress: 0 });
  speakFrom(0);
}

export function speechPause() {
  if (state?.status !== "playing") return;
  run++;
  window.speechSynthesis.cancel();
  set({ ...state, status: "paused" });
}

export function speechResume() {
  if (state?.status !== "paused") return;
  set({ ...state, status: "playing" });
  speakFrom(index);
}

export function speechRate(r: number) {
  rate = r;
  if (!state) return;
  set({ ...state, rate: r });
  if (state.status === "playing") speakFrom(index);
}

export function speechStop() {
  run++;
  if (speechSupported()) window.speechSynthesis.cancel();
  set(null);
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function useSpeech(): Speech {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => null,
  );
}
