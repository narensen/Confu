import * as Y from "yjs";

// Editing a note together, live. The note is a Yjs document (a CRDT: edits
// from several people merge without conflicts). Peers swap Yjs updates over
// a broadcast channel the host provides (Supabase Realtime on the web).
//
// End-to-end encrypted: the share code (which travels only in the link's
// #fragment) gives both the room name and an AES-GCM key. The relay sees
// neither the room's code nor the text.

export interface LiveTransport {
  send(data: Uint8Array): void;
  onMessage(cb: (data: Uint8Array) => void): () => void;
  close(): void;
}
export type LiveOpener = (room: string) => Promise<LiveTransport>;

const HELLO = 1; // "I just joined": everyone answers with their whole document
const UPDATE = 2;
const REMOTE = Symbol("live-remote");

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

export const newShareCode = () => b64url(crypto.getRandomValues(new Uint8Array(24)));
export const isShareCode = (s: string) => /^[A-Za-z0-9_-]{32}$/.test(s);

export async function roomFor(code: string): Promise<{ room: string; key: CryptoKey }> {
  const room = [...(await sha256(`confu-room:${code}`)).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = await crypto.subtle.importKey("raw", await sha256(`confu-key:${code}`), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { room, key };
}

async function seal(key: CryptoKey, kind: number, payload: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new Uint8Array(payload.length + 1);
  plain[0] = kind;
  plain.set(payload, 1);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

async function open(key: CryptoKey, data: Uint8Array): Promise<{ kind: number; payload: Uint8Array } | null> {
  try {
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(0, 12) }, key, data.slice(12)));
    return { kind: plain[0], payload: plain.slice(1) };
  } catch {
    return null; // not ours, or tampered with: ignored
  }
}

export async function joinLive(doc: Y.Doc, code: string, openRoom: LiveOpener): Promise<{ leave: () => void }> {
  const { room, key } = await roomFor(code);
  const t = await openRoom(room);
  const send = (kind: number, payload: Uint8Array) => void seal(key, kind, payload).then((m) => t.send(m));
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) send(UPDATE, update);
  };
  doc.on("update", onUpdate);
  const off = t.onMessage((data) => {
    void open(key, data).then((m) => {
      if (!m) return;
      if (m.kind === HELLO) send(UPDATE, Y.encodeStateAsUpdate(doc));
      else if (m.kind === UPDATE) Y.applyUpdate(doc, m.payload, REMOTE);
    });
  });
  // Ask for everyone's document, and offer ours.
  send(HELLO, new Uint8Array());
  send(UPDATE, Y.encodeStateAsUpdate(doc));
  return {
    leave() {
      doc.off("update", onUpdate);
      off();
      t.close();
    },
  };
}

// A note's Yjs document, from what's stored (ydoc: base64 of its state).
export function noteDoc(stored: { ydoc: string | null; content: string }): Y.Doc {
  const doc = new Y.Doc();
  if (stored.ydoc) Y.applyUpdate(doc, Uint8Array.from(atob(stored.ydoc), (c) => c.charCodeAt(0)));
  else if (stored.content) doc.getText("content").insert(0, stored.content);
  return doc;
}

export function encodeDoc(doc: Y.Doc): string {
  const bytes = Y.encodeStateAsUpdate(doc);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// The smallest edit turning `before` into `after` (one typed or pasted change).
export function diff(before: string, after: string): { index: number; remove: number; insert: string } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { index: start, remove: before.length - start - end, insert: after.slice(start, after.length - end) };
}

// Where a cursor at `index` ends up after a remote change (a Yjs text delta).
export function moveIndex(index: number, delta: { retain?: number; insert?: unknown; delete?: number }[]): number {
  let pos = 0;
  let out = index;
  for (const op of delta) {
    if (op.retain) pos += op.retain;
    else if (typeof op.insert === "string") {
      if (pos <= index) out += op.insert.length;
      pos += op.insert.length;
    } else if (op.delete) {
      if (pos < index) out -= Math.min(op.delete, index - pos);
    }
    if (pos > out) break;
  }
  return Math.max(0, out);
}

// A transport for tests: every opener in the same hub hears the others.
export function memoryHub() {
  const rooms = new Map<string, Set<(d: Uint8Array) => void>>();
  const sent: Uint8Array[] = [];
  const opener: LiveOpener = async (room) => {
    const listeners = new Set<(d: Uint8Array) => void>();
    const members = rooms.get(room) ?? new Set();
    rooms.set(room, members);
    const deliver = (d: Uint8Array) => listeners.forEach((l) => l(d));
    members.add(deliver);
    return {
      send(data) {
        sent.push(data);
        for (const m of members) if (m !== deliver) queueMicrotask(() => m(data));
      },
      onMessage(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      close() {
        members.delete(deliver);
      },
    };
  };
  return { opener, sent, rooms };
}

// A relay over Supabase Realtime broadcast (free tier; messages aren't
// stored). Takes the host's Supabase client; only these calls are used.
type Channel = {
  on(type: "broadcast", filter: { event: string }, cb: (msg: { payload: { d?: string } }) => void): Channel;
  subscribe(cb: (status: string) => void): unknown;
  send(msg: { type: "broadcast"; event: string; payload: { d: string } }): Promise<unknown>;
};
export type BroadcastClient = { channel(name: string, opts: { config: { broadcast: { self: boolean } } }): Channel; removeChannel(ch: Channel): unknown };

function toB64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function broadcastOpener(client: BroadcastClient): LiveOpener {
  return async (room) => {
    const listeners = new Set<(d: Uint8Array) => void>();
    const channel = client.channel(`confu-note-${room}`, { config: { broadcast: { self: false } } }).on("broadcast", { event: "u" }, ({ payload }) => {
      if (typeof payload?.d !== "string") return;
      const bytes = Uint8Array.from(atob(payload.d), (c) => c.charCodeAt(0));
      listeners.forEach((l) => l(bytes));
    });
    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error("Couldn't reach the live editing relay."));
      });
    });
    return {
      send: (data) => void channel.send({ type: "broadcast", event: "u", payload: { d: toB64(data) } }),
      onMessage(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      close: () => void client.removeChannel(channel),
    };
  };
}
