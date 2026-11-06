"use client";

import { useSyncExternalStore } from "react";
import { setInVoice, touchPresence } from "@/lib/friends";
import { armRoomExit, currentRoom, subscribeRoom } from "@/lib/rooms";
import { track } from "@/lib/telemetry";
import { VoiceSession, type ScreenShare, type VoicePerson } from "@/lib/voice-session";

// Voice belongs to the app, not to the room's page: once you're in, you stay
// in while you go to your library or a session (the header shows who's
// talking, with mute and leave). Reloading the page brings you back in, with
// the same mute. Leaving the room leaves its voice.

export type VoiceState = {
  slug: string | null; // the room whose voice this is
  people: VoicePerson[];
  inVoice: boolean;
  joining: boolean;
  muted: boolean;
  deafened: boolean;
  needsTap: boolean; // the browser blocked playback until a click
  error: string | null;
  resumable: boolean; // you were in voice before the reload; one click rejoins
  screens: ScreenShare[];
  sharing: boolean;
};

const IDLE: VoiceState = {
  slug: null,
  people: [],
  inVoice: false,
  joining: false,
  muted: false,
  deafened: false,
  needsTap: false,
  error: null,
  resumable: false,
  screens: [],
  sharing: false,
};

function sameScreens(a: ScreenShare[], b: ScreenShare[]) {
  if (a.length !== b.length) return false;
  return a.every((screen, i) => screen.id === b[i]?.id && screen.stream === b[i]?.stream && screen.name === b[i]?.name && screen.mine === b[i]?.mine);
}
const RESUME_KEY = "confu:voice";

let state: VoiceState = IDLE;
let session: VoiceSession | null = null;
let watchers = 0;
let host: HTMLDivElement | null = null;
let started = false;
const listeners = new Set<() => void>();

function set(patch: Partial<VoiceState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

type Saved = { slug: string; muted: boolean; deafened: boolean; at: number };

function remember() {
  if (!state.slug) return;
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ slug: state.slug, muted: state.muted, deafened: state.deafened, at: Date.now() } satisfies Saved));
  } catch {}
}

function forget() {
  try {
    sessionStorage.removeItem(RESUME_KEY);
  } catch {}
}

function saved(): Saved | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? "null") as Saved | null;
    return raw && typeof raw.slug === "string" && Date.now() - raw.at < 6 * 3600_000 ? raw : null;
  } catch {
    return null;
  }
}

// Remote audio plays from elements kept off-screen (some browsers won't play
// audio from an element that's display:none).
function hostElement() {
  if (!host) {
    host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);pointer-events:none;";
    document.body.appendChild(host);
  }
  return host;
}

function sessionFor(slug: string) {
  if (session?.slug === slug) return session;
  const previous = session;
  // The callbacks close over the session before the const exists. A holder
  // breaks that cycle so TypeScript can type it.
  const holder: { current: VoiceSession | null } = { current: null };
  const next = new VoiceSession(
    slug,
    hostElement(),
    (people) => {
      if (session !== holder.current) return;
      const inVoice = people.some((p) => p.me);
      if (inVoice !== state.inVoice) {
        setInVoice(inVoice);
        void touchPresence();
      }
      set({ people, inVoice });
    },
    (message) => {
      if (session === holder.current) set({ error: message });
    },
    (needsTap) => {
      if (session === holder.current) set({ needsTap });
    },
    () => session === holder.current,
    (screens) => {
      if (session !== holder.current) return;
      const sharing = screens.some((screen) => screen.mine);
      if (sharing === state.sharing && sameScreens(state.screens, screens)) return;
      set({ screens, sharing });
    },
  );
  holder.current = next;
  // Point at the new session before the old one closes, so its teardown
  // can't remove the channel this one is about to open.
  session = next;
  if (previous) void previous.close();
  set({ ...IDLE, slug });
  next.watch();
  return next;
}

