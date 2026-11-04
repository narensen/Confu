import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";

// The signed-in app's frame: library, review, threads, spaces, rooms,
// friends, settings and the rest. The header lives here rather than in each
// page, so it stays put as you move between them: no reload, no flash of the
// account placeholder, and the marker under the current place slides to the
// next one. (A session has its own header, with its title.)
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      {children}
    </div>
  );
}
