"use client";

import { ghostButtonClass } from "@/components/ui";
import { openGuide } from "./Guide";

export function TourButton() {
  return (
    <button type="button" onClick={openGuide} className={`${ghostButtonClass} mt-5`}>
      Take the 2-minute tour
    </button>
  );
}
