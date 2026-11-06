"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { driveRemote, SignInNeeded } from "@confu/client/sync/drive";
import { syncOnce } from "@confu/client/sync/engine";
import { useHost } from "./host";
import { useDevice } from "./local";

// Keeps this device and the student's Google Drive in step: on open, every
// few minutes while the app is on screen, a little after each change, and
// when the connection comes back.

const EVERY_MS = 3 * 60_000;
const AFTER_CHANGE_MS = 20_000;

export type SyncState = {
  available: boolean; // the host offers Drive
  on: boolean;
  busy: boolean;
  label: string | null; // what it's doing right now
  lastAt: string | null;
  paused: boolean; // Google needs the student to sign in again
  error: string | null;
};

type Ctx = { state: SyncState; connect: () => Promise<void>; syncNow: () => Promise<void>; turnOff: () => Promise<void> };
const SyncContext = createContext<Ctx | null>(null);

export function useSync(): Ctx {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync() outside <SyncProvider>");
  return ctx;
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { drive } = useHost();
  const { store, files, changed, version } = useDevice();
  const [state, setState] = useState<SyncState>({ available: Boolean(drive), on: false, busy: false, label: null, lastAt: null, paused: false, error: null });
  const running = useRef(false);
  const on = useRef(false);
  const ownChange = useRef(false);

  const run = useCallback(
    async (interactive: boolean) => {
      if (!drive || running.current || (!interactive && !on.current)) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      running.current = true;
      setState((s) => ({ ...s, busy: true, label: "Syncing…" }));
      try {
        const remote = driveRemote((o) => drive.token({ ...o, interactive }), { fetch: drive.fetch });
        const r = await syncOnce(store, files, remote, (label) => setState((s) => ({ ...s, label })));
        if (r.received || r.downloaded) {
          ownChange.current = true; // what came in needn't go straight back out
          changed();
        }
        setState((s) => ({ ...s, lastAt: new Date().toISOString(), paused: false, error: null }));
      } catch (e) {
        if (e instanceof SignInNeeded) setState((s) => ({ ...s, paused: true }));
        else setState((s) => ({ ...s, error: e instanceof Error ? e.message : "Sync failed." }));
      } finally {
        running.current = false;
        setState((s) => ({ ...s, busy: false, label: null }));
      }
    },
    [drive, store, files, changed],
  );

  // Was sync turned on here before?
  useEffect(() => {
    if (!drive) return;
    let live = true;
    Promise.all([store.getMeta("drive.on"), store.getMeta("sync.at")]).then(([was, at]) => {
      if (!live) return;
      on.current = was === "1";
      setState((s) => ({ ...s, on: on.current, lastAt: at }));
      if (on.current) void run(false);
    });
    return () => {
      live = false;
    };
  }, [drive, store, run]);

  // Every few minutes while on screen, and when back online.
  useEffect(() => {
    if (!drive) return;
    const tick = () => document.visibilityState === "visible" && void run(false);
    const timer = setInterval(tick, EVERY_MS);
    window.addEventListener("online", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [drive, run]);

  // A little after the student changes something.
  useEffect(() => {
    if (!drive || !version) return;
    if (ownChange.current) {
      ownChange.current = false;
      return;
    }
    const timer = setTimeout(() => void run(false), AFTER_CHANGE_MS);
    return () => clearTimeout(timer);
  }, [drive, version, run]);

  const value = useMemo<Ctx>(
    () => ({
      state,
      async connect() {
        if (!drive) return;
        setState((s) => ({ ...s, error: null }));
        try {
          await drive.token({ interactive: true });
        } catch (e) {
          setState((s) => ({ ...s, error: e instanceof Error ? e.message : "Google sign-in didn't finish." }));
          return;
        }
        await store.setMeta("drive.on", "1");
        on.current = true;
        setState((s) => ({ ...s, on: true, paused: false }));
        await run(true);
      },
      syncNow: () => run(true),
      async turnOff() {
        await store.setMeta("drive.on", null);
        on.current = false;
        drive?.forget?.();
        setState((s) => ({ ...s, on: false, paused: false, error: null }));
      },
    }),
    [state, drive, store, run],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
