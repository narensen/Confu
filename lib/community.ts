"use client";

// Threads and private learning spaces (migration 0027). Questions people ask
// each other. The tutor inside a session is a different thing, and a learning
// space is not a study room.

import { createClient } from "@/lib/supabase/client";

const MISSING =
  /list_threads|get_thread|create_thread|reply_thread|delete_post|my_spaces|space_state|create_space|join_space|leave_space|delete_space/;

export function communityMigrationError(message: string) {
  if (MISSING.test(message) || /schema cache|PGRST202|PGRST205/i.test(message)) {
    return "Threads and learning spaces need migration 0027 to be run in Supabase.";
  }
  return message;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SPACE_SLUG = /^s-[a-z0-9]{10}$/;

export type ThreadCard = {
  id: string;
  title: string;
  body: string;
  author: string;
  mine: boolean;
  replies: number;
  created_at: string;
};

export type ThreadReply = { id: string; body: string; author: string; mine: boolean; created_at: string };

export type ThreadDetail = {
  thread: ThreadCard & { space_slug: string | null; space_name: string | null };
  replies: ThreadReply[];
};

export type SpaceCard = {
  id: string;
  slug: string;
  name: string;
  about: string;
  mine: boolean;
  members: number;
  questions: number;
};

export type SpaceState = SpaceCard & { joined: boolean; threads: ThreadCard[] };

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

function text(value: unknown, max: number, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, max);
  return trimmed || fallback;
}

function stamp(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : new Date(0).toISOString();
}

function cards(value: unknown): ThreadCard[] {
  const rows: ThreadCard[] = [];
  for (const item of asArray(value)) {
    const row = asObject(item);
    const id = text(row.id, 40);
    if (!UUID.test(id)) continue;
    rows.push({
      id,
      title: text(row.title, 160, "Question"),
      body: text(row.body, 8000),
      author: text(row.author, 40, "Someone"),
      mine: row.mine === true,
      replies: typeof row.replies === "number" && row.replies >= 0 ? Math.min(10000, Math.floor(row.replies)) : 0,
      created_at: stamp(row.created_at),
    });
  }
  return rows;
}

function payloadError(data: unknown) {
  const error = asObject(data).error;
  if (typeof error === "string" && error.trim()) throw new Error(error.trim().slice(0, 240));
}

async function call<T>(fn: string, args: Record<string, unknown>, read: (data: unknown) => T): Promise<T> {
  const { data, error } = await createClient().rpc(fn, args);
  if (error) throw new Error(communityMigrationError(error.message));
  payloadError(data);
  return read(data);
}

export function loadThreads(spaceId: string | null) {
  return call("list_threads", { p_space: spaceId }, (data) => cards(asObject(data).threads));
}

export function loadThread(id: string): Promise<ThreadDetail> {
  if (!UUID.test(id)) return Promise.reject(new Error("That question is gone."));
  return call("get_thread", { p_id: id }, (data) => {
    const json = asObject(data);
    const thread = cards([json.thread])[0];
    if (!thread) throw new Error("That question is gone.");
    const row = asObject(json.thread);
    const slug = text(row.space_slug, 16);
    const replies: ThreadReply[] = [];
    for (const item of asArray(json.replies)) {
      const reply = asObject(item);
      const replyId = text(reply.id, 40);
      if (!UUID.test(replyId)) continue;
      replies.push({
        id: replyId,
        body: text(reply.body, 8000),
        author: text(reply.author, 40, "Someone"),
        mine: reply.mine === true,
        created_at: stamp(reply.created_at),
      });
    }
    return {
      thread: { ...thread, space_slug: SPACE_SLUG.test(slug) ? slug : null, space_name: text(row.space_name, 80) || null },
      replies,
    };
  });
}

export function createThread(input: { title: string; body: string; spaceId?: string | null }) {
  const spaceId = input.spaceId && UUID.test(input.spaceId) ? input.spaceId : null;
  return call("create_thread", { p_title: input.title, p_body: input.body, p_space: spaceId }, (data) => {
    const id = text(asObject(data).id, 40);
    if (!UUID.test(id)) throw new Error("Couldn't post that.");
    return id;
  });
}

export function replyThread(id: string, body: string) {
  if (!UUID.test(id)) return Promise.reject(new Error("That question is gone."));
  return call("reply_thread", { p_id: id, p_body: body }, () => undefined);
}

export function deletePost(id: string) {
  if (!UUID.test(id)) return Promise.reject(new Error("That post is already gone."));
  return call("delete_post", { p_id: id }, () => undefined);
}

function spaceCard(row: Record<string, unknown>): SpaceCard | null {
  const id = text(row.id, 40);
  const slug = text(row.slug, 16);
  if (!UUID.test(id) || !SPACE_SLUG.test(slug)) return null;
  return {
    id,
    slug,
    name: text(row.name, 80, "Space"),
    about: text(row.about, 500),
    mine: row.mine === true,
    members: typeof row.members === "number" ? Math.max(0, Math.floor(row.members)) : 0,
    questions: typeof row.questions === "number" ? Math.max(0, Math.floor(row.questions)) : 0,
  };
}

export function loadSpaces() {
  return call("my_spaces", {}, (data) => asArray(asObject(data).spaces).flatMap((item) => {
    const card = spaceCard(asObject(item));
    return card ? [card] : [];
  }));
}

export function createSpace(name: string, about: string) {
  return call("create_space", { p_name: name, p_about: about }, (data) => {
    const json = asObject(data);
    const slug = text(json.slug, 16);
    if (!SPACE_SLUG.test(slug)) throw new Error("Couldn't make the space.");
    return { slug, name: text(json.name, 80, name.trim() || "Space") };
  });
}

function readSpace(data: unknown): SpaceState {
  const json = asObject(data);
  const card = spaceCard(json);
  if (!card) throw new Error("No space with that link.");
  const joined = json.joined === true;
  return { ...card, joined, threads: joined ? cards(json.threads) : [] };
}

export function loadSpace(slug: string) {
  if (!SPACE_SLUG.test(slug)) return Promise.reject(new Error("No space with that link."));
  return call("space_state", { p_slug: slug }, readSpace);
}

export function joinSpace(slug: string) {
  if (!SPACE_SLUG.test(slug)) return Promise.reject(new Error("No space with that link."));
  return call("join_space", { p_slug: slug }, readSpace);
}

export function leaveSpace(slug: string) {
  if (!SPACE_SLUG.test(slug)) return Promise.reject(new Error("No space with that link."));
  return call("leave_space", { p_slug: slug }, () => undefined);
}

export function deleteSpace(slug: string) {
  if (!SPACE_SLUG.test(slug)) return Promise.reject(new Error("No space with that link."));
  return call("delete_space", { p_slug: slug }, () => undefined);
}
