// Where the sync keeps its files: a flat folder of named files. Google
// Drive in the app (drive.ts); memory in tests. Names are short and
// dot-separated, e.g. "changes.dev-a1b2.000012.json" or "blob.docs.<id>.pdf".

export type RemoteFile = { id: string; name: string; modified: string };

export interface Remote {
  // Every file whose name starts with `prefix`, changed after `since` (ISO)
  // when given.
  list(prefix: string, since?: string): Promise<RemoteFile[]>;
  read(id: string): Promise<Blob>;
  // Creates the file, or replaces the one with this name.
  write(name: string, data: Blob): Promise<RemoteFile>;
  remove(id: string): Promise<void>;
}

export function memoryRemote(): Remote & { files: Map<string, { name: string; data: Blob; modified: string }> } {
  const files = new Map<string, { name: string; data: Blob; modified: string }>();
  let n = 0;
  let clock = Date.parse("2026-01-01T00:00:00Z");
  const stamp = () => new Date((clock += 1000)).toISOString();
  return {
    files,
    async list(prefix, since) {
      return [...files.entries()]
        .filter(([, f]) => f.name.startsWith(prefix) && (!since || f.modified > since))
        .map(([id, f]) => ({ id, name: f.name, modified: f.modified }));
    },
    async read(id) {
      const f = files.get(id);
      if (!f) throw new Error(`No such file: ${id}`);
      return f.data;
    },
    async write(name, data) {
      const existing = [...files.entries()].find(([, f]) => f.name === name);
      const id = existing?.[0] ?? `f${++n}`;
      const modified = stamp();
      files.set(id, { name, data, modified });
      return { id, name, modified };
    },
    async remove(id) {
      files.delete(id);
    },
  };
}
