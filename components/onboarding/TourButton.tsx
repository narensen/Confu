"use client";

import { ghostButtonClass } from "@/components/ui";
import { openGuide } from "./Guide";

export function TourButton({ label = "Take the 2-minute tour", className = "mt-5" }: { label?: string; className?: string }) {
  return (
    <button type="button" onClick={openGuide} className={`${ghostButtonClass} ${className}`}>
      {label}
    </button>
  );
}
