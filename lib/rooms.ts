"use client";

import { createClient } from "@/lib/supabase/client";

// Study rooms (migration 0025): the room you're in, kept across pages so a
// header can show it (and its timer) all over the app. Presence is a
// check-in every 30 seconds; changes (someone joins, the timer starts) are
// announced on a Realtime channel so everyone refreshes at once.
//
// Closing the tab leaves the room. The check-in is remembered in
// localStorage, so a reload (which also fires pagehide) joins again.

export type RoomMember = { name: string; studying: string | null; me: boolean; joined_at: string };
export type RoomState = {
  id: string;
  slug: string;
  name: string;
  is_public: boolean;
  mine: boolean;
  timer_mode: "manual" | "clock";
  focus_minutes: number;
  break_minutes: number;
  timer_phase: "idle" | "focus" | "break";
  timer_ends_at: string | null;
  now: string;
  members: RoomMember[];
};
export type Current = { slug: string; name: string; studying: string };

const KEY = "confu:room";
let current: Current | null = null;
// Set when this tab is unloading, so a check-in still in flight can't undo the leave.
let leavingPage = false;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeRoom(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function currentRoom(): Current | null {
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    try {
      current = JSON.parse(localStorage.getItem(KEY) ?? "null") as Current | null;
    } catch {
      current = null;
    }
  }
  return current;
}

function save(next: Current | null) {
  current = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {}
  emit();
}

export async function displayName() {
  const { data } = await createClient().auth.getUser();
  const full = (data.user?.user_metadata as { full_name?: string } | undefined)?.full_name?.trim();
  return full?.split(/\s+/)[0] || "Someone";
}

export async function joinRoom(slug: string, name: string, studying = "") {
  armRoomExit();
  await cacheToken();
  const supabase = createClient();
  const { error } = await supabase.rpc("join_room", { p_slug: slug, p_name: await displayName(), p_studying: studying || null });
  if (error) throw new Error(/No such room/.test(error.message) ? "That room doesn't exist any more." : /join_room/.test(error.message) ? "Study rooms need migration 0025 to be run." : error.message);
  save({ slug, name, studying });
  ping(slug);
}

export async function leaveRoom() {
  const room = currentRoom();
  save(null);
  if (!room) return;
  await createClient().rpc("leave_room", { p_slug: room.slug });
  ping(room.slug);
}

export function setStudying(studying: string) {
  const room = currentRoom();
  if (room) save({ ...room, studying });
}

export async function heartbeat() {
  // The tab is closing. A check-in now would undo the leave.
  if (leavingPage) return;
  armRoomExit();
  const room = currentRoom();
  if (!room) return;
  await cacheToken();
  if (leavingPage) return;
  const { error } = await createClient().rpc("join_room", { p_slug: room.slug, p_name: await displayName(), p_studying: room.studying || null });
  if (leavingPage) {
    beaconLeaveRoom();
    return;
  }
  if (error && /No such room/.test(error.message)) save(null);
}

// The tab still thinks it's in the room, but the server has dropped it
// (the other tab closed, or a reload's leave arrived late). Check in again.
export function stayIfJoined(state: RoomState | null) {
  if (leavingPage) return;
  const mine = currentRoom();
  if (state && mine?.slug === state.slug && !state.members.some((member) => member.me)) void heartbeat();
}

export async function roomState(slug: string): Promise<RoomState | null> {
  const { data, error } = await createClient().rpc("room_state", { p_slug: slug });
  if (error) throw new Error(/room_state/.test(error.message) ? "Study rooms need migration 0025 to be run." : error.message);
  return (data as RoomState | null) ?? null;
}

// Everyone in the room refreshes when something changes. Several parts of the
// page can listen; the channel stays up while at least one of them does.
const channels = new Map<string, ReturnType<ReturnType<typeof createClient>["channel"]>>();
const roomListeners = new Map<string, Set<(left: boolean) => void>>();

function leftFlag(payload: unknown) {
  return Boolean(payload && typeof payload === "object" && (payload as { left?: unknown }).left === true);
}

