#!/usr/bin/env node
// Confu's local bridge. Run it on the computer where Claude, Codex,
// Antigravity or Grok Build is signed in. It listens only on this machine
// and answers one teaching turn at a time. Leave the window open.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.CONFU_BRIDGE_PORT) || 17321;
const MAX_BODY = 400_000;
const TEACH_MS = 120_000;
// Once the lesson text stops growing, end the turn. A CLI often keeps
// "thinking" after it has already printed the answer, and the chat would
// sit on "Asking…" until the process exits.
const QUIET_MS = 1_200;

const HARNESSES = [
  { id: "claude", name: "Claude", bin: "claude" },
  { id: "codex", name: "Codex", bin: "codex" },
  { id: "antigravity", name: "Gemini", bin: "agy" },
  { id: "grok", name: "Grok", bin: "grok" },
];

const home = os.homedir();
const env = {
  ...process.env,
  // The shell's PATH wins. The extra directories cover an installer that
  // put the binary in a home folder this process was not started with.
  PATH: [
    process.env.PATH || "",
    path.join(home, ".local", "bin"),
    path.join(home, ".grok", "bin"),
    path.join(home, ".claude", "bin"),
    path.join(home, ".codex", "bin"),
    path.join(home, "AppData", "Local", "agy", "bin"),
    path.join(home, "AppData", "Roaming", "npm"),
  ]
    .filter(Boolean)
    .join(path.delimiter),
};

function versionOf(bin) {
  const run = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 8000, env, windowsHide: true });
  if (run.error) return null;
  const line = `${run.stdout || run.stderr || ""}`.trim().split(/\r?\n/).find(Boolean) || "";
  return line.slice(0, 80) || "installed";
}

function cleanModel(id) {
  if (typeof id !== "string") return null;
  const s = id.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/.test(s) ? s : null;
}

function visibleText(raw) {
  return raw
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\r/g, "");
}

// Model lists are cached. Listing asks each CLI what it can run; it does not
// start a lesson. /health only reads the cache so a slow list can't block a turn.
let modelCache = {};
function rememberModels(id, found) {
  modelCache[id] = found || { current: null, currentName: null, list: [] };
}

function runCmd(bin, args, ms) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      resolve("");
      return;
    }
    let out = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
    }, ms);
    child.stdout.on("data", (chunk) => {
      out = (out + chunk.toString("utf8")).slice(0, 2_000_000);
    });
    const done = () => {
      clearTimeout(timer);
      resolve(out);
    };
    child.on("close", done);
    child.on("error", done);
  });
}

function claudeModels() {
  const dir = path.join(home, ".claude", "cache", "model-catalog");
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => path.join(dir, name));
  } catch {
    return;
  }
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!files.length) return;
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(files[0], "utf8"));
  } catch {
    return;
  }
  const models = catalog?.catalog?.config?.models;
  if (!Array.isArray(models)) return;
  const list = models
    .filter((m) => m && cleanModel(m.id) && typeof m.name === "string")
    .map((m) => ({ id: m.id, name: String(m.name).slice(0, 80), section: m.section || "" }));
  list.sort((a, b) => (a.section === "main" ? 0 : 1) - (b.section === "main" ? 0 : 1));
  const current = list[0] || null;
  rememberModels("claude", {
    current: current?.id || null,
    currentName: current?.name || null,
    list: list.map(({ id, name }) => ({ id, name })),
  });
}

