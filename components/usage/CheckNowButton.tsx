"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

// Ask Groq where a key stands right now, then re-render with the answer.
export function CheckNowButton({ sessionId }: { sessionId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await fetch(`/api/usage?check=1${sessionId ? `&sessionId=${sessionId}` : ""}`, { cache: "no-store" });
          router.refresh();
        })
      }
      className="rounded-md border border-ink/30 px-2 py-0.5 text-[11px] text-muted transition hover:border-ink hover:text-ink disabled:opacity-50"
    >
      {pending ? "Checking…" : "Check now"}
    </button>
  );
}
