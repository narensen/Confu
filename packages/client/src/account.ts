import type { FetchLike } from "@confu/ai/fetch-like";
import type { FileStore } from "@confu/storage/files";
import type { Store } from "@confu/storage/store";
import { TABLE } from "@confu/storage/tables";

// A Confu account and this device.
//
// importAccount: takes over what the account had on the server (from
// /api/export/device), keeping the same ids, so running it again updates
// rather than duplicates.
//
// sessionIndex: the little the server keeps about on-device sessions
// (title, number of files, when reviews are next due), for reminder emails
// and the account's dashboard. No content.

export type AccountExport = {
  format: "confu-account";
  version: 1;
  tables: Record<string, Record<string, unknown>[]>;
  files: { path: string; url: string }[];
};

export type ImportResult = { sessions: number; rows: number; files: number; missing: number };

export async function importAccount(
  store: Store,
  files: FileStore,
  data: AccountExport,
  opts: { fetch?: FetchLike; onProgress?: (label: string) => void } = {},
): Promise<ImportResult> {
  if (data.format !== "confu-account" || data.version !== 1) throw new Error("Unexpected answer from the server.");
  const doFetch = opts.fetch ?? fetch;
  const result: ImportResult = { sessions: data.tables.study_sessions?.length ?? 0, rows: 0, files: 0, missing: 0 };
  for (const [table, rows] of Object.entries(data.tables)) {
    const spec = TABLE[table];
    if (!spec?.synced || spec.since || !Array.isArray(rows) || !rows.length) continue;
    const known = new Set(spec.columns.map((c) => c.name));
    opts.onProgress?.(`Copying ${table.replace(/_/g, " ")}…`);
    await store.putMany(
      table,
      rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => known.has(k)))),
    );
    result.rows += rows.length;
  }
  let n = 0;
  for (const f of data.files) {
    opts.onProgress?.(`Downloading files (${++n} of ${data.files.length})…`);
    if (await files.get(f.path)) {
      result.files++;
      continue;
    }
    try {
      const res = await doFetch(f.url);
      if (!res.ok) throw new Error(String(res.status));
      await files.put(f.path, await res.blob());
      result.files++;
    } catch {
      result.missing++;
    }
  }
  return result;
}

export type SessionIndexRow = {
  session_id: string;
  title: string;
  kind: string;
  files: number;
  updated_at: string;
  next_review_at: string | null;
  reviews_due: number; // due within a day of publishing (reminders say "about N")
  device: string;
};

export async function sessionIndex(store: Store, now = Date.now()): Promise<SessionIndexRow[]> {
  return (
    await store.query<Omit<SessionIndexRow, "device">>(
      `SELECT s.id AS session_id, s.title, s.kind, s.updated_at,
         (SELECT count(*) FROM documents d WHERE d.session_id = s.id) AS files,
         (SELECT min(due) FROM (
            SELECT due_at AS due FROM review_items r WHERE r.session_id = s.id AND r.suspended = 0
            UNION ALL SELECT due FROM cards c WHERE c.session_id = s.id AND c.suspended = 0
         )) AS next_review_at,
         (SELECT count(*) FROM (
            SELECT due_at AS due FROM review_items r WHERE r.session_id = s.id AND r.suspended = 0
            UNION ALL SELECT due FROM cards c WHERE c.session_id = s.id AND c.suspended = 0
         ) WHERE due <= ?) AS reviews_due
       FROM study_sessions s WHERE s.archived_at IS NULL`,
      [new Date(now + 86_400_000).toISOString()],
    )
  ).map((r) => ({ ...r, title: r.title.slice(0, 300), device: store.device }));
}
