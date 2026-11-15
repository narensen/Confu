import { Suspense, type ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import { MobileTabBar } from "@/components/PrimaryNav";

// The signed-in app's frame: library, review, threads, spaces, rooms,
// friends, settings and the rest. The header (and, on phones, the tab bar)
// lives here rather than in each page, so it stays put as you move between
// them: no reload, no flash of the account placeholder, and the marker under
// the current place slides to the next one. (A session has its own header,
// with its title.)
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    // On phones the places are a tab bar along the bottom: room is left for it.
    <div className="flex min-h-dvh flex-col bg-paper pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:pb-0">
      <AppHeader />
      {children}
      {/* It reads the URL to mark where you are, so it streams in after the page. */}
      <Suspense fallback={null}>
        <MobileTabBar />
      </Suspense>
    </div>
  );
}
