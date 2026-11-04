// The device's file store: PDFs and other originals, by path ("docs/<id>.pdf").
// The database keeps the path; the bytes live here.
//
// In the browser: the origin-private file system (OPFS) where it can be
// written from the page, else IndexedDB (older Safari, which is also the
// iPhone app). Both count against the same per-site storage, and neither is
// visible to other sites. memoryFiles() is for tests and for a browser that
// allows neither.

export interface FileStore {
  readonly kind: "opfs" | "indexeddb" | "memory";
  put(path: string, data: Blob): Promise<void>;
  get(path: string): Promise<Blob | null>;
  remove(path: string): Promise<void>;
}

function parts(path: string): string[] {
  const segs = path.split("/").filter(Boolean);
  if (!segs.length || segs.some((s) => s === "." || s === "..")) throw new Error(`Bad file path: ${path}`);
  return segs;
}

export function memoryFiles(): FileStore {
  const files = new Map<string, Blob>();
  return {
    kind: "memory",
    async put(path, data) {
      files.set(parts(path).join("/"), data);
    },
    async get(path) {
      return files.get(parts(path).join("/")) ?? null;
    },
    async remove(path) {
      files.delete(parts(path).join("/"));
    },
  };
}

const isNotFound = (e: unknown) => e instanceof DOMException && (e.name === "NotFoundError" || e.name === "TypeMismatchError");

export function opfsFiles(root = "confu-files"): FileStore {
  async function dir(segs: string[], create: boolean) {
    let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(root, { create: true });
    for (const s of segs) d = await d.getDirectoryHandle(s, { create });
    return d;
  }
  return {
    kind: "opfs",
    async put(path, data) {
      const segs = parts(path);
      const handle = await (await dir(segs.slice(0, -1), true)).getFileHandle(segs.at(-1)!, { create: true });
      const out = await handle.createWritable();
      try {
        await out.write(data);
        await out.close();
      } catch (e) {
        await out.abort().catch(() => {});
        throw e;
      }
    },
    async get(path) {
      const segs = parts(path);
      try {
        const handle = await (await dir(segs.slice(0, -1), false)).getFileHandle(segs.at(-1)!);
        return await handle.getFile();
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    async remove(path) {
      const segs = parts(path);
      try {
        await (await dir(segs.slice(0, -1), false)).removeEntry(segs.at(-1)!);
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    },
  };
}

export function indexedDbFiles(dbName = "confu-files"): FileStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () =>
    (db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const store = (await open()).transaction("files", mode).objectStore("files");
    return new Promise((resolve, reject) => {
      const req = fn(store);
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  }
  return {
    kind: "indexeddb",
    async put(path, data) {
      // Stored as bytes: some Safari versions lose Blobs kept in IndexedDB.
      const bytes = await data.arrayBuffer();
      await tx("readwrite", (s) => s.put({ type: data.type, bytes }, parts(path).join("/")));
    },
    async get(path) {
      const row = await tx<{ type: string; bytes: ArrayBuffer } | undefined>("readonly", (s) => s.get(parts(path).join("/")));
      return row ? new Blob([row.bytes], { type: row.type }) : null;
    },
    async remove(path) {
      await tx("readwrite", (s) => s.delete(parts(path).join("/")));
    },
  };
}

// The best store this browser offers. OPFS is used only where the page can
// write to it directly (createWritable); older Safari can't.
export function browserFiles(): FileStore {
  const g = globalThis as { FileSystemFileHandle?: { prototype: object }; navigator?: Navigator; indexedDB?: IDBFactory };
  if (g.navigator?.storage?.getDirectory && g.FileSystemFileHandle && "createWritable" in g.FileSystemFileHandle.prototype) return opfsFiles();
  if (g.indexedDB) return indexedDbFiles();
  return memoryFiles();
}
