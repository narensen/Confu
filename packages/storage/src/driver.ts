// The smallest SQLite surface the store needs, so the same code runs on
// SQLite WASM in a browser worker, Bun's SQLite in tests, and native SQLite
// in the desktop app.

export type SqlValue = string | number | null | Uint8Array;
export type Params = readonly SqlValue[];
export type Row = Record<string, SqlValue>;

// One connection. Calls may be asynchronous (a worker round trip) but are
// answered in order.
export interface RawDriver {
  run(sql: string, params?: Params): Promise<void>;
  all<T = Row>(sql: string, params?: Params): Promise<T[]>;
  close(): Promise<void>;
  // False when storage fell back to memory (no OPFS): nothing survives a reload.
  readonly persistent: boolean;
}

export interface Sql {
  run(sql: string, params?: Params): Promise<void>;
  all<T = Row>(sql: string, params?: Params): Promise<T[]>;
}

// Serialises every call on one connection, so a transaction can't
// interleave with another caller's statements while it awaits.
export class SerialDriver implements Sql {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly raw: RawDriver) {}

  get persistent() {
    return this.raw.persistent;
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.tail.then(job, job);
    this.tail = next.catch(() => {});
    return next;
  }

  run(sql: string, params?: Params) {
    return this.enqueue(() => this.raw.run(sql, params));
  }

  all<T = Row>(sql: string, params?: Params) {
    return this.enqueue(() => this.raw.all<T>(sql, params));
  }

  // Everything in `fn` commits together or not at all. Nested calls inside
  // `fn` must use the `tx` it's given, not this driver (that would wait for
  // the transaction to finish, and never return).
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      await this.raw.run("BEGIN IMMEDIATE");
      try {
        const out = await fn({ run: (s, p) => this.raw.run(s, p), all: (s, p) => this.raw.all(s, p) });
        await this.raw.run("COMMIT");
        return out;
      } catch (err) {
        await this.raw.run("ROLLBACK").catch(() => {});
        throw err;
      }
    });
  }

  close() {
    return this.enqueue(() => this.raw.close());
  }
}
