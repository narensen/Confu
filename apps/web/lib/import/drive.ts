// Google Drive: pick files with Google's own picker and download them in the
// browser. Asks only for drive.file, which covers just the files the student
// picks. PDFs come as they are; Google Docs/Slides/Sheets are exported to PDF;
// Word and PowerPoint files are converted through a temporary Google copy
// (deleted right after). The same conversion turns slides and Word files
// uploaded from the computer into PDFs (convertWithGoogle).
//
// Needs, in Google Cloud: the Picker API and Drive API enabled, an API key,
// the OAuth client's JavaScript origins, and these public env vars:
//   NEXT_PUBLIC_GOOGLE_CLIENT_ID, NEXT_PUBLIC_GOOGLE_API_KEY, NEXT_PUBLIC_GOOGLE_APP_ID

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
const APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID;

export const driveConfigured = Boolean(CLIENT_ID && API_KEY && APP_ID);

const PDF = "application/pdf";
const EXPORTABLE = ["application/vnd.google-apps.document", "application/vnd.google-apps.presentation", "application/vnd.google-apps.spreadsheet", "application/vnd.google-apps.drawing"];
const CONVERT: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "application/vnd.google-apps.presentation",
  "application/vnd.ms-powerpoint": "application/vnd.google-apps.presentation",
  "application/vnd.oasis.opendocument.presentation": "application/vnd.google-apps.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "application/vnd.google-apps.document",
  "application/msword": "application/vnd.google-apps.document",
  "application/vnd.oasis.opendocument.text": "application/vnd.google-apps.document",
  "application/rtf": "application/vnd.google-apps.document",
};

type Picked = { id: string; name: string; mimeType: string; url?: string };
type DocsView = { setMimeTypes(s: string): DocsView; setIncludeFolders(b: boolean): DocsView; setSelectFolderEnabled(b: boolean): DocsView };
type Builder = {
  addView(v: DocsView): Builder;
  enableFeature(f: unknown): Builder;
  setOAuthToken(t: string): Builder;
  setDeveloperKey(k: string): Builder;
  setAppId(a: string): Builder;
  setTitle(t: string): Builder;
  setCallback(cb: (d: { action: string; docs?: Picked[] }) => void): Builder;
  build(): { setVisible(v: boolean): void };
};
type G = {
  accounts: { oauth2: { initTokenClient(o: Record<string, unknown>): { requestAccessToken(o?: Record<string, unknown>): void } } };
  picker: {
    DocsView: new (id?: unknown) => DocsView;
    PickerBuilder: new () => Builder;
    ViewId: { DOCS: unknown };
    Feature: { MULTISELECT_ENABLED: unknown };
    Action: { PICKED: string; CANCEL: string };
  };
};
declare global {
  interface Window {
    google?: G;
    gapi?: { load(name: string, cb: () => void): void };
  }
}

const loaded = new Map<string, Promise<void>>();
function script(src: string) {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Couldn't load Google's file picker. Check your connection or ad blocker."));
        document.head.appendChild(s);
      }),
    );
  }
  return loaded.get(src)!;
}

// Browsers only allow the sign-in popup straight from a click, so everything
// it needs is loaded beforehand (prepareDrive, when the Drive tab opens) and
// the click asks for the token before any await. The token lasts an hour, so
// later imports skip the popup.
type TokenClient = { requestAccessToken(o?: Record<string, unknown>): void };
let tokenClient: TokenClient | null = null;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
let cachedToken: { value: string; expires: number } | null = null;
let ready: Promise<void> | null = null;

export function prepareDrive(): Promise<void> {
  ready ??= (async () => {
    await Promise.all([script("https://accounts.google.com/gsi/client"), script("https://apis.google.com/js/api.js")]);
    await new Promise<void>((resolve) => window.gapi!.load("picker", resolve));
    tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (r: { access_token?: string; expires_in?: number; error?: string }) => {
        if (r.access_token) {
          cachedToken = { value: r.access_token, expires: Date.now() + ((r.expires_in ?? 3600) - 120) * 1000 };
          pending?.resolve(r.access_token);
        } else pending?.reject(new Error(r.error ?? "Google sign-in failed."));
        pending = null;
      },
      error_callback: (e: { type?: string; message?: string }) => {
        pending?.reject(
          new Error(
            e.type === "popup_closed"
              ? "CANCELLED"
              : e.type === "popup_failed_to_open"
                ? "Your browser blocked Google's sign-in window. Allow pop-ups for this site, then try again."
                : (e.message ?? "Google sign-in failed."),
          ),
        );
        pending = null;
      },
    });
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

export const driveReady = () => Boolean(tokenClient);

// Must run synchronously inside the click handler.
function token(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now()) return Promise.resolve(cachedToken.value);
  if (!tokenClient) return Promise.reject(new Error("Google Drive is still loading. Try again in a moment."));
  pending?.reject(new Error("CANCELLED"));
  const promise = new Promise<string>((resolve, reject) => (pending = { resolve, reject }));
  tokenClient.requestAccessToken({ prompt: "" });
  return promise;
}

