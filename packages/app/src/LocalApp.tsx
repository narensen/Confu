"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { sessionIndex } from "@confu/client/account";
import { importSession } from "@confu/client/bundle";
import { finishOpenRouter } from "@confu/client/openrouter";
import { createSession } from "@confu/client/library";
import { isShareCode } from "@confu/client/live";
import { saveNote } from "@confu/client/tools";
import { readPublicDriveFile } from "@confu/client/sync/drive";
import { buttonClass } from "@confu/ui/classes";
import { Dialog, Notice, Screen, SyncChip, TopBar } from "./chrome";
import { HostContext, useHost, type Host } from "./host";
import { AiPanel, useAccountAiOnce } from "./KeySetup";
import { Library } from "./Library";
import { LocalProvider, useDevice } from "./local";
import type { Tool } from "./Session";
import { SyncProvider } from "./sync";
import { SyncPanel } from "./SyncPanel";

// The reader, the podcast panel and the video stage are not needed to list
// the library. Loading them here is what kept "Opening your library…" up.
const SessionView = lazy(() => import("./Session").then((m) => ({ default: m.SessionView })));

// Confu on the device: no account, no server. The host (the web app's /app
// route, the desktop shell) says which session is open, how to change it,
// and what it offers (Google Drive, a Confu account).

export function LocalApp(host: Host) {
  return (
    <HostContext.Provider value={host}>
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
        <SyncProvider>
          <Shell />
        </SyncProvider>
      </LocalProvider>
    </HostContext.Provider>
  );
}

type NoticeState = { tone: "ok" | "danger"; text: string } | null;

function Shell() {
  const host = useHost();
  const { sessionId, navigate } = host;
  const device = useDevice();
  const [dialog, setDialog] = useState<"ai" | "sync" | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [pending, setPending] = useState<{ sessionId: string; files: File[] } | null>(null);
  const [opening, setOpening] = useState<{ sessionId: string; tool: Tool; note?: { id: string; code: string } } | null>(null);
  useOpenRouterReturn(setNotice);
  useAccountAiOnce((res) =>
    setNotice(
      res.ok
        ? { tone: "ok", text: `Using the AI from your Confu account (${res.info.via === "oauth" ? "OpenRouter" : "your key"}). Change it under Your AI.` }
        : { tone: "danger", text: `Your account's AI didn't work here: ${res.error}` },
    ),
  );
  useSharedLink(setNotice);
  useSessionIndex();
  useSharedNote(setNotice, setOpening);

  const onFilesTaken = useCallback(() => setPending(null), []);

  return (
    <div className="flex h-dvh flex-col">
      <TopBar homeHref={host.homeHref ?? "/"} onAi={() => setDialog("ai")} right={<SyncChip onClick={() => setDialog("sync")} />}>
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
        <Screen key={sessionId ?? "library"}>
        {sessionId ? (
          <Suspense fallback={<p className="flex flex-1 items-center justify-center font-mono text-xs text-muted" role="status">Opening this session…</p>}>
            <SessionView
              key={`${sessionId}:${opening?.note?.id ?? ""}`}
              sessionId={sessionId}
              initialFiles={pending?.sessionId === sessionId ? pending.files : null}
              onFilesTaken={onFilesTaken}
              onBack={() => navigate(null)}
              initialTool={opening?.sessionId === sessionId ? opening.tool : undefined}
              openNote={opening?.sessionId === sessionId ? (opening.note ?? null) : null}
            />
          </Suspense>
        ) : (
          <Library
            onOpen={(id, files, tool) => {
              if (files?.length) setPending({ sessionId: id, files });
              setOpening(tool ? { sessionId: id, tool } : null);
              navigate(id);
            }}
          />
        )}
        </Screen>
      </TopBar>
      {dialog === "ai" && (
        <Dialog title="Your AI" onClose={() => setDialog(null)}>
          <AiPanel onSaved={() => setDialog(null)} />
        </Dialog>
      )}
      {dialog === "sync" && (
        <Dialog title="Sync and backup" onClose={() => setDialog(null)}>
          <SyncPanel />
        </Dialog>
      )}
    </div>
  );
}

