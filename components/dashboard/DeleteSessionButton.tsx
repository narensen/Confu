"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteSession } from "./actions";

export function DeleteSessionButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Delete “${title}”? Its PDFs, plan, highlights and conversation will be removed.`)) return;
        start(async () => {
          await deleteSession(id);
          router.refresh();
        });
      }}
      className="rounded-md px-2 py-1 text-xs text-muted transition hover:bg-danger/10 hover:text-danger disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
