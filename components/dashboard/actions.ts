"use server";

import { requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

async function storagePathsFor(supabase: Awaited<ReturnType<typeof createClient>>, documentIds: string[]) {
  if (!documentIds.length) return [];
  const [{ data: docs }, { data: figures }] = await Promise.all([
    supabase.from("documents").select("storage_path").in("id", documentIds),
    supabase.from("highlights").select("image_path").in("document_id", documentIds).not("image_path", "is", null),
  ]);
  return [...(docs ?? []).map((d) => d.storage_path as string), ...(figures ?? []).map((f) => f.image_path as string)];
}

export async function deleteSession(sessionId: string) {
  await requireUser();
  const supabase = await createClient();
  const { data: docs } = await supabase.from("documents").select("id").eq("session_id", sessionId);
  const files = await storagePathsFor(
    supabase,
    (docs ?? []).map((d) => d.id as string),
  );
  if (files.length) await supabase.storage.from("documents").remove(files);
  // Documents, plan, memory and messages cascade.
  await supabase.from("study_sessions").delete().eq("id", sessionId);
}

export async function deleteDocument(documentId: string) {
  await requireUser();
  const supabase = await createClient();
  const files = await storagePathsFor(supabase, [documentId]);
  if (files.length) await supabase.storage.from("documents").remove(files);
  await supabase.from("documents").delete().eq("id", documentId);
}
