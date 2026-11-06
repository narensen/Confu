import { createContext, useContext } from "react";
import type { FetchLike } from "@confu/ai/fetch-like";
import type { SessionIndexRow } from "@confu/client/account";
import type { LiveOpener } from "@confu/client/live";
import type { TokenSource } from "@confu/client/sync/drive";

// What the app gets from where it runs (the web app's /app route, the
// desktop shell). Everything but navigation is optional: without Drive
// there's no sync, without an account there's nothing to bring over.

export type DriveHost = {
  token: TokenSource; // Google sign-in for the drive.file scope
  apiKey?: string | null; // reads publicly shared session files without sign-in
  shareUrl: (fileId: string) => string; // the link a friend opens
  forget?: () => void; // drop the token when sync is turned off
  fetch?: FetchLike; // how to reach Google's APIs (the desktop app goes through its main process)
};

export type AccountHost = {
  email: string;
  exportUrl: string; // GET → AccountExport (the account's data on the server)
  publishIndex: (rows: SessionIndexRow[], removed: string[]) => Promise<void>;
};

export type Host = {
  sessionId: string | null;
  navigate: (sessionId: string | null, opts?: { replace?: boolean }) => void;
  homeHref?: string;
  drive?: DriveHost | null;
  account?: AccountHost | null;
  sharedFileId?: string | null; // a shared session to add (?shared=)
  openRouter?: boolean; // "Connect OpenRouter" in the page (needs an https or localhost address)
  platform?: "web" | "desktop";
  fetchPdf?: (url: string) => Promise<Blob>; // open papers from other sites (a course's sources)
  live?: LiveOpener | null; // a relay for editing notes together
  shareNoteUrl?: (code: string) => string; // the link to edit a note together
  noteCode?: string | null; // a note shared with the student (#note=…)
};

export const HostContext = createContext<Host | null>(null);

export function useHost(): Host {
  const host = useContext(HostContext);
  if (!host) throw new Error("useHost() outside <LocalApp>");
  return host;
}
