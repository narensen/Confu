"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/components/dialogs";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";
import { JSON_HEADERS } from "@/lib/ai-errors";
import { SITE } from "@/lib/site";
import { track } from "@/lib/telemetry";

// A reading list (stored as a "noticeboard", migration 0034; once called a
// door card): a title and up to 12 links, shared as a short link or printed
// for a noticeboard. Anyone who opens it can start a session from it.

type Kind = "paper" | "web" | "youtube" | "sample";
type License = "cc" | "open" | "link";
type Item = { title: string; url: string; kind: Kind; fetch: boolean; kindSet: boolean };

const empty = (): Item => ({ title: "", url: "", kind: "web", fetch: true, kindSet: false });

const KIND_LABEL: Record<Kind, string> = { web: "Web page", paper: "Paper", youtube: "Lecture", sample: "Sample" };

// What a link is, from its address.
function guessKind(url: string): Kind {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/arxiv\.org|doi\.org|\/doi\/|semanticscholar|openreview|acm\.org|ieee|springer|sciencedirect|nature\.com|\.pdf($|\?)/i.test(url)) return "paper";
  return "web";
}

// A title to start from: the page's address, tidied.
function guessTitle(url: string) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "")
      .replace(/\.(pdf|html?)$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    return (last && !/^[0-9a-z]{8,}$/i.test(last) ? last : u.hostname.replace(/^www\./, "")).slice(0, 200);
  } catch {
    return "";
  }
}

