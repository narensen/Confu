import { SerialDriver, type Params, type RawDriver, type Sql, type SqlValue } from "./driver";
import { Clock } from "./hlc";
import { migrate } from "./schema";
import { TABLE, type TableSpec } from "./tables";

// The on-device database. Every write to a synced table is stamped with the
// clock and logged in _changes, for the sync to pick up later. Table and
// column names only ever come from the specs in tables.ts, never from
// callers' strings, and values are always bound parameters.

export type Change = { tbl: string; key: string; op: "put" | "delete"; hlc: string; data: Record<string, unknown> | null };
type Stored = Record<string, unknown>;

const quote = (name: string) => `"${name}"`;

function spec(table: string): TableSpec {
  const s = TABLE[table];
  if (!s) throw new Error(`Unknown table: ${table}`);
  return s;
}

// The row's key as one string: "id", or "doc-1|3" for a composite key.
export const rowKey = (s: TableSpec, row: Stored) => s.key.map((k) => String(row[k])).join("|");

function toSql(s: TableSpec, row: Stored): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  for (const [name, value] of Object.entries(row)) {
    const col = s.columns.find((c) => c.name === name);
    if (!col) throw new Error(`${s.name} has no column ${name}`);
    out[name] =
      value === undefined || value === null
        ? null
        : col.type === "json"
          ? JSON.stringify(value)
          : col.type === "bool"
            ? value
              ? 1
              : 0
            : (value as SqlValue);
  }
  return out;
}

function fromSql<T>(s: TableSpec, row: Record<string, SqlValue>): T {
  const out: Stored = {};
  for (const col of s.columns) {
    const v = row[col.name];
    out[col.name] = v === null || v === undefined ? null : col.type === "json" ? JSON.parse(String(v)) : col.type === "bool" ? Boolean(v) : v;
  }
  return out as T;
}

const randomId = () => crypto.randomUUID();

const withId = (s: TableSpec, row: Stored): Stored => (s.key.length === 1 && s.key[0] === "id" && row.id == null ? { ...row, id: randomId() } : { ...row });

// "a = ? AND b IS NULL" for { a: 1, b: null }, with its parameters.
function whereOf(s: TableSpec, where: Stored): { sql: string; params: SqlValue[] } {
  const cols = Object.keys(where);
  for (const c of cols) if (!s.columns.some((x) => x.name === c)) throw new Error(`${s.name} has no column ${c}`);
  return {
    sql: cols.map((c) => (where[c] === null ? `${quote(c)} IS NULL` : `${quote(c)} = ?`)).join(" AND "),
    params: cols.filter((c) => where[c] !== null).map((c) => toSql(s, { [c]: where[c] })[c]),
  };
}

export class Store {
  private constructor(
    private readonly db: SerialDriver,
    readonly clock: Clock,
  ) {}

  static async open(raw: RawDriver, opts: { device?: string } = {}): Promise<Store> {
    const db = new SerialDriver(raw);
    await db.run("PRAGMA foreign_keys = OFF"); // rows from a sync can arrive in any order
    await db.transaction(migrate);
    const meta = Object.fromEntries((await db.all<{ key: string; value: string }>(`SELECT key, value FROM "_meta"`)).map((r) => [r.key, r.value]));
    const device = meta.device ?? opts.device ?? `dev-${randomId().slice(0, 8)}`;
    if (!meta.device) await db.run(`INSERT INTO "_meta" (key, value) VALUES ('device', ?)`, [device]);
    const [last] = await db.all<{ hlc: string }>(`SELECT max(hlc) AS hlc FROM "_changes"`);
    return new Store(db, new Clock(device, last?.hlc ?? undefined));
  }

  get persistent() {
    return this.db.persistent;
  }

  get device() {
    return this.clock.device;
  }

  // ---- reads ----

  async get<T = Stored>(table: string, key: Stored): Promise<T | null> {
    const s = spec(table);
    const where = s.key.map((k) => `${quote(k)} = ?`).join(" AND ");
    const [row] = await this.db.all<Record<string, SqlValue>>(`SELECT * FROM ${quote(s.name)} WHERE ${where} LIMIT 1`, s.key.map((k) => key[k] as SqlValue));
    return row ? fromSql<T>(s, row) : null;
  }

