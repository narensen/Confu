"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ghostButtonClass } from "@/components/ui";
import { openReadingList } from "./DoorCardDialog";

// The library's less-used tools, behind one button, so "+ New session" is
// the one clear thing to press.
export function LibraryMore({ map }: { map: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
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

  const item = "flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition hover:bg-paper";
  return (
    <div ref={root} className="relative">
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={`${ghostButtonClass} py-2.5`}>
        More
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div role="menu" aria-label="More" className="animate-pop absolute top-full right-0 z-30 mt-2 w-72 origin-top-right rounded-2xl border border-ink bg-panel p-1.5 shadow-hard">
          {map && (
            <Link role="menuitem" href="/map" onClick={() => setOpen(false)} className={item}>
              <span className="text-sm font-medium">Literature map</span>
              <span className="text-xs text-muted">Every paper across your sessions, and how they connect</span>
            </Link>
          )}
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              openReadingList();
            }}
            className={item}
          >
            <span className="text-sm font-medium">Share a reading list</span>
            <span className="text-xs text-muted">A page of links anyone can start a session from</span>
          </button>
        </div>
      )}
    </div>
  );
}