function pick(accessToken: string): Promise<Picked[]> {
  const g = window.google!.picker;
  return new Promise((resolve) => {
    const view = new g.DocsView(g.ViewId.DOCS)
      .setMimeTypes([PDF, ...EXPORTABLE, ...Object.keys(CONVERT)].join(","))
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);
    new g.PickerBuilder()
      .addView(view)
      .enableFeature(g.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(accessToken)
      .setDeveloperKey(API_KEY!)
      .setAppId(APP_ID!)
      .setTitle("Choose files for Confu")
      .setCallback((data) => {
        if (data.action === g.Action.PICKED) resolve(data.docs ?? []);
        else if (data.action === g.Action.CANCEL) resolve([]);
      })
      .build()
      .setVisible(true);
  });
}

async function api(accessToken: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(res.status === 403 ? "Google Drive refused access to that file." : `Google Drive error (${res.status}).`);
  return res;
}

async function download(accessToken: string, f: Picked): Promise<Blob> {
  if (f.mimeType === PDF) return (await api(accessToken, `files/${f.id}?alt=media`)).blob();
  if (EXPORTABLE.includes(f.mimeType)) return (await api(accessToken, `files/${f.id}/export?mimeType=${encodeURIComponent(PDF)}`)).blob();
  const target = CONVERT[f.mimeType];
  if (!target) throw new Error(`“${f.name}” can't be turned into a PDF.`);
  // Convert via a temporary Google copy, then remove it.
  const copy = (await (await api(accessToken, `files/${f.id}/copy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `${f.name} (Confu temp)`, mimeType: target }) })).json()) as { id: string };
  try {
    return await (await api(accessToken, `files/${copy.id}/export?mimeType=${encodeURIComponent(PDF)}`)).blob();
  } finally {
    await api(accessToken, `files/${copy.id}`, { method: "DELETE" }).catch(() => {});
  }
}

export type DriveFile = { file: File; title: string; sourceUrl: string | null };

export async function importFromDrive(onStatus: (s: string) => void): Promise<{ files: DriveFile[]; failed: string[] }> {
  if (!driveConfigured) throw new Error("Google Drive import isn't set up yet.");
  const signIn = token(); // first, while this is still the click
  onStatus("Opening Google Drive…");
  const accessToken = await signIn;
  const picked = await pick(accessToken);
  const files: DriveFile[] = [];
  const failed: string[] = [];
  for (const [i, f] of picked.entries()) {
    onStatus(`Downloading ${i + 1} of ${picked.length}: ${f.name}`);
    try {
      const blob = await download(accessToken, f);
      const title = f.name.replace(/\.(pdf|pptx?|docx?|odp|odt|rtf)$/i, "");
      files.push({ file: new File([blob], `${title.slice(0, 100)}.pdf`, { type: PDF }), title, sourceUrl: f.url ?? null });
    } catch (err) {
      failed.push(`${f.name}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  return { files, failed };
}

/* ------------------------------------------- converting uploaded files */

// Uploaded slides and documents Google can turn into a PDF (not Keynote).
const UPLOAD_TARGET: [RegExp, string][] = [
  [/\.(pptx?|odp)$/i, "application/vnd.google-apps.presentation"],
  [/\.(docx?|odt|rtf)$/i, "application/vnd.google-apps.document"],
];
export const convertTarget = (f: File) => UPLOAD_TARGET.find(([re]) => re.test(f.name))?.[1] ?? null;
export const needsConversion = (f: File) => f.type !== "application/pdf" && Boolean(convertTarget(f));

// Upload to the student's Drive as Google Slides/Docs, export a PDF, delete
// the copy. Call it straight from a click (the sign-in may open a popup), and
// after prepareDrive() has finished.
export async function convertWithGoogle(files: File[], onStatus: (s: string) => void): Promise<{ pdfs: File[]; failed: string[] }> {
  if (!driveConfigured) throw new Error("Google Drive isn't set up yet.");
  const signIn = token(); // first, while this is still the click
  onStatus("Connecting to Google…");
  const accessToken = await signIn;
  const pdfs: File[] = [];
  const failed: string[] = [];
  for (const [i, file] of files.entries()) {
    const target = convertTarget(file);
    if (!target) {
      failed.push(`${file.name}: Google can't convert this kind of file.`);
      continue;
    }
    onStatus(`Converting ${i + 1} of ${files.length}: ${file.name}`);
    let id: string | null = null;
    try {
      // Resumable upload: simple uploads stop at 5 MB.
      const start = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": file.type || "application/octet-stream" },
        body: JSON.stringify({ name: `${file.name} (Confu temp)`, mimeType: target }),
      });
      const location = start.ok ? start.headers.get("location") : null;
      if (!location) throw new Error(`Google Drive error (${start.status}).`);
      const put = await fetch(location, { method: "PUT", body: file });
      if (!put.ok) throw new Error(put.status === 400 ? "Google couldn't read this file." : `Google Drive error (${put.status}).`);
      id = ((await put.json()) as { id: string }).id;
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(PDF)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(res.status === 403 ? "It's too big for Google to export (10 MB limit). Export it as PDF yourself." : `Google Drive error (${res.status}).`);
      const name = file.name.replace(/\.[^.]+$/, "");
      pdfs.push(new File([await res.blob()], `${name}.pdf`, { type: PDF }));
    } catch (err) {
      failed.push(`${file.name}: ${err instanceof Error ? err.message : "failed"}`);
    } finally {
      if (id) await api(accessToken, `files/${id}`, { method: "DELETE" }).catch(() => {});
    }
  }
  return { pdfs, failed };
}
