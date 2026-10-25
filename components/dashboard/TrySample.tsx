"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/dialogs";
import { buildPdfFile } from "@/lib/import/build-pdf";
import { SAMPLE, SAMPLE_TITLE } from "@/lib/import/sample";
import { uploadPdfToSession } from "@/lib/pdf/upload";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/telemetry";

// "Try a sample session": a study session with Confu's short guide to the
// science of learning already in it, so new students can try highlighting,
// asking, planning and reviewing before uploading their own material.
export function TrySample() {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);

  async function start() {
    if (status) return;
    setStatus("Setting up the sample…");
    const supabase = createClient();
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Your session expired. Sign in again.");
      const { data: session, error } = await supabase
        .from("study_sessions")
        .insert({ title: `Sample: ${SAMPLE_TITLE}`, kind: "study" })
        .select("id")
        .single();
      if (error || !session) throw error ?? new Error("Couldn't create the sample.");
      const file = await buildPdfFile(SAMPLE);
      await uploadPdfToSession(supabase, {
        userId: auth.user.id,
        sessionId: session.id,
        file,
        position: 0,
        onStatus: () => setStatus("Preparing the guide…"),
        title: SAMPLE.title,
        meta: { source: "sample" },
      });
      track("sample.start");
      router.refresh();
      router.push(`/session/${session.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't start the sample.", "error");
      setStatus(null);
    }
  }

  return (
    <div className="mt-6 flex flex-col items-start gap-3 rounded-2xl border border-dashed border-ink/40 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-serif text-xl">Not sure where to begin?</p>
        <p className="mt-1 text-sm text-muted">Try a sample session: a short guide to the science of learning, ready to highlight, ask about, plan and review.</p>
      </div>
      <button
        type="button"
        onClick={start}
        disabled={Boolean(status)}
        className="shrink-0 rounded-lg border border-ink bg-panel px-4 py-2 text-sm font-medium transition hover:-translate-y-px hover:shadow-[2px_2px_0_0_#facc15] disabled:opacity-60"
      >
        {status ?? "Try a sample session"}
      </button>
    </div>
  );
}
