#!/usr/bin/env node
// Confu's local bridge. Run it on the computer where Claude, Codex,
// Antigravity or Grok Build is signed in. It listens only on this machine
// and answers one teaching turn at a time. Leave the window open.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.CONFU_BRIDGE_PORT) || 17321;
const TOKEN = randomBytes(5).toString("hex");
const MAX_BODY = 400_000;
const TEACH_MS = 120_000;

const HARNESSES = [
  { id: "claude", name: "Claude", bin: "claude" },
  { id: "codex", name: "Codex", bin: "codex" },
  { id: "antigravity", name: "Antigravity", bin: "agy" },
  { id: "grok", name: "Grok Build", bin: "grok" },
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

function detected() {
  return HARNESSES.map((h) => {
    const version = versionOf(h.bin);
    return { id: h.id, name: h.name, installed: Boolean(version), version };
  });
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Confu-Bridge");
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
function teachArgs(id, effort, promptPath) {
  if (id === "claude") {
    return {
      bin: "claude",
      args: ["-p", "--effort", effort, "--permission-mode", "plan", "--tools", "", "--restricted", "--output-format", "text"],
      stdin: true,
    };
  }
  if (id === "codex") {
    return {
      bin: "codex",
      args: [
        "exec",
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
  // -p takes the next word as the prompt, so the lesson stays in TEACH.md
  // and this line only tells the agent to read it.
  if (id === "antigravity") {
    return {
      bin: "agy",
      args: [
        "--effort",
        effort,
        "--mode=plan",
        "--output-format",
        "text",
        "-p",
        "Read TEACH.md and teach the student exactly as it asks. Reply in markdown only. Do not create, edit, or delete any file. Do not run commands.",
      ],
      stdin: false,
    };
  }
  return {
    bin: "grok",
    args: ["--prompt-file", promptPath, "--reasoning-effort", effort, "--max-turns", "1", "--permission-mode", "plan", "--output-format", "plain"],
    stdin: false,
  };
}

function runTeach(id, effort, prompt, res) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "confu-teach-"));
  const promptPath = path.join(dir, "TEACH.md");
  fs.writeFileSync(promptPath, prompt);
  const spec = teachArgs(id, effort, promptPath);
  const child = spawn(spec.bin, spec.args, {
    cwd: dir,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  let sent = false;
  let settled = false;
  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  };
  const kill = () => {
    if (!child.killed && child.exitCode === null) child.kill("SIGTERM");
  };
  const finish = (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
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
  child.stdout.on("data", (chunk) => {
    if (settled || !chunk.length) return;
    sent = true;
    open();
    res.write(chunk);
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

function pairPage() {
  const safe = TOKEN.replace(/[^a-z0-9]/gi, "");
  return `<!doctype html>
<meta charset="utf-8">
<title>Confu bridge</title>
<style>
  body { font: 16px/1.45 ui-sans-serif, system-ui, sans-serif; margin: 8vh auto; max-width: 28rem; padding: 0 1.25rem; color: #14120b; }
  code { font-size: 1.6rem; letter-spacing: 0.08em; }
  button { margin-top: 1rem; font: inherit; padding: 0.4rem 0.8rem; }
</style>
<h1>Confu bridge</h1>
<p>The connection code is</p>
<p><code id="code">${safe}</code></p>
<button id="send" type="button">Send this code to Confu</button>
<p id="note"></p>
<script>
  const token = ${JSON.stringify(safe)};
  document.getElementById("send").onclick = () => {
    if (window.opener) window.opener.postMessage({ source: "confu-bridge", token }, "*");
    navigator.clipboard?.writeText(token).catch(() => {});
    document.getElementById("note").textContent = window.opener ? "Sent. You can close this tab." : "Copied. Paste it into Confu.";
  };
</script>`;
}

const server = createServer(async (req, res) => {
  cors(req, res);
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/pair") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(pairPage());
    return;
  }
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, authorized: req.headers["x-confu-bridge"] === TOKEN, os: os.platform(), harnesses: detected() }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/teach") {
    if (req.headers["x-confu-bridge"] !== TOKEN) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "That connection code doesn't match this bridge." }));
      return;
    }
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
    runTeach(harness.id, effort, brief(body), res);
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

server.listen(PORT, "127.0.0.1", () => {
  const rows = detected()
    .map((h) => `  ${h.name.padEnd(12)} ${h.installed ? h.version : "not installed"}`)
    .join("\n");
  process.stdout.write(
    `Confu bridge\nListening on http://127.0.0.1:${PORT}\nConnection code: ${TOKEN}\n\n${rows}\n\nLeave this window open while you study.\n`,
  );
});
