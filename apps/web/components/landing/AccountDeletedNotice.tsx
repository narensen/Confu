"use client";

import { useSearchParams } from "next/navigation";

// Shown once after "Delete account" sends you home.
export function AccountDeletedNotice() {
  const params = useSearchParams();
  if (params.get("account") !== "deleted") return null;
  return (
    <div role="status" className="animate-enter border-b border-ink bg-yellow-200 px-6 py-2.5 text-center text-sm">
      Your account and everything in it have been deleted. Thanks for trying Confu.
    </div>
  );
}
