"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";
import { lecturePdf, playlistLectures, TranscriptError, type PlaylistLecture } from "@/lib/import/fetch-client";
import { driveConfigured, driveReady, importFromDrive, prepareDrive } from "@/lib/import/drive";
import {
  connectZotero,
  parseBibtex,
  parseRis,
  zoteroCollections,
  zoteroItems,
  zoteroPdf,
  type ZoteroAccount,
  type ZoteroCollection,
  type ZoteroItem,
} from "@/lib/import/zotero";
import { boardPhotoPdf } from "@/lib/import/board-pdf";
import { metaFor, type PaperMeta } from "@/lib/pdf/add-paper";
import { track } from "@/lib/telemetry";

// "Add material": PDFs, web pages (printed to PDF by the student), YouTube
// lectures, Google Drive and Zotero. Everything except papers becomes a PDF
// (lectures are typeset in the browser), so it gets search, highlights,
// contents, plans, the tutor and spaced review like any upload.

export type ImportedFile = { file: File; title?: string; sourceUrl?: string | null; meta?: Record<string, unknown> };
type Tab = "upload" | "web" | "youtube" | "drive" | "zotero" | "board";

const TABS: { id: Tab; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "board", label: "Board" },
  { id: "web", label: "Web page" },
  { id: "youtube", label: "YouTube" },
  { id: "drive", label: "Google Drive" },
  { id: "zotero", label: "Zotero" },
];

export function AddMaterialDialog({
  onClose,
  onFiles,
  onImported,
  onPapers,
  initialTab = "upload",
  initialUrl,
  onFindPaper,
  onLectures,
}: {
  onClose: () => void;
  onFiles: (files: File[]) => void;
  onImported: (items: ImportedFile[]) => void;
  onPapers: (papers: PaperMeta[]) => void;
  initialTab?: Tab;
  initialUrl?: string; // the YouTube tab, opened on a playlist
  onFindPaper?: () => void; // study sessions: add a research paper by arXiv ID, DOI or title
  // A playlist's chosen lectures: fetched and added in the session (each
  // with its own progress in Files), so this dialog can close right away.
  onLectures: (lectures: { url: string; title: string }[]) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const done = (items: ImportedFile[], source: string) => {
    if (!items.length) return;
    track("import.done", { source, count: items.length });
    onImported(items);
    onClose();
  };

  const shared = { busy, setBusy, setError, done };

  return (
    <div
      className="animate-fade fixed inset-0 z-60 flex items-center justify-center bg-scrim p-3 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="add-material-title" className="animate-pop flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard">
        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <div>
            <p className={eyebrowClass}>Add material</p>
            <h2 id="add-material-title" className="mt-1 font-serif text-2xl">
              Study from anything
            </h2>
            <p className="mt-1 text-sm text-muted">PDFs, slides and Word docs, a photo of the board, web pages saved as PDFs, lecture videos, Google Drive and Zotero.</p>
          </div>
          <button onClick={onClose} disabled={Boolean(busy)} aria-label="Close" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-paper disabled:opacity-30">
            ✕
          </button>
        </div>

        <div role="tablist" aria-label="Source" className="mt-4 flex gap-1 overflow-x-auto border-b border-ink px-5 [scrollbar-width:none]">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              disabled={Boolean(busy)}
              onClick={() => {
                setTab(t.id);
                setError(null);
              }}
              className={`relative shrink-0 px-3 pt-1 pb-2.5 text-sm font-medium whitespace-nowrap transition ${tab === t.id ? "text-ink" : "text-muted hover:text-ink"}`}
            >
              {t.label}
              {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-ink" />}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {tab === "upload" && (
            <>
              <UploadTab
                onFiles={(files) => {
                  onFiles(files);
                  onClose();
                }}
              />
              {onFindPaper && (
                <button
                  type="button"
                  onClick={onFindPaper}
                  className="mt-4 flex w-full items-center justify-between gap-3 rounded-xl border border-ink bg-paper px-4 py-3 text-left transition hover:-translate-y-px hover:shadow-hard-sm"
                >
                  <span className="text-sm">
                    <span className="font-medium">Adding a research paper?</span>{" "}
                    <span className="text-muted">Find it by arXiv ID, DOI or title, and read it with the three passes.</span>
                  </span>
                  <span aria-hidden>→</span>
                </button>
              )}
            </>
          )}
          {tab === "board" && <BoardTab {...shared} />}
          {tab === "web" && (
            <WebTab
              onFiles={(files) => {
                track("import.done", { source: "web_print", count: files.length });
                onFiles(files);
                onClose();
              }}
            />
          )}
          {tab === "youtube" && (
            <YouTubeTab
              {...shared}
              initialUrl={initialUrl}
              onLectures={(list) => {
                track("import.playlist", { count: list.length });
                onLectures(list);
                onClose();
              }}
            />
          )}
          {tab === "drive" && <DriveTab {...shared} />}
          {tab === "zotero" && (
            <ZoteroTab
              {...shared}
              onPapers={(papers) => {
                if (papers.length) {
                  track("import.done", { source: "zotero_papers", count: papers.length });
                  onPapers(papers);
                }
              }}
              close={onClose}
            />
          )}

          {error && <p className="animate-pop mt-4 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm whitespace-pre-line text-danger">{error}</p>}
        </div>

        {busy && (
          <div className="flex items-center gap-2.5 border-t border-ink bg-paper px-6 py-3 text-sm" role="status">
            <span className="size-2 animate-pulse rounded-full bg-ink" />
            <span className="truncate">{busy}</span>
          </div>
        )}
      </div>
    </div>
  );
}

