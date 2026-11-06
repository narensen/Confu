import { readFileSync } from "node:fs";
import path from "node:path";
import { app, ipcMain, shell, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";

// New versions come from GitHub Releases (see .github/workflows/desktop.yml).
// Windows and Linux download them in the background and install on the next
// restart, or straight away from the "Restart to update" prompt. Unsigned Mac
// builds can't replace themselves, so on a Mac the prompt links to the
// download instead.

export type UpdateState =
  | { state: "idle" }
  | { state: "checking"; manual: boolean }
  | { state: "none"; manual: boolean }
  | { state: "available"; version: string; manual: boolean } // Mac: download it by hand
  | { state: "downloading"; version: string; percent: number; manual: boolean }
  | { state: "ready"; version: string }
  | { state: "error"; message: string; manual: boolean }
  | { state: "dev"; manual: boolean }; // not an installed build: nothing to update

export const RELEASES = "https://github.com/narensen/Confu/releases/latest";
const EVERY = 4 * 60 * 60 * 1000; // look again every 4 hours while open

export function setUpUpdates(window: () => BrowserWindow | null) {
  const { autoUpdater } = electronUpdater;
  const mac = process.platform === "darwin";
  // An AppImage updates itself; a .deb or a copy run from the source can't.
  const canUpdate = app.isPackaged && (process.platform !== "linux" || Boolean(process.env.APPIMAGE) || isDeb());
  let current: UpdateState = canUpdate ? { state: "idle" } : { state: "dev", manual: false };
  let manual = false;
  let readyVersion: string | null = null;

  const send = (next: UpdateState) => {
    current = next;
    window()?.webContents.send("confu:update", next);
  };

  if (canUpdate) {
    // For trying a release before publishing it: serve the release folder
    // (latest*.yml and the installers) and point CONFU_UPDATE_URL at it.
    if (process.env.CONFU_UPDATE_URL) autoUpdater.setFeedURL({ provider: "generic", url: process.env.CONFU_UPDATE_URL });
    autoUpdater.autoDownload = !mac;
    autoUpdater.autoInstallOnAppQuit = !mac;
    autoUpdater.on("checking-for-update", () => send({ state: "checking", manual }));
    autoUpdater.on("update-not-available", () => send({ state: "none", manual }));
    autoUpdater.on("update-available", (info) => send(mac ? { state: "available", version: info.version, manual } : { state: "downloading", version: info.version, percent: 0, manual }));
    autoUpdater.on("download-progress", (p) => {
      if (current.state === "downloading") send({ ...current, percent: Math.round(p.percent) });
    });
    autoUpdater.on("update-downloaded", (info) => {
      readyVersion = info.version;
      send({ state: "ready", version: info.version });
    });
    autoUpdater.on("error", (e) => send({ state: "error", message: e?.message ?? String(e), manual }));
  }

  const check = async (byHand: boolean) => {
    if (!canUpdate) return send({ state: "dev", manual: byHand });
    // Already downloaded: nothing to look for until the restart.
    if (readyVersion) return send({ state: "ready", version: readyVersion });
    if (current.state === "checking" || current.state === "downloading") return;
    manual = byHand;
    await autoUpdater.checkForUpdates().catch(() => {}); // reported through "error"
  };

  ipcMain.handle("confu:update-state", () => current);
  ipcMain.handle("confu:update-check", () => check(true));
  ipcMain.handle("confu:update-install", () => {
    if (mac || !readyVersion) return void shell.openExternal(RELEASES);
    // Quietly (no installer pages on Windows), then open the new version.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });
  ipcMain.handle("confu:update-later", () => {
    // Put away for now. A downloaded one still installs when the app quits.
    if (current.state !== "ready") send({ state: "idle" });
  });

  if (canUpdate) {
    setTimeout(() => void check(false), Number(process.env.CONFU_UPDATE_DELAY ?? 10_000)); // after the window has settled
    setInterval(() => void check(false), EVERY).unref();
  }
  return { check: () => check(true) };
}

// electron-builder's .deb records the package type next to the app.
function isDeb() {
  try {
    return readFileSync(path.join(process.resourcesPath, "package-type"), "utf8").trim() === "deb";
  } catch {
    return false;
  }
}
