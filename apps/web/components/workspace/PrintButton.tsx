"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-md border border-ink bg-ink px-3 py-1.5 text-sm font-medium text-white">
      Print
    </button>
  );
}