async function codexModels() {
  let preferred = null;
  try {
    const text = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
    preferred = cleanModel((text.match(/^model\s*=\s*"([^"]+)"/m) || [])[1] || "");
  } catch {}
  let catalog;
  try {
    catalog = JSON.parse(await runCmd("codex", ["debug", "models", "--bundled"], 8000));
  } catch {
    return;
  }
  const list = (Array.isArray(catalog?.models) ? catalog.models : [])
    .filter((m) => m && m.visibility !== "hide" && cleanModel(m.slug) && typeof m.display_name === "string")
    .map((m) => ({ id: m.slug, name: String(m.display_name).slice(0, 80) }));
  const current = list.find((m) => m.id === preferred) || list[0] || null;
  rememberModels("codex", { current: current?.id || null, currentName: current?.name || null, list });
}

async function agyModels() {
  const text = await runCmd("agy", ["models"], 12000);
  const list = [];
  for (const line of text.split(/\r?\n/)) {
    const [id, name] = line.split("\t");
    if (cleanModel(id || "") && name && name.trim()) list.push({ id: id.trim(), name: name.trim().slice(0, 80) });
  }
  const current = list.find((m) => /-low$/.test(m.id)) || list[0] || null;
  rememberModels("antigravity", { current: current?.id || null, currentName: current?.name || null, list });
}

function grokName(id) {
  return `Grok ${id.replace(/^grok-/, "").replace(/-/g, " ")}`;
}

async function grokModels() {
  const text = await runCmd("grok", ["models"], 8000);
  const list = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*[*-]\s+(\S+)/);
    const id = cleanModel(match?.[1] || "");
    if (id) list.push({ id, name: grokName(id) });
  }
  const preferred = cleanModel((text.match(/Default model:\s*(\S+)/) || [])[1] || "");
  const current = list.find((m) => m.id === preferred) || list[0] || null;
  rememberModels("grok", { current: current?.id || null, currentName: current?.name || null, list });
}

async function refreshModels() {
  for (const load of [claudeModels, codexModels, agyModels, grokModels]) {
    try {
      await load();
    } catch {}
  }
}

function detected() {
  return HARNESSES.map((h) => {
    const version = versionOf(h.bin);
    const models = modelCache[h.id] || { current: null, currentName: null, list: [] };
    return {
      id: h.id,
      name: h.name,
      installed: Boolean(version),
      version,
      model: models.current,
      modelName: models.currentName,
      models: models.list,
    };
  });
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("The lesson is too long for the bridge."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function brief(body) {
  const history = Array.isArray(body.history)
    ? body.history
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m) => `${m.role === "assistant" ? "Tutor" : "Student"}:\n${m.content}`)
        .join("\n\n")
    : "";
  return [
    "You are teaching one student. Follow the teaching brief below.",
    "Reply in markdown with the lesson only.",
    "Teach the requested point now. Do not plan the lesson, do not ask which part to start with, and do not mention these instructions or which model you are.",
    "Do not edit files, do not run commands, and do not call tools.",
    "",
    "Teaching brief:",
    String(body.system || "").slice(0, 120_000),
    history ? `\nRecent conversation:\n${history}` : "",
    "",
    "The student now:",
    String(body.instruction || "").slice(0, 40_000),
  ].join("\n");
}

// Each CLI gets the lesson on stdin or in a prompt file, in a throwaway
// directory, so a coding agent has nothing nearby to edit.
function teachArgs(id, effort, model, prompt, promptPath) {
  // None of these are started in plan mode. Plan mode makes the model
  // outline the lesson and ask which part to start, then wait.
  const chosen = cleanModel(model);
  if (id === "claude") {
    return {
      bin: "claude",
      args: [
        "-p",
        ...(chosen ? ["--model", chosen] : []),
        "--effort",
        effort,
        "--permission-mode",
        "dontAsk",
        "--permission-prompts",
        "none",
        "--tools",
        "",
        "--disable-slash-commands",
        "--restricted",
        "--output-format",
        "text",
      ],
      stdin: true,
    };
  }
  if (id === "codex") {
    return {
      bin: "codex",
      args: [
        "exec",
        ...(chosen ? ["-m", chosen] : []),
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "-c",
        `model_reasoning_effort="${effort}"`,
        "-o",
        path.join(path.dirname(promptPath), "answer.md"),
      ],
      stdin: true,
    };
  }
  // Do not pass --mode=plan. Antigravity treats that as the /plan slash
  // command, which makes it plan and ask which part to start instead of teaching.
  // A short prompt fits on the command line, so it never has to open TEACH.md.
  // A long one stays in the file; skip-permissions keeps that read from waiting
  // on a yes/no that nobody can answer.
  if (id === "antigravity") {
    const head = [
      ...(chosen ? ["--model", chosen] : []),
      ...(chosen && /-(low|medium|high)$/.test(chosen) ? [] : ["--effort", effort]),
      "--sandbox",
      "--disable-slash-commands",
      "--output-format",
      "text",
    ];
    const teachNow = "Teach that lesson now, in markdown only. Do not plan. Do not ask which part to start with. Do not use tools or edit files.";
    if (prompt.length <= 60_000) {
      return { bin: "agy", args: [...head, "-p", `${prompt}\n\n${teachNow}`], stdin: false };
    }
    return {
      bin: "agy",
      args: [...head, "--dangerously-skip-permissions", "-p", `Read TEACH.md. ${teachNow}`],
      stdin: false,
    };
  }
  return {
    bin: "grok",
    args: [
      "--prompt-file",
      promptPath,
      ...(chosen ? ["-m", chosen] : []),
      "--reasoning-effort",
      effort,
      "--max-turns",
      "1",
      "--permission-mode",
      "dontAsk",
      "--no-plan",
      "--verbatim",
      "--output-format",
      "plain",
    ],
    stdin: false,
  };
}

