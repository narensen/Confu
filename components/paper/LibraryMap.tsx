"use client";

import { useRouter } from "next/navigation";
import { toast } from "@/components/dialogs";
import { addPaperFromMeta, type PaperMeta } from "@/lib/pdf/add-paper";
import { createClient } from "@/lib/supabase/client";
import { LiteratureMap } from "./LiteratureMap";

// The personal literature map, as a page: papers open in their session, and
// papers found on the map are added to the session the student picks.
export function LibraryMap() {
  const router = useRouter();

  async function add(paper: PaperMeta, sessionId?: string) {
    if (!sessionId) throw new Error("Pick a session to add it to.");
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new Error("Your session expired. Sign in again.");
    const [{ data: last }, { data: target }] = await Promise.all([
      supabase.from("documents").select("position").eq("session_id", sessionId).order("position", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("study_sessions").select("kind, title").eq("id", sessionId).single(),
    ]);
    const res = await addPaperFromMeta(supabase, { userId: auth.user.id, sessionId, position: (last?.position ?? -1) + 1, paper, onStatus: () => {} });
    // In a study session it's read as a paper, with the three passes.
    if (target?.kind === "study") await supabase.from("paper_reviews").upsert({ document_id: res.id, session_id: sessionId }, { onConflict: "document_id" });
    toast(`Added to “${target?.title ?? "your session"}”${res.hasPdf ? "" : " (abstract only: no open PDF)"}.`);
  }

  return <LiteratureMap scope={{ kind: "library" }} onOpenDoc={(doc, session) => session && router.push(`/session/${session}?doc=${doc}`)} onAdd={add} />;
}
