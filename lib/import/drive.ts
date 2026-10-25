// Google Drive: pick files with Google's own picker and download them in the
// browser. Asks only for drive.file, which covers just the files the student
// picks. PDFs come as they are; Google Docs/Slides/Sheets are exported to PDF;
// Word and PowerPoint files are converted through a temporary Google copy
// (deleted right after).
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

async function token(): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (r: { access_token?: string; error?: string }) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error ?? "Google sign-in failed."))),
      error_callback: (e: { type?: string; message?: string }) => reject(new Error(e.type === "popup_closed" ? "CANCELLED" : (e.message ?? "Google sign-in failed."))),
    });
    client.requestAccessToken({ prompt: "" });
  });
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
  onStatus("Opening Google Drive…");
  await Promise.all([script("https://accounts.google.com/gsi/client"), script("https://apis.google.com/js/api.js")]);
  await new Promise<void>((resolve) => window.gapi!.load("picker", resolve));
  const accessToken = await token();
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
