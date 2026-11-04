import type { Metadata } from "next";
import { Suspense } from "react";
import { LocalRoute } from "./LocalRoute";

// Confu on this device: no account, nothing stored on our servers. The
// library, files, chat and keys live in this browser (packages/app).
export const metadata: Metadata = {
  title: "Confu — on this device",
  description: "Study your PDFs with a tutor that runs on your own AI. No account; everything stays in your browser.",
};

export default function LocalAppPage() {
  return (
    <Suspense
      fallback={
        <p className="flex flex-1 items-center justify-center py-24 font-mono text-xs text-muted" role="status">
          Opening your library…
        </p>
      }
    >
      <LocalRoute />
    </Suspense>
  );
}