  // Rows whose columns equal the given values, optionally ordered.
  async list<T = Stored>(table: string, where: Stored = {}, opts: { order?: string; desc?: boolean; limit?: number } = {}): Promise<T[]> {
    const s = spec(table);
    if (opts.order && !s.columns.some((x) => x.name === opts.order)) throw new Error(`${s.name} has no column ${opts.order}`);
    const w = whereOf(s, where);
    const sql = [
      `SELECT * FROM ${quote(s.name)}`,
      w.sql ? `WHERE ${w.sql}` : "",
      opts.order ? `ORDER BY ${quote(opts.order)} ${opts.desc ? "DESC" : "ASC"}` : "",
      opts.limit ? `LIMIT ${Math.max(1, Math.floor(opts.limit))}` : "",
    ].join(" ");
    return (await this.db.all<Record<string, SqlValue>>(sql, w.params)).map((r) => fromSql<T>(s, r));
  }

  // A read-only query for what list() can't express (joins, search).
  query<T>(sql: string, params?: Params): Promise<T[]> {
    return this.db.all<T>(sql, params);
  }

  // ---- writes ----

  // Insert or update a row (only the given columns change on update).
  // An `id` is created when a table keyed by id gets a row without one.
  async put<T extends Stored>(table: string, row: T): Promise<T & { id?: string }> {
    const s = spec(table);
    const full = withId(s, row);
    await this.db.transaction((tx) => this.write(tx, s, full, s.synced ? this.clock.tick() : null, true));
    return full as T & { id?: string };
  }

  // Several rows in one transaction (a document's pages): one commit
  // instead of hundreds.
  async putMany<T extends Stored>(table: string, rows: T[]): Promise<void> {
    const s = spec(table);
    if (!rows.length) return;
    await this.db.transaction(async (tx) => {
      for (const row of rows) await this.write(tx, s, withId(s, row), s.synced ? this.clock.tick() : null, true);
    });
  }

  async remove(table: string, key: Stored): Promise<void> {
    const s = spec(table);
    await this.db.transaction((tx) => this.drop(tx, s, key));
  }

  // Every row whose columns equal the given values, each logged as a
  // delete. Returns how many went.
  async removeWhere(table: string, where: Stored): Promise<number> {
    const s = spec(table);
    const w = whereOf(s, where);
    if (!w.sql) throw new Error("removeWhere needs a condition");
    return this.db.transaction(async (tx) => {
      const keys = await tx.all<Stored>(`SELECT ${s.key.map(quote).join(", ")} FROM ${quote(s.name)} WHERE ${w.sql}`, w.params);
      for (const key of keys) await this.drop(tx, s, key);
      return keys.length;
    });
  }

  private async drop(tx: Sql, s: TableSpec, key: Stored) {
    const k = rowKey(s, key);
    await tx.run(`DELETE FROM ${quote(s.name)} WHERE ${s.key.map((c) => `${quote(c)} = ?`).join(" AND ")}`, s.key.map((c) => key[c] as SqlValue));
    if (!s.synced) return;
    const hlc = this.clock.tick();
    await tx.run(`INSERT INTO "_tombstones" (tbl, row_key, hlc) VALUES (?, ?, ?) ON CONFLICT (tbl, row_key) DO UPDATE SET hlc = excluded.hlc`, [s.name, k, hlc]);
    await tx.run(`INSERT INTO "_changes" (tbl, row_key, op, hlc, data) VALUES (?, ?, 'delete', ?, NULL)`, [s.name, k, hlc]);
  }

