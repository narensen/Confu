// Just enough of the Google Drive v3 API for the sync's requests, checked
// the way Drive does: a bearer token, folders, multipart and resumable uploads.

type File = { id: string; name: string; mimeType: string; parents: string[]; appProperties: Record<string, string>; data: Uint8Array; modifiedTime: string; createdTime: string; public: boolean };

export function fakeDrive(opts: { token?: string } = {}) {
  const files = new Map<string, File>();
  const sessions = new Map<string, { meta: Partial<File>; id?: string }>();
  let n = 0;
  let clock = Date.parse("2026-02-01T00:00:00Z");
  const stamp = () => new Date((clock += 1000)).toISOString();
  const requests: string[] = [];
  let failNext401 = false;

  function matches(f: File, q: string): boolean {
    // Split on " and ", but not inside appProperties' braces.
    const clauses = q.replace(/\{[^}]*\}/g, (g) => g.replace(/ and /g, " AND ")).split(" and ").map((c) => c.trim().replace(/ AND /g, " and "));
    for (const clause of clauses) {
      let m;
      if (clause === "trashed = false") continue;
      if ((m = /^mimeType = '(.+)'$/.exec(clause))) {
        if (f.mimeType !== m[1]) return false;
      } else if ((m = /^appProperties has \{ key='(.+)' and value='(.+)' \}$/.exec(clause))) {
        if (f.appProperties[m[1]] !== m[2]) return false;
      } else if ((m = /^'(.+)' in parents$/.exec(clause))) {
        if (!f.parents.includes(m[1])) return false;
      } else if ((m = /^name = '(.+)'$/.exec(clause))) {
        if (f.name !== m[1].replace(/\\'/g, "'")) return false;
      } else if ((m = /^modifiedTime > '(.+)'$/.exec(clause))) {
        if (!(f.modifiedTime > m[1])) return false;
      } else throw new Error(`fake drive: unsupported clause ${clause}`);
    }
    return true;
  }

  function parseMultipart(body: Uint8Array, boundary: string): { meta: Record<string, unknown>; data: Uint8Array } {
    const text = new TextDecoder("latin1").decode(body);
    const sep = `--${boundary}`;
    const parts = text.split(sep).slice(1, -1);
    const [metaPart, dataPart] = parts.map((p) => p.slice(p.indexOf("\r\n\r\n") + 4, -2));
    const start = text.indexOf(dataPart, text.indexOf(sep, text.indexOf(sep) + 1));
    return { meta: JSON.parse(metaPart), data: body.slice(start, start + dataPart.length) };
  }

  const out = (f: File) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime });

  function save(meta: Record<string, unknown>, data: Uint8Array, id?: string): File {
    const now = stamp();
    if (id) {
      const f = files.get(id)!;
      Object.assign(f, { data, modifiedTime: now });
      return f;
    }
    const f: File = {
      id: `id${++n}`,
      name: String(meta.name ?? "untitled"),
      mimeType: String(meta.mimeType ?? "application/octet-stream"),
      parents: (meta.parents as string[]) ?? ["root"],
      appProperties: (meta.appProperties as Record<string, string>) ?? {},
      data,
      modifiedTime: now,
      createdTime: now,
      public: false,
    };
    files.set(f.id, f);
    return f;
  }

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      requests.push(`${req.method} ${url.pathname}${url.searchParams.get("uploadType") ? `?uploadType=${url.searchParams.get("uploadType")}` : ""}`);
      // Public reads with an API key.
      const key = url.searchParams.get("key");
      if (key) {
        const f = files.get(url.pathname.split("/").pop()!);
        return f?.public && key === "api-key" ? new Response(new Blob([f.data as Uint8Array<ArrayBuffer>])) : Response.json({ error: { message: "not found" } }, { status: 404 });
      }
      if (url.pathname.startsWith("/session/")) {
        const s = sessions.get(url.pathname.slice(9))!;
        const f = save(s.meta, new Uint8Array(await req.arrayBuffer()), s.id);
        return Response.json(out(f));
      }
      if (failNext401) {
        failNext401 = false;
        return Response.json({ error: { message: "expired" } }, { status: 401 });
      }
      if (req.headers.get("authorization") !== `Bearer ${opts.token ?? "tok"}`) return Response.json({ error: { message: "bad token" } }, { status: 401 });
      const path = url.pathname;
      if (req.method === "GET" && path === "/drive/v3/files") {
        const q = url.searchParams.get("q") ?? "";
        const list = [...files.values()].filter((f) => matches(f, q)).sort((a, b) => (a.modifiedTime < b.modifiedTime ? -1 : 1));
        const size = Number(url.searchParams.get("pageSize") ?? 100);
        const start = Number(url.searchParams.get("pageToken") ?? 0);
        const page = list.slice(start, start + size);
        return Response.json({ files: page.map(out), ...(start + size < list.length ? { nextPageToken: String(start + size) } : {}) });
      }
      if (req.method === "POST" && path === "/drive/v3/files") return Response.json(out(save(await req.json(), new Uint8Array())));
      let m;
      if ((m = /^\/upload\/drive\/v3\/files(?:\/(.+))?$/.exec(path))) {
        const id = m[1];
        if (url.searchParams.get("uploadType") === "multipart") {
          const boundary = /boundary=(.+)$/.exec(req.headers.get("content-type") ?? "")![1];
          const { meta, data } = parseMultipart(new Uint8Array(await req.arrayBuffer()), boundary);
          return Response.json(out(save(meta, data, id)));
        }
        if (url.searchParams.get("uploadType") === "resumable") {
          const sid = crypto.randomUUID();
          sessions.set(sid, { meta: await req.json(), id });
          return new Response(null, { headers: { location: `${url.origin}/session/${sid}` } });
        }
      }
      if ((m = /^\/drive\/v3\/files\/([^/]+)$/.exec(path))) {
        const f = files.get(m[1]);
        if (!f) return Response.json({ error: { message: "File not found" } }, { status: 404 });
        if (req.method === "DELETE") {
          files.delete(f.id);
          return new Response(null, { status: 204 });
        }
        if (url.searchParams.get("alt") === "media") return new Response(new Blob([f.data as Uint8Array<ArrayBuffer>]));
      }
      if ((m = /^\/drive\/v3\/files\/([^/]+)\/permissions$/.exec(path))) {
        files.get(m[1])!.public = true;
        return Response.json({ id: "anyoneWithLink" });
      }
      return Response.json({ error: { message: `fake drive: ${req.method} ${path}` } }, { status: 400 });
    },
  });
  return {
    url: `http://localhost:${server.port}`,
    files,
    requests,
    expireToken: () => (failNext401 = true),
    stop: () => server.stop(true),
  };
}
