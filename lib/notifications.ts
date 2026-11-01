"use client";

import { createClient } from "@/lib/supabase/client";

// Your notifications (migration 0039): written by the database when someone
// sends you a friend request, accepts one, invites you to a room, replies to
// your question, or picks your reply as the answer, and when Confu's check
// corrects or hides one of your posts. Delivered live over Realtime, with a
// slow poll as the backstop.

export type NoticeKind = "friend_request" | "friend_accepted" | "room_invite" | "thread_reply" | "reply_accepted" | "post_corrected" | "post_hidden";

export type Notice = {
  id: string;
  kind: NoticeKind;
  title: string;
  body: string;
  url: string;
  data: Record<string, unknown>;
  actor: string | null;
  read: boolean;
  created_at: string;
};

const KINDS = new Set<NoticeKind>(["friend_request", "friend_accepted", "room_invite", "thread_reply", "reply_accepted", "post_corrected", "post_hidden"]);

function parse(value: unknown): Notice | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !KINDS.has(row.kind as NoticeKind)) return null;
  const url = typeof row.url === "string" && row.url.startsWith("/") ? row.url : "";
  return {
    id: row.id,
    kind: row.kind as NoticeKind,
    title: typeof row.title === "string" ? row.title : "",
    body: typeof row.body === "string" ? row.body : "",
    url,
    data: row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : {},
    actor: typeof row.actor === "string" ? row.actor : null,
    read: row.read === true,
    created_at: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
  };
}

export async function loadNotices(): Promise<{ notices: Notice[]; unread: number } | null> {
  const { data, error } = await createClient().rpc("my_notifications", { p_limit: 40 });
  if (error || !data) return null;
  const json = data as { notifications?: unknown[]; unread?: number };
  return {
    notices: (json.notifications ?? []).flatMap((n) => parse(n) ?? []),
    unread: typeof json.unread === "number" ? json.unread : 0,
  };
}

// Mark some as read (or all, with no ids). Returns how many are left unread.
export async function readNotices(ids?: string[]) {
  const { data } = await createClient().rpc("read_notifications", { p_ids: ids?.length ? ids : null });
  return typeof (data as { unread?: number } | null)?.unread === "number" ? (data as { unread: number }).unread : 0;
}

// Calls back whenever a notification of yours is added or updated.
export function watchNotices(userId: string, onChange: () => void) {
  const supabase = createClient();
  const topic = `notifications:${userId}`;
  // supabase.channel() would hand back an existing channel of the same name.
  const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`);
  if (stale) void supabase.removeChannel(stale);
  const channel = supabase
    .channel(topic)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, onChange)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, onChange)
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
