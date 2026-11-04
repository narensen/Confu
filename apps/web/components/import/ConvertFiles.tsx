"use client";

import { useEffect, useState } from "react";
import { buttonClass, eyebrowClass, ghostButtonClass } from "@/components/ui";
import { convertWithGoogle, driveConfigured, driveReady, prepareDrive } from "@/lib/import/drive";
import { POWERPOINT_HELP, PPT_CONVERTER_URL } from "@/lib/pdf/office";
import { track } from "@/lib/telemetry";

// Slides and Word files picked for upload: turn them into PDFs through the
// student's Google Drive, with one click (Google's sign-in has to open from a
// click, which picking a file doesn't reliably count as).
export function ConvertFiles({ files, onDone, onClose }: { files: File[]; onDone: (pdfs: File[]) => void; onClose: () => void }) {
  const [ready, setReady] = useState(driveReady);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!driveConfigured) return;
    let live = true;
    prepareDrive().then(
      () => live && setReady(true),
      (err: unknown) => live && setError(err instanceof Error ? err.message : "Couldn't load Google."),
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !status && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, status]);

  async function convert() {
    setError(null);
    try {
      const { pdfs, failed } = await convertWithGoogle(files, setStatus);
      track("import.converted", { count: pdfs.length, failed: failed.length });
      if (pdfs.length) onDone(pdfs);
      if (failed.length) setError(`Couldn't convert:\n${failed.join("\n")}`);
      else onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't convert.";
      if (msg !== "CANCELLED") setError(msg);
    } finally {
      setStatus(null);
    }
  }

  const slides = files.every((f) => /\.(pptx?|odp|key)$/i.test(f.name));

  return (
    <div
      className="animate-fade fixed inset-0 z-[65] flex items-center justify-center bg-scrim p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && !status && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="convert-title" className="animate-pop w-full max-w-md rounded-2xl border border-ink bg-panel p-6 shadow-hard">
        <p className={eyebrowClass}>{slides ? "Slides" : "Documents"} to PDF</p>
        <h2 id="convert-title" className="mt-1 font-serif text-2xl leading-snug">
          Turn {files.length === 1 ? "this file" : `these ${files.length} files`} into {files.length === 1 ? "a PDF" : "PDFs"}
        </h2>
        <ul className="mt-3 space-y-1 text-sm">
          {files.map((f) => (
            <li key={f.name + f.size} className="flex items-center gap-2">
              <span className="shrink-0 rounded border border-ink/30 px-1 font-mono text-[10px] text-muted uppercase">{f.name.split(".").pop()}</span>
              <span className="min-w-0 truncate">{f.name}</span>
            </li>
          ))}
        </ul>

        {driveConfigured ? (
          <>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Google converts {files.length === 1 ? "it" : "them"} in your Drive; the temporary copy is deleted straight after. Confu only gets access to files it creates.
            </p>
            {status && (
              <div role="status" className="mt-3 flex items-center gap-3 rounded-lg border border-line bg-paper px-3 py-2 text-xs">
                <div className="indeterminate h-[3px] w-12 shrink-0 rounded-full bg-line" />
                <span className="min-w-0 truncate text-muted">{status}</span>
              </div>
            )}
            {error && <p className="animate-pop mt-3 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm whitespace-pre-line text-danger">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={Boolean(status)} className={`${ghostButtonClass} py-1.5`}>
                Cancel
              </button>
              <button type="button" onClick={convert} disabled={!ready || Boolean(status)} className={`${buttonClass} py-1.5`}>
                {ready ? "Convert with Google Drive" : "Loading Google…"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm leading-relaxed text-muted">{POWERPOINT_HELP}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={onClose} className={`${ghostButtonClass} py-1.5`}>
                Close
              </button>
              <a href={PPT_CONVERTER_URL} target="_blank" rel="noreferrer" className={`${buttonClass} py-1.5`}>
                Free converter ↗
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
