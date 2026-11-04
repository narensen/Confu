import type { Params, RawDriver, Row } from "../driver";

// The browser's driver: talks to SQLite in wasm-worker.ts. Opens (or
// creates) the database called `name`, persistent when the browser allows.
export async function wasmDriver(name = "confu", worker?: Worker): Promise<RawDriver> {
  const w = worker ?? new Worker(new URL("./wasm-worker.ts", import.meta.url), { type: "module", name: "confu-sqlite" });
  let next = 0;
  const waiting = new Map<number, { resolve: (v: { rows?: Row[]; persistent?: boolean }) => void; reject: (e: Error) => void }>();
  w.onmessage = (e: MessageEvent<{ id: number; rows?: Row[]; persistent?: boolean; error?: string }>) => {
    const job = waiting.get(e.data.id);
    if (!job) return;
    waiting.delete(e.data.id);
    if (e.data.error) job.reject(new Error(e.data.error));
    else job.resolve(e.data);
  };
  w.onerror = (e) => {
    for (const job of waiting.values()) job.reject(new Error(e.message || "The database worker stopped."));
    waiting.clear();
  };
  const call = (kind: string, extra: Record<string, unknown> = {}) =>
    new Promise<{ rows?: Row[]; persistent?: boolean }>((resolve, reject) => {
      const id = ++next;
      waiting.set(id, { resolve, reject });
      w.postMessage({ id, kind, ...extra });
    });

  const { persistent = false } = await call("open", { name });
  return {
    persistent,
    async run(sql: string, params?: Params) {
      await call("run", { sql, params: params ? [...params] : undefined });
    },
    async all<T = Row>(sql: string, params?: Params) {
      return ((await call("all", { sql, params: params ? [...params] : undefined })).rows ?? []) as T[];
    },
    async close() {
      await call("close");
      w.terminate();
    },
  };
}
