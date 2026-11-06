// Writes explainer-video storyboards with real models, through the same code
// the app uses (writeVideo: the guide, the request, the repair step), and
// keeps everything for render.ts and the report.
//
//   bun --conditions=react-server video-lab/generate.ts <run> <model,model> [slug,slug]
//
// Models are reached as an OpenAI-compatible server: a local Ollama by
// default (LAB_BASE_URL, LAB_KEY to point elsewhere, e.g. Groq or OpenRouter).

import { mkdirSync, writeFileSync } from "node:fs";
import type { Connection } from "@confu/ai/connection";
import { writeVideo } from "@confu/client/video";
import { bunDriver } from "@confu/storage/drivers/bun";
import { Store } from "@confu/storage/store";
import { FIXTURES } from "./fixtures";

const [run = "run", modelArg = "lab-qwen2.5-coder-7b", slugArg] = process.argv.slice(2);
const baseUrl = process.env.LAB_BASE_URL ?? "http://localhost:11434/v1";
const key = process.env.LAB_KEY ?? "";
const provider = (process.env.LAB_PROVIDER ?? "custom") as Connection["provider"];
const minutes = Number(process.env.LAB_MINUTES ?? 2);
const models = modelArg.split(",");
const fixtures = slugArg ? FIXTURES.filter((f) => slugArg.split(",").includes(f.slug)) : FIXTURES;
const out = `${process.env.LAB_OUT ?? "/tmp/video-lab"}/${run}`;

const store = await Store.open(bunDriver(), { device: "lab" });

for (const model of models) {
  mkdirSync(`${out}/${model}`, { recursive: true });
  for (const f of fixtures) {
    const conn: Connection = { id: "lab", provider, key, baseUrl, models: { chat: model, fast: model, vision: model }, via: "key" };
    const t0 = Date.now();
    let result: Record<string, unknown>;
    try {
      const r = await writeVideo(store, conn, { sessionId: "lab", title: f.title, minutes, pages: f.pages });
      result = { ok: Boolean(r.script), ...r };
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e), issues: [], script: null, raw: "" };
    }
    const ms = Date.now() - t0;
    writeFileSync(`${out}/${model}/${f.slug}.json`, JSON.stringify({ model, slug: f.slug, title: f.title, ms, ...result }, null, 2));
    const issues = (result.issues as string[]) ?? [];
    const scenes = (result.script as { scenes?: unknown[] } | null)?.scenes?.length ?? 0;
    console.log(`${model.padEnd(26)} ${f.slug.padEnd(18)} ${result.ok ? "ok  " : "FAIL"} ${String(scenes).padStart(2)} scenes ${String(issues.length).padStart(3)} fixes ${(ms / 1000).toFixed(0).padStart(4)}s ${result.error ?? ""}`);
  }
}
