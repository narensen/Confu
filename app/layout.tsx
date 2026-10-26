import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "katex/dist/katex.min.css";
import { Suspense } from "react";
import "./globals.css";
import { SITE } from "@/lib/site";
import { AppShell } from "@/components/AppShell";
import { DialogHost } from "@/components/dialogs";
import { FeedbackHost } from "@/components/Feedback";
import { FlashToast } from "@/components/FlashToast";
import { RoomDock } from "@/components/rooms/RoomDock";
import { Telemetry } from "@/components/Telemetry";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Absolute links for social preview images (packs, templates, Wrapped).
  metadataBase: new URL(SITE.url),
  title: "Confu — learn anything, deeply",
  description: "Set a goal, bring your PDF and lectures, and learn with a tutor that remembers your progress.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: browser extensions add attributes to <html>.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <DialogHost />
        <FeedbackHost />
        <AppShell />
        <FlashToast />
        <Suspense fallback={null}>
          <RoomDock />
        </Suspense>
        <Suspense fallback={null}>
          <Telemetry />
        </Suspense>
      </body>
    </html>
  );
}
