"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { bridgeCommand, detectComputer, harnessById, HARNESSES, installCommand, osLabel, type DesktopOS, type HarnessId } from "@/lib/harnesses";
import {
  loadConsent,
  loadTutorLink,
  probeBridge,
  saveConsent,
  saveTutorLink,
  storedTutor,
  type BridgeHealth,
  type BridgeModel,
  type LocalConsent,
  type TutorLink,
} from "@/lib/harness-client";

const NAMES: Record<TutorLink["id"], string> = {
  groq: "Confu",
  claude: "Claude",
  codex: "ChatGPT",
  antigravity: "Gemini",
  grok: "Grok",
};

// One Tutors button. When a session opens, Confu asks once whether it may
// look for tutors on this computer. With a yes it finds the local bridge on
// its own, keeps the tutor picked last time if it's installed, and otherwise
// connects the first one found. No connection code.
export function HarnessBar({ onChange }: { onChange: (link: TutorLink) => void }) {
  const [link, setLink] = useState<TutorLink>({ id: "groq", effort: "low", model: null, modelName: null, connected: false, installed: true });
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [down, setDown] = useState(false);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [computer, setComputer] = useState<{ os: DesktopOS; mobile: boolean }>({ os: "linux", mobile: false });
  const [consent, setConsent] = useState<LocalConsent>("no");
  const [asking, setAsking] = useState(false);
  const linkRef = useRef(link);
  // Set when the student said yes in this session. If no bridge answers,
  // the menu opens with the one-time setup instead of failing quietly.
  const justAllowed = useRef(false);
  const onChangeRef = useRef(onChange);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // True after hydration. The server can't read this computer or
  // localStorage, so the first client render matches it, then loads.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [loaded, setLoaded] = useState(false);
  if (mounted && !loaded) {
    const found = detectComputer();
    const said = loadConsent();
    setLoaded(true);
    setComputer(found);
    setLink(loadTutorLink());
    setConsent(said);
    if (said === null && !found.mobile) setAsking(true);
  }

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  function publish(next: TutorLink) {
    linkRef.current = next;
    setLink(next);
    saveTutorLink(next);
    onChangeRef.current(next);
  }

  // Tell the workspace which tutor was saved, once it's loaded.
  useEffect(() => {
    if (!loaded) return;
    linkRef.current = link;
    onChangeRef.current(link);
    // Only the first load; later changes are published where they happen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  function allow() {
    saveConsent("yes");
    setConsent("yes");
    setAsking(false);
    justAllowed.current = true;
    setChecking(true);
  }

  function decline() {
    saveConsent("no");
    setConsent("no");
    setAsking(false);
  }

  useEffect(() => {
    if (!open && !asking) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (asking) decline();
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
  }, [open, asking]);

  // With permission, probe from the moment the session opens and keep
  // probing, so a bridge that starts later is picked up and one that stops
  // is noticed before the next question. Without it, probe only while the
  // menu is open or a harness is the tutor, so the browser isn't asked for
  // loopback by someone who said no.
  const looking = consent === "yes" || open || link.id !== "groq";
  useEffect(() => {
    if (!looking) return;
    let stop = false;
    const look = async () => {
      let current = linkRef.current;
      try {
        const found = await probeBridge();
        if (stop || linkRef.current.id !== current.id) return;
        setChecking(false);
        setDown(false);
        setHealth(found);
        justAllowed.current = false;
        if (consent === "yes" && found) {
          // Keep the last pick if it's installed, else the first one found.
          // Choosing Confu on purpose sticks.
          const usable = (id: TutorLink["id"]) => found.harnesses.some((h) => h.id === id && h.installed);
          const explicitConfu = storedTutor() === "groq";
          const first = HARNESSES.find((h) => usable(h.id));
          if (first && !explicitConfu && !usable(current.id)) {
            current = { ...current, id: first.id, model: null, modelName: null };
          }
        }
        if (current.id === "groq") return;
        const row = found?.harnesses.find((h) => h.id === current.id);
        const options = row?.models ?? [];
        const picked = options.find((m) => m.id === current.model);
        const model = options.length ? picked?.id || row?.model || null : current.model || row?.model || null;
        const modelName = options.length ? picked?.name || row?.modelName || null : current.modelName || row?.modelName || null;
        const next = { ...current, model, modelName, connected: Boolean(found && row?.installed), installed: Boolean(row?.installed) };
        const changed =
          next.connected !== current.connected ||
          next.installed !== current.installed ||
          next.model !== current.model ||
          next.modelName !== current.modelName ||
          next.id !== linkRef.current.id;
        linkRef.current = next;
        setLink(next);
        if (changed) onChangeRef.current(next);
      } catch {
        if (stop) return;
        setChecking(false);
        setHealth(null);
        setDown(true);
        if (justAllowed.current) {
          justAllowed.current = false;
          setOpen(true);
        }
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
    // Waiting for a bridge that isn't there yet doesn't need to be quick.
    const timer = window.setInterval(() => void look(), open || link.id !== "groq" ? 4000 : 10000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [link.id, open, looking, consent]);

  function choose(id: TutorLink["id"]) {
    const row = id === "groq" ? null : health?.harnesses.find((h) => h.id === id);
    const installed = id === "groq" || Boolean(row?.installed);
    const connected = id !== "groq" && Boolean(health) && installed;
    const same = linkRef.current.id === id;
    const keep = id !== "groq" && same ? linkRef.current.model : null;
    const picked = row?.models.find((m) => m.id === keep);
    const model = id === "groq" ? null : picked?.id || row?.model || keep;
    const modelName = id === "groq" ? null : picked?.name || (model && model === row?.model ? row?.modelName : null) || (same ? linkRef.current.modelName : null);
    publish({ ...linkRef.current, id, model, modelName: id === "groq" ? null : modelName, connected, installed });
    if (id === "groq" || connected) setOpen(false);
  }

  function pickModel(model: BridgeModel) {
    if (linkRef.current.id === "groq") return;
    publish({ ...linkRef.current, model: model.id, modelName: model.name });
    setOpen(false);
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
        aria-label={`Tutor: ${NAMES[link.id]}. Choose who teaches`}
        title="Choose who teaches"
        onClick={() => {
          const next = !open;
          setAsking(false);
          setOpen(next);
          if (next) setChecking(true);
        }}
        className="flex h-7 max-w-44 items-center gap-1 rounded-md px-1.5 text-sm text-muted transition hover:bg-paper hover:text-ink aria-expanded:bg-paper aria-expanded:text-ink"
      >
        <span className="truncate">{NAMES[link.id]}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden className={`shrink-0 ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {asking && !open && (
        <div
          role="dialog"
          aria-label="Use tutors on this computer"
          className="animate-pop absolute top-full left-0 z-50 mt-2 w-72 origin-top-left rounded-2xl border border-ink bg-panel p-3 text-xs leading-relaxed text-muted shadow-hard"
        >
          <p className="text-sm font-medium text-ink">Teach with AI on this computer?</p>
          <p className="mt-1">
            Confu can teach with Claude, ChatGPT, Gemini or Grok if one is signed in here. It looks for them now and each time a session opens. Your browser
            may ask to allow access to this device.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button type="button" onClick={allow} className="rounded-md border border-ink bg-ink px-2.5 py-1 text-xs font-medium text-panel">
              Allow
            </button>
            <button type="button" onClick={decline} className="rounded-md border border-ink/25 px-2.5 py-1 text-xs font-medium text-ink">
              Not now
            </button>
          </div>
        </div>
      )}

      {open && (
        <div role="menu" aria-label="Tutors" className="animate-pop absolute top-full left-0 z-50 mt-2 max-h-[70vh] w-72 origin-top-left overflow-y-auto rounded-2xl border border-ink bg-panel shadow-hard">
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
                <span className={`shrink-0 font-mono text-xs ${status === "Ready" ? "text-ink" : "text-muted"}`}>{status}</span>
                <Mark on={on} />
              </button>
            );
          })}
          {selected && (health?.harnesses.find((row) => row.id === link.id)?.models.length ?? 0) > 0 && (
            <div className="border-t border-line px-1.5 py-1.5">
              <p className="px-1.5 py-1 font-mono text-xs tracking-widest text-muted uppercase">Model</p>
              {health?.harnesses
                .find((row) => row.id === link.id)
                ?.models.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    role="menuitem"
                    onClick={() => pickModel(model)}
                    className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs hover:bg-paper ${link.model === model.id ? "text-ink" : "text-muted"}`}
                  >
                    <Mark on={link.model === model.id} />
                    <span className="min-w-0 flex-1 truncate">{model.name}</span>
                  </button>
                ))}
            </div>
          )}

          <div className="space-y-2 border-t border-line px-3 py-2.5 text-xs leading-relaxed text-muted">
            {computer.mobile && <p>Open Confu on a Mac, Windows, or Linux computer. A phone can&apos;t run these.</p>}
            {!computer.mobile && (selected || consent === "yes") && !link.connected && !health && (
              <>
                <p>
                  {selected ? "" : "No tutors found on this computer yet. "}Set up the bridge once on this {osLabel(computer.os)}. It needs{" "}
                  <a className="underline underline-offset-2" href="https://nodejs.org" target="_blank" rel="noreferrer">
                    Node.js
                  </a>
                  . Say yes when it asks to start at login, and Confu finds it by itself from then on.
                </p>
                <Command text={bridgeCommand(computer.os, origin)} copied={copied === "bridge"} onCopy={() => void copy(bridgeCommand(computer.os, origin), "bridge")} />
                {down && <p>The browser blocked it, or it isn&apos;t running. Allow loopback access if asked.</p>}
              </>
            )}
            {!computer.mobile && selected && health && !link.installed && (
              <>
                <p>{selected.name} isn&apos;t installed. Run this, then run {selected.signIn} once to sign in.</p>
                <Command
                  text={installCommand(selected.id, computer.os)}
                  copied={copied === "install"}
                  onCopy={() => void copy(installCommand(selected.id, computer.os), "install")}
                />
              </>
            )}
            {selected && link.connected && (
              <p className="text-ink">
                {selected.name}
                {link.modelName ? ` · ${link.modelName}` : ""} is teaching.
              </p>
            )}
            {!computer.mobile && (
              <button
                type="button"
                onClick={() => {
                  if (consent === "yes") decline();
                  else allow();
                }}
                className="underline underline-offset-2 hover:text-ink"
              >
                {consent === "yes" ? "Stop looking for tutors on this computer" : "Look for tutors on this computer"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function noSubscribe() {
  return () => {};
}

function Mark({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${on ? "bg-ink" : "bg-transparent"}`} />
  );
}

function Command({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-ink/20 bg-paper px-2 py-1 font-mono text-xs leading-snug text-ink">{text}</code>
      <button type="button" onClick={onCopy} className="shrink-0 rounded-md border border-ink/25 px-2 py-1 text-xs font-medium text-ink">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
