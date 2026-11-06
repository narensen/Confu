import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { broadcastOpener, diff, encodeDoc, joinLive, memoryHub, moveIndex, newShareCode, noteDoc, roomFor, type BroadcastClient } from "@confu/client/live";

const settle = () => new Promise((r) => setTimeout(r, 30));
const text = (d: Y.Doc) => d.getText("content").toString();

describe("live notes", () => {
  test("two people edit at once and end up with the same note", async () => {
    const hub = memoryHub();
    const code = newShareCode();
    const a = noteDoc({ ydoc: null, content: "Entropy notes\n" });
    const b = new Y.Doc();
    await joinLive(a, code, hub.opener);
    await joinLive(b, code, hub.opener);
    await settle();
    expect(text(b)).toBe("Entropy notes\n");
    a.getText("content").insert(text(a).length, "A: disorder grows.\n");
    b.getText("content").insert(0, "# ");
    await settle();
    expect(text(a)).toBe(text(b));
    expect(text(a)).toBe("# Entropy notes\nA: disorder grows.\n");
  });

  test("the relay sees neither the code nor the words", async () => {
    const hub = memoryHub();
    const code = newShareCode();
    const a = noteDoc({ ydoc: null, content: "secret formula" });
    await joinLive(a, code, hub.opener);
    await settle();
    const { room } = await roomFor(code);
    expect(room).not.toContain(code);
    const seen = hub.sent.map((m) => new TextDecoder().decode(m)).join("");
    expect(seen).not.toContain("secret");
  });

  test("a stranger with a different code can't read or write", async () => {
    const hub = memoryHub();
    const code = newShareCode();
    const a = noteDoc({ ydoc: null, content: "mine" });
    await joinLive(a, code, hub.opener);
    // Same room name, wrong key: forge a room by reusing the hub's room.
    const { room } = await roomFor(code);
    const t = await hub.opener(room);
    t.send(new Uint8Array(64).fill(7));
    await settle();
    expect(text(a)).toBe("mine");
  });

  test("a note survives being stored and loaded", () => {
    const d = noteDoc({ ydoc: null, content: "Hello" });
    d.getText("content").insert(5, " world");
    expect(text(noteDoc({ ydoc: encodeDoc(d), content: "" }))).toBe("Hello world");
  });

  test("text edits and cursors", () => {
    expect(diff("hello world", "hello brave world")).toEqual({ index: 6, remove: 0, insert: "brave " });
    expect(diff("abcdef", "abef")).toEqual({ index: 2, remove: 2, insert: "" });
    // Someone inserts 3 characters before my cursor at 10.
    expect(moveIndex(10, [{ retain: 2 }, { insert: "xyz" }])).toBe(13);
    // …or deletes 4 characters around it.
    expect(moveIndex(10, [{ retain: 8 }, { delete: 4 }])).toBe(8);
    // …or edits after it.
    expect(moveIndex(3, [{ retain: 5 }, { insert: "zz" }])).toBe(3);
  });
});

test("the Supabase broadcast relay carries updates between two clients", async () => {
  // A stand-in for Supabase Realtime: one in-memory channel per name.
  const channels = new Map<string, Set<(p: { d: string }) => void>>();
  const client = (): BroadcastClient => ({
    channel(name) {
      let handler: ((m: { payload: { d?: string } }) => void) | null = null;
      const set = channels.get(name) ?? new Set();
      channels.set(name, set);
      const me = (p: { d: string }) => handler?.({ payload: p });
      const ch = {
        on(_t: "broadcast", _f: { event: string }, cb: (m: { payload: { d?: string } }) => void) {
          handler = cb;
          return ch;
        },
        subscribe(cb: (s: string) => void) {
          set.add(me);
          cb("SUBSCRIBED");
        },
        async send(msg: { payload: { d: string } }) {
          for (const other of set) if (other !== me) setTimeout(() => other(msg.payload), 0);
        },
      };
      return ch;
    },
    removeChannel() {},
  });
  const code = newShareCode();
  const a = noteDoc({ ydoc: null, content: "shared " });
  const b = new Y.Doc();
  await joinLive(a, code, broadcastOpener(client()));
  await joinLive(b, code, broadcastOpener(client()));
  await settle();
  b.getText("content").insert(7, "text");
  await settle();
  expect(text(a)).toBe("shared text");
  expect([...channels.keys()][0]).toStartWith("confu-note-");
});
