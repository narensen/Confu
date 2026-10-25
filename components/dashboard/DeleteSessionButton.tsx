"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteSession } from "./actions";
import { ask, toast } from "@/components/dialogs";

export function DeleteSessionButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        const ok = await ask({
          title: `Delete “${title}”?`,
          body: "Its PDFs, plan, highlights and conversation will be removed. This can't be undone.",
          confirm: "Delete session",
          danger: true,
        });
        if (!ok) return;
        start(async () => {
          const res = await deleteSession(id);
          if (res.error) toast(res.error, "error");
          else router.refresh();
        });
      }}
      className="rounded-md px-2 py-1 text-xs text-muted transition hover:bg-danger/10 hover:text-danger disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
