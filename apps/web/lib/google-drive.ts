"use client";

import { DRIVE_SCOPE, SignInNeeded, type TokenSource } from "@confu/client/sync/drive";

// Google sign-in for Drive sync, in the page (Google Identity Services'
// token flow): no server and no refresh token. A token lasts an hour and is
// kept for this tab only; after that, a background sync asks the student to
// reconnect with one click.

type TokenResponse = { access_token?: string; expires_in?: number | string; error?: string; error_description?: string };
type TokenClient = { requestAccessToken: (o?: { prompt?: string }) => void };
type Gis = {
  accounts: {
    oauth2: {
      initTokenClient: (c: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type?: string; message?: string }) => void }) => TokenClient;
      revoke: (token: string, done?: () => void) => void;
    };
  };
};

const KEEP = "confu.drive.token";
let script: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if ((window as { google?: Gis }).google?.accounts?.oauth2) return Promise.resolve();
  script ??= new Promise<void>((resolve, reject) => {
    const s = Object.assign(document.createElement("script"), { src: "https://accounts.google.com/gsi/client", async: true });
    s.onload = () => resolve();
    s.onerror = () => {
      script = null;
      reject(new Error("Couldn't load Google sign-in. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return script;
}

type Kept = { value: string; expires: number };

function kept(): Kept | null {
  try {
    const k = JSON.parse(sessionStorage.getItem(KEEP) ?? "null") as Kept | null;
    return k && k.expires > Date.now() + 60_000 ? k : null;
  } catch {
    return null;
  }
}

export function googleDriveToken(clientId: string): TokenSource & { forget: () => void } {
  let granted = false;
  const source = async ({ fresh = false, interactive = false }: { fresh?: boolean; interactive?: boolean } = {}) => {
    const k = fresh ? null : kept();
    if (k) return k.value;
    if (!interactive) throw new SignInNeeded();
    await loadGis();
    const gis = (window as unknown as { google: Gis }).google;
    return new Promise<string>((resolve, reject) => {
      const client = gis.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: (r) => {
          if (r.error || !r.access_token) return reject(new Error(r.error_description || "Google didn't give access to Drive."));
          granted = true;
          sessionStorage.setItem(KEEP, JSON.stringify({ value: r.access_token, expires: Date.now() + Number(r.expires_in ?? 3600) * 1000 }));
          resolve(r.access_token);
        },
        error_callback: (e) => reject(new Error(e.type === "popup_closed" ? "Google sign-in was closed." : (e.message ?? "Google sign-in didn't finish."))),
      });
      client.requestAccessToken({ prompt: granted ? "" : undefined });
    });
  };
  return Object.assign(source, {
    forget() {
      const k = kept();
      sessionStorage.removeItem(KEEP);
      if (k) (window as { google?: Gis }).google?.accounts.oauth2.revoke(k.value);
    },
  });
}
