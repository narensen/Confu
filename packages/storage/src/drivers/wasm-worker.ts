/// <reference lib="webworker" />
// Runs SQLite (WebAssembly) in a dedicated worker, stored in the browser's
// origin-private file system with the "opfs-sahpool" VFS. That VFS needs no
// cross-origin isolation headers (which would break Google sign-in and the
// Drive picker pop-ups), at the cost of one tab at a time owning the
// database; a second tab falls back to memory and says so.
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

type Db = {
  exec(opts: { sql: string; bind?: unknown[] }): unknown;
  selectObjects(sql: string, bind?: unknown[]): Record<string, unknown>[];
  close(): void;
};
type Request = { id: number; kind: "open" | "run" | "all" | "close"; sql?: string; params?: unknown[]; name?: string };

let db: Db | null = null;
let persistent = false;
let opening: Promise<void> | null = null;

// The pool's options. preserveOnInitFailure: by default a failed start
// *deletes the pool* (the student's database), which is exactly what must
// not happen when the failure is only another tab holding it.
// forceReinitIfPreviouslyFailed: try again instead of returning the cached
// failure.
const POOL = {
  name: "confu-sahpool",
  directory: ".confu",
  initialCapacity: 8,
  preserveOnInitFailure: true,
  forceReinitIfPreviouslyFailed: true,
};

// A reloaded page can start before the old one has let go of the files.
// Wait for it (about 4 s in all) before giving up and running in memory.
const WAITS = [0, 150, 300, 600, 1200, 2000];

async function open(name: string) {
  const sqlite3 = await sqlite3InitModule();
  for (const wait of WAITS) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const pool = await sqlite3.installOpfsSAHPoolVfs(POOL as Parameters<typeof sqlite3.installOpfsSAHPoolVfs>[0]);
      db = new pool.OpfsSAHPoolDb(`/${name}.sqlite3`) as unknown as Db;
      persistent = true;
      return;
    } catch (e) {
      // No OPFS at all (private browsing in some browsers, very old ones):
      // waiting won't help.
      if (e instanceof Error && /Missing required OPFS APIs/.test(e.message)) break;
    }
  }
  // Another tab holds the database, or there's no OPFS: keep working, in memory.
  db = new sqlite3.oo1.DB(":memory:", "c") as unknown as Db;
  persistent = false;
}

const reply = (msg: Record<string, unknown>) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, kind, sql = "", params } = event.data;
  try {
    if (kind === "open") {
      opening ??= open(event.data.name ?? "confu");
      await opening;
      return reply({ id, persistent });
    }
    await opening;
    if (!db) throw new Error("The database isn't open.");
    const bind = params && params.length ? params : undefined;
    if (kind === "run") {
      db.exec({ sql, bind });
      return reply({ id });
    }
    if (kind === "all") return reply({ id, rows: db.selectObjects(sql, bind) });
    if (kind === "close") {
      db.close();
      db = null;
      return reply({ id });
    }
  } catch (err) {
    reply({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
