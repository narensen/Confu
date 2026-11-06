import { createHash, randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { app, net, safeStorage, shell } from "electron";

// Google sign-in for Drive sync on the desktop: the installed-app flow. The
// student signs in in their own browser, Google sends them back to a
// one-time address on this computer (127.0.0.1), and the refresh token is
// kept in the system keychain (safeStorage), so sync keeps working without
// signing in again. Scope: drive.file only.

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const SIGN_IN_TIMEOUT = 5 * 60_000;

export const SIGN_IN_NEEDED = "signin-needed";

type Grant = { access_token: string; expires_in: number; refresh_token?: string; error?: string; error_description?: string };

export function googleAuth(cfg: { clientId: string; clientSecret: string }) {
  const file = path.join(app.getPath("userData"), "google-drive.bin");
  let access: { value: string; expires: number } | null = null;
  let memoryRefresh: string | null = null; // when the keychain isn't available

  const readRefresh = (): string | null => {
    if (memoryRefresh) return memoryRefresh;
    try {
      return safeStorage.decryptString(readFileSync(file));
    } catch {
      return null;
    }
  };
  const saveRefresh = (token: string) => {
    if (safeStorage.isEncryptionAvailable()) writeFileSync(file, safeStorage.encryptString(token), { mode: 0o600 });
    else memoryRefresh = token;
  };

  async function exchange(params: Record<string, string>): Promise<string> {
    const res = await net.fetch(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }).toString() });
    const grant = (await res.json()) as Grant;
    if (!res.ok || !grant.access_token) throw new Error(grant.error_description || grant.error || "Google refused the sign-in.");
    access = { value: grant.access_token, expires: Date.now() + grant.expires_in * 1000 };
    if (grant.refresh_token) saveRefresh(grant.refresh_token);
    return grant.access_token;
  }

  function signIn(): Promise<string> {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(16).toString("hex");
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/") return void res.writeHead(404).end();
        const code = url.searchParams.get("code");
        const ok = code && url.searchParams.get("state") === state;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><title>Confu</title><body style="font:16px system-ui;padding:3rem;text-align:center">${ok ? "Google Drive is connected. You can close this tab and go back to Confu." : "Sign-in didn't finish. Go back to Confu and try again."}</body>`);
        server.close();
        clearTimeout(timer);
        if (!ok) return reject(new Error(url.searchParams.get("error") ?? "Google sign-in didn't finish."));
        exchange({ code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirect }).then(resolve, reject);
      });
      let redirect = "";
      const timer = setTimeout(() => {
        server.close();
        reject(new Error("Google sign-in timed out."));
      }, SIGN_IN_TIMEOUT);
      server.listen(0, "127.0.0.1", () => {
        redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const url = new URL(AUTH);
        for (const [k, v] of Object.entries({ client_id: cfg.clientId, redirect_uri: redirect, response_type: "code", scope: SCOPE, code_challenge: challenge, code_challenge_method: "S256", state, access_type: "offline", prompt: "consent" })) url.searchParams.set(k, v);
        void shell.openExternal(url.toString());
      });
    });
  }

  return {
    async token({ fresh = false, interactive = false }: { fresh?: boolean; interactive?: boolean } = {}): Promise<string> {
      if (!fresh && access && access.expires > Date.now() + 60_000) return access.value;
      const refresh = readRefresh();
      if (refresh) {
        try {
          return await exchange({ refresh_token: refresh, grant_type: "refresh_token" });
        } catch {
          // Revoked or expired: sign in again.
        }
      }
      if (!interactive) throw new Error(SIGN_IN_NEEDED);
      return signIn();
    },
    forget() {
      const refresh = readRefresh();
      access = null;
      memoryRefresh = null;
      rmSync(file, { force: true });
      if (refresh) void net.fetch(`${REVOKE}?token=${encodeURIComponent(refresh)}`, { method: "POST" }).catch(() => {});
    },
  };
}
