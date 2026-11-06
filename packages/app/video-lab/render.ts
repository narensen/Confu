// Draws every storyboard from a run (generate.ts) in headless Chrome, checks
// each finished scene for layout problems, saves a contact sheet per video,
// and writes report.md: which mistakes were made how often, by which model.
//
//   bun video-lab/render.ts <run>

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { timeline } from "@confu/core/video/timing";
import type { VideoScript } from "@confu/core/video/script";

const run = process.argv[2] ?? "run";
const dir = `${process.env.LAB_OUT ?? "/tmp/video-lab"}/${run}`;
const build = "/tmp/video-lab/harness";
const repo = resolve(import.meta.dir, "../../..");
const font = (pkg: string) => {
  const base = join(repo, "node_modules/.bun");
  const hit = readdirSync(base).find((d) => d.startsWith(`@fontsource-variable+${pkg}@`));
  return hit ? `file://${join(base, hit, "node_modules/@fontsource-variable", pkg, "index.css")}` : "";
};

const built = await Bun.build({ entrypoints: [join(import.meta.dir, "harness.tsx")], outdir: build, target: "browser", minify: false, define: { "process.env.NODE_ENV": '"production"' } });
if (!built.success) throw new Error(built.logs.join("\n"));
writeFileSync(
  `${build}/index.html`,
  `<!doctype html><html><head><meta charset="utf-8">${["geist", "geist-mono", "newsreader"].map((p) => `<link rel="stylesheet" href="${font(p)}">`).join("")}<style>body{margin:0;background:#000}</style></head><body><div id="root"></div><script type="module" src="./harness.js"></script></body></html>`,
);

const chrome = process.env.CHROME ?? ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--allow-file-access-from-files"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`file://${build}/index.html`);
await page.waitForSelector("body[data-ready]");
await page.evaluate(() => document.fonts.ready);

type Result = { model: string; slug: string; ok: boolean; ms: number; issues: string[]; script: VideoScript | null; error?: string };
const results: (Result & { layout: string[]; notes: string[]; words: number; seconds: number; templates: string[] })[] = [];

for (const model of readdirSync(dir).filter((d) => statSync(`${dir}/${d}`).isDirectory())) {
  const shots = `${dir}/${model}/shots`;
  mkdirSync(shots, { recursive: true });
  for (const file of readdirSync(`${dir}/${model}`).filter((f) => f.endsWith(".json"))) {
    const r = JSON.parse(readFileSync(`${dir}/${model}/${file}`, "utf8")) as Result;
    const layout: string[] = [];
    const notes: string[] = [];
    const imgs: string[] = [];
    let seconds = 0;
    let words = 0;
    if (r.script) {
      const t = timeline(r.script.scenes);
      seconds = t.total;
      for (const [i, scene] of r.script.scenes.entries()) {
        words += scene.narration.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
        const longest = [...scene.narration].sort((a, b) => b.text.length - a.text.length)[0] ?? null;
        const rep = await page.evaluate((s, tm, c) => window.labRender(s, tm, c), scene as never, t.scenes[i] as never, longest as never);
        layout.push(...rep.issues);
        notes.push(...rep.notes.map((n) => `scene ${i + 1} (${scene.template}): ${n}`));
        const path = `${shots}/${r.slug}-${String(i + 1).padStart(2, "0")}.png`;
        await page.screenshot({ path, clip: { x: 0, y: 0, width: 1280, height: 720 } });
        imgs.push(path);
      }
      // A contact sheet: every scene of the video on one image.
      const sheet = await browser.newPage();
      await sheet.setViewport({ width: 1600, height: 900 });
      const sheetHtml = `${shots}/${r.slug}.sheet.html`;
      writeFileSync(
        sheetHtml,
        `<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:8px;font:13px sans-serif;color:#ccc">${imgs
          .map((p, k) => `<figure style="margin:0"><img src="file://${p}" style="width:100%;display:block"><figcaption>${k + 1}. ${r.script!.scenes[k].template}</figcaption></figure>`)
          .join("")}</body>`,
      );
      await sheet.goto(`file://${sheetHtml}`, { waitUntil: "load" });
      const h = await sheet.evaluate(() => document.body.scrollHeight);
      await sheet.setViewport({ width: 1600, height: h });
      await sheet.screenshot({ path: `${dir}/${model}/${r.slug}.sheet.png` });
      await sheet.close();
    }
    results.push({ ...r, layout, notes, words, seconds, templates: r.script?.scenes.map((s) => s.template) ?? [] });
    console.log(`${model.padEnd(26)} ${r.slug.padEnd(18)} ${r.script ? `${r.script.scenes.length} scenes ${Math.round(seconds)}s` : "no video"}  ${[...new Set(layout)].join(" ")}`);
  }
}
await browser.close();

