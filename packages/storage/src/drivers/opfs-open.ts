// How long the worker may spend acquiring the database's file locks.
// Compiling SQLite is not counted: that finishes on its own, and cutting it
// off would open an empty library over a database that was about to load.
export const OPFS_BUDGET_MS = 10_000;

// A reloaded page can start before the old one has let go of the files.
export const OPFS_WAITS = [0, 150, 300, 600, 1200, 2000];

// installOpfsSAHPoolVfs rejects when another tab holds the files, and the
// waits above cover that. It does not reject when the lock call never
// returns. Retrying that call waits on the same pending attempt, so a hang
// has to spend the budget once and then stop.
export class OpfsTimeout extends Error {
  constructor() {
    super("opfs-timeout");
    this.name = "OpfsTimeout";
  }
}

export function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new OpfsTimeout()), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// The pool when the locks were acquired, or null when they won't be (no
// OPFS, another tab, or a lock call that never returned). `attempt` must be
// safe to call again after a rejection. It is not called again after a timeout.
export async function openPersistent<T>(
  attempt: () => Promise<T>,
  opts: {
    budgetMs?: number;
    waits?: number[];
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<T | null> {
  const budget = opts.budgetMs ?? OPFS_BUDGET_MS;
  const waits = opts.waits ?? OPFS_WAITS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const started = now();
  for (const wait of waits) {
    const left = budget - (now() - started);
    if (left <= 0) return null;
    if (wait) await sleep(Math.min(wait, left));
    const slice = budget - (now() - started);
    if (slice <= 0) return null;
    try {
      return await withDeadline(attempt(), slice);
    } catch (e) {
      if (e instanceof OpfsTimeout) return null;
      if (e instanceof Error && /Missing required OPFS APIs/.test(e.message)) return null;
    }
  }
  return null;
}
