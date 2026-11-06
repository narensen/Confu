"use client";

import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass, labelClass } from "@/components/ui";
import { isPowerPoint, PPT_CONVERTER_URL } from "@/lib/pdf/office";
import { needsConversion } from "@/lib/import/drive";
import { ConvertFiles } from "@/components/import/ConvertFiles";
import { handOffPdfs } from "@/lib/pdf/handoff";
import { validatePdf } from "@/lib/pdf/upload";
import { createClient } from "@/lib/supabase/client";
import type { SessionKind } from "@confu/core/types";

gsap.registerPlugin(useGSAP);

const OPEN_EVENT = "confu:new-session";

// Open the dialog from anywhere, optionally on a given session type.
export function openNewSession(kind?: SessionKind) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { kind } }));
}

export const KINDS: { kind: SessionKind; name: string; body: string; example: string; icon: React.ReactNode }[] = [
  {
    kind: "study",
    name: "Study",
    body: "Learn toward a goal with a phased plan, across your files and beyond.",
    example: "e.g. Linear algebra for machine learning",
    icon: <path d="M4 19V5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2Zm0 0a2 2 0 0 0 2 2h12M9 7h6" />,
  },
  {
    kind: "exam",
    name: "Exam prep",
    body: "Practise exam-style questions from your notes and find your weak topics.",
    example: "e.g. Operating Systems midterm",
    icon: <path d="M9 11l2 2 4-4M7 3h10l3 3v15H4V3h3Zm0 0v3h10V3" />,
  },
  {
    kind: "paper",
    name: "Papers",
    body: "Read research papers in three passes. Add them by arXiv ID or DOI.",
    example: "e.g. RL fine-tuning for LLM reasoning",
    icon: <path d="M6 2h9l5 5v15H6zM14 2v6h6M9 13h7M9 17h5" />,
  },
];

