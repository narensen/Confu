"use client";

// Threads and learning spaces (migrations 0027 and 0038). Questions people
// ask each other, organised by subject. The tutor inside a session is a
// different thing, and a learning space is not a study room.
//
// Spaces are either public subjects (Mathematics, Law…: anyone signed in can
// read; asking or replying joins you) or private groups joined by link.

import { createClient } from "@/lib/supabase/client";

const V1 = /list_threads|get_thread|create_thread|reply_thread|delete_post|my_spaces|space_state|create_space|join_space|leave_space|delete_space/;
const V2 = /browse_threads|browse_spaces|toggle_vote|accept_reply|edit_post|_space_open|post_votes|activity_at|accepted_id/;
const V3 = /report_post|_check_json|_post_visible|check_status|post_reports/;

export function communityMigrationError(message: string) {
  if (V3.test(message)) return "Reports and checks need migration 0039 to be run in Supabase.";
  if (V2.test(message)) return "Subjects, votes and answers need migration 0038 to be run in Supabase.";
  if (V1.test(message) || /schema cache|PGRST202|PGRST205/i.test(message)) {
    return "Threads and learning spaces need migrations 0027 and 0038 to be run in Supabase.";
  }
  return message;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A private space's link (s-xxxxxxxxxx) or a subject's name (physics, computer-science).
export const SPACE_SLUG = /^(s-[a-z0-9]{10}|[a-z][a-z0-9-]{1,38}[a-z0-9])$/;

export type SpaceRef = { slug: string; name: string; icon: string; visibility: "public" | "private" };

// What Confu's check found (migration 0039). Absent when the post is fine.
//   pending    not checked yet (a page asks for it)
//   flagged    may be wrong: a note says why
//   corrected  a reply that was wrong: the note, and the corrected reply
//   hidden     spam or abuse, waiting for review (only its author sees it)
export type PostCheck = {
  status: "pending" | "flagged" | "corrected" | "hidden";
  note: string | null;
  fix: string | null;
  incorrect: number | null;
  rational: number | null;
};

export type ThreadCard = {
  id: string;
  title: string;
  body: string;
  author: string;
  mine: boolean;
  replies: number;
  votes: number;
  voted: boolean;
  solved: boolean;
  flagged: boolean;
  hidden: boolean;
  created_at: string;
  activity_at: string;
  space: SpaceRef | null;
};

export type ThreadReply = {
  id: string;
  body: string;
  author: string;
  mine: boolean;
  created_at: string;
  edited: boolean;
  votes: number;
  voted: boolean;
  accepted: boolean;
  reported: boolean;
  check: PostCheck | null;
};

export type ThreadDetail = {
  thread: ThreadCard & { edited: boolean; joined: boolean; reported: boolean; check: PostCheck | null };
  replies: ThreadReply[];
};

export type SpaceCard = {
  id: string;
  slug: string;
  name: string;
  about: string;
  icon: string;
  category: string;
  visibility: "public" | "private";
  official: boolean;
  mine: boolean;
  joined: boolean;
  members: number;
  questions: number;
  thisWeek: number;
};

export type SpaceState = SpaceCard;

export type ThreadSort = "active" | "new" | "top" | "unanswered" | "mine";

/* ---------------------------------------------------------------- parsing */

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

function count(value: unknown) {
  return typeof value === "number" && value >= 0 ? Math.min(1_000_000, Math.floor(value)) : 0;
}

function stamp(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : new Date(0).toISOString();
}

function spaceRef(value: unknown): SpaceRef | null {
  const row = asObject(value);
  const slug = text(row.slug, 40);
  if (!SPACE_SLUG.test(slug)) return null;
  return {
    slug,
    name: text(row.name, 80, "Space"),
    icon: text(row.icon, 8),
    visibility: row.visibility === "public" ? "public" : "private",
  };
}

function card(value: unknown): ThreadCard | null {
  const row = asObject(value);
  const id = text(row.id, 40);
  if (!UUID.test(id)) return null;
  const created = stamp(row.created_at);
  return {
    id,
    title: text(row.title, 160, "Question"),
    body: text(row.body, 8000),
    author: text(row.author, 40, "Someone"),
    mine: row.mine === true,
    replies: count(row.replies),
    votes: count(row.votes),
    voted: row.voted === true,
    solved: row.solved === true,
    flagged: row.flagged === true,
    hidden: row.hidden === true,
    created_at: created,
    activity_at: typeof row.activity_at === "string" ? stamp(row.activity_at) : created,
    space: row.space ? spaceRef(row.space) : null,
  };
}

function postCheck(value: unknown): PostCheck | null {
  const row = asObject(value);
  const status = row.status;
  if (status !== "pending" && status !== "flagged" && status !== "corrected" && status !== "hidden") return null;
  const share = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);
  return {
    status,
    note: text(row.note, 4000) || null,
    fix: text(row.fix, 8000) || null,
    incorrect: share(row.incorrect),
    rational: share(row.rational),
  };
}

