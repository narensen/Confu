"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { buttonClass } from "@/components/ui";
import { megabytes } from "@/lib/format-usage";
import type { Build, Platform } from "@/lib/releases";

// The build for the computer this page is open on. Phones get the web app,
// which installs to the Home Screen.

type Device = Platform | "ios" | "android" | null;

const NAMES: Record<Platform, string> = { mac: "Mac", windows: "Windows", linux: "Linux" };

function detect(): Device {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Mac/.test(ua)) return "mac";
  if (/Win/.test(ua)) return "windows";
  if (/Linux|X11|CrOS/.test(ua)) return "linux";
  return null;
}

const noSubscribe = () => () => {};

export function DownloadButton({ builds }: { builds: Build[] }) {
  const device = useSyncExternalStore(noSubscribe, detect, () => null);

  if (device === "ios" || device === "android") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/app" className={`${buttonClass} px-6 py-3 text-base`}>
          Open Confu
        </Link>
        <a href="#phones" className="text-sm font-medium underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
          Add it to your Home Screen
        </a>
      </div>
    );
  }

  const build = device ? builds.find((b) => b.platform === device) : null;
  if (!build) {
    return (
      <a href="#builds" className={`${buttonClass} px-6 py-3 text-base`}>
        Choose your download
      </a>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <a href={build.url} className={`${buttonClass} px-6 py-3 text-base`}>
        <DownloadIcon />
        Download for {NAMES[build.platform]}
      </a>
      <span className="font-mono text-xs text-muted">
        {build.label} · {build.note} · {megabytes(build.size)}
      </span>
    </div>
  );
}

export function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3" />
    </svg>
  );
}