function closeSession() {
  const s = session;
  session = null;
  if (s) void s.close({ force: true });
  set(IDLE);
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  // Closing the tab also leaves the study room. A reload checks back in.
  armRoomExit();
  // Going away (reload, closing the tab): tell the others in voice now.
  // A page frozen for back/forward is still in the call.
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) session?.goodbye();
  });
  // Leaving the room (or switching rooms) leaves its voice.
  subscribeRoom(() => {
    if (session && currentRoom()?.slug !== session.slug) void leaveVoice();
  });
  // After a reload, come back in.
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const last = saved();
  if (!last) return;
  if (nav?.type !== "reload" || currentRoom()?.slug !== last.slug) {
    forget();
    return;
  }
  void resume(last);
}

async function resume(last: Saved) {
  const s = sessionFor(last.slug);
  // Only rejoin by itself if the microphone is already allowed; otherwise the
  // browser would ask out of nowhere. Then it's one click.
  let allowed = false;
  try {
    const permission = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    allowed = permission?.state === "granted";
  } catch {}
  set({ muted: last.muted, deafened: last.deafened });
  if (!allowed) return set({ resumable: true });
  s.preset(last.muted, last.deafened);
  set({ joining: true });
  try {
    await s.join();
    track("voice.resume", {});
  } catch (err) {
    set({ resumable: true, error: err instanceof Error ? err.message : "Couldn't rejoin voice." });
  } finally {
    set({ joining: false });
  }
}

export function subscribeVoice(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function voiceState() {
  return state;
}

export function useVoice() {
  return useSyncExternalStore(subscribeVoice, voiceState, () => IDLE);
}

// A room's page shows who's in its voice. Keeps listening while anyone looks,
// or while you're in it.
export function watchVoice(slug: string) {
  start();
  watchers += 1;
  sessionFor(slug);
  return () => {
    watchers -= 1;
    // React mounts, unmounts, and mounts again in one turn. Closing in that
    // gap killed the session the second mount was about to use.
    queueMicrotask(() => {
      if (watchers <= 0 && session?.slug === slug && !session.inVoice && !state.joining && !state.resumable) closeSession();
    });
  };
}

export async function joinVoice(slug: string) {
  const s = sessionFor(slug);
  if (s.inVoice) return;
  // Rejoining after a reload keeps the mute you had; a fresh join starts open.
  const resuming = state.resumable;
  const muted = resuming && state.muted;
  const deafened = resuming && state.deafened;
  set({ joining: true, error: null, resumable: false, muted, deafened });
  try {
    s.preset(muted, deafened);
    await s.join();
    remember();
    track("voice.join", {});
  } catch (err) {
    set({ error: err instanceof Error ? err.message : "Couldn't join voice." });
  } finally {
    set({ joining: false });
  }
}

export function leaveVoice() {
  forget();
  const s = session;
  if (!s) return set({ resumable: false, screens: [], sharing: false });
  // Don't wait on the network. The other person is told before we return.
  s.leave();
  set({ muted: false, deafened: false, needsTap: false, resumable: false, error: null, screens: [], sharing: false });
  if (watchers <= 0 || currentRoom()?.slug !== s.slug) closeSession();
}

export async function shareScreen() {
  const s = session;
  if (!s?.inVoice) return;
  set({ error: null });
  try {
    await s.shareScreen();
    track("voice.screen", {});
  } catch (err) {
    set({ error: err instanceof Error ? err.message : "Couldn't share the screen." });
  }
}

export function stopScreenShare() {
  session?.stopScreen();
}

export function setVoiceMuted(on: boolean) {
  if (state.deafened) return;
  session?.setMuted(on);
  set({ muted: on });
  if (state.inVoice) remember();
}

export function setVoiceDeafened(on: boolean) {
  session?.setDeafened(on);
  set({ deafened: on });
  if (state.inVoice) remember();
}

export function hearVoice() {
  session?.hear();
}