  private async write(tx: Sql, s: TableSpec, row: Stored, hlc: string | null, log: boolean) {
    const values = toSql(s, row);
    if (hlc) values._hlc = hlc;
    for (const k of s.key) if (values[k] === undefined || values[k] === null) throw new Error(`${s.name}: ${k} is required`);
    const where = s.key.map((c) => `${quote(c)} = ?`).join(" AND ");
    const keyValues = s.key.map((c) => values[c]);
    const updates = Object.keys(values).filter((c) => !s.key.includes(c));
    // An existing row is updated in place, so a partial row (just a status)
    // works; INSERT … ON CONFLICT would check the missing required columns
    // before noticing the row exists. UPDATE also fires the triggers that
    // keep page search in step (INSERT OR REPLACE would not).
    const [exists] = await tx.all(`SELECT 1 AS x FROM ${quote(s.name)} WHERE ${where}`, keyValues);
    if (exists) {
      if (updates.length) await tx.run(`UPDATE ${quote(s.name)} SET ${updates.map((c) => `${quote(c)} = ?`).join(", ")} WHERE ${where}`, [...updates.map((c) => values[c]), ...keyValues]);
    } else {
      const cols = Object.keys(values);
      await tx.run(`INSERT INTO ${quote(s.name)} (${cols.map(quote).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((c) => values[c]));
    }
    if (!hlc || !log) return;
    const k = rowKey(s, row);
    await tx.run(`DELETE FROM "_tombstones" WHERE tbl = ? AND row_key = ?`, [s.name, k]);
    // The whole row as it is now, so another device can apply it on its own.
    const [current] = await tx.all<Record<string, SqlValue>>(`SELECT * FROM ${quote(s.name)} WHERE ${where}`, keyValues);
    await tx.run(`INSERT INTO "_changes" (tbl, row_key, op, hlc, data) VALUES (?, ?, 'put', ?, ?)`, [s.name, k, hlc, JSON.stringify(fromSql(s, current))]);
  }

  // ---- sync ----

  // Local changes not yet uploaded, oldest first.
  async pending(limit = 500): Promise<(Change & { seq: number })[]> {
    const rows = await this.db.all<{ seq: number; tbl: string; row_key: string; op: "put" | "delete"; hlc: string; data: string | null }>(
      `SELECT seq, tbl, row_key, op, hlc, data FROM "_changes" WHERE synced = 0 ORDER BY seq LIMIT ?`,
      [limit],
    );
    return rows.map((r) => ({ seq: r.seq, tbl: r.tbl, key: r.row_key, op: r.op, hlc: r.hlc, data: r.data ? (JSON.parse(r.data) as Record<string, unknown>) : null }));
  }

  async markSynced(upTo: number): Promise<void> {
    await this.db.run(`UPDATE "_changes" SET synced = 1 WHERE seq <= ? AND synced = 0`, [upTo]);
  }

  // Apply changes from another device. The newest change to a row wins; an
  // older one (including one older than a delete) is ignored. Returns how
  // many changed something here.
  async applyRemote(changes: Change[]): Promise<number> {
    let applied = 0;
    await this.db.transaction(async (tx) => {
      for (const c of changes) {
        const s = TABLE[c.tbl];
        if (!s?.synced) continue;
        this.clock.receive(c.hlc);
        const keyParts = c.key.split("|");
        const where = s.key.map((k) => `${quote(k)} = ?`).join(" AND ");
        const keyValues = s.key.map((k, i) => (s.columns.find((x) => x.name === k)?.type === "int" ? Number(keyParts[i]) : keyParts[i]));
        const [current] = await tx.all<{ _hlc: string }>(`SELECT "_hlc" FROM ${quote(s.name)} WHERE ${where}`, keyValues);
        const [tomb] = await tx.all<{ hlc: string }>(`SELECT hlc FROM "_tombstones" WHERE tbl = ? AND row_key = ?`, [s.name, c.key]);
        const latest = [current?._hlc ?? "", tomb?.hlc ?? ""].sort().pop()!;
        if (c.hlc <= latest) continue;
        if (c.op === "delete") {
          await tx.run(`DELETE FROM ${quote(s.name)} WHERE ${where}`, keyValues);
          await tx.run(`INSERT INTO "_tombstones" (tbl, row_key, hlc) VALUES (?, ?, ?) ON CONFLICT (tbl, row_key) DO UPDATE SET hlc = excluded.hlc`, [s.name, c.key, c.hlc]);
        } else if (c.data) {
          const known = Object.fromEntries(Object.entries(c.data).filter(([k]) => s.columns.some((x) => x.name === k)));
          await this.write(tx, s, known, c.hlc, false);
          await tx.run(`DELETE FROM "_tombstones" WHERE tbl = ? AND row_key = ?`, [s.name, c.key]);
        }
        applied++;
      }
    });
    return applied;
  }

  // ---- device settings and sync bookkeeping (never synced) ----

  async getMeta(key: string): Promise<string | null> {
    const [row] = await this.db.all<{ value: string }>(`SELECT value FROM "_meta" WHERE key = ?`, [key]);
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string | null): Promise<void> {
    if (value === null) await this.db.run(`DELETE FROM "_meta" WHERE key = ?`, [key]);
    else await this.db.run(`INSERT INTO "_meta" (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [key, value]);
  }

  transaction<T>(fn: (tx: Sql) => Promise<T>) {
    return this.db.transaction(fn);
  }

  close() {
    return this.db.close();
  }
}
