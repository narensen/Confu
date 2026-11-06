"use client";

import { useState } from "react";
import { importAccount, type AccountExport } from "@confu/client/account";
import { exportSession } from "@confu/client/bundle";
import { driveRemote } from "@confu/client/sync/drive";
import { buttonClass, eyebrowClass, ghostButtonClass } from "@confu/ui/classes";
import { ago } from "./chrome";
import { useHost } from "./host";
import { useDevice } from "./local";
import { useSync } from "./sync";

// Sync and backup: the student's Google Drive, and taking over what their
// Confu account had on the server.

export function SyncPanel() {
  const host = useHost();
  const { state, connect, syncNow, turnOff } = useSync();
  return (
    <div className="space-y-6">
      {host.drive ? (
        <section className="space-y-3">
          <p className={eyebrowClass}>Google Drive</p>
          {!state.on ? (
            <>
              <p className="text-sm leading-relaxed text-muted">
                Keep your library in your own Google Drive: a backup, and the same sessions on your other devices. Confu can only see the files it
                puts there, nothing else in your Drive.
              </p>
              <button type="button" onClick={connect} className={`${buttonClass} w-full py-2.5`}>
                Connect Google Drive
              </button>
            </>
          ) : (
            <>
              <p className="text-sm" role="status">
                {state.busy
                  ? (state.label ?? "Syncing…")
                  : state.paused
                    ? "Paused: Google needs you to sign in again."
                    : state.lastAt
                      ? `Synced ${ago(state.lastAt)}.`
                      : "Not synced yet."}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={syncNow} disabled={state.busy} className={`${buttonClass} flex-1`}>
                  {state.paused ? "Reconnect" : "Sync now"}
                </button>
                <button type="button" onClick={turnOff} disabled={state.busy} className={ghostButtonClass}>
                  Turn off
                </button>
              </div>
              <p className="text-xs leading-relaxed text-muted">Turning it off keeps what&apos;s already in your Drive, in the folder called Confu.</p>
            </>
          )}
          {state.error && <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{state.error}</p>}
        </section>
      ) : (
        <p className="text-sm leading-relaxed text-muted">
          Sync isn&apos;t set up on this copy of Confu. To move a session to another device, use Share → Download a file, then open it there.
        </p>
      )}
      {host.account && <BringOver />}
    </div>
  );
}

export function BringOver({ compact = false }: { compact?: boolean }) {
  const { account } = useHost();
  const { store, files, changed } = useDevice();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!account) return null;

  async function run() {
    setError(null);
    setDone(null);
    setBusy("Asking your account…");
    try {
      const res = await fetch(account!.exportUrl, { cache: "no-store" });
      const body = (await res.json()) as AccountExport | { error: string };
      if (!res.ok || "error" in body) throw new Error("error" in body ? body.error : `The server answered ${res.status}.`);
      const r = await importAccount(store, files, body, { onProgress: setBusy });
      changed();
      setDone(
        `${r.sessions === 1 ? "1 session" : `${r.sessions} sessions`} and ${r.files === 1 ? "1 file" : `${r.files} files`} are on this device now.` +
          (r.missing ? ` ${r.missing} file${r.missing === 1 ? "" : "s"} couldn't be downloaded; run it again later.` : ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't bring your sessions over.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={compact ? "space-y-3" : "space-y-3 border-t border-line pt-5"}>
      {!compact && <p className={eyebrowClass}>Your Confu account</p>}
      <p className="text-sm leading-relaxed text-muted">
        Copy the sessions, files and progress from {account.email} onto this device. Running it again updates them; nothing is removed from your
        account.
      </p>
      <button type="button" onClick={run} disabled={Boolean(busy)} className={`${compact ? buttonClass : ghostButtonClass} w-full`}>
        {busy ?? "Bring my sessions over"}
      </button>
      {done && <p className="text-sm text-ok">{done}</p>}
      {error && <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
    </section>
  );
}

const fileName = (title: string) => `${title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "Confu session"}.confu`;

export function SharePanel({ sessionId, title }: { sessionId: string; title: string }) {
  const { drive } = useHost();
  const { store, files } = useDevice();
  const [chat, setChat] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setError(null);
    setBusy("Packing…");
    try {
      const blob = await exportSession(store, files, sessionId, { chat });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: fileName(title) });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't pack the session.");
    } finally {
      setBusy(null);
    }
  }

  async function makeLink() {
    if (!drive) return;
    setError(null);
    setBusy("Uploading to your Google Drive…");
    try {
      const remote = driveRemote((o) => drive.token({ ...o, interactive: true }), { fetch: drive.fetch });
      const blob = await exportSession(store, files, sessionId, { chat });
      const file = await remote.write(`share.${sessionId}.${Date.now()}.confu`, blob);
      await remote.share(file.id);
      setLink(drive.shareUrl(file.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the link.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted">
        They get their own copy: the files, plan, notes and flashcards. Your chat stays with you unless you include it, and your progress always
        does.
      </p>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={chat} onChange={(e) => setChat(e.target.checked)} className="size-4 accent-[var(--ink)]" />
        Include the chat
      </label>
      {drive?.apiKey && (
        <div className="space-y-2 rounded-xl border border-ink bg-paper p-4">
          {link ? (
            <>
              <p className="text-sm font-medium">Anyone with this link can add a copy:</p>
              <div className="flex gap-2">
                <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-ink/25 bg-panel px-2 py-1.5 font-mono text-xs" />
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                  }}
                  className={ghostButtonClass}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-muted">The file is in your Google Drive (folder Confu). Delete it there to stop sharing.</p>
            </>
          ) : (
            <>
              <button type="button" onClick={makeLink} disabled={Boolean(busy)} className={`${buttonClass} w-full`}>
                Create a link
              </button>
              <p className="text-xs leading-relaxed text-muted">Saved in your Google Drive and shared with anyone who has the link.</p>
            </>
          )}
        </div>
      )}
      <button type="button" onClick={download} disabled={Boolean(busy)} className={`${ghostButtonClass} w-full`}>
        Download a file (.confu)
      </button>
      {busy && (
        <p className="font-mono text-xs text-muted" role="status">
          {busy}
        </p>
      )}
      {error && <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
