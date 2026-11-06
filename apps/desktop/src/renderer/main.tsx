import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/newsreader";
// The same KaTeX version that renders the math (rehype-katex, via @confu/ui).
import "katex/dist/katex.min.css";
import "./styles.css";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { DriveHost } from "@confu/app/host";
import { preloadDevice } from "@confu/app/local";
import { LocalApp } from "@confu/app/LocalApp";
import { configurePdfWorker } from "@confu/app/pdf";
import type { FetchLike } from "@confu/ai/fetch-like";
import { broadcastOpener, type BroadcastClient } from "@confu/client/live";
import { SignInNeeded } from "@confu/client/sync/drive";
import { createClient } from "@supabase/supabase-js";
import type { DesktopBridge } from "../main/preload";
import { UpdateBar } from "./UpdateBar";

declare global {
  interface Window {
    confu?: DesktopBridge;
  }
}

configurePdfWorker(workerUrl);
preloadDevice();

const bridge = window.confu;
type Info = Awaited<ReturnType<DesktopBridge["info"]>>;

// Requests to Google's APIs go through the desktop shell.
const googleFetch: FetchLike = async (input, init) => {
  const body = init?.body == null ? null : await new Response(init.body).arrayBuffer();
  const res = await bridge!.googleFetch({ url: String(input), method: init?.method, headers: Object.fromEntries(new Headers(init?.headers).entries()), body });
  return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: res.headers });
};

const sessionFromUrl = () => new URLSearchParams(window.location.search).get("s");

// Editing notes together goes through the project's Supabase Realtime, when
// the build has one (VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const live = SUPABASE_URL && SUPABASE_KEY ? broadcastOpener(createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } }) as unknown as BroadcastClient) : null;

const fetchPdf = async (url: string) => new Blob([await bridge!.fetchPdf(url)], { type: "application/pdf" });

function App() {
  const [sessionId, setSessionId] = useState(sessionFromUrl);
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    void bridge?.info().then(setInfo);
    const onPop = () => setSessionId(sessionFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const drive = useMemo<DriveHost | null>(() => {
    if (!bridge || !info?.google) return null;
    return {
      async token(opts) {
        const r = await bridge.googleToken(opts ?? {});
        if (r.token) return r.token;
        if (r.error === "signin-needed") throw new SignInNeeded();
        throw new Error(r.error ?? "Google sign-in didn't finish.");
      },
      forget: () => void bridge.googleForget(),
      apiKey: info.googleApiKey,
      shareUrl: (id) => `${info.site}/app?shared=${encodeURIComponent(id)}`,
      fetch: googleFetch,
    };
  }, [info]);

  return (
    <>
    <LocalApp
      sessionId={sessionId}
      navigate={(id, opts) => {
        window.history[opts?.replace ? "replaceState" : "pushState"](null, "", id ? `?s=${encodeURIComponent(id)}` : window.location.pathname);
        setSessionId(id);
      }}
      homeHref="index.html"
      drive={drive}
      openRouter={false}
      platform="desktop"
      fetchPdf={bridge ? fetchPdf : undefined}
      live={live}
      shareNoteUrl={(code) => `${info?.site ?? "https://confu.lol"}/app#note=${code}`}
    />
    {bridge && <UpdateBar updates={bridge.updates} />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
