"use client";

// PDFs picked in the new-session dialog, handed to the session to upload. The
// dialog opens the session straight away, so the student can write their goal
// while the PDFs are read and indexed. Lives in memory: it survives the
// client-side navigation, not a reload.
const pending = new Map<string, File[]>();

export function handOffPdfs(sessionId: string, files: File[]) {
  if (files.length) pending.set(sessionId, files);
}

// Look without taking (safe in a state initialiser, which may run twice).
export function peekHandoff(sessionId: string): File[] {
  return pending.get(sessionId) ?? [];
}

// Take them once; a second call gets nothing.
export function takeHandoff(sessionId: string): File[] {
  const files = pending.get(sessionId) ?? [];
  pending.delete(sessionId);
  return files;
}
