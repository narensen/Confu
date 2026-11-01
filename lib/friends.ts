"use client";

import { formatFriendCode, safeRoomSlug } from "@/lib/friend-query";
import { currentRoom } from "@/lib/rooms";
import { createClient } from "@/lib/supabase/client";

export { formatFriendCode };

const MISSING = /my_friends|request_friend|respond_friend|cancel_friend_request|remove_friend|friend_notices|set_friend_presence|invite_friend_to_room|revoke_room_invite|dismiss_room_invite|room_friends/;

export function friendsMigrationError(message: string) {
  if (/migration 0025/.test(message)) return message;
  if (MISSING.test(message) || /schema cache|PGRST202|PGRST205/i.test(message)) {
    return "Friends need migration 0026 to be run in Supabase.";
  }
  return message;
}

export type Friend = {
  user_id: string;
  name: string;
  online: boolean;
  in_voice: boolean;
  room_hidden: boolean;
  room_slug: string | null;
  room_name: string | null;
};

export type FriendRequestRow = { id: string; name: string };
export type RoomInviteCard = { id: string; room_slug: string; room_name: string; from_name: string };
export type RoomFriend = { user_id: string; name: string; online: boolean; in_voice: boolean; invited: boolean };

export type FriendsPayload = {
  code: string;
  incoming: FriendRequestRow[];
  outgoing: FriendRequestRow[];
  invites: RoomInviteCard[];
  friends: Friend[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asObject(data: unknown): Record<string, unknown> {
  if (typeof data === "string") {
    try {
      return asObject(JSON.parse(data) as unknown);
    } catch {
      return {};
    }
  }
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, max: number, fallback: string) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, max);
  return trimmed || fallback;
}

function requestRows(value: unknown): FriendRequestRow[] {
  const rows: FriendRequestRow[] = [];
  for (const item of asArray(value)) {
    const row = asObject(item);
    const id = text(row.id, 40, "");
    if (!UUID.test(id)) continue;
    rows.push({ id, name: text(row.name, 40, "Someone") });
  }
  return rows;
}

export function parseFriends(data: unknown): FriendsPayload {
  const json = asObject(data);
  const friends: Friend[] = [];
  for (const item of asArray(json.friends)) {
    const row = asObject(item);
    const user_id = text(row.user_id, 40, "");
    if (!UUID.test(user_id)) continue;
    const slug = safeRoomSlug(row.room_slug);
    friends.push({
      user_id,
      name: text(row.name, 40, "Someone"),
      online: row.online === true,
      in_voice: row.in_voice === true,
      room_hidden: row.room_hidden === true,
      room_slug: slug,
      room_name: slug ? text(row.room_name, 80, "Study room") : null,
    });
  }
  friends.sort((a, b) => Number(b.online) - Number(a.online) || Number(b.in_voice) - Number(a.in_voice) || a.name.localeCompare(b.name));

  const invites: RoomInviteCard[] = [];
  for (const item of asArray(json.invites)) {
    const row = asObject(item);
    const id = text(row.id, 40, "");
    const room_slug = safeRoomSlug(row.room_slug);
    if (!UUID.test(id) || !room_slug) continue;
    invites.push({
      id,
      room_slug,
      room_name: text(row.room_name, 80, "Study room"),
      from_name: text(row.from_name, 40, "Someone"),
    });
  }

  return {
    code: text(json.code, 16, ""),
    incoming: requestRows(json.incoming),
    outgoing: requestRows(json.outgoing),
    invites,
    friends,
  };
}

export function parseRoomFriends(data: unknown): RoomFriend[] {
  const friends: RoomFriend[] = [];
  for (const item of asArray(asObject(data).friends)) {
    const row = asObject(item);
    const user_id = text(row.user_id, 40, "");
    if (!UUID.test(user_id)) continue;
    friends.push({
      user_id,
      name: text(row.name, 40, "Someone"),
      online: row.online === true,
      in_voice: row.in_voice === true,
      invited: row.invited === true,
    });
  }
  return friends;
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().rpc(fn, args);
  if (error) throw new Error(friendsMigrationError(error.message));
  return data as T;
}

export async function loadFriends() {
  return parseFriends(await call("my_friends"));
}

export async function requestFriend(query: string) {
  const data = asObject(await call("request_friend", { p_query: query }));
  if (typeof data.error === "string" && data.error) throw new Error(data.error);
  const status = data.status === "accepted" ? "accepted" : "pending";
  return { name: text(data.name, 40, "Someone"), status: status as "accepted" | "pending" };
}

export async function respondFriend(id: string, accept: boolean) {
  await call("respond_friend", { p_id: id, p_accept: accept });
}

export async function cancelFriendRequest(id: string) {
  await call("cancel_friend_request", { p_id: id });
}

export async function removeFriend(userId: string) {
  await call("remove_friend", { p_user_id: userId });
}

export async function loadRoomFriends(slug: string) {
  return parseRoomFriends(await call("room_friends", { p_slug: slug }));
}

export async function inviteFriendToRoom(slug: string, userId: string) {
  await call("invite_friend_to_room", { p_slug: slug, p_user_id: userId });
}

export async function revokeRoomInvite(slug: string, userId: string) {
  await call("revoke_room_invite", { p_slug: slug, p_user_id: userId });
}

export async function dismissRoomInvite(id: string) {
  await call("dismiss_room_invite", { p_id: id });
}

export async function friendNotices(): Promise<{ incoming: number; invites: number } | null> {
  const { data, error } = await createClient().rpc("friend_notices");
  if (error || data == null) return null;
  const json = asObject(data);
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  return { incoming: num(json.incoming), invites: num(json.invites) };
}

let inVoice = false;
const voiceListeners = new Set<() => void>();

export function setInVoice(on: boolean) {
  if (inVoice === on) return;
  inVoice = on;
  voiceListeners.forEach((listener) => listener());
}

export function subscribeInVoice(listener: () => void) {
  voiceListeners.add(listener);
  return () => voiceListeners.delete(listener);
}

export function inVoiceNow() {
  return inVoice;
}

// Tells friends you're online, and which room you're in if you've really joined it.
export async function touchPresence() {
  const room = currentRoom();
  await createClient().rpc("set_friend_presence", { p_slug: room?.slug ?? null, p_voice: inVoice });
}
