"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { finishOpenRouter } from "@confu/client/openrouter";
import { buttonClass } from "@confu/ui/classes";
import { Dialog, Notice, TopBar } from "./chrome";
import { AiPanel } from "./KeySetup";
import { Library } from "./Library";
import { LocalProvider, useDevice } from "./local";
import { SessionView } from "./Session";

// Confu on the device: no account, no server. The host (the web app's /app
// route; later the desktop and Android shells) says which session is open
// and how to change it.

export function LocalApp({ sessionId, navigate, homeHref = "/" }: { sessionId: string | null; navigate: (sessionId: string | null) => void; homeHref?: string }) {
  return (
    <LocalProvider
      fallback={({ error, retry }) => (
        <div className="flex flex-1 items-center justify-center px-6 py-24 text-center">
          {error ? (
            <div className="max-w-sm">
              <h1 className="font-serif text-2xl">Confu couldn&apos;t open its storage</h1>
              <p className="mt-2 text-sm text-muted">{error}</p>
              <button type="button" onClick={retry} className={`${buttonClass} mt-6`}>
                Try again
              </button>
            </div>
          ) : (
            <p className="font-mono text-xs text-muted" role="status">
              Opening your library…
            </p>
          )}
        </div>
      )}
    >
      <Shell sessionId={sessionId} navigate={navigate} homeHref={homeHref} />
    </LocalProvider>
  );
}

function Shell({ sessionId, navigate, homeHref }: { sessionId: string | null; navigate: (id: string | null) => void; homeHref: string }) {
  const device = useDevice();
  const [aiOpen, setAiOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [pending, setPending] = useState<{ sessionId: string; files: File[] } | null>(null);
  const finishing = useRef(false);

  // Back from openrouter.ai with ?code=: keep the key, tidy the address.
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (!code || finishing.current) return;
    finishing.current = true;
    url.searchParams.delete("code");
    window.history.replaceState(null, "", url);
    finishOpenRouter(device.keys, code).then((res) => {
      setNotice(res.ok ? { tone: "ok", text: "OpenRouter is connected. The tutor is ready." } : { tone: "danger", text: res.error });
      device.changed();
    });
  }, [device]);

  const onFilesTaken = useCallback(() => setPending(null), []);

  return (
    <div className="flex h-dvh flex-col">
      <TopBar homeHref={homeHref} onAi={() => setAiOpen(true)}>
        {!device.persistent && (
          <Notice>
            Nothing here is being saved. Confu is open in another tab (close it and reload this one), or this browser is blocking storage, as some
            private windows do.
          </Notice>
        )}
        {notice && (
          <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>
            {notice.text}
          </Notice>
        )}
        {sessionId ? (
          <SessionView
            key={sessionId}
            sessionId={sessionId}
            initialFiles={pending?.sessionId === sessionId ? pending.files : null}
            onFilesTaken={onFilesTaken}
            onBack={() => navigate(null)}
          />
        ) : (
          <Library
            onOpen={(id, files) => {
              if (files?.length) setPending({ sessionId: id, files });
              navigate(id);
            }}
          />
        )}
      </TopBar>
      {aiOpen && (
        <Dialog title="Your AI" onClose={() => setAiOpen(false)}>
          <AiPanel onSaved={() => setAiOpen(false)} />
        </Dialog>
      )}
    </div>
  );
}