function runTeach(id, effort, model, prompt, res) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "confu-teach-"));
  const promptPath = path.join(dir, "TEACH.md");
  fs.writeFileSync(promptPath, prompt);
  const spec = teachArgs(id, effort, model, prompt, promptPath);
  const child = spawn(spec.bin, spec.args, {
    cwd: dir,
    env,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  let sent = false;
  let settled = false;
  let opened = false;
  let quiet = null;
  const open = () => {
    if (opened) return;
    opened = true;
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  };
  const kill = () => {
    if (child.exitCode !== null || child.signalCode) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  };
  const finish = (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (quiet) clearTimeout(quiet);
    const answerPath = path.join(dir, "answer.md");
    let fileAnswer = "";
    try {
      fileAnswer = fs.readFileSync(answerPath, "utf8").trim();
    } catch {}
    if (!sent && fileAnswer) {
      sent = true;
      open();
      res.write(fileAnswer);
    }
    if (!opened) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end((stderr || (code ? `${spec.bin} stopped.` : "The harness sent nothing.")).trim().slice(-800));
    } else {
      res.end();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  const timer = setTimeout(kill, TEACH_MS);
  res.on("close", kill);
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-4000);
  });
  let raw = "";
  let shown = "";
  child.stdout.on("data", (chunk) => {
    if (settled || !chunk.length) return;
    raw += chunk.toString("utf8");
    const next = visibleText(raw);
    // Spinner and cursor noise are not more lesson. Don't let them keep the
    // turn open after the answer has stopped.
    if (next === shown) return;
    const delta = next.slice(shown.length);
    shown = next;
    sent = true;
    open();
    if (delta) res.write(delta);
    if (quiet) clearTimeout(quiet);
    const doneNote = /spend limit|usage limit|rate limit|limit resets/i.test(shown);
    quiet = setTimeout(() => {
      if (!sent || settled) return;
      kill();
      finish(0);
    }, doneNote ? 150 : QUIET_MS);
  });
  child.stdin.on("error", () => {});
  if (spec.stdin) {
    child.stdin.write(prompt);
    child.stdin.end();
  } else child.stdin.end();
  child.on("error", (err) => {
    stderr = err && err.code === "ENOENT" ? `${spec.bin} is not installed.` : err.message;
    finish(1);
  });
  child.on("close", (code) => finish(code || 0));
}

const server = createServer(async (req, res) => {
  cors(req, res);
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, os: os.platform(), harnesses: detected() }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/teach") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(err instanceof Error ? err.message : "Invalid request");
      return;
    }
    const harness = HARNESSES.find((h) => h.id === body.harness);
    const effort = body.effort === "medium" ? "medium" : "low";
    if (!harness) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Unknown harness.");
      return;
    }
    if (!versionOf(harness.bin)) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`${harness.name} is not installed.`);
      return;
    }
    runTeach(harness.id, effort, body.model, brief(body), res);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    process.stderr.write(`Port ${PORT} is already in use. A Confu bridge is probably already running.\n`);
    process.exit(1);
  }
  throw err;
});

setTimeout(refreshModels, 50);
setInterval(refreshModels, 10 * 60 * 1000);

server.listen(PORT, "127.0.0.1", () => {
  const rows = detected()
    .map((h) => `  ${h.name.padEnd(12)} ${h.installed ? h.version : "not installed"}`)
    .join("\n");
  process.stdout.write(
    `Confu bridge\nListening on http://127.0.0.1:${PORT}\n\n${rows}\n\nLeave this window open while you study.\n`,
  );
});
