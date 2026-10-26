"use client";

import { createClient } from "@/lib/supabase/client";

// Study rooms (migration 0025): the room you're in, kept across pages so a
// small dock can follow you into your library and sessions. Presence is a
// check-in every 30 seconds; changes (someone joins, the timer starts) are
// announced on a Realtime channel so everyone refreshes at once.

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
  const room = currentRoom();
  if (!room) return;
  const { error } = await createClient().rpc("join_room", { p_slug: room.slug, p_name: await displayName(), p_studying: room.studying || null });
  if (error && /No such room/.test(error.message)) save(null);
}

export async function roomState(slug: string): Promise<RoomState | null> {
  const { data, error } = await createClient().rpc("room_state", { p_slug: slug });
  if (error) throw new Error(/room_state/.test(error.message) ? "Study rooms need migration 0025 to be run." : error.message);
  return (data as RoomState | null) ?? null;
}

// Everyone in the room refreshes when something changes.
const channels = new Map<string, ReturnType<ReturnType<typeof createClient>["channel"]>>();
export function onRoomChange(slug: string, cb: () => void) {
  const supabase = createClient();
  const channel = supabase.channel(`room:${slug}`, { config: { broadcast: { self: false } } });
  channel.on("broadcast", { event: "refresh" }, cb).subscribe();
  channels.set(slug, channel);
  return () => {
    channels.delete(slug);
    void supabase.removeChannel(channel);
  };
}

export function ping(slug: string) {
  const channel = channels.get(slug);
  if (channel) void channel.send({ type: "broadcast", event: "refresh", payload: {} });
  else {
    // Not watching the room (e.g. leaving from the dock): a one-off message.
    const supabase = createClient();
    const once = supabase.channel(`room:${slug}`);
    once.subscribe((status) => {
      if (status === "SUBSCRIBED") void once.send({ type: "broadcast", event: "refresh", payload: {} }).finally(() => void supabase.removeChannel(once));
    });
  }
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
