"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ask, toast } from "@/components/dialogs";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass, labelClass } from "@/components/ui";
import { JSON_HEADERS } from "@/lib/ai-errors";
import { SITE } from "@/lib/site";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/telemetry";

type Existing = { slug: string; title: string; description: string; visibility: "public" | "unlisted"; class_mode: boolean; author_name: string | null; views: number; copies: number };

// "Share" in a session's header: publish it as a study pack others can copy.
export function SharePack({ sessionId, title }: { sessionId: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Share this session as a study pack"
        className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted transition hover:bg-paper hover:text-ink"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" />
        </svg>
        <span className="hidden sm:inline">Share</span>
      </button>
      {open && createPortal(<ShareDialog sessionId={sessionId} sessionTitle={title} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function ShareDialog({ sessionId, sessionTitle, onClose }: { sessionId: string; sessionTitle: string; onClose: () => void }) {
  const [existing, setExisting] = useState<Existing | null | undefined>(undefined);
  const [title, setTitle] = useState(sessionTitle);
  const [description, setDescription] = useState("");
  const [showName, setShowName] = useState(true);
  const [listed, setListed] = useState(false);
  const [highlights, setHighlights] = useState(true);
  const [classMode, setClassMode] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void createClient()
      .from("packs")
      .select("slug, title, description, visibility, class_mode, author_name, views, copies")
      .eq("session_id", sessionId)
      .maybeSingle()
      .then(({ data }) => {
        if (!live) return;
        const p = data as Existing | null;
        setExisting(p);
        if (p) {
          setTitle(p.title);
          setDescription(p.description);
          setListed(p.visibility === "public");
          setClassMode(p.class_mode);
          setShowName(p.author_name !== null);
        }
      });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [sessionId, onClose]);

  async function publish() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/packs/publish", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ sessionId, title, description, showName, visibility: listed ? "public" : "unlisted", classMode, includeHighlights: highlights }),
      });
      const j = (await res.json().catch(() => ({}))) as { slug?: string; error?: string; updated?: boolean };
      if (!res.ok || !j.slug) throw new Error(j.error ?? "Couldn't publish it.");
      track(j.updated ? "pack.update" : "pack.publish", { listed, classMode });
      setExisting((e) => ({
        slug: j.slug!,
        title,
        description,
        visibility: listed ? "public" : "unlisted",
        class_mode: classMode,
        author_name: showName ? "you" : null,
        views: e?.views ?? 0,
        copies: e?.copies ?? 0,
      }));
      toast(j.updated ? "Pack updated with your latest sources and plan." : "Your pack is live. Copy the link to share it.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't publish it.");
    } finally {
      setPending(false);
    }
  }

  const link = existing ? `${SITE.url}/p/${existing.slug}` : "";

  return (
    <div className="animate-fade fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-3 backdrop-blur-[2px] sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="share-title" className="animate-pop flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard">
        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <div>
            <p className={eyebrowClass}>Study pack</p>
            <h2 id="share-title" className="mt-1 font-serif text-2xl">
              {existing ? "Your pack is live" : "Share this session"}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-paper">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {existing === undefined ? (
            <div className="skeleton h-40 rounded-xl" />
          ) : (
            <>
              {existing && (
                <div className="space-y-2 rounded-xl border border-ink bg-yellow-50 p-4">
                  <code className="block truncate rounded-md border border-line bg-panel px-2.5 py-1.5 font-mono text-xs">{link}</code>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(link).then(() => toast("Link copied."))}
                      className="rounded-md border border-ink bg-ink px-3 py-1 text-xs font-medium text-white"
                    >
                      Copy link
                    </button>
                    <a href={link} target="_blank" rel="noreferrer" className={`${ghostButtonClass} px-3 py-1 text-xs`}>
                      Open ↗
                    </a>
                    {existing.class_mode && (
                      <a href={`/p/${existing.slug}/class`} className={`${ghostButtonClass} px-3 py-1 text-xs`}>
                        Class progress
                      </a>
                    )}
                    <span className="ml-auto font-mono text-[11px] text-muted">
                      {existing.views} views · {existing.copies} copies
                    </span>
                  </div>
                </div>
              )}
              <label className="block">
                <span className={labelClass}>Title</span>
                <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
              </label>
              <label className="block">
                <span className={labelClass}>What it&apos;s for</span>
                <textarea
                  rows={3}
                  value={description}
                  maxLength={2000}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Who it helps and what they'll be able to do after, e.g. 'Everything I used to pass ML in 3 weeks.'"
                  className={`${inputClass} resize-y`}
                />
              </label>
              <Toggle checked={showName} onChange={setShowName} label="Show my first name" hint="Otherwise it's shared without a name." />
              <Toggle checked={listed} onChange={setListed} label="List it in the public gallery" hint="Off: only people with the link can find it." />
              <Toggle checked={highlights} onChange={setHighlights} label="Include my highlights" hint="The passages you marked, with your notes on them." />
              <Toggle
                checked={classMode}
                onChange={setClassMode}
                label="Class mode"
                hint="People who copy it can choose to share their progress with you (topics done, days active), never their notes or chats."
              />
              <p className="rounded-lg border border-line bg-paper px-3 py-2.5 text-xs leading-relaxed text-muted">
                <span className="font-medium text-ink">What&apos;s shared:</span> your sources as links and paper IDs, your plan
                {highlights ? " and highlights" : ""}. <span className="font-medium text-ink">Never shared:</span> your conversations, pass notes,
                answers or uploaded files. People add their own copy of those.
              </p>
              {error && <p className="animate-pop rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-ink px-6 py-4">
          {existing ? (
            <button
              type="button"
              onClick={async () => {
                if (!(await ask({ title: "Unpublish this pack?", body: "The link stops working. Copies people already made stay theirs.", confirm: "Unpublish", danger: true }))) return;
                const res = await fetch(`/api/packs/publish?sessionId=${sessionId}`, { method: "DELETE" });
                if (!res.ok) return toast("Couldn't unpublish it. Try again.", "error");
                setExisting(null);
                toast("Unpublished.");
              }}
              className="text-xs text-muted underline-offset-2 hover:text-danger hover:underline"
            >
              Unpublish
            </button>
          ) : (
            <span />
          )}
          <button type="button" onClick={publish} disabled={pending || existing === undefined || !title.trim()} className={`${buttonClass} py-2`}>
            {pending ? "Publishing…" : existing ? "Update pack" : "Publish pack"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs leading-relaxed text-muted">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border border-ink transition-colors ${checked ? "bg-ink" : "bg-panel"}`}
      >
        <span className={`absolute top-0.5 left-0.5 size-[18px] rounded-full transition-transform duration-200 ${checked ? "translate-x-5 bg-yellow-400" : "bg-ink/70"}`} />
      </button>
    </label>
  );
}
