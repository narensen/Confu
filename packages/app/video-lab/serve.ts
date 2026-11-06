// Builds the lab's browser page and serves it on localhost: a secure
// context (WebCodecs needs one), with the app's fonts served alongside.
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../../..");
const out = "/tmp/video-lab/harness";
const fontDir = (pkg: string) => {
  const base = join(repo, "node_modules/.bun");
  const hit = readdirSync(base).find((d) => d.startsWith(`@fontsource-variable+${pkg}@`));
  return hit ? join(base, hit, "node_modules/@fontsource-variable", pkg) : null;
};

export async function startHarness(): Promise<{ url: string; stop: () => void }> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "harness.tsx")], outdir: out, target: "browser", define: { "process.env.NODE_ENV": '"production"' } });
  if (!built.success) throw new Error(built.logs.join("\n"));
  const fonts = ["geist", "geist-mono", "newsreader"];
  const html = `<!doctype html><html><head><meta charset="utf-8">${fonts.map((f) => `<link rel="stylesheet" href="/fonts/${f}/index.css">`).join("")}<style>body{margin:0;background:#000}</style></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>`;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname);
      if (path === "/") return new Response(html, { headers: { "content-type": "text/html" } });
      const m = /^\/fonts\/([\w-]+)\/(.+)$/.exec(path);
      if (m && fonts.includes(m[1]) && !m[2].includes("..")) {
        const dir = fontDir(m[1]);
        return dir ? new Response(Bun.file(join(dir, m[2]))) : new Response("", { status: 404 });
      }
      if (!path.includes("..")) return new Response(Bun.file(join(out, path)));
      return new Response("", { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/`, stop: () => server.stop(true) };
}
