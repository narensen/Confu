"use client";

import { useState } from "react";
import { toast } from "@/components/dialogs";
import { ghostButtonClass } from "@/components/ui";
import { JSON_HEADERS } from "@/lib/ai-errors";
import { SITE } from "@/lib/site";
import { track } from "@/lib/telemetry";

// Make a public snapshot of this month's numbers, or take it down.
export function WrappedShare({ month, initialToken }: { month: string; initialToken: string | null }) {
  const [token, setToken] = useState(initialToken);
  const [showName, setShowName] = useState(true);
  const [pending, setPending] = useState(false);
  const link = token ? `${SITE.url}/w/${token}` : "";

  async function share() {
    setPending(true);
    try {
      const res = await fetch("/api/wrapped/share", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ month, showName }) });
      const j = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !j.token) throw new Error(j.error ?? "Couldn't share it.");
      setToken(j.token);
      const url = `${SITE.url}/w/${j.token}`;
      track("wrapped.share");
      if (navigator.share) await navigator.share({ title: "My month in Confu", url }).catch(() => {});
      else await navigator.clipboard.writeText(url).then(() => toast("Link copied. It shows your numbers, nothing else."));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't share it.", "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-ink bg-panel px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{token ? "Shared" : "Share your month"}</p>
        <p className="text-sm text-muted">
          {token ? (
            <>
              Anyone with <span className="font-mono text-xs">{link.replace(/^https?:\/\//, "")}</span> sees these numbers (not your notes or sessions).
            </>
          ) : (
            "A page with these numbers only: no notes, no session details beyond the top one's title."
          )}
        </p>
        {!token && (
          <label className="mt-2 flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} className="size-3.5 accent-[var(--ink)]" />
            Show my first name
          </label>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={token ? () => navigator.clipboard.writeText(link).then(() => toast("Link copied.")) : share}
          disabled={pending}
          className="rounded-lg border border-ink bg-ink px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
        >
          {pending ? "Sharing…" : token ? "Copy link" : "Share"}
        </button>
        {token && (
          <button
            type="button"
            onClick={async () => {
              await fetch(`/api/wrapped/share?month=${month}`, { method: "DELETE" });
              setToken(null);
              toast("Unshared: the link no longer works.");
            }}
            className={`${ghostButtonClass} py-2`}
          >
            Unshare
          </button>
        )}
      </div>
    </div>
  );
}