function spaceCard(value: unknown): SpaceCard | null {
  const row = asObject(value);
  const id = text(row.id, 40);
  const slug = text(row.slug, 40);
  if (!UUID.test(id) || !SPACE_SLUG.test(slug)) return null;
  return {
    id,
    slug,
    name: text(row.name, 80, "Space"),
    about: text(row.about, 500),
    icon: text(row.icon, 8),
    category: text(row.category, 40),
    visibility: row.visibility === "public" ? "public" : "private",
    official: row.official === true,
    mine: row.mine === true,
    joined: row.joined === true,
    members: count(row.members),
    questions: count(row.questions),
    thisWeek: count(row.this_week),
  };
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

/* ---------------------------------------------------------------- threads */

export const PAGE_SIZE = 25;

// Everywhere public (no space), or one space; sorted, searched, a page at a time.
export function browseThreads(opts: { space?: string | null; sort?: ThreadSort; query?: string; offset?: number }) {
  return call(
    "browse_threads",
    {
      p_space: opts.space ?? null,
      p_sort: opts.sort ?? "active",
      p_query: opts.query?.trim() || null,
      p_limit: PAGE_SIZE,
      p_offset: opts.offset ?? 0,
    },
    (data) => {
      const json = asObject(data);
      return { threads: asArray(json.threads).flatMap((item) => card(item) ?? []), total: count(json.total) };
    },
  );
}

export function loadThread(id: string): Promise<ThreadDetail> {
  if (!UUID.test(id)) return Promise.reject(new Error("That question is gone."));
  return call("get_thread", { p_id: id }, (data) => {
    const json = asObject(data);
    const row = asObject(json.thread);
    const thread = card(row);
    if (!thread) throw new Error("That question is gone.");
    // Before 0038 the thread named its space with space_slug and space_name.
    const legacy = !thread.space && SPACE_SLUG.test(text(row.space_slug, 40)) ? spaceRef({ slug: row.space_slug, name: row.space_name, visibility: "private" }) : null;
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
        edited: reply.edited === true,
        votes: count(reply.votes),
        voted: reply.voted === true,
        accepted: reply.accepted === true,
        reported: reply.reported === true,
        check: postCheck(reply.check),
      });
    }
    return {
      thread: {
        ...thread,
        space: thread.space ?? legacy,
        edited: row.edited === true,
        joined: row.joined === true,
        reported: row.reported === true,
        check: postCheck(row.check),
      },
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
  }).then((id) => {
    void requestChecks([id]);
    return id;
  });
}

export function replyThread(id: string, body: string) {
  if (!UUID.test(id)) return Promise.reject(new Error("That question is gone."));
  return call("reply_thread", { p_id: id, p_body: body }, (data) => {
    const replyId = text(asObject(data).id, 40);
    if (!UUID.test(replyId)) throw new Error("Couldn't post that.");
    return replyId;
  }).then((replyId) => {
    void requestChecks([replyId]);
    return replyId;
  });
}

export function editPost(id: string, body: string, title?: string) {
  if (!UUID.test(id)) return Promise.reject(new Error("That post is gone."));
  return call("edit_post", { p_id: id, p_title: title ?? null, p_body: body }, () => undefined).then((result) => {
    void requestChecks([id]);
    return result;
  });
}

