"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { eyebrowClass } from "@/components/ui";

// The workspace's keyboard shortcuts (they work when you're not typing in a
// box and no dialog is open). "?" shows this list.
export const SHORTCUTS: { group: string; keys: [string, string][] }[] = [
  {
    group: "Tutor",
    keys: [
      ["t", "Show or fold away the tutor"],
      ["/", "Write to the tutor"],
      ["e", "In full screen: the tutor across the whole screen, or back beside the page"],
    ],
  },
  {
    group: "Tools (they slide out on the right; press again to put away)",
    keys: [
      ["p", "Plan (Passes in a paper session, Practice in exam prep)"],
      ["h", "Highlights"],
      ["f", "Files"],
      ["Esc", "Put away a tool that isn't pinned"],
    ],
  },
  {
    group: "Reading",
    keys: [
      ["[  ]", "Previous / next open file"],
      ["w", "Close this file's tab (it stays in Files)"],
      ["n", "Open the next topic's pages"],
      [".", "Full screen on or off"],
      ["Ctrl F  ⌘ F", "Search in this file"],
    ],
  },
  { group: "Anywhere", keys: [["?", "This list"], ["Esc", "Close a dialog"]] },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => (e.key === "Escape" || e.key === "?") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="animate-fade fixed inset-0 z-60 flex items-center justify-center bg-scrim p-3 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="keys-title" className="animate-pop w-full max-w-md overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard">
        <div className="flex items-start justify-between gap-4 border-b border-ink px-6 pt-5 pb-4">
          <div>
            <p className={eyebrowClass}>Keyboard</p>
            <h2 id="keys-title" className="mt-1 font-serif text-2xl">
              Shortcuts
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-paper">
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
          {SHORTCUTS.map((g) => (
            <section key={g.group}>
              <p className={eyebrowClass}>{g.group}</p>
              <dl className="mt-2 space-y-1.5">
                {g.keys.map(([k, what]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4 text-sm">
                    <dt className="flex shrink-0 gap-1">
                      {k.split("  ").map((part) => (
                        <kbd key={part} className="rounded border border-ink/30 bg-paper px-1.5 py-0.5 font-mono text-[11px]">
                          {part}
                        </kbd>
                      ))}
                    </dt>
                    <dd className="text-right text-muted">{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
