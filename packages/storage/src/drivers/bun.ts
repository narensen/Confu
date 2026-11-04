import { Database } from "bun:sqlite";
import type { Params, RawDriver, Row } from "../driver";

// Bun's built-in SQLite: tests, and scripts. `:memory:` unless a path is given.
export function bunDriver(path = ":memory:"): RawDriver {
  const db = new Database(path, { create: true, strict: true });
  return {
    persistent: path !== ":memory:",
    async run(sql: string, params: Params = []) {
      db.query(sql).run(...(params as never[]));
    },
    async all<T = Row>(sql: string, params: Params = []) {
      return db.query(sql).all(...(params as never[])) as T[];
    },
    async close() {
      db.close();
    },
  };
}
