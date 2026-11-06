"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import type { AccountHost, DriveHost } from "@confu/app/host";
import { proxyPdfFetcher } from "@confu/client/courses";
import { broadcastOpener, type BroadcastClient, type LiveOpener } from "@confu/client/live";
import { googleDriveToken } from "@/lib/google-drive";
import { createClient } from "@/lib/supabase/client";

// Browser only: it needs the device's storage and workers, and pdf.js
// touches `window` as soon as it loads.
const LocalApp = dynamic(() => import("@confu/app/LocalApp").then((m) => m.LocalApp), {
  ssr: false,
  loading: () => (
    <p className="flex flex-1 items-center justify-center py-24 font-mono text-xs text-muted" role="status">
      Opening your library…
    </p>
  ),
});

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY || "";

// The open session is ?s=<id>. pushState keeps it one page (the database
// stays open) while Back and Forward still work.
export function LocalRoute() {
  const params = useSearchParams();
  const sessionId = params.get("s");
  const shared = params.get("shared");
  useKeepOffline();
  const drive = useMemo<DriveHost | null>(() => {
    if (!GOOGLE_CLIENT_ID) return null;
    const token = googleDriveToken(GOOGLE_CLIENT_ID);
    return { token, forget: token.forget, apiKey: GOOGLE_API_KEY || null, shareUrl: (id) => `${window.location.origin}/app?shared=${encodeURIComponent(id)}` };
  }, []);
  const account = useAccount();
  const noteCode = useHashParam("note");
  const live = useMemo<LiveOpener | null>(() => (process.env.NEXT_PUBLIC_SUPABASE_URL ? broadcastOpener(createClient() as unknown as BroadcastClient) : null), []);
  return (
    <LocalApp
      sessionId={sessionId}
      sharedFileId={shared}
      noteCode={noteCode}
      live={live}
      shareNoteUrl={(code) => `${window.location.origin}/app#note=${code}`}
      fetchPdf={proxyPdfFetcher("/api/paper/pdf")}
      navigate={(id, opts) => window.history[opts?.replace ? "replaceState" : "pushState"](null, "", id ? `/app?s=${encodeURIComponent(id)}` : "/app")}
      homeHref="/"
      drive={drive}
      account={account}
      platform="web"
    />
  );
}

// A value from the address's #fragment (never sent to the server), e.g. a
// note's share code.
function useHashParam(name: string): string | null {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setValue(new URLSearchParams(window.location.hash.slice(1)).get(name));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [name]);
  return value;
}

// Signed in to a Confu account: offer to bring its sessions over, and keep
// its session index current. Signed out: none of that.
function useAccount(): AccountHost | null {
  const [account, setAccount] = useState<AccountHost | null>(null);
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    const supabase = createClient();
    let live = true;
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      if (!live || !user) return;
      setAccount({
        email: user.email ?? "your account",
        exportUrl: "/api/export/device",
        async publishIndex(rows, removed) {
          if (rows.length) {
            const { error } = await supabase.from("session_index").upsert(rows.map((r) => ({ ...r, user_id: user.id })));
            if (error) throw error;
          }
          if (removed.length) {
            const { error } = await supabase.from("session_index").delete().in("session_id", removed);
            if (error) throw error;
          }
        },
      });
    });
    return () => {
      live = false;
    };
  }, []);
  return account;
}

// The service worker (public/sw.js, registered by AppShell) keeps build files
// as they load. On a first visit the page loaded before the worker was
// running, so tell it which files those were.
function useKeepOffline() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let live = true;
    navigator.serviceWorker.ready.then((reg) => {
      if (!live) return;
      const urls = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((u) => new URL(u).pathname.startsWith("/_next/static/"));
      reg.active?.postMessage({ type: "keep-offline", urls });
    });
    return () => {
      live = false;
    };
  }, []);
}
