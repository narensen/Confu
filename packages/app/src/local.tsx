"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DeviceKeys } from "@confu/client/keys";
import { browserFiles, type FileStore } from "@confu/storage/files";
import { wasmDriver } from "@confu/storage/drivers/wasm";
import { indexedDbKeySource } from "@confu/storage/keys";
import { Store } from "@confu/storage/store";

// Everything on this device, opened once per page: the database (SQLite in
// a worker), the file store, and the student's AI keys.

export type Device = {
  store: Store;
  keys: DeviceKeys;
  files: FileStore;
  // false: the database is in memory only (Confu is open in another tab, or
  // the browser blocks storage), so nothing here survives a reload.
  persistent: boolean;
};

let opening: Promise<Device> | null = null;

function openDevice(): Promise<Device> {
  opening ??= (async () => {
    const raw = await wasmDriver("confu");
    const store = await Store.open(raw);
    // Ask the browser not to clear this site's storage when space runs low.
    await navigator.storage?.persist?.().catch(() => false);
    return { store, keys: new DeviceKeys(store, indexedDbKeySource()), files: browserFiles(), persistent: raw.persistent };
  })().catch((e) => {
    opening = null;
    throw e;
  });
  return opening;
}

type Ctx = Device & { version: number; changed: () => void };
const LocalContext = createContext<Ctx | null>(null);

export function useDevice(): Ctx {
  const ctx = useContext(LocalContext);
  if (!ctx) throw new Error("useDevice() outside <LocalProvider>");
  return ctx;
}

export function LocalProvider({ children, fallback }: { children: ReactNode; fallback: (state: { error: string | null; retry: () => void }) => ReactNode }) {
  const [device, setDevice] = useState<Device | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    openDevice().then(
      (d) => live && setDevice(d),
      (e: unknown) => live && setError(e instanceof Error ? e.message : "This browser couldn't open Confu's storage."),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  const changed = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(() => (device ? { ...device, version, changed } : null), [device, version, changed]);
  if (!value) {
    return fallback({
      error,
      retry: () => {
        setError(null);
        setAttempt((a) => a + 1);
      },
    });
  }
  return <LocalContext.Provider value={value}>{children}</LocalContext.Provider>;
}

// Data read from the device, read again after any change (changed()).
// Keeps showing the last result while the next one loads.
export function useLocal<T>(load: (d: Device) => Promise<T>, deps: unknown[]): { data: T | undefined; error: string | null } {
  const device = useDevice();
  const [state, setState] = useState<{ data: T | undefined; error: string | null }>({ data: undefined, error: null });
  useEffect(() => {
    let live = true;
    load(device).then(
      (data) => live && setState({ data, error: null }),
      (e: unknown) => live && setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : String(e) })),
    );
    return () => {
      live = false;
    };
    // `load` is a new function each render; `deps` say when its result changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.version, ...deps]);
  return state;
}
