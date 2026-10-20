"use server";

import { requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

async function storagePathsFor(supabase: Awaited<ReturnType<typeof createClient>>, documentIds: string[]) {
  if (!documentIds.length) return [];
  const [{ data: docs }, { data: figures }] = await Promise.all([
    supabase.from("documents").select("storage_path").in("id", documentIds),
    supabase.from("highlights").select("image_path").in("document_id", documentIds).not("image_path", "is", null),
  ]);
  // Papers added by arXiv ID / DOI may have no stored PDF.
  return [...(docs ?? []).map((d) => d.storage_path as string | null), ...(figures ?? []).map((f) => f.image_path as string)].filter(
    (p): p is string => Boolean(p),
  );
}

// Files go first, and a failure stops the delete: removing the rows would
// leave the files behind with nothing pointing at them.
const FILES_FAILED = "Couldn't delete the stored files, so nothing was deleted. Try again.";

async function removeFiles(supabase: Awaited<ReturnType<typeof createClient>>, files: string[]): Promise<boolean> {
  if (!files.length) return true;
  const { error } = await supabase.storage.from("documents").remove(files);
  return !error;
}

export async function deleteSession(sessionId: string): Promise<{ error?: string }> {
  await requireUser();
  const supabase = await createClient();
  const { data: docs } = await supabase.from("documents").select("id").eq("session_id", sessionId);
  const files = await storagePathsFor(
    supabase,
    (docs ?? []).map((d) => d.id as string),
  );
  if (!(await removeFiles(supabase, files))) return { error: FILES_FAILED };
  // Documents, plan, memory and messages cascade.
  const { error } = await supabase.from("study_sessions").delete().eq("id", sessionId);
  return error ? { error: error.message } : {};
}

export async function deleteDocument(documentId: string): Promise<{ error?: string }> {
  await requireUser();
  const supabase = await createClient();
  const files = await storagePathsFor(supabase, [documentId]);
  if (!(await removeFiles(supabase, files))) return { error: FILES_FAILED };
  const { error } = await supabase.from("documents").delete().eq("id", documentId);
  return error ? { error: error.message } : {};
}