// The report: mistakes by kind (generation and layout), per model.
const models = [...new Set(results.map((r) => r.model))];
const kinds = new Map<string, Map<string, number>>();
const bump = (kind: string, model: string) => {
  const m = kinds.get(kind) ?? new Map<string, number>();
  m.set(model, (m.get(model) ?? 0) + 1);
  kinds.set(kind, m);
};
for (const r of results) {
  // Count each kind once per video: how many videos had it.
  for (const k of new Set([...(r.issues ?? []).map((i) => i.replace(/:(?:[a-z_]+)$/, (m) => (/^:(alias|unknown)/.test(m) ? "" : m))), ...r.layout])) bump(k, r.model);
  if (!r.script) bump("FAILED", r.model);
}
const rows = [...kinds].sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0));
const md = [
  `# Video lab: ${run}`,
  "",
  `${results.length} videos, ${results.filter((r) => r.script).length} usable. Page errors: ${errors.length ? errors.join("; ") : "none"}.`,
  "",
  `| model | videos | usable | avg scenes | avg seconds | avg words | avg time |`,
  `|---|---|---|---|---|---|---|`,
  ...models.map((m) => {
    const rs = results.filter((r) => r.model === m);
    const ok = rs.filter((r) => r.script);
    const avg = (f: (r: (typeof rs)[number]) => number) => (ok.length ? Math.round(ok.reduce((n, r) => n + f(r), 0) / ok.length) : 0);
    return `| ${m} | ${rs.length} | ${ok.length} | ${avg((r) => r.templates.length)} | ${avg((r) => r.seconds)} | ${avg((r) => r.words)} | ${Math.round(rs.reduce((n, r) => n + r.ms, 0) / rs.length / 1000)}s |`;
  }),
  "",
  "## Mistakes (videos affected)",
  "",
  `| kind | ${models.join(" | ")} | total |`,
  `|---|${models.map(() => "---").join("|")}|---|`,
  ...rows.map(([k, m]) => `| ${k} | ${models.map((x) => m.get(x) ?? 0).join(" | ")} | ${[...m.values()].reduce((x, y) => x + y, 0)} |`),
  "",
  "## Templates used",
  "",
  ...models.map((m) => {
    const c = new Map<string, number>();
    for (const r of results.filter((x) => x.model === m)) for (const t of r.templates) c.set(t, (c.get(t) ?? 0) + 1);
    return `- ${m}: ${[...c].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(", ")}`;
  }),
  "",
  "## Layout notes",
  "",
  ...results.flatMap((r) => r.notes.map((n) => `- ${r.model} / ${r.slug}: ${n}`)),
  "",
  "## Failures",
  "",
  ...results.filter((r) => !r.script).map((r) => `- ${r.model} / ${r.slug}: ${r.error ?? r.issues.join(", ")}`),
].join("\n");
writeFileSync(`${dir}/report.md`, md);
writeFileSync(`${dir}/report.json`, JSON.stringify(results.map(({ script, ...r }) => ({ ...r, scenes: script?.scenes.length ?? 0 })), null, 2));
console.log(`\n${dir}/report.md`);
