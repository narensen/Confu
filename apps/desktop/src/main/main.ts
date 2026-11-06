import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, net, protocol, session, shell } from "electron";
import electronUpdater from "electron-updater";
import { googleAuth } from "./google";

// Confu for Mac, Windows and Linux. The window shows the on-device app
// (packages/app), served from the private confu:// scheme: a secure origin
// of its own, so the browser storage it needs (OPFS, IndexedDB) works and
// nothing is shared with websites. Links out open in the student's browser.

declare const CONFU_CONFIG: { googleClientId: string; googleClientSecret: string; googleApiKey: string; site: string };

const SCHEME = "confu";
const ORIGIN = `${SCHEME}://app`;
const RENDERER = path.join(__dirname, "..", "renderer");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true } }]);

// One window, one copy of the database.
if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
const google = CONFU_CONFIG.googleClientId ? googleAuth({ clientId: CONFU_CONFIG.googleClientId, clientSecret: CONFU_CONFIG.googleClientSecret }) : null;

async function serve(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.normalize(path.join(RENDERER, rel));
  if (!file.startsWith(RENDERER + path.sep)) return new Response("Not found", { status: 404 });
  const target = (await stat(file).catch(() => null))?.isFile() ? file : path.join(RENDERER, "index.html");
  const body = await readFile(target);
  return new Response(body, { headers: { "content-type": MIME[path.extname(target)] ?? "application/octet-stream", "cache-control": "no-cache" } });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 380,
    minHeight: 520,
    title: "Confu",
    backgroundColor: "#f5f5f1",
    show: !process.env.CONFU_HIDDEN,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  // Links to websites open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(ORIGIN)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  void win.loadURL(`${ORIGIN}/index.html`);
  win.on("closed", () => (win = null));
}

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  protocol.handle(SCHEME, serve);

  // Recording a lecture from the computer's own sound: getDisplayMedia gets
  // the screen's audio (Windows, macOS 13+), without a picker.
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    const [screen] = await desktopCapturer.getSources({ types: ["screen"] });
    callback(screen ? { video: screen, audio: "loopback" } : {});
  });

  ipcMain.handle("confu:info", () => ({ version: app.getVersion(), platform: process.platform, google: Boolean(google), googleApiKey: CONFU_CONFIG.googleApiKey || null, site: CONFU_CONFIG.site }));
  ipcMain.handle("confu:google-token", async (_e, opts: { fresh?: boolean; interactive?: boolean }) => {
    if (!google) return { error: "Google Drive isn't set up in this build." };
    try {
      return { token: await google.token(opts ?? {}) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle("confu:google-forget", () => google?.forget());
  // Google's APIs, reached from here (no CORS questions for a custom scheme).
  ipcMain.handle("confu:google-fetch", async (_e, req: { url: string; method?: string; headers?: Record<string, string>; body?: ArrayBuffer | null }) => {
    const url = new URL(req.url);
    if (!/(^|\.)googleapis\.com$/.test(url.hostname) || url.protocol !== "https:") return { status: 400, headers: {}, body: new TextEncoder().encode("Only Google APIs").buffer };
    const res = await net.fetch(url.toString(), { method: req.method ?? "GET", headers: req.headers, body: req.body ? Buffer.from(req.body) : undefined });
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: await res.arrayBuffer() };
  });

  // An open paper from another site (a course's sources). https only, PDFs
  // only, at most 80 MB.
  ipcMain.handle("confu:fetch-pdf", async (_e, raw: string) => {
    const url = new URL(raw);
    if (url.protocol !== "https:") throw new Error("Only https links.");
    const res = await net.fetch(url.toString(), { redirect: "follow" });
    if (!res.ok) throw new Error(`The site answered ${res.status}.`);
    if (Number(res.headers.get("content-length") ?? 0) > 80 * 1024 * 1024) throw new Error("That PDF is over 80 MB.");
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > 80 * 1024 * 1024) throw new Error("That PDF is over 80 MB.");
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("That link isn't a PDF.");
    return bytes;
  });

  createWindow();
  if (app.isPackaged) checkForUpdates();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (!win) createWindow();
});

// Updates come from GitHub Releases. Windows and Linux update themselves;
// unsigned Mac builds can't, so they say a new version is out and link to it.
function checkForUpdates() {
  const { autoUpdater } = electronUpdater;
  const mac = process.platform === "darwin";
  autoUpdater.autoDownload = !mac;
  autoUpdater.on("update-available", async (info) => {
    if (!mac) return;
    const { response } = await dialog.showMessageBox({ type: "info", message: `Confu ${info.version} is out.`, detail: "Download it from GitHub and replace this copy.", buttons: ["Download", "Later"] });
    if (response === 0) void shell.openExternal("https://github.com/narensen/Confu/releases/latest");
  });
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}