// Back from openrouter.ai with ?code=: keep the key, tidy the address.
function useOpenRouterReturn(setNotice: (n: NoticeState) => void) {
  const { keys, changed } = useDevice();
  const finishing = useRef(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (!code || finishing.current) return;
    finishing.current = true;
    url.searchParams.delete("code");
    window.history.replaceState(null, "", url);
    finishOpenRouter(keys, code).then((res) => {
      setNotice(res.ok ? { tone: "ok", text: "OpenRouter is connected. The tutor is ready." } : { tone: "danger", text: res.error });
      changed();
    });
  }, [keys, changed, setNotice]);
}

// A shared session's link (?shared=<Drive file id>): add a copy and open it.
function useSharedLink(setNotice: (n: NoticeState) => void) {
  const { sharedFileId, drive, navigate } = useHost();
  const { store, files, changed } = useDevice();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!sharedFileId || done.current === sharedFileId) return;
    done.current = sharedFileId;
    if (!drive?.apiKey) {
      setNotice({ tone: "danger", text: "Shared links aren't set up on this copy of Confu. Ask for the session file instead." });
      return;
    }
    setNotice({ tone: "ok", text: "Adding the shared session…" });
    readPublicDriveFile(sharedFileId, drive.apiKey, drive.fetch)
      .then((blob) => importSession(store, files, blob))
      .then((s) => {
        changed();
        setNotice({ tone: "ok", text: `“${s.title}” is in your library now. It's your own copy.` });
        navigate(s.id, { replace: true });
      })
      .catch((e: unknown) => setNotice({ tone: "danger", text: e instanceof Error ? e.message : "Couldn't open that shared session." }));
  }, [sharedFileId, drive, store, files, changed, navigate, setNotice]);
}

// Signed in to a Confu account: keep its list of sessions current (titles
// and next review, no content), a few seconds after things change.
function useSessionIndex() {
  const { account } = useHost();
  const { store, version } = useDevice();
  useEffect(() => {
    if (!account) return;
    const timer = setTimeout(async () => {
      try {
        const rows = await sessionIndex(store);
        const before = JSON.parse((await store.getMeta("index.published")) ?? "[]") as string[];
        const now = new Set(rows.map((r) => r.session_id));
        const signature = JSON.stringify(rows.map((r) => [r.session_id, r.title, r.files, r.updated_at, r.next_review_at]));
        if (signature === (await store.getMeta("index.signature"))) return;
        await account.publishIndex(
          rows,
          before.filter((id) => !now.has(id)),
        );
        await store.setMeta("index.published", JSON.stringify([...now]));
        await store.setMeta("index.signature", signature);
      } catch {
        // Offline or signed out: next change tries again.
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [account, store, version]);
}

// A note someone is editing with the student (#note=<code>): open it, or
// make it (in a "Shared notes" session) and join the room.
function useSharedNote(setNotice: (n: NoticeState) => void, open: (o: { sessionId: string; tool: Tool; note: { id: string; code: string } }) => void) {
  const { noteCode, live, navigate } = useHost();
  const { store, changed } = useDevice();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!noteCode || done.current === noteCode) return;
    done.current = noteCode;
    if (!isShareCode(noteCode)) return setNotice({ tone: "danger", text: "That note link isn't complete. Ask for it again." });
    if (!live) return setNotice({ tone: "danger", text: "Editing together isn't set up on this copy of Confu." });
    void (async () => {
      const [known] = await store.query<{ key: string }>(`SELECT key FROM "_meta" WHERE key LIKE 'note.share.%' AND value = ?`, [noteCode]);
      let noteId = known?.key.slice("note.share.".length) ?? null;
      let sessionId = noteId ? (await store.get<{ session_id: string }>("notes", { id: noteId }))?.session_id : null;
      if (!noteId || !sessionId) {
        const [shared] = await store.list<{ id: string }>("study_sessions", { title: "Shared notes" }, { limit: 1 });
        sessionId = shared?.id ?? (await createSession(store, { title: "Shared notes" })).id;
        noteId = await saveNote(store, { sessionId, title: "Shared note", content: "" });
        await store.setMeta(`note.share.${noteId}`, noteCode);
      }
      changed();
      open({ sessionId, tool: "notes", note: { id: noteId, code: noteCode } });
      navigate(sessionId, { replace: true });
    })();
  }, [noteCode, live, store, changed, navigate, open, setNotice]);
}
