"use client";

import { useState, useTransition } from "react";
import { setFeedbackStatus } from "@/app/(app)/admin/actions";
import { toast } from "@/components/dialogs";

export type FeedbackItem = {
  id: number;
  kind: "bug" | "idea" | "confusing" | "love";
  message: string;
  path: string | null;
  status: "new" | "seen" | "done";
  created_at: string;
  email: string | null;
};

const KIND: Record<FeedbackItem["kind"], { text: string; cls: string }> = {
  bug: { text: "Something broke", cls: "border-danger/50 text-danger" },
  idea: { text: "Idea", cls: "border-ink/40 text-ink" },
  confusing: { text: "Confusing", cls: "border-warn/50 text-warn" },
  love: { text: "Love it", cls: "border-transparent bg-yellow-400 text-ink" },
};

function kindLabel(f: FeedbackItem) {
  if (f.message.startsWith("Tutor answer · helpful")) return "Helpful answer";
  if (f.message.startsWith("Tutor answer · not helpful")) return "Not quite";
  return KIND[f.kind].text;
}

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function FeedbackInbox({ initial }: { initial: FeedbackItem[] }) {
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [, start] = useTransition();
  const open = items.filter((i) => i.status !== "done");
  const shown = filter === "open" ? open : items;

  function set(id: number, status: FeedbackItem["status"]) {
    const before = items;
    setItems((list) => list.map((i) => (i.id === id ? { ...i, status } : i)));
    start(async () => {
      const res = await setFeedbackStatus(id, status);
      if (res.error) {
        setItems(before);
        toast(res.error, "error");
      }
    });
  }

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-ink/30 px-4 py-6 text-center text-sm text-muted">
        No feedback yet. People can send it from the account menu, and from any error page.
      </p>
    );
  }

  return (
    <div>
      <div role="tablist" className="mb-3 flex gap-1.5">
        {(
          [
            ["open", `Open · ${open.length}`],
            ["all", `All · ${items.length}`],
          ] as const
        ).map(([id, text]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={filter === id}
            onClick={() => setFilter(id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${filter === id ? "border-ink bg-ink text-white" : "border-ink/30 hover:border-ink"}`}
          >
            {text}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">All caught up.</p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((f) => (
            <li key={f.id} className={`py-3 ${f.status === "done" ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${KIND[f.kind].cls}`}>{kindLabel(f)}</span>
                {f.status === "new" && <span className="font-mono text-[10px] tracking-wider text-ink uppercase">● New</span>}
                {f.status === "done" && <span className="font-mono text-[10px] tracking-wider text-ok uppercase">✓ Done</span>}
                <span className="ml-auto text-[11px] text-muted">{ago(f.created_at)}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{f.message}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="min-w-0 truncate text-[11px] text-muted">
                  {f.email ?? "deleted account"}
                  {f.path ? ` · ${f.path}` : ""}
                </p>
                <div className="ml-auto flex gap-1.5">
                  {f.status === "new" && <Action onClick={() => set(f.id, "seen")}>Mark seen</Action>}
                  {f.status !== "done" ? <Action onClick={() => set(f.id, "done")}>Done</Action> : <Action onClick={() => set(f.id, "seen")}>Reopen</Action>}
                  {f.email && (
                    <a
                      href={`mailto:${f.email}?subject=${encodeURIComponent("Your Confu feedback")}`}
                      className="rounded-md border border-ink/30 px-2 py-0.5 text-[11px] font-medium transition hover:border-ink"
                    >
                      Reply
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Action({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md border border-ink/30 px-2 py-0.5 text-[11px] font-medium transition hover:border-ink">
      {children}
    </button>
  );
}
