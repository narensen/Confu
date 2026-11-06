import { useEffect, useState } from "react";
import type { DesktopBridge } from "../main/preload";
import type { UpdateState } from "../main/updates";

// A new version, from GitHub Releases. Downloads happen quietly; this says
// when one is ready ("Restart to update") and answers Help → Check for
// Updates. Nothing shows when there's nothing to say.

export function UpdateBar({ updates }: { updates: DesktopBridge["updates"] }) {
  const [s, setS] = useState<UpdateState>({ state: "idle" });
  const [hidden, setHidden] = useState<string | null>(null); // the state put away

  useEffect(() => {
    void updates.state().then(setS);
    return updates.onChange((next) => {
      setS(next);
      setHidden((h) => (h === next.state ? h : null)); // progress doesn't bring it back
    });
  }, [updates]);

  // "Up to date" goes away by itself.
  useEffect(() => {
    if (s.state !== "none") return;
    const t = setTimeout(() => setHidden("none"), 4000);
    return () => clearTimeout(t);
  }, [s.state]);

  const manual = "manual" in s && s.manual;
  let text: string | null = null;
  let action: { label: string; run: () => void } | null = null;
  switch (s.state) {
    case "checking":
      text = manual ? "Looking for a new version…" : null;
      break;
    case "none":
      text = manual ? "You have the newest version." : null;
      break;
    case "downloading":
      text = manual ? `Downloading Confu ${s.version}… ${s.percent}%` : null;
      break;
    case "ready":
      text = `Confu ${s.version} is ready. Your library stays as it is.`;
      action = { label: "Restart to update", run: () => void updates.install() };
      break;
    case "available":
      text = `Confu ${s.version} is out. Download it and replace this copy; your library stays.`;
      action = { label: "Download", run: () => void updates.install() };
      break;
    case "error":
      text = manual ? `Couldn't check for updates: ${s.message.split("\n")[0].slice(0, 140)}` : null;
      break;
    case "dev":
      // Only reached from the menu: a copy run from the source updates with git.
      text = manual ? "This copy runs from the source code. Pull the latest code to update it." : null;
      break;
  }
  if (!text || hidden === s.state) return null;

  return (
    <div role="status" className="fixed bottom-4 left-4 z-[60] flex max-w-sm items-start gap-3 rounded-xl border border-ink bg-panel px-4 py-3 text-sm">
      <p className="min-w-0 flex-1 leading-snug">{text}</p>
      {action && (
        <button type="button" onClick={action.run} className="shrink-0 rounded-full bg-ink px-3 py-1 text-xs font-medium text-white transition hover:opacity-85">
          {action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Not now"
        onClick={() => {
          setHidden(s.state);
          void updates.later();
        }}
        className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-paper hover:text-ink"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