export function NewSessionLauncher({ className, label = "+ New session" }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<SessionKind | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      setKind((e as CustomEvent<{ kind?: SessionKind }>).detail?.kind ?? null);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setKind(null);
          setOpen(true);
        }}
        className={className ?? `${buttonClass} py-2.5`}
      >
        {label}
      </button>
      {open && createPortal(<NewSessionDialog initialKind={kind} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function NewSessionDialog({ initialKind, onClose }: { initialKind: SessionKind | null; onClose: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<SessionKind | null>(initialKind);
  const [title, setTitle] = useState("");
  const [examDate, setExamDate] = useState("");
  const [question, setQuestion] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pptPicked, setPptPicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const step = kind ? 2 : 1;
  const meta = KINDS.find((k) => k.kind === kind);

  const close = useCallback(() => {
    if (busy) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !panel.current) return onClose();
    gsap.to(panel.current, { y: 16, scale: 0.98, autoAlpha: 0, duration: 0.2, ease: "power2.in" });
    gsap.to(root.current, { autoAlpha: 0, duration: 0.22, onComplete: onClose });
  }, [busy, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [close]);

  // Entrance, and a slide between steps.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(root.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 });
        gsap.fromTo(panel.current, { y: 28, scale: 0.97, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.5, ease: "power3.out" });
      });
    },
    { scope: root },
  );
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo("[data-step]", { x: step === 2 ? 40 : -40, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.45, ease: "power3.out" });
        if (step === 1) {
          gsap.fromTo("[data-kind-card]", { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, ease: "power3.out", stagger: 0.06, clearProps: "all" });
        }
      });
      if (step === 2) window.setTimeout(() => titleInput.current?.focus(), 60);
    },
    { scope: root, dependencies: [step] },
  );

  // Slides and Word files go through Google first; the PDFs come back to this list.
  const [converting, setConverting] = useState<File[] | null>(null);
  function addFiles(list: FileList | File[] | null) {
    const all = Array.from(list ?? []);
    const office = all.filter(needsConversion);
    if (office.length) setConverting(office);
    const picked = all.filter((f) => !needsConversion(f));
    const bad = picked.map(validatePdf).find(Boolean);
    setPptPicked(picked.some(isPowerPoint));
    if (bad) return setError(bad);
    setError(null);
    setFiles((cur) => [...cur, ...picked.filter((f) => !cur.some((c) => c.name === f.name && c.size === f.size))]);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const name = title.replace(/\s+/g, " ").trim();
    if (!kind) return;
    if (!name) return setError("Give your session a title.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Your session expired. Sign in again.");
      const row = {
        title: name.slice(0, 200),
        kind,
        ...(kind === "exam" && examDate ? { exam_date: examDate } : {}),
        ...(kind === "paper" && question.trim() ? { research_goal: question.trim().slice(0, 4000) } : {}),
        ...(kind === "paper" ? { cite_mode: true } : {}),
      };
      let inserted = await supabase.from("study_sessions").insert(row).select("id").single();
      if (inserted.error && kind === "paper" && inserted.error.code === "42703" && /cite_mode/i.test(inserted.error.message)) {
        const { cite_mode: _cite, ...base } = row;
        void _cite;
        inserted = await supabase.from("study_sessions").insert(base).select("id").single();
      }
      const { data: session, error: insertError } = inserted;
      if (insertError || !session) throw insertError ?? new Error("Couldn't create the session.");

      // The session uploads them itself, so the goal can be written meanwhile.
      handOffPdfs(session.id, files);
      // The dashboard stays mounted (hidden) while the session is open, so
      // close the dialog now, or it's still there, "Creating…", on the way back.
      // Refresh first so the library lists the new session when you return.
      router.refresh();
      router.push(`/session/${session.id}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the session.");
      setBusy(false);
    }
  }

  return (
    <div
      ref={root}
      className="fixed inset-0 z-60 flex items-center justify-center bg-scrim p-3 sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-session-title"
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard"
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink px-6 pt-5 pb-4">
          <div>
            <p className={eyebrowClass}>New session · step {step} of 2</p>
            <h2 id="new-session-title" className="mt-1 font-serif text-2xl">
              {step === 1 ? "What are you here to do?" : `New ${meta!.name.toLowerCase()} session`}
            </h2>
          </div>
          <button onClick={close} aria-label="Close" disabled={busy} className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-paper disabled:opacity-40">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {step === 1 ? (
            <div data-step className="grid gap-3 sm:grid-cols-3">
              {KINDS.map((k) => (
                <button
                  key={k.kind}
                  data-kind-card
                  type="button"
                  onClick={() => setKind(k.kind)}
                  className="group flex flex-col rounded-xl border border-ink/30 p-4 text-left transition duration-200 ease-fluid hover:border-ink"
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    {k.icon}
                  </svg>
                  <span className="mt-3 font-serif text-xl">{k.name}</span>
                  <span className="mt-1 text-sm leading-relaxed text-muted">{k.body}</span>
                </button>
              ))}
            </div>
          ) : (
            <form id="new-session-form" data-step onSubmit={create} className="space-y-5">
              <label className="block">
                <span className={labelClass}>Title</span>
                <input
                  ref={titleInput}
                  required
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={meta!.example}
                  disabled={busy}
                  className={inputClass}
                />
                <span className="mt-1 block text-xs text-muted">You can rename it any time.</span>
              </label>

              {kind === "exam" && (
                <label className="block">
                  <span className={labelClass}>
                    Exam date <span className="font-normal text-muted">(optional)</span>
                  </span>
                  <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} disabled={busy} className={`${inputClass} max-w-56`} />
                </label>
              )}

              {kind === "paper" ? (
                <label className="block">
                  <span className={labelClass}>
                    What are you researching? <span className="font-normal text-muted">(optional)</span>
                  </span>
                  <textarea
                    rows={3}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    disabled={busy}
                    placeholder="Used to decide which papers deserve a deep read. You can add or change it later."
                    className={`${inputClass} resize-y`}
                  />
                  <span className="mt-1 block text-xs text-muted">You&apos;ll add papers by arXiv ID, DOI or title inside the session.</span>
                </label>
              ) : (
                <div>
                  <span className={labelClass}>
                    Files <span className="font-normal text-muted">(optional: PDFs, slides or Word docs; add web pages, YouTube lectures, Google Drive or Zotero inside the session)</span>
                  </span>
                  <input ref={fileInput} type="file" accept="application/pdf,.pptx,.ppt,.odp,.docx,.doc,.odt,.rtf" multiple className="hidden" onChange={(e) => {
                      addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      addFiles(e.dataTransfer.files);
                    }}
                    className="rounded-lg border border-dashed border-ink/40 bg-paper p-4 text-center"
                  >
                    {files.length > 0 && (
                      <ul className="mb-3 space-y-1 text-left text-sm">
                        {files.map((f) => (
                          <li key={f.name + f.size} className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-muted">PDF</span>
                            <span className="min-w-0 flex-1 truncate">{f.name}</span>
                            <button type="button" onClick={() => setFiles((cur) => cur.filter((c) => c !== f))} className="text-xs text-muted hover:text-danger">
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button type="button" onClick={() => fileInput.current?.click()} className={`${ghostButtonClass} py-1.5 text-xs`}>
                      {files.length ? "Add more files" : "Choose files"}
                    </button>
                    <p className="mt-2 text-xs text-muted">or drop them here · up to 50 MB each. They upload in the session while you write your goal.</p>
                  </div>
                </div>
              )}

              {error && (
                <div className="animate-pop rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
                  <p>{error}</p>
                  {pptPicked && (
                    <a href={PPT_CONVERTER_URL} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded-md border border-danger/50 bg-panel px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger hover:text-white">
                      Open the free converter ↗
                    </a>
                  )}
                </div>
              )}
            </form>
          )}
        </div>

        {step === 2 && (
          <div className="flex items-center justify-between gap-3 border-t border-ink px-6 py-4">
            <button type="button" onClick={() => setKind(null)} disabled={busy} className={`${ghostButtonClass} py-1.5`}>
              Back
            </button>
            <button form="new-session-form" disabled={busy || !title.trim()} className={`${buttonClass} py-2`}>
              {busy ? "Creating…" : "Create session"}
            </button>
          </div>
        )}
      </div>
      {converting && (
        <ConvertFiles
          files={converting}
          onDone={(pdfs) => setFiles((cur) => [...cur, ...pdfs.filter((f) => !cur.some((c) => c.name === f.name && c.size === f.size))])}
          onClose={() => setConverting(null)}
        />
      )}
    </div>
  );
}
