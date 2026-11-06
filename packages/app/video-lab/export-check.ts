// Exports one storyboard from a run to a real video file, in headless Chrome.
//   bun video-lab/export-check.ts <run>/<model>/<slug>.json [silent]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { startHarness } from "./serve";

const [file, mode] = process.argv.slice(2);
const r = JSON.parse(readFileSync(`/tmp/video-lab/${file}`, "utf8"));
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--allow-file-access-from-files"], protocolTimeout: 1_800_000 });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror", String(e)));
page.on("console", (m) => console.log("page:", m.text()));
const harness = await startHarness();
await page.goto(harness.url);
await page.waitForSelector("body[data-ready]");
const out = await page.evaluate((s, v) => window.labExport(s, v), r.script, mode !== "silent");
const path = `/tmp/video-lab/${file.replace(/\.json$/, "")}.${out.ext}`;
writeFileSync(path, Buffer.from(out.b64, "base64"));
console.log(`${path}  ${(out.size / 1e6).toFixed(2)} MB  in ${(out.ms / 1000).toFixed(1)}s`);
await browser.close();
harness.stop();
