"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui";
import { titleFromFile, uploadPdfToSession, validatePdf } from "@/lib/pdf/upload";
import { createClient } from "@/lib/supabase/client";
import type { SessionKind } from "@/lib/types";

const KINDS: { kind: SessionKind; title: string; body: string }[] = [
  { kind: "study", title: "Study session", body: "Learn toward a goal with a phased plan and a tutor." },
  { kind: "exam", title: "Exam prep", body: "Upload your college notes, practise exam questions, find weak topics." },
  { kind: "paper", title: "Paper session", body: "Read research papers with the three-pass method." },
];

// Creates a study session from one or more PDFs.
export function NewSessionButton() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const kindRef = useRef<SessionKind>("study");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function createPaperSession() {
    setError(null);
    setStatus("Creating session…");
    const { data: session, error: sessionError } = await createClient()
      .from("study_sessions")
      .insert({ title: "Untitled paper session", kind: "paper" })
      .select("id")
      .single();
    if (sessionError || !session) {
      setStatus(null);
      return setError(sessionError?.message ?? "Couldn't create the session.");
    }
    router.push(`/session/${session.id}`);
  }

  async function handle(files: File[]) {
    setError(null);
    const invalid = files.map(validatePdf).find(Boolean);
    if (invalid) return setError(invalid);

    const supabase = createClient();
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Your session expired. Sign in again.");

      setStatus("Creating session…");
      const first = titleFromFile(files[0]);
      const title = (files.length > 1 ? `${first} + ${files.length - 1} more` : first).slice(0, 200);
      const { data: session, error: sessionError } = await supabase
        .from("study_sessions")
        .insert({ title, kind: kindRef.current })
        .select("id")
        .single();
      if (sessionError || !session) throw sessionError ?? new Error("Could not create a session");

      const scanned: string[] = [];
      for (const [position, file] of files.entries()) {
        const { lowText } = await uploadPdfToSession(supabase, { userId: auth.user.id, sessionId: session.id, file, position, onStatus: setStatus });
        if (lowText) scanned.push(file.name);
      }
      if (scanned.length) {
        alert(`These PDFs have very little selectable text (they may be scanned): ${scanned.join(", ")}. Use “Capture region” on their pages so the tutor can read them.`);
      }
      router.push(`/session/${session.id}`);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Upload failed.");
    }
  }

  return (
    <div ref={menuRef} className="relative flex flex-col items-end gap-1.5">
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void handle(files);
        }}
      />
      <button
        className={`${buttonClass} py-2.5`}
        disabled={Boolean(status)}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {status ?? "+ New session"}
      </button>
      {menuOpen && (
        <div className="animate-pop absolute top-full right-0 z-30 mt-2 w-72 rounded-xl border border-ink bg-panel p-1.5 shadow-hard">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              onClick={() => {
                kindRef.current = k.kind;
                setMenuOpen(false);
                // Papers are added inside the session by arXiv ID / DOI, so no file picker.
                if (k.kind === "paper") void createPaperSession();
                else input.current?.click();
              }}
              className="block w-full rounded-lg px-3 py-2.5 text-left transition hover:bg-paper"
            >
              <span className="block text-sm font-medium">{k.title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted">{k.body}</span>
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted">{status ? "Keep this tab open" : "Study or papers · one or more PDFs"}</p>
      {error && <p className="animate-pop text-sm text-danger">{error}</p>}
    </div>
  );
}