export function DoorCardLauncher() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${ghostButtonClass} py-2.5`} title="Share a list of links that anyone can start a session from">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
        Reading list
      </button>
      {open && createPortal(<Dialog onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function Dialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"study" | "exam" | "paper">("study");
  const [items, setItems] = useState<Item[]>([empty(), empty()]);
  const [code, setCode] = useState<string | null>(null);
  const [planned, setPlanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (i: number, next: Partial<Item>) => setItems((cur) => cur.map((c, j) => (j === i ? { ...c, ...next } : c)));

  async function create() {
    const kept = items
      .map((item) => ({ title: item.title.trim() || guessTitle(item.url.trim()), url: item.url.trim(), kind: item.kind, license: (item.fetch ? "open" : "link") as License }))
      .filter((item) => item.url);
    if (!title.trim()) return setError("Give the list a title.");
    if (!kept.length) return setError("Add at least one link.");
    if (kept.some((item) => !/^https?:\/\//i.test(item.url))) return setError("Each link should start with http:// or https://.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/noticeboard", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ title: title.trim(), kind, items: kept }) });
      const json = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!res.ok || !json.code) throw new Error(json.error ?? "Couldn't make the list.");
      track("reading_list.create", { items: kept.length });
      setCode(json.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make the list.");
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
      setPlanned(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't write a plan.");
    } finally {
      setBusy(false);
    }
  }

  const url = code ? `${SITE.url}/b/${code}` : "";

  return (
    <div className="animate-fade fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-scrim p-3 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="reading-list-title" className="animate-pop my-6 w-full max-w-2xl overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard">
        <div className="flex items-start justify-between gap-4 border-b border-ink px-6 pt-5 pb-4">
          <div>
            <p className={eyebrowClass}>Reading list</p>
            <h2 id="reading-list-title" className="mt-1 font-serif text-2xl">
              {code ? "Your list is ready to share" : "Share a reading list"}
            </h2>
            {!code && (
              <p className="mt-1 max-w-lg text-sm text-muted">
                Paste the links for a week of reading. Share the link in the group chat, or print one page for a classroom door. Anyone who opens it starts a session from the list. No files are uploaded.
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-paper">
            ✕
          </button>
        </div>

        {code ? (
          <div className="space-y-5 px-6 py-5">
            <div className="rounded-xl border border-ink bg-yellow-100 p-4">
              <p className="text-sm text-muted">Anyone with this link sees the list and can start a session from it in one click:</p>
              <p className="mt-2 truncate font-mono text-sm font-medium">{url}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => navigator.clipboard.writeText(url).then(() => toast("Link copied."))} className={`${buttonClass} py-1.5`}>
                  Copy link
                </button>
                <a href={`/b/${code}`} target="_blank" rel="noreferrer" className={`${ghostButtonClass} py-1.5`}>
                  Open it
                </a>
                <a href={`/b/${code}`} target="_blank" rel="noreferrer" className={`${ghostButtonClass} py-1.5`} title="Open it, then Print: a one-page card for a noticeboard or a door">
                  Print a card
                </a>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
              <div className="min-w-0 max-w-sm">
                <p className="text-sm font-medium">{planned ? "Plan added" : "Add a study plan (optional)"}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {planned ? "People who start a session from the list get these topics, in order." : "Confu orders the links into topics, so a session from the list starts with a plan. Uses one AI prompt."}
                </p>
              </div>
              {!planned && (
                <button type="button" disabled={busy} onClick={() => void plan()} className={`${ghostButtonClass} py-1.5 text-xs`}>
                  {busy ? "Writing…" : "Write a plan"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-5 px-6 py-5">
            <ol className="grid gap-2 text-xs text-muted sm:grid-cols-3">
              {["Paste the links: papers, lectures, pages.", "Share the link, or print it for a noticeboard.", "Whoever opens it starts a session with all of it."].map((step, i) => (
                <li key={step} className="flex gap-2 rounded-lg bg-paper px-3 py-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-ink font-mono text-[10px] text-ink">{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Title</span>
                <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Week 4: Electric potential" className={inputClass} />
              </label>
              <div>
                <span className="mb-1.5 block text-sm font-medium">Starts a</span>
                <div className="flex rounded-lg border border-ink/25 p-0.5">
                  {(["study", "exam", "paper"] as const).map((k) => (
                    <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${kind === k ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>
                      {k === "paper" ? "Papers" : k === "exam" ? "Exam prep" : "Study"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <span className="mb-1.5 block text-sm font-medium">Links</span>
              <ul className="space-y-2">
                {items.map((item, i) => (
                  <li key={i} className="rounded-xl border border-line p-2.5">
                    <div className="flex gap-2">
                      <input
                        value={item.url}
                        maxLength={2000}
                        onChange={(e) => {
                          const next = e.target.value;
                          patch(i, { url: next, ...(item.kindSet ? {} : { kind: guessKind(next) }) });
                        }}
                        placeholder="https://"
                        aria-label={`Link ${i + 1}`}
                        className={`${inputClass} py-1.5 font-mono text-xs`}
                      />
                      {items.length > 1 && (
                        <button type="button" onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))} aria-label={`Remove link ${i + 1}`} className="shrink-0 rounded-md px-2 text-muted hover:bg-paper hover:text-ink">
                          ✕
                        </button>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        value={item.title}
                        maxLength={200}
                        onChange={(e) => patch(i, { title: e.target.value })}
                        placeholder={guessTitle(item.url) || "Title"}
                        aria-label={`Title of link ${i + 1}`}
                        className={`${inputClass} min-w-40 flex-1 py-1.5 text-sm`}
                      />
                      <select value={item.kind} onChange={(e) => patch(i, { kind: e.target.value as Kind, kindSet: true })} aria-label="What it is" className="rounded-lg border border-ink/25 bg-panel px-2 py-1.5 text-xs">
                        {(["web", "paper", "youtube"] as const).map((k) => (
                          <option key={k} value={k}>
                            {KIND_LABEL[k]}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1.5 text-xs text-muted" title="Off: the session keeps the link, and doesn't download it (for pages behind a login, or that you'd rather not copy).">
                        <input type="checkbox" checked={item.fetch} onChange={(e) => patch(i, { fetch: e.target.checked })} className="accent-[var(--ink)]" />
                        Download into the session
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
              {items.length < 12 && (
                <button type="button" onClick={() => setItems((cur) => [...cur, empty()])} className="mt-2 text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline">
                  + Add a link
                </button>
              )}
            </div>
          </div>
        )}

        {error && <p className="px-6 pb-3 text-sm text-danger">{error}</p>}
        <div className="flex items-center justify-between gap-3 border-t border-line bg-paper px-6 py-3.5">
          <p className="text-xs text-muted">Links only: no files are uploaded.</p>
          {code ? (
            <button type="button" onClick={onClose} className={buttonClass}>
              Done
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void create()} className={buttonClass}>
              {busy ? "Making…" : "Make the list"}
            </button>
          )}
        </div>
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
      track("reading_list.copy");
      router.push(`/session/${json.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a session.");
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" disabled={busy} onClick={() => void copy()} className={`${buttonClass} py-2.5`}>
        {busy ? "Starting…" : "Start a session from this list →"}
      </button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
