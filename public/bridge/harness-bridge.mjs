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
// After the lesson text stops arriving, don't wait out a harness that keeps
// thinking in silence. The chat would sit on "Asking…" for the whole timeout.
const QUIET_MS = 8_000;

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
function teachArgs(id, effort, prompt, promptPath) {
  // None of these are started in plan mode. Plan mode makes the model
  // outline the lesson and ask which part to start, then wait.
  if (id === "claude") {
    return {
      bin: "claude",
      args: [
        "-p",
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
    const head = ["--effort", effort, "--sandbox", "--disable-slash-commands", "--output-format", "text"];
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

function runTeach(id, effort, prompt, res) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "confu-teach-"));
  const promptPath = path.join(dir, "TEACH.md");
  fs.writeFileSync(promptPath, prompt);
  const spec = teachArgs(id, effort, prompt, promptPath);
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
  let quiet = null;
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
  child.stdout.on("data", (chunk) => {
    if (settled || !chunk.length) return;
    sent = true;
    open();
    res.write(chunk);
    if (quiet) clearTimeout(quiet);
    quiet = setTimeout(() => {
      if (!sent || settled) return;
      kill();
      finish(0);
    }, QUIET_MS);
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
    `Confu bridge\nListening on http://127.0.0.1:${PORT}\n\n${rows}\n\nLeave this window open while you study.\n`,
  );
});