export function onRoomChange(slug: string, cb: (left: boolean) => void) {
  const supabase = createClient();
  let listeners = roomListeners.get(slug);
  if (!listeners) {
    listeners = new Set();
    roomListeners.set(slug, listeners);
    const channel = supabase.channel(`room:${slug}`, { config: { broadcast: { self: false } } });
    channel
      .on("broadcast", { event: "refresh" }, ({ payload }) => {
        const left = leftFlag(payload);
        roomListeners.get(slug)?.forEach((fn) => fn(left));
      })
      .subscribe();
    channels.set(slug, channel);
  }
  listeners.add(cb);
  const mine = listeners;
  return () => {
    mine.delete(cb);
    if (mine.size > 0 || roomListeners.get(slug) !== mine) return;
    roomListeners.delete(slug);
    const channel = channels.get(slug);
    channels.delete(slug);
    if (channel) void supabase.removeChannel(channel);
  };
}

export function ping(slug: string, payload: Record<string, unknown> = {}) {
  const supabase = createClient();
  // supabase.channel() hands back an existing channel with the same topic, so
  // a one-off must never be made (and removed) while another is open.
  const open = channels.get(slug) ?? supabase.getChannels().find((c) => c.topic === `realtime:room:${slug}`);
  if (open) void open.send({ type: "broadcast", event: "refresh", payload }).catch(() => {});
  else {
    // Not watching the room (e.g. leaving from the header): a one-off message.
    const once = supabase.channel(`room:${slug}`);
    once.subscribe((status) => {
      if (status === "SUBSCRIBED") void once.send({ type: "broadcast", event: "refresh", payload }).finally(() => void supabase.removeChannel(once));
    });
  }
}

// The access token can't be fetched during pagehide (that promise never
// finishes), so it's kept from the last check-in.
let accessToken = "";
let exitArmed = false;

async function cacheToken() {
  try {
    const { data } = await createClient().auth.getSession();
    if (data.session?.access_token) accessToken = data.session.access_token;
  } catch {
    // The last token we saw is still the one to try.
  }
}

function beaconRpc(fn: string, body: unknown) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !accessToken) return;
  try {
    void fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    // The tab is going away. The next check-in, or the room's own timeout, covers a miss.
  }
}

// Closing the tab, or leaving the site. A reload fires this too, and the new
// page checks in again. localStorage is left alone so that reload still
// knows the room.
function beaconLeaveRoom() {
  const room = currentRoom();
  if (!room) return;
  leavingPage = true;
  beaconRpc("leave_room", { p_slug: room.slug });
  beaconRpc("set_friend_presence", { p_slug: null, p_voice: false });
  const open = channels.get(room.slug);
  if (open) void open.send({ type: "broadcast", event: "refresh", payload: { left: true } }).catch(() => {});
}

export function armRoomExit() {
  if (exitArmed || typeof window === "undefined") return;
  exitArmed = true;
  void cacheToken();
  createClient().auth.onAuthStateChange((event, session) => {
    if (session?.access_token) accessToken = session.access_token;
    else if (event === "SIGNED_OUT") accessToken = "";
  });
  window.addEventListener("pagehide", (event) => {
    // Frozen into the back/forward cache: the page is still open.
    if (event.persisted) return;
    beaconLeaveRoom();
  });
  window.addEventListener("pageshow", () => {
    // The page is on screen again (a reload, or back from the cache).
    leavingPage = false;
  });
}

// The timer as it stands right now: clock rooms cycle on the hour; others
// run what their maker started.
export function timerNow(room: Pick<RoomState, "timer_mode" | "focus_minutes" | "break_minutes" | "timer_phase" | "timer_ends_at">, now: number, skew = 0) {
  if (room.timer_mode === "clock") {
    const cycle = (room.focus_minutes + room.break_minutes) * 60_000;
    const into = now % cycle;
    const focus = into < room.focus_minutes * 60_000;
    return { phase: focus ? ("focus" as const) : ("break" as const), left: focus ? room.focus_minutes * 60_000 - into : cycle - into };
  }
  if (room.timer_phase === "idle" || !room.timer_ends_at) return { phase: "idle" as const, left: 0 };
  const left = Date.parse(room.timer_ends_at) - (now + skew);
  return left > 0 ? { phase: room.timer_phase, left } : { phase: "idle" as const, left: 0 };
}

export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
