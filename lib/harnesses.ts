// The four local coding harnesses a student can ask to teach. The browser
// never sees their login. A bridge on their own computer (public/bridge)
// runs the CLI they already signed in to.

export const BRIDGE_PORT = 17321;
export const BRIDGE_ORIGIN = `http://127.0.0.1:${BRIDGE_PORT}`;

export type DesktopOS = "mac" | "windows" | "linux";
export type HarnessId = "claude" | "codex" | "antigravity" | "grok";
export type TutorEngine = "groq" | HarnessId;
export type TeachEffort = "low" | "medium";

export type HarnessInfo = {
  id: HarnessId;
  name: string;
  bin: string;
  // What they run once, in a new terminal, to sign in.
  signIn: string;
};

export const HARNESSES: HarnessInfo[] = [
  { id: "claude", name: "Claude", bin: "claude", signIn: "claude" },
  { id: "codex", name: "ChatGPT", bin: "codex", signIn: "codex" },
  { id: "antigravity", name: "Gemini", bin: "agy", signIn: "agy" },
  { id: "grok", name: "Grok", bin: "grok", signIn: "grok" },
];

export const harnessById = (id: string): HarnessInfo | undefined => HARNESSES.find((h) => h.id === id);

// Official one-line installers. macOS and Linux share a shell script.
// Windows is PowerShell, which is what a new terminal opens on.
export function installCommand(id: HarnessId, os: DesktopOS): string {
  if (os === "windows") {
    const url = {
      claude: "https://claude.ai/install.ps1",
      codex: "https://chatgpt.com/codex/install.ps1",
      antigravity: "https://antigravity.google/cli/install.ps1",
      grok: "https://x.ai/cli/install.ps1",
    }[id];
    return `irm ${url} | iex`;
  }
  const url = {
    claude: "https://claude.ai/install.sh",
    codex: "https://chatgpt.com/codex/install.sh",
    antigravity: "https://antigravity.google/cli/install.sh",
    grok: "https://x.ai/cli/install.sh",
  }[id];
  const shell = id === "codex" ? "sh" : "bash";
  return `curl -fsSL ${url} | ${shell}`;
}

export function bridgeCommand(os: DesktopOS, origin: string): string {
  const url = `${origin.replace(/\/$/, "")}/bridge/harness-bridge.mjs`;
  if (os === "windows") return `irm ${url} -OutFile confu-bridge.mjs; node confu-bridge.mjs`;
  return `curl -fsSL ${url} -o confu-bridge.mjs && node confu-bridge.mjs`;
}

export function detectComputer(): { os: DesktopOS; mobile: boolean } {
  if (typeof navigator === "undefined") return { os: "linux", mobile: false };
  const nav = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } };
  const platform = `${nav.userAgentData?.platform ?? ""} ${nav.platform ?? ""} ${nav.userAgent ?? ""}`.toLowerCase();
  const os: DesktopOS = platform.includes("win") ? "windows" : platform.includes("mac") || platform.includes("iphone") || platform.includes("ipad") ? "mac" : "linux";
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const mobile = Boolean(nav.userAgentData?.mobile) || /android|iphone|ipad|mobile/i.test(nav.userAgent) || (os === "mac" && nav.maxTouchPoints > 1 && coarse);
  return { os, mobile };
}

export function osLabel(os: DesktopOS): string {
  if (os === "mac") return "Mac";
  if (os === "windows") return "Windows";
  return "Linux";
}