export function deletePost(id: string) {
  if (!UUID.test(id)) return Promise.reject(new Error("That post is already gone."));
  return call("delete_post", { p_id: id }, () => undefined);
}

export function toggleVote(id: string) {
  if (!UUID.test(id)) return Promise.reject(new Error("That post is gone."));
  return call("toggle_vote", { p_id: id }, (data) => {
    const json = asObject(data);
    return { voted: json.voted === true, votes: count(json.votes) };
  });
}

// The asker picks the reply that answered it; the same reply again (or null) clears it.
export function acceptReply(threadId: string, replyId: string | null) {
  if (!UUID.test(threadId)) return Promise.reject(new Error("That question is gone."));
  return call("accept_reply", { p_thread: threadId, p_reply: replyId }, (data) => {
    const accepted = text(asObject(data).accepted, 40);
    return UUID.test(accepted) ? accepted : null;
  });
}

export type ReportReason = "wrong" | "spam" | "abuse" | "other";

export function reportPost(id: string, reason: ReportReason, note = "") {
  if (!UUID.test(id)) return Promise.reject(new Error("That post is gone."));
  return call("report_post", { p_id: id, p_reason: reason, p_note: note }, (data) => {
    const json = asObject(data);
    return { recheck: json.recheck === true, hidden: json.hidden === true };
  }).then((result) => {
    if (result.recheck) void requestChecks([id]);
    return result;
  });
}

// Ask the server to check posts that haven't been (new, edited, or reported
// as wrong). Returns what changed: post id → its new status.
export async function requestChecks(ids: string[]): Promise<Record<string, string>> {
  const wanted = ids.filter((id) => UUID.test(id)).slice(0, 5);
  if (!wanted.length) return {};
  try {
    const res = await fetch("/api/community/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: wanted }) });
    if (!res.ok) return {};
    const json = (await res.json()) as { results?: Record<string, string | null> };
    return Object.fromEntries(Object.entries(json.results ?? {}).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

/* ----------------------------------------------------------------- spaces */

function spaceList(data: unknown) {
  return asArray(asObject(data).spaces).flatMap((item) => spaceCard(item) ?? []);
}

// Every public subject.
export function browseSpaces() {
  return call("browse_spaces", {}, spaceList);
}

// The spaces you're in: private groups and subjects you follow.
export function loadSpaces() {
  return call("my_spaces", {}, spaceList);
}

export function createSpace(name: string, about: string) {
  return call("create_space", { p_name: name, p_about: about }, (data) => {
    const json = asObject(data);
    const slug = text(json.slug, 40);
    if (!SPACE_SLUG.test(slug)) throw new Error("Couldn't make the space.");
    return { slug, name: text(json.name, 80, name.trim() || "Space") };
  });
}

function readSpace(data: unknown): SpaceState {
  const space = spaceCard(data);
  if (!space) throw new Error("No space with that link.");
  return space;
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

/* ------------------------------------------------------------------ text */

const TEX: Record<string, string> = {
  top: "ᵀ", alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", theta: "θ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", phi: "φ", omega: "ω",
  Sigma: "Σ", Delta: "Δ", Omega: "Ω", Pi: "Π", sum: "∑", prod: "∏", int: "∫", infty: "∞", partial: "∂", nabla: "∇", cdot: "·", times: "×",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", neq: "≠", approx: "≈", to: "→", rightarrow: "→", Rightarrow: "⇒", in: "∈", sqrt: "√", pm: "±",
};

// Inline maths as readable text: $u^\top \Sigma u$ → uᵀ Σ u.
function texToText(tex: string) {
  return tex
    .replace(/\\(?:frac)\{([^}]*)\}\{([^}]*)\}/g, "($1)/($2)")
    .replace(/\^\\top/g, "ᵀ")
    .replace(/\\([a-zA-Z]+)/g, (m, name: string) => TEX[name] ?? "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// A post's body as one line of plain text, for previews in lists.
export function plainExcerpt(markdown: string, max = 220) {
  const flat = markdown
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/\$\$[\s\S]*?\$\$/g, " [equation] ")
    .replace(/\$([^$\n]{1,200})\$/g, (_, tex: string) => texToText(tex))
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}