type Shared = {
  busy: string | null;
  setBusy: (s: string | null) => void;
  setError: (s: string | null) => void;
  done: (items: ImportedFile[], source: string) => void;
};

/* ------------------------------------------------------------- upload */

function UploadTab({ onFiles }: { onFiles: (files: File[]) => void }) {
  return (
    <div>
      <DropZone accept="application/pdf,.pptx,.ppt,.odp,.docx,.doc,.odt,.rtf" title="Drop files here" hint="or click to choose files. Scanned pages are read too." onFiles={onFiles} />
      <p className="mt-3 text-xs text-muted">PowerPoint and Word files are turned into PDFs through Google Drive.</p>
    </div>
  );
}

function DropZone({ accept, title, hint, onFiles }: { accept: string; title: string; hint: string; onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length) onFiles(files);
        }}
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${over ? "border-ink bg-paper" : "border-ink/30 hover:border-ink"}`}
      >
        <span className="font-serif text-xl">{title}</span>
        <span className="text-sm text-muted">{hint}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}

/* ---------------------------------------------------------------- web */

const kbdClass = "rounded border border-ink/30 bg-paper px-1.5 py-0.5 font-mono text-[11px]";

// A web page comes in as the student's own print of it. The browser draws
// the page as they see it, so diagrams, images, maths and tables come along
// (reading the page's text on the server lost every figure), and pages behind
// a login or a bot check work the same.

function WebTab({ onFiles }: { onFiles: (files: File[]) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">Print the page as a PDF, then add it here</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">Your browser keeps the page as you see it: diagrams, images, maths and tables included. Pages behind a login work too.</p>
      </div>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
        <li>Open the page and scroll to the end, so every image has loaded.</li>
        <li>
          Press <kbd className={kbdClass}>Ctrl</kbd> <kbd className={kbdClass}>P</kbd> (<kbd className={kbdClass}>⌘</kbd> <kbd className={kbdClass}>P</kbd> on a Mac). On a phone: Share, then Print.
        </li>
        <li>
          Choose <b>Save as PDF</b>. Under More settings, turn on <b>Background graphics</b> (<b>Print backgrounds</b> in Firefox and Safari) so diagrams keep their colours.
        </li>
        <li>Save it, then drop the PDF below.</li>
      </ol>
      <DropZone accept="application/pdf" title="Drop the PDF here" hint="or click to choose it." onFiles={onFiles} />
      <p className="text-xs leading-relaxed text-muted">For a cleaner PDF without menus and ads, switch to your browser&apos;s Reader view first, or use the site&apos;s own print or PDF version.</p>
    </div>
  );
}

/* ------------------------------------------------------------ youtube */

const minutes = (s: number) => (s ? `${Math.round(s / 60)} min` : "");
const isPlaylistLink = (u: string) => /[?&]list=/.test(u) && !/[?&]list=(WL|LL|RD)/.test(u);
const isVideoLink = (u: string) => /[?&]v=|youtu\.be\/|\/shorts\/|\/live\//.test(u);

function YouTubeTab({ busy, setBusy, setError, done, initialUrl, onLectures }: Shared & { initialUrl?: string; onLectures: (list: { url: string; title: string }[]) => void }) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [paste, setPaste] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [title, setTitle] = useState("");
  // A playlist: its lectures, and which to import (all, to start with).
  const [playlist, setPlaylist] = useState<{ title: string; author: string; videos: PlaylistLecture[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  async function openPlaylist(link: string) {
    setError(null);
    setBusy("Reading the playlist…");
    try {
      const p = await playlistLectures(link);
      setPlaylist(p);
      setPicked(new Set(p.videos.map((v) => v.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open that playlist.");
    } finally {
      setBusy(null);
    }
  }

  // Opened on a playlist (a goal's "Choose"): list its lectures straight away.
  useEffect(() => {
    if (initialUrl && isPlaylistLink(initialUrl)) void Promise.resolve().then(() => openPlaylist(initialUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function importLecture(withTranscript: boolean) {
    setError(null);
    try {
      const got = await lecturePdf({ url, ...(withTranscript ? { transcript, title } : {}) }, setBusy);
      done([got], withTranscript ? "youtube_pasted" : "youtube");
    } catch (err) {
      if (err instanceof TranscriptError && (err.code === "BLOCKED" || err.code === "NO_CAPTIONS")) setPaste(true);
      setError(err instanceof Error ? err.message : "Couldn't import that lecture.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!url.trim()) return;
          // A playlist link (not a video in one) lists its lectures to pick from.
          if (isPlaylistLink(url) && !isVideoLink(url)) void openPlaylist(url.trim());
          else void importLecture(false);
        }}
        className="space-y-3"
      >
        <input
          autoFocus
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setPlaylist(null);
          }}
          placeholder="A lecture (youtube.com/watch?v=…) or a playlist (…/playlist?list=…)"
          aria-label="YouTube link"
          className={`${inputClass} font-mono text-[13px]`}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs leading-relaxed text-muted">The transcript becomes a document with timestamps. Each section links back to that moment in the video.</p>
          <button className={`${buttonClass} shrink-0 py-1.5`} disabled={Boolean(busy) || !url.trim()}>
            {isPlaylistLink(url) && !isVideoLink(url) ? "Show lectures" : "Import lecture"}
          </button>
        </div>
        {isPlaylistLink(url) && isVideoLink(url) && !playlist && (
          <button type="button" onClick={() => openPlaylist(url.trim())} disabled={Boolean(busy)} className="text-xs font-medium underline-offset-4 hover:underline">
            This video is in a playlist: choose lectures from the whole playlist instead
          </button>
        )}
      </form>

      {playlist && (
        <div className="animate-enter space-y-3 rounded-xl border border-line p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{playlist.title}</p>
              <p className="text-xs text-muted">
                {[playlist.author, `${playlist.videos.length} videos`, `${picked.size} chosen`].filter(Boolean).join(" · ")}
              </p>
            </div>
            <span className="flex shrink-0 gap-3 text-xs">
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => setPicked(new Set(playlist.videos.map((v) => v.id)))}>
                All
              </button>
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => setPicked(new Set())}>
                None
              </button>
            </span>
          </div>
          <ul className="max-h-64 space-y-0.5 overflow-y-auto">
            {playlist.videos.map((v, i) => (
              <li key={v.id}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-paper">
                  <input
                    type="checkbox"
                    checked={picked.has(v.id)}
                    onChange={() =>
                      setPicked((s) => {
                        const next = new Set(s);
                        if (next.has(v.id)) next.delete(v.id);
                        else next.add(v.id);
                        return next;
                      })
                    }
                    className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]"
                  />
                  <span className="w-6 shrink-0 text-right font-mono text-[11px] text-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1 leading-snug">{v.title}</span>
                  {v.seconds > 0 && <span className="shrink-0 font-mono text-[11px] text-muted">{minutes(v.seconds)}</span>}
                </label>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">Each lecture becomes its own file. They come in one by one in Files, so you can keep working.</p>
            <button
              type="button"
              disabled={!picked.size}
              onClick={() => onLectures(playlist.videos.filter((v) => picked.has(v.id)).map((v) => ({ url: `https://www.youtube.com/watch?v=${v.id}`, title: v.title })))}
              className={`${buttonClass} shrink-0 py-1.5`}
            >
              Import {picked.size} {picked.size === 1 ? "lecture" : "lectures"}
            </button>
          </div>
        </div>
      )}

      <button type="button" onClick={() => setPaste((v) => !v)} className="text-xs font-medium underline-offset-4 hover:underline">
        {paste ? "Hide" : "Paste a transcript instead"}
      </button>
      {paste && (
        <div className="animate-enter space-y-3 rounded-xl border border-line p-3">
          <p className="text-xs leading-relaxed text-muted">
            On YouTube, open the video, click <b>…more</b> under it, then <b>Show transcript</b>. Select the whole transcript, copy it, and paste it here. Transcripts from
            other lecture sites work too.
          </p>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lecture title (optional with a YouTube link)" className={`${inputClass} py-1.5`} />
          <textarea
            rows={6}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={"0:00\nWelcome to the course…\n0:12\nToday we look at…"}
            className={`${inputClass} resize-y font-mono text-[12px]`}
          />
          <div className="flex justify-end">
            <button type="button" disabled={Boolean(busy) || !transcript.trim() || (!url.trim() && !title.trim())} onClick={() => importLecture(true)} className={`${buttonClass} py-1.5`}>
              Import transcript
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- drive */

function DriveTab(props: Shared) {
  if (!driveConfigured) {
    return (
      <div className="rounded-xl border border-dashed border-ink/30 p-5 text-sm leading-relaxed">
        <p className="font-medium">Google Drive import isn&apos;t switched on yet.</p>
        <p className="mt-1 text-muted">
          For now, download the file from Drive and upload it. Google Docs and Slides: <b>File → Download → PDF</b>.
        </p>
      </div>
    );
  }
  return <DrivePicker {...props} />;
}

function DrivePicker({ busy, setBusy, setError, done }: Shared) {
  // Load Google's sign-in and picker now: the popup has to open straight
  // from the click, with nothing left to download.
  const [ready, setReady] = useState(driveReady);
  useEffect(() => {
    let live = true;
    prepareDrive().then(
      () => live && setReady(true),
      (err: unknown) => live && setError(err instanceof Error ? err.message : "Couldn't load Google Drive."),
    );
    return () => {
      live = false;
    };
  }, [setError]);

  async function choose() {
    setError(null);
    try {
      const { files, failed } = await importFromDrive((s) => setBusy(s));
      if (failed.length) setError(`Couldn't import:\n${failed.join("\n")}`);
      done(
        files.map((f) => ({ file: f.file, title: f.title, sourceUrl: f.sourceUrl, meta: { source: "google_drive" } })),
        "google_drive",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't open Google Drive.";
      if (msg !== "CANCELLED") setError(msg);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted">
        Pick PDFs, Google Docs, Slides and Sheets, or Word and PowerPoint files. Docs and slides are turned into PDFs. Confu only gets access to the files you pick.
      </p>
      <button type="button" onClick={choose} disabled={Boolean(busy) || !ready} className={`${buttonClass} py-2`}>
        {ready ? "Choose from Google Drive" : "Loading Google Drive…"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------- zotero */

const ZOTERO_KEY = "confu:zotero-key";

function ZoteroTab({ busy, setBusy, setError, done, onPapers, close }: Shared & { onPapers: (p: PaperMeta[]) => void; close: () => void }) {
  const [key, setKey] = useState(() => {
    try {
      return localStorage.getItem(ZOTERO_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [remember, setRemember] = useState(() => Boolean(key));
  const [account, setAccount] = useState<ZoteroAccount | null>(null);
  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [collection, setCollection] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ZoteroItem[] | null>(null);
  const [filePapers, setFilePapers] = useState<PaperMeta[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);

  async function connect() {
    setError(null);
    setBusy("Connecting to Zotero…");
    try {
      const acc = await connectZotero(key);
      try {
        if (remember) localStorage.setItem(ZOTERO_KEY, acc.apiKey);
        else localStorage.removeItem(ZOTERO_KEY);
      } catch {}
      setAccount(acc);
      setCollections(await zoteroCollections(acc));
      await load(acc, "", "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect to Zotero.");
    } finally {
      setBusy(null);
    }
  }

  async function load(acc: ZoteroAccount, coll: string, query: string) {
    setBusy("Loading your library…");
    try {
      setItems(await zoteroItems(acc, { collection: coll || undefined, q: query }));
      setPicked(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your library.");
    } finally {
      setBusy(null);
    }
  }

  async function importItems() {
    if (!account || !items) return;
    const chosen = items.filter((i) => picked.has(i.key));
    const files: ImportedFile[] = [];
    const papers: PaperMeta[] = [];
    for (const [n, it] of chosen.entries()) {
      setBusy(`Getting ${n + 1} of ${chosen.length}: ${it.paper.title}`);
      const pdf = it.pdf ? await zoteroPdf(account, it) : null;
      if (pdf) files.push({ file: pdf, title: it.paper.title, sourceUrl: it.paper.url || null, meta: { ...metaFor(it.paper), source: "zotero" } });
      else papers.push(it.paper);
    }
    setBusy(null);
    onPapers(papers);
    if (files.length) done(files, "zotero_pdf");
    else close();
  }

  const list = useMemo(
    () => (filePapers ? filePapers.map((p, i) => ({ key: `f${i}`, paper: p, pdf: null as ZoteroItem["pdf"], type: "file" })) : (items ?? [])),
    [filePapers, items],
  );

  return (
    <div className="space-y-4">
      {!account && !filePapers && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
            className="space-y-3"
          >
            <p className="text-sm leading-relaxed text-muted">
              Create a read-only key at{" "}
              <a href="https://www.zotero.org/settings/keys/new" target="_blank" rel="noreferrer" className="font-medium text-ink underline underline-offset-2">
                zotero.org/settings/keys
              </a>{" "}
              : tick only <b>Allow library access</b>, and leave write access and groups off. Your key goes straight from your browser to Zotero.
            </p>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Zotero API key"
              aria-label="Zotero API key"
              autoComplete="off"
              spellCheck={false}
              className={`${inputClass} font-mono text-[13px]`}
            />
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-3.5 accent-[var(--ink)]" />
                Remember on this device
              </label>
              <button className={`${buttonClass} py-1.5`} disabled={Boolean(busy) || key.trim().length < 20}>
                Connect
              </button>
            </div>
          </form>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <div>
            <button type="button" onClick={() => fileInput.current?.click()} className={`${ghostButtonClass} py-1.5 text-xs`}>
              Import a .bib or .ris file
            </button>
            <p className="mt-1.5 text-xs text-muted">Exported from Zotero, Mendeley, EndNote or Google Scholar.</p>
            <input
              ref={fileInput}
              type="file"
              accept=".bib,.ris,.txt,application/x-bibtex,application/x-research-info-systems"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const text = await f.text();
                const papers = /^\s*TY\s{2}-/m.test(text) ? parseRis(text) : parseBibtex(text);
                if (!papers.length) return setError("No references found in that file.");
                setError(null);
                setFilePapers(papers);
                setPicked(new Set(papers.map((_, i) => `f${i}`)));
              }}
            />
          </div>
        </>
      )}

      {account && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">
            Connected as <b className="text-ink">{account.username}</b>
          </span>
          <select
            value={collection}
            onChange={(e) => {
              setCollection(e.target.value);
              void load(account, e.target.value, q);
            }}
            className="h-8 rounded-md border border-ink/30 bg-panel px-2 text-xs"
            aria-label="Collection"
          >
            <option value="">All items</option>
            {collections.map((c) => (
              <option key={c.key} value={c.key}>
                {"  ".repeat(c.depth)}
                {c.name}
              </option>
            ))}
          </select>
          <form
            className="flex min-w-40 flex-1 gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              void load(account, collection, q);
            }}
          >
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, author, year" className="h-8 min-w-0 flex-1 rounded-md border border-ink/30 bg-panel px-2 text-xs outline-none focus:border-ink" />
          </form>
        </div>
      )}

      {(account || filePapers) && (
        <>
          {list.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Nothing here.</p>
          ) : (
            <ul className="max-h-80 space-y-1.5 overflow-y-auto">
              {list.map((it) => (
                <li key={it.key}>
                  <label className={`flex cursor-pointer gap-3 rounded-lg border p-2.5 transition ${picked.has(it.key) ? "border-ink" : "border-line hover:border-ink/40"}`}>
                    <input
                      type="checkbox"
                      checked={picked.has(it.key)}
                      onChange={() =>
                        setPicked((s) => {
                          const next = new Set(s);
                          if (next.has(it.key)) next.delete(it.key);
                          else next.add(it.key);
                          return next;
                        })
                      }
                      className="mt-1 size-4 shrink-0 accent-[var(--ink)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-serif leading-snug">{it.paper.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted">
                        {[it.paper.authors.slice(0, 3).join(", ") + (it.paper.authors.length > 3 ? " et al." : ""), it.paper.venue, it.paper.year].filter(Boolean).join(" · ")}
                      </span>
                      <span className="mt-1 inline-block rounded border border-ink/30 px-1.5 py-px font-mono text-[10px] text-muted">
                        {it.pdf && account?.files ? "PDF in Zotero" : it.paper.pdf_url ? "arXiv PDF" : it.paper.abstract ? "Abstract only" : "Details only"}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setAccount(null);
                setFilePapers(null);
                setItems(null);
              }}
              className="text-xs text-muted underline-offset-4 hover:text-ink hover:underline"
            >
              {filePapers ? "Choose another file" : "Disconnect"}
            </button>
            <button
              type="button"
              disabled={Boolean(busy) || !picked.size}
              onClick={() => {
                if (filePapers) {
                  onPapers(filePapers.filter((_, i) => picked.has(`f${i}`)));
                  close();
                } else void importItems();
              }}
              className={`${buttonClass} py-1.5`}
            >
              Add {picked.size || ""} {picked.size === 1 ? "item" : "items"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- board */

function BoardTab({ busy, setBusy, setError, done }: Shared) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  async function take(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy("Reading the photo…");
    try {
      const pdf = await boardPhotoPdf(file);
      done([{ file: pdf, title: "Board", meta: { source: "board" } }], "board");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that photo.");
      setBusy(null);
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-muted">
        Snap the board. It becomes a page in this session, and Confu reads it like a scan. A photo, not a video.
      </p>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void take(e.target.files?.[0])} />
      <input ref={library} type="file" accept="image/*" className="hidden" onChange={(e) => void take(e.target.files?.[0])} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={Boolean(busy)} onClick={() => camera.current?.click()} className={buttonClass}>
          Take a photo
        </button>
        <button type="button" disabled={Boolean(busy)} onClick={() => library.current?.click()} className={ghostButtonClass}>
          Choose a photo
        </button>
      </div>
    </div>
  );
}
