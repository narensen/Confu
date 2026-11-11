"use client";

import { useEffect, useRef, useState } from "react";
import { bridgeCommand, detectComputer, harnessById, HARNESSES, installCommand, osLabel, type DesktopOS, type HarnessId } from "@/lib/harnesses";
import { loadTutorLink, probeBridge, saveTutorLink, type BridgeHealth, type TutorLink } from "@/lib/harness-client";

const NAMES: Record<TutorLink["id"], string> = {
  groq: "Confu",
  claude: "Claude",
  codex: "Codex",
  antigravity: "Antigravity",
  grok: "Grok",
};

// One Tutors button. Opening it asks the local bridge which harnesses are
// installed and connects the one you pick. No connection code.
export function HarnessBar({ onChange }: { onChange: (link: TutorLink) => void }) {
  const [link, setLink] = useState<TutorLink>({ id: "groq", effort: "low", connected: false, installed: true });
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [down, setDown] = useState(false);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [computer, setComputer] = useState<{ os: DesktopOS; mobile: boolean }>({ os: "linux", mobile: false });
  const linkRef = useRef(link);
  const onChangeRef = useRef(onChange);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  linkRef.current = link;
  onChangeRef.current = onChange;

  function publish(next: TutorLink) {
    linkRef.current = next;
    setLink(next);
    saveTutorLink(next);
    onChangeRef.current(next);
  }

  useEffect(() => {
    setComputer(detectComputer());
    const stored = loadTutorLink();
    linkRef.current = stored;
    setLink(stored);
    onChangeRef.current(stored);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Probe when the menu is open, and keep probing while a harness is the
  // tutor so a bridge that stops is noticed before the next question.
  // Staying on Confu does not probe, so the browser is not asked for loopback.
  useEffect(() => {
    if (link.id === "groq" && !open) return;
    let stop = false;
    const look = async () => {
      const current = linkRef.current;
      try {
        const found = await probeBridge();
        if (stop || linkRef.current.id !== current.id) return;
        setChecking(false);
        setDown(false);
        setHealth(found);
        if (current.id === "groq") return;
        const row = found?.harnesses.find((h) => h.id === current.id);
        const next = { ...current, connected: Boolean(found && row?.installed), installed: Boolean(row?.installed) };
        const changed = next.connected !== current.connected || next.installed !== current.installed;
        linkRef.current = next;
        setLink(next);
        if (changed) onChangeRef.current(next);
      } catch {
        if (stop) return;
        setChecking(false);
        setHealth(null);
        setDown(true);
        if (current.id === "groq") return;
        const next = { ...current, connected: false };
        if (next.connected !== current.connected) {
          linkRef.current = next;
          setLink(next);
          onChangeRef.current(next);
        }
      }
    };
    void look();
    const timer = window.setInterval(() => void look(), 4000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [link.id, open]);

  function choose(id: TutorLink["id"]) {
    const row = id === "groq" ? null : health?.harnesses.find((h) => h.id === id);
    const installed = id === "groq" || Boolean(row?.installed);
    const connected = id !== "groq" && Boolean(health) && installed;
    publish({ ...linkRef.current, id, connected, installed });
    if (id === "groq" || connected) setOpen(false);
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((cur) => (cur === key ? null : cur)), 1200);
    } catch {}
  }

  const selected = link.id === "groq" ? null : harnessById(link.id);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const statusOf = (id: HarnessId) => {
    if (checking && !health) return "Checking";
    if (!health) return "Bridge off";
    return health.harnesses.find((h) => h.id === id)?.installed ? "Ready" : "Not installed";
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Tutors"
        title="Choose who teaches"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) setChecking(true);
        }}
        className="flex h-7 max-w-36 items-center gap-1 rounded-md border border-ink/25 px-2 text-xs font-medium text-ink hover:border-ink aria-expanded:border-ink"
      >
        <span className="truncate">{link.id === "groq" ? "Tutors" : NAMES[link.id]}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden className={`shrink-0 ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div role="menu" aria-label="Tutors" className="animate-pop absolute top-full left-0 z-50 mt-2 w-72 origin-top-left overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard">
          <button type="button" role="menuitem" onClick={() => choose("groq")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-paper">
            <span className="min-w-0 flex-1">Confu</span>
            <Mark on={link.id === "groq"} />
          </button>
          {HARNESSES.map((h) => {
            const status = statusOf(h.id);
            const on = link.id === h.id;
            return (
              <button key={h.id} type="button" role="menuitem" onClick={() => choose(h.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-paper">
                <span className="min-w-0 flex-1">{h.name}</span>
                <span className={`font-mono text-[10px] ${status === "Ready" ? "text-ink" : "text-muted"}`}>{status}</span>
                <Mark on={on} />
              </button>
            );
          })}

          <div className="space-y-2 border-t border-line px-3 py-2.5 text-xs leading-relaxed text-muted">
            {computer.mobile && <p>Open Confu on a Mac, Windows, or Linux computer. A phone can't run these.</p>}
            {!computer.mobile && selected && !link.connected && !health && (
              <>
                <p>
                  Start the bridge once on this {osLabel(computer.os)}. It needs{" "}
                  <a className="underline underline-offset-2" href="https://nodejs.org" target="_blank" rel="noreferrer">
                    Node.js
                  </a>
                  . Leave that window open.
                </p>
                <Command text={bridgeCommand(computer.os, origin)} copied={copied === "bridge"} onCopy={() => void copy(bridgeCommand(computer.os, origin), "bridge")} />
                {down && <p>The browser blocked it, or it isn't running. Allow loopback access if asked.</p>}
              </>
            )}
            {!computer.mobile && selected && health && !link.installed && (
              <>
                <p>{selected.name} isn't installed. Run this, then run {selected.signIn} once to sign in.</p>
                <Command
                  text={installCommand(selected.id, computer.os)}
                  copied={copied === "install"}
                  onCopy={() => void copy(installCommand(selected.id, computer.os), "install")}
                />
              </>
            )}
            {selected && link.connected && <p className="text-ink">{selected.name} is teaching. Leave the bridge window open.</p>}
            <div className="flex items-center gap-1">
              <span className="mr-1">Effort</span>
              {(["low", "medium"] as const).map((effort) => (
                <button
                  key={effort}
                  type="button"
                  aria-pressed={link.effort === effort}
                  onClick={() => publish({ ...linkRef.current, effort })}
                  className={`rounded-md border px-2 py-0.5 ${link.effort === effort ? "border-ink text-ink" : "border-transparent hover:text-ink"}`}
                >
                  {effort}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Mark({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${on ? "bg-ink" : "bg-transparent"}`} />
  );
}

function Command({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-ink/20 bg-paper px-2 py-1 font-mono text-[11px] leading-snug text-ink">{text}</code>
      <button type="button" onClick={onCopy} className="shrink-0 rounded-md border border-ink/25 px-2 py-1 text-[11px] font-medium text-ink">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
