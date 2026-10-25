"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteSession, setSessionArchived } from "./actions";
import { choose, toast } from "@/components/dialogs";

// Archive (or restore) and Delete on a library card. Deleting takes the
// session's activity with it, and so the streak days it counted: the dialog
// always says so and offers Archive instead.
export function SessionActions({ id, title, archived }: { id: string; title: string; archived: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const archive = (on: boolean) =>
    start(async () => {
      const res = await setSessionArchived(id, on);
      if (res.error) return toast(res.error, "error");
      toast(on ? `Archived “${title}”. Find it under Archived at the bottom of your library.` : `Restored “${title}”.`);
      router.refresh();
    });

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => archive(!archived)}
        className="rounded-md px-2 py-1 text-xs text-muted transition hover:bg-paper hover:text-ink disabled:opacity-50"
      >
        {archived ? "Restore" : "Archive"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          const choice = await choose({
            title: `Delete “${title}”?`,
            body: `Its PDFs, plan, highlights and conversation will be removed, and your study streak loses the days you studied in it. This can't be undone.${
              archived ? "" : " To just hide it, archive it instead: everything, streak included, is kept."
            }`,
            confirm: "Delete session",
            alternative: archived ? undefined : "Archive instead",
            danger: true,
          });
          if (choice === "alternative") return archive(true);
          if (choice !== "confirm") return;
          start(async () => {
            const res = await deleteSession(id);
            if (res.error) toast(res.error, "error");
            else router.refresh();
          });
        }}
        className="rounded-md px-2 py-1 text-xs text-muted transition hover:bg-danger/10 hover:text-danger disabled:opacity-50"
      >
        {pending ? "…" : "Delete"}
      </button>
    </div>
  );
}
