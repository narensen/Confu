import type { FetchLike } from "@confu/ai/fetch-like";
import type { Remote, RemoteFile } from "./remote";

// The sync folder in the student's Google Drive, through the Drive REST API
// with the drive.file scope: Confu sees only the files it created, never the
// rest of their Drive. The folder is found by a tag (appProperties), so
// renaming or moving it in Drive doesn't break anything.

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

// An access token for the signed-in Google account. `fresh` asks for a new
// one (the last was refused). Without `interactive`, a source that would have
// to show Google's sign-in throws SignInNeeded instead (background syncs
// can't open a pop-up; the student clicks Reconnect).
export type TokenSource = (opts?: { fresh?: boolean; interactive?: boolean }) => Promise<string>;

export class SignInNeeded extends Error {
  constructor() {
    super("Reconnect Google Drive to keep syncing.");
  }
}

type Options = {
  folderName?: string;
  fetch?: FetchLike;
  api?: string; // https://www.googleapis.com (tests point it elsewhere)
};

const FOLDER_MIME = "application/vnd.google-apps.folder";
const MULTIPART_MAX = 5 * 1024 * 1024;
const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function driveRemote(token: TokenSource, opts: Options = {}): Remote & { share(id: string): Promise<void>; folderId(): Promise<string> } {
  const api = opts.api ?? "https://www.googleapis.com";
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const folderName = opts.folderName ?? "Confu";
  let folder: Promise<string> | null = null;

  async function call(path: string, init: RequestInit = {}, retry = 0): Promise<Response> {
    const res = await doFetch(`${api}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${await token({ fresh: retry > 0 && retry < 2 })}` } });
    if (res.status === 401 && retry === 0) return call(path, init, 1);
    if ((res.status === 429 || res.status >= 500 || (res.status === 403 && /rate/i.test(await res.clone().text()))) && retry < 4) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** retry));
      return call(path, init, retry + 2);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = `Google Drive answered ${res.status}`;
      try {
        message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
      } catch {}
      throw new DriveError(message, res.status);
    }
    return res;
  }

  async function findFolder(): Promise<string> {
    const query = `mimeType = '${FOLDER_MIME}' and trashed = false and appProperties has { key='confu' and value='root' }`;
    const res = await call(`/drive/v3/files?${new URLSearchParams({ q: query, fields: "files(id)", orderBy: "createdTime", pageSize: "10" })}`);
    const found = ((await res.json()) as { files: { id: string }[] }).files[0];
    if (found) return found.id;
    const made = await call(`/drive/v3/files?fields=id`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: folderName, mimeType: FOLDER_MIME, appProperties: { confu: "root" } }),
    });
    return ((await made.json()) as { id: string }).id;
  }

  const folderId = () =>
    (folder ??= findFolder().catch((e) => {
      folder = null;
      throw e;
    }));

  async function list(prefix: string, since?: string): Promise<RemoteFile[]> {
    const parent = await folderId();
    const out: RemoteFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `${q(parent)} in parents and trashed = false${since ? ` and modifiedTime > ${q(since)}` : ""}`,
        fields: "nextPageToken, files(id, name, modifiedTime)",
        orderBy: "modifiedTime",
        pageSize: "1000",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const body = (await (await call(`/drive/v3/files?${params}`)).json()) as { nextPageToken?: string; files: { id: string; name: string; modifiedTime: string }[] };
      for (const f of body.files) if (f.name.startsWith(prefix)) out.push({ id: f.id, name: f.name, modified: f.modifiedTime });
      pageToken = body.nextPageToken;
    } while (pageToken);
    return out;
  }

  async function existing(name: string): Promise<string | null> {
    const parent = await folderId();
    const params = new URLSearchParams({ q: `${q(parent)} in parents and trashed = false and name = ${q(name)}`, fields: "files(id)", pageSize: "1" });
    return ((await (await call(`/drive/v3/files?${params}`)).json()) as { files: { id: string }[] }).files[0]?.id ?? null;
  }

  async function write(name: string, data: Blob): Promise<RemoteFile> {
    const id = await existing(name);
    const type = data.type || "application/octet-stream";
    const meta = id ? {} : { name, parents: [await folderId()] };
    const target = `/upload/drive/v3/files${id ? `/${id}` : ""}`;
    const method = id ? "PATCH" : "POST";
    const fields = "id,name,modifiedTime";
    let res: Response;
    if (data.size <= MULTIPART_MAX) {
      const boundary = `confu${crypto.randomUUID().replace(/-/g, "")}`;
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`,
        data,
        `\r\n--${boundary}--`,
      ]);
      res = await call(`${target}?uploadType=multipart&fields=${fields}`, { method, headers: { "content-type": `multipart/related; boundary=${boundary}` }, body });
    } else {
      // Bigger files go in a resumable upload: open a session, then send the bytes.
      const start = await call(`${target}?uploadType=resumable&fields=${fields}`, {
        method,
        headers: { "content-type": "application/json; charset=UTF-8", "x-upload-content-type": type, "x-upload-content-length": String(data.size) },
        body: JSON.stringify(meta),
      });
      const location = start.headers.get("location");
      if (!location) throw new DriveError("Google Drive didn't start the upload.", 0);
      const put = await doFetch(location, { method: "PUT", headers: { "content-type": type }, body: data });
      if (!put.ok) throw new DriveError(`Google Drive answered ${put.status}`, put.status);
      res = put;
    }
    const f = (await res.json()) as { id: string; name: string; modifiedTime: string };
    return { id: f.id, name: f.name, modified: f.modifiedTime };
  }

  return {
    list,
    write,
    folderId,
    async read(id) {
      return (await call(`/drive/v3/files/${encodeURIComponent(id)}?alt=media`)).blob();
    },
    async remove(id) {
      await call(`/drive/v3/files/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    // Anyone with the link can read the file (a shared session).
    async share(id) {
      await call(`/drive/v3/files/${encodeURIComponent(id)}/permissions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "anyone", role: "reader" }),
      });
    },
  };
}

// A file someone shared with "anyone with the link", read with an API key
// (no sign-in needed to open a shared session).
export async function readPublicDriveFile(fileId: string, apiKey: string, fetcher: FetchLike = fetch, api = "https://www.googleapis.com"): Promise<Blob> {
  const res = await fetcher(`${api}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) throw new DriveError(res.status === 404 ? "That shared session isn't there any more, or isn't shared with everyone." : `Google Drive answered ${res.status}`, res.status);
  return res.blob();
}
