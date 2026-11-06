import type { FileStore } from "@confu/storage/files";
import type { Change, Store } from "@confu/storage/store";
import type { Remote, RemoteFile } from "./remote";

// Sync between this device and the student's other devices, through a
// folder they own (their Google Drive).
//
// Changes: each device uploads its change log in files named by the range
// of its own change numbers they cover, "changes.<device>.<first>-<last>.json".
// A retried upload can overlap an earlier one but never leaves a gap, and
// applying a change twice does nothing (the newest edit to a row wins; see
// Store.applyRemote). Other devices read each device's files in order and
// remember how far they got.
//
// Files: PDFs and recordings are uploaded once as "blob.<path>" and fetched
// by any device that has the row but not the file.

const BATCH = 1000;
const LIST_MARGIN_MS = 60 * 60 * 1000; // re-list an hour back: a new file can show up late in a listing
const pad = (n: number) => String(n).padStart(9, "0");

export const changeFileName = (device: string, first: number, last: number) => `changes.${device}.${pad(first)}-${pad(last)}.json`;
export const blobName = (path: string) => `blob.${path.split("/").join(".")}`;

const CHANGE_FILE = /^changes\.(.+)\.(\d{9})-(\d{9})\.json$/;

export function parseChangeFile(name: string): { device: string; first: number; last: number } | null {
  const m = CHANGE_FILE.exec(name);
  return m ? { device: m[1], first: Number(m[2]), last: Number(m[3]) } : null;
}

// Rows that point at a file in the device's file store.
const FILE_TABLES = ["documents", "recordings"] as const;

export type SyncResult = { sent: number; received: number; uploaded: number; downloaded: number };
export type SyncProgress = (label: string) => void;

export async function syncOnce(store: Store, files: FileStore, remote: Remote, onProgress: SyncProgress = () => {}): Promise<SyncResult> {
  const result: SyncResult = { sent: 0, received: 0, uploaded: 0, downloaded: 0 };
  const device = store.device;

  // ---- send this device's changes ----
  for (;;) {
    const batch = await store.pending(BATCH);
    if (!batch.length) break;
    onProgress(`Sending ${batch.length} changes…`);
    const first = batch[0].seq;
    const last = batch.at(-1)!.seq;
    const changes: Change[] = batch.map(({ tbl, key, op, hlc, data }) => ({ tbl, key, op, hlc, data }));
    await remote.write(changeFileName(device, first, last), new Blob([JSON.stringify({ format: "confu-changes", version: 1, device, first, last, changes })], { type: "application/json" }));
    await store.markSynced(last);
    result.sent += batch.length;
  }

  // ---- receive other devices' changes ----
  const since = await store.getMeta("sync.listed");
  const listed = await remote.list("changes.", since ?? undefined);
  const byDevice = new Map<string, { file: RemoteFile; first: number; last: number }[]>();
  for (const file of listed) {
    const p = parseChangeFile(file.name);
    if (!p || p.device === device) continue;
    byDevice.set(p.device, [...(byDevice.get(p.device) ?? []), { file, first: p.first, last: p.last }]);
  }
  let stalled = false;
  for (const [other, list] of byDevice) {
    let cursor = Number((await store.getMeta(`sync.in.${other}`)) ?? 0);
    list.sort((a, b) => a.first - b.first || b.last - a.last);
    for (const f of list) {
      if (f.last <= cursor) continue;
      if (f.first > cursor + 1) {
        stalled = true; // an earlier file isn't visible yet; next time
        break;
      }
      onProgress("Receiving changes…");
      const body = JSON.parse(await (await remote.read(f.file.id)).text()) as { changes?: Change[] };
      result.received += await store.applyRemote(body.changes ?? []);
      cursor = f.last;
      await store.setMeta(`sync.in.${other}`, String(cursor));
    }
  }
  // Next time, list only what changed since (with a margin), unless a
  // device is waiting on a file that hasn't shown up.
  const newest = listed.map((f) => f.modified).sort().at(-1);
  if (newest && !stalled) await store.setMeta("sync.listed", new Date(Date.parse(newest) - LIST_MARGIN_MS).toISOString());

  // ---- files ----
  const blobs = new Map((await remote.list("blob.")).map((f) => [f.name, f]));
  for (const table of FILE_TABLES) {
    const rows = await store.query<{ storage_path: string | null }>(`SELECT storage_path FROM "${table}" WHERE storage_path IS NOT NULL`);
    for (const { storage_path: path } of rows) {
      if (!path) continue;
      const name = blobName(path);
      const local = await files.get(path);
      if (local && !blobs.has(name)) {
        onProgress("Uploading files…");
        blobs.set(name, await remote.write(name, local));
        result.uploaded++;
      } else if (!local && blobs.has(name)) {
        onProgress("Downloading files…");
        await files.put(path, await remote.read(blobs.get(name)!.id));
        result.downloaded++;
      }
    }
  }

  await store.setMeta("sync.at", new Date().toISOString());
  return result;
}
