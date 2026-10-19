"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { buttonClass } from "@/components/ui";
import { titleFromFile, uploadPdfToSession, validatePdf } from "@/lib/pdf/upload";
import { createClient } from "@/lib/supabase/client";

// Creates a study session from one or more PDFs.
export function NewSessionButton() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const { data: session, error: sessionError } = await supabase.from("study_sessions").insert({ title }).select("id").single();
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
    <div className="flex flex-col items-end gap-1.5">
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
      <button className={`${buttonClass} py-2.5`} disabled={Boolean(status)} onClick={() => input.current?.click()}>
        {status ?? "+ New session"}
      </button>
      <p className="text-xs text-muted">{status ? "Keep this tab open" : "Choose one or more PDFs"}</p>
      {error && <p className="animate-pop text-sm text-danger">{error}</p>}
    </div>
  );
}
