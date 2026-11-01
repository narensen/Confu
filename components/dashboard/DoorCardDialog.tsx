"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";
import { JSON_HEADERS } from "@/lib/ai-errors";
import { SITE } from "@/lib/site";

type Kind = "paper" | "web" | "youtube" | "sample";
type License = "cc" | "open" | "link";
type Item = { title: string; url: string; kind: Kind; license: License };

const empty = (): Item => ({ title: "", url: "", kind: "web", license: "open" });

export function DoorCardLauncher() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${ghostButtonClass} py-2.5`}>
        Door card
      </button>
      {open && createPortal(<Dialog onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function Dialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"study" | "exam" | "paper">("study");
  const [items, setItems] = useState<Item[]>([empty(), empty(), empty()]);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    const kept = items.map((item) => ({ ...item, title: item.title.trim(), url: item.url.trim() })).filter((item) => item.title && item.url);
    if (!title.trim() || !kept.length) return setError("Add a title and at least one link.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/noticeboard", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ title: title.trim(), kind, items: kept }) });
      const json = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!res.ok || !json.code) throw new Error(json.error ?? "Couldn't make the card.");
      setCode(json.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make the card.");
    } finally {
      setBusy(false);
    }
  }

  async function plan() {
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/noticeboard", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ code, plan: true }) });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Couldn't write a plan.");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't write a plan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-3" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-ink bg-panel p-6">
        <p className={eyebrowClass}>Door card</p>
        <h2 className="mt-1 font-serif text-2xl">A reading list for the door</h2>
        <p className="mt-2 text-sm text-muted">Links only. A file doesn&apos;t go on the card, and Confu doesn&apos;t fetch NCERT.</p>
        {code ? (
          <div className="mt-4 space-y-3">
            <code className="block truncate rounded-md border border-line bg-paper px-2 py-1 font-mono text-xs">
              {SITE.url}/b/{code}
            </code>
            <button type="button" disabled={busy} onClick={() => void plan()} className={`${ghostButtonClass} py-1.5 text-xs`}>
              {busy ? "Writing…" : "Write a plan from these titles"}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={inputClass} />
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={inputClass}>
              <option value="study">Study</option>
              <option value="exam">Exam</option>
              <option value="paper">Paper</option>
            </select>
            {items.map((item, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <input value={item.title} maxLength={200} onChange={(e) => setItems((cur) => cur.map((c, j) => (j === i ? { ...c, title: e.target.value } : c)))} placeholder="Title" className={`${inputClass} py-1.5 text-sm`} />
                <input value={item.url} maxLength={2000} onChange={(e) => setItems((cur) => cur.map((c, j) => (j === i ? { ...c, url: e.target.value } : c)))} placeholder="https://" className={`${inputClass} py-1.5 text-sm`} />
                <select value={item.kind} onChange={(e) => setItems((cur) => cur.map((c, j) => (j === i ? { ...c, kind: e.target.value as Kind } : c)))} className={`${inputClass} py-1.5 text-sm`}>
                  <option value="web">Web page</option>
                  <option value="paper">Paper</option>
                  <option value="youtube">Lecture</option>
                  <option value="sample">Sample</option>
                </select>
                <select value={item.license} onChange={(e) => setItems((cur) => cur.map((c, j) => (j === i ? { ...c, license: e.target.value as License } : c)))} className={`${inputClass} py-1.5 text-sm`}>
                  <option value="open">Open</option>
                  <option value="cc">CC</option>
                  <option value="link">Link, don&apos;t fetch</option>
                </select>
              </div>
            ))}
            {items.length < 12 && (
              <button type="button" onClick={() => setItems((cur) => [...cur, empty()])} className={`${ghostButtonClass} py-1 text-xs`}>
                Add a link
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => void create()} className={`${buttonClass} w-full py-2`}>
              {busy ? "Making…" : "Make the card"}
            </button>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <button type="button" onClick={onClose} className={`${ghostButtonClass} mt-4 py-1 text-xs`}>
          Close
        </button>
      </div>
    </div>
  );
}

export function CopyDoorCard({ code }: { code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function copy() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/noticeboard/copy", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ code }) });
      const json = (await res.json().catch(() => ({}))) as { sessionId?: string; error?: string };
      if (res.status === 401) {
        router.push(`/login?next=/b/${code}`);
        return;
      }
      if (!res.ok || !json.sessionId) throw new Error(json.error ?? "Couldn't start a session.");
      router.push(`/session/${json.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a session.");
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" disabled={busy} onClick={() => void copy()} className={`${buttonClass} py-2`}>
        {busy ? "Starting…" : "Start a session from this list"}
      </button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
