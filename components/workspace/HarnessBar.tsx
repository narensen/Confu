"use client";

import { useEffect, useRef, useState } from "react";
import { eyebrowClass } from "@/components/ui";
import { BRIDGE_ORIGIN, bridgeCommand, detectComputer, harnessById, installCommand, osLabel } from "@/lib/harnesses";
import { loadTutorLink, probeBridge, saveTutorLink, type BridgeHealth, type TutorLink } from "@/lib/harness-client";

const ENGINES: { id: TutorLink["id"]; label: string }[] = [
  { id: "groq", label: "Confu" },
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "antigravity", label: "Antigravity" },
  { id: "grok", label: "Grok" },
];

const GROQ_SAFE: TutorLink = { id: "groq", effort: "low", token: "", connected: false, installed: true };

// Picks who teaches, and shows the one install line for this computer when
// that harness (or the bridge that runs it) isn't there yet.
export function HarnessBar({ onChange }: { onChange: (link: TutorLink) => void }) {
  const [link, setLink] = useState<TutorLink>(GROQ_SAFE);
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [down, setDown] = useState(false);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const linkRef = useRef(link);
  const onChangeRef = useRef(onChange);
  linkRef.current = link;
  onChangeRef.current = onChange;
  const computer = typeof window === "undefined" ? { os: "linux" as const, mobile: false } : detectComputer();

  function publish(next: TutorLink) {
    linkRef.current = next;
    setLink(next);
    saveTutorLink(next);
    onChangeRef.current(next);
  }

  useEffect(() => {
    const stored = loadTutorLink();
    setCode(stored.token);
    linkRef.current = stored;
    setLink(stored);
    onChangeRef.current(stored);
  }, []);

  useEffect(() => {
    if (link.id === "groq") return;
    let stop = false;
    const look = async () => {
      const current = linkRef.current;
      try {
        const found = await probeBridge(current.token);
        if (stop || linkRef.current.id !== current.id || linkRef.current.token !== current.token) return;
        setDown(false);
        setHealth(found);
        const row = found?.harnesses.find((h) => h.id === current.id);
        const next = { ...current, connected: Boolean(found?.authorized && row?.installed), installed: Boolean(row?.installed) };
        const changed = next.connected !== current.connected || next.installed !== current.installed;
        linkRef.current = next;
        setLink(next);
        if (changed) onChangeRef.current(next);
      } catch {
        if (stop) return;
        setHealth(null);
        setDown(true);
        const next = { ...current, connected: false, installed: false };
        linkRef.current = next;
        setLink(next);
        onChangeRef.current(next);
      }
    };
    void look();
    const timer = window.setInterval(() => void look(), 4000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [link.id, link.token]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== BRIDGE_ORIGIN) return;
      const data = event.data as { source?: string; token?: string } | null;
      if (data?.source !== "confu-bridge" || !data.token) return;
      setCode(data.token);
      publish({ ...linkRef.current, token: data.token });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((cur) => (cur === key ? null : cur)), 1200);
    } catch {}
  }

  const selected = link.id === "groq" ? null : harnessById(link.id);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const row = health?.harnesses.find((h) => h.id === link.id);

  return (
    <div className="shrink-0 border-b border-line bg-paper px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`${eyebrowClass} mr-1`}>Tutor</span>
        <div role="group" aria-label="Who teaches" className="flex flex-wrap gap-1">
          {ENGINES.map((engine) => {
            const on = link.id === engine.id;
            return (
              <button
                key={engine.id}
                type="button"
                aria-pressed={on}
                onClick={() => publish({ ...link, id: engine.id, connected: false, installed: engine.id === "groq" })}
                className={`rounded-md border px-2 py-0.5 text-xs font-medium ${on ? "border-ink bg-ink text-white" : "border-ink/25 text-muted hover:border-ink hover:text-ink"}`}
              >
                {engine.label}
              </button>
            );
          })}
        </div>
        {selected && (
          <div role="group" aria-label="Effort" className="ml-auto flex gap-1">
            {(["low", "medium"] as const).map((effort) => (
              <button
                key={effort}
                type="button"
                aria-pressed={link.effort === effort}
                onClick={() => publish({ ...link, effort })}
                className={`rounded-md border px-2 py-0.5 text-xs ${link.effort === effort ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}
              >
                {effort}
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && computer.mobile && <p className="mt-2 text-xs leading-relaxed text-muted">Open Confu on a Mac, Windows, or Linux computer. A phone can't run these.</p>}

      {selected && !computer.mobile && !link.connected && (
        <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted">
          <p>{selected.name} teaches from this {osLabel(computer.os)} on {link.effort} effort. Sign-in stays in that app.</p>
          {down && <p>The bridge isn't running, or the browser blocked it. Allow loopback access if the browser asks.</p>}
          {row && !row.installed && <p>{selected.name} isn't installed yet.</p>}
          {(!row || !row.installed) && (
            <Command text={installCommand(selected.id, computer.os)} copied={copied === "install"} onCopy={() => void copy(installCommand(selected.id, computer.os), "install")} />
          )}
          <p>
            {row?.installed ? "If you haven't signed in yet, run" : "Open a new terminal and run"} <code className="font-mono text-ink">{selected.signIn}</code> once
            {row?.installed ? "." : " to sign in."}
          </p>
          {!health && (
            <>
              <p>
                Start the bridge. It needs{" "}
                <a className="underline underline-offset-2" href="https://nodejs.org" target="_blank" rel="noreferrer">
                  Node.js
                </a>
                .
              </p>
              <Command text={bridgeCommand(computer.os, origin)} copied={copied === "bridge"} onCopy={() => void copy(bridgeCommand(computer.os, origin), "bridge")} />
            </>
          )}
          {health && link.token && !health.authorized && <p>That code doesn't match the bridge window.</p>}
          {health && (
            <form
              className="flex flex-wrap items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const token = code.trim();
                if (token) publish({ ...link, token });
              }}
            >
              <label className="text-ink" htmlFor="bridge-code">
                Connection code
              </label>
              <input
                id="bridge-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="w-28 rounded-md border border-ink/25 bg-panel px-2 py-1 font-mono text-xs outline-none focus:border-ink"
              />
              <button type="submit" className="rounded-md border border-ink px-2 py-1 text-xs font-medium text-ink">
                Connect
              </button>
              <button type="button" onClick={() => window.open(`${BRIDGE_ORIGIN}/pair`, "confu-bridge", "width=460,height=420")} className="rounded-md px-2 py-1 text-xs text-muted underline-offset-2 hover:underline">
                Open the code
              </button>
            </form>
          )}
        </div>
      )}

      {selected && link.connected && (
        <p className="mt-1.5 text-[11px] text-muted">
          {selected.name} is teaching{row?.version ? ` · ${row.version}` : ""}. Leave the bridge window open.
        </p>
      )}
    </div>
  );
}

function Command({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-ink/20 bg-panel px-2 py-1.5 font-mono text-[11px] leading-snug text-ink">{text}</code>
      <button type="button" onClick={onCopy} className="shrink-0 rounded-md border border-ink/25 px-2 py-1 text-[11px] font-medium text-ink">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
