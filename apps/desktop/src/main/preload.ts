import { contextBridge, ipcRenderer } from "electron";
import type { UpdateState } from "./updates";

// The little the window can ask of the desktop shell. No Node, no files:
// version info, Google sign-in for Drive sync, requests to Google's APIs,
// downloading an open paper, and updating the app.

export type DesktopBridge = typeof bridge;

const bridge = {
  info: () => ipcRenderer.invoke("confu:info") as Promise<{ version: string; platform: string; google: boolean; googleApiKey: string | null; site: string }>,
  googleToken: (opts: { fresh?: boolean; interactive?: boolean }) => ipcRenderer.invoke("confu:google-token", opts) as Promise<{ token?: string; error?: string }>,
  googleForget: () => ipcRenderer.invoke("confu:google-forget") as Promise<void>,
  googleFetch: (req: { url: string; method?: string; headers?: Record<string, string>; body?: ArrayBuffer | null }) =>
    ipcRenderer.invoke("confu:google-fetch", req) as Promise<{ status: number; headers: Record<string, string>; body: ArrayBuffer }>,
  fetchPdf: (url: string) => ipcRenderer.invoke("confu:fetch-pdf", url) as Promise<ArrayBuffer>,
  updates: {
    state: () => ipcRenderer.invoke("confu:update-state") as Promise<UpdateState>,
    check: () => ipcRenderer.invoke("confu:update-check") as Promise<void>,
    install: () => ipcRenderer.invoke("confu:update-install") as Promise<void>,
    later: () => ipcRenderer.invoke("confu:update-later") as Promise<void>,
    onChange(listener: (state: UpdateState) => void) {
      const handler = (_e: unknown, state: UpdateState) => listener(state);
      ipcRenderer.on("confu:update", handler);
      return () => void ipcRenderer.removeListener("confu:update", handler);
    },
  },
};

contextBridge.exposeInMainWorld("confu", bridge);
