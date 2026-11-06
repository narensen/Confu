import { contextBridge, ipcRenderer } from "electron";

// The little the window can ask of the desktop shell. No Node, no files:
// version info, Google sign-in for Drive sync, requests to Google's APIs,
// and downloading an open paper.

export type DesktopBridge = typeof bridge;

const bridge = {
  info: () => ipcRenderer.invoke("confu:info") as Promise<{ version: string; platform: string; google: boolean; googleApiKey: string | null; site: string }>,
  googleToken: (opts: { fresh?: boolean; interactive?: boolean }) => ipcRenderer.invoke("confu:google-token", opts) as Promise<{ token?: string; error?: string }>,
  googleForget: () => ipcRenderer.invoke("confu:google-forget") as Promise<void>,
  googleFetch: (req: { url: string; method?: string; headers?: Record<string, string>; body?: ArrayBuffer | null }) =>
    ipcRenderer.invoke("confu:google-fetch", req) as Promise<{ status: number; headers: Record<string, string>; body: ArrayBuffer }>,
  fetchPdf: (url: string) => ipcRenderer.invoke("confu:fetch-pdf", url) as Promise<ArrayBuffer>,
};

contextBridge.exposeInMainWorld("confu", bridge);
