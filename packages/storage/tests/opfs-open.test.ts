import { describe, expect, test } from "bun:test";
import { openPersistent } from "@confu/storage/drivers/opfs-open";

describe("openPersistent", () => {
  test("returns the pool on the first try", async () => {
    let calls = 0;
    const pool = await openPersistent(async () => {
      calls += 1;
      return "db";
    });
    expect(pool).toBe("db");
    expect(calls).toBe(1);
  });

  test("tries again when a lock rejects, and stops when it opens", async () => {
    let calls = 0;
    const pool = await openPersistent(
      () => {
        calls += 1;
        if (calls < 3) return Promise.reject(new Error("NoModificationAllowedError"));
        return Promise.resolve("db");
      },
      { budgetMs: 1_000, waits: [0, 0, 0], sleep: async () => {} },
    );
    expect(pool).toBe("db");
    expect(calls).toBe(3);
  });

  test("a lock call that never returns is not started a second time", async () => {
    let calls = 0;
    const pool = await openPersistent(() => {
      calls += 1;
      return new Promise(() => {});
    }, { budgetMs: 40, waits: [0, 0, 0], sleep: async () => {} });
    expect(pool).toBeNull();
    expect(calls).toBe(1);
  });

  test("missing OPFS is not retried", async () => {
    let calls = 0;
    const pool = await openPersistent(() => {
      calls += 1;
      return Promise.reject(new Error("Missing required OPFS APIs."));
    }, { waits: [0, 0, 0], sleep: async () => {} });
    expect(pool).toBeNull();
    expect(calls).toBe(1);
  });

  test("waits count against the budget", async () => {
    let calls = 0;
    let t = 0;
    const pool = await openPersistent(
      () => {
        calls += 1;
        return Promise.reject(new Error("locked"));
      },
      {
        budgetMs: 100,
        waits: [0, 80, 80],
        now: () => t,
        sleep: async (ms) => {
          t += ms;
        },
      },
    );
    expect(pool).toBeNull();
    expect(calls).toBe(2);
    expect(t).toBe(100);
  });
});
