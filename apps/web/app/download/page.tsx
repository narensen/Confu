import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DownloadButton, DownloadIcon } from "@/components/site/DownloadButton";
import { SiteFooter, SiteNav } from "@/components/site/SiteNav";
import { eyebrowClass, ghostButtonClass } from "@/components/ui";
import { megabytes } from "@/lib/format-usage";
import { latestRelease, RELEASES_URL, REPO, type Build, type Platform } from "@/lib/releases";

export const metadata: Metadata = {
  title: "Download Confu — Mac, Windows, Linux and phones",
  description: "Confu for your computer, free and open source. Your library stays on your device, the tutor runs on your own AI, and the app updates itself.",
};

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

// The first time an unsigned app opens (no paid certificates), the system
// asks to confirm it. Once, then never again.
const PLATFORMS: { id: Platform; name: string; icon: ReactNode; firstOpen: ReactNode }[] = [
  {
    id: "mac",
    name: "macOS",
    icon: <path d="M4 5h16v11H4zM2 19h20" />,
    firstOpen: (
      <>
        Open the .dmg and drag Confu to Applications. The first time, macOS says it can&apos;t check the developer: open{" "}
        <b>System Settings → Privacy &amp; Security</b> and choose <b>Open Anyway</b>. New versions show up in the app; download them here.
      </>
    ),
  },
  {
    id: "windows",
    name: "Windows",
    icon: <path d="M3 4h18v16H3zM12 4v16M3 12h18" />,
    firstOpen: (
      <>
        Run the installer. If Windows SmartScreen says it protected your PC, choose <b>More info → Run anyway</b>. After that, Confu
        updates itself.
      </>
    ),
  },
  {
    id: "linux",
    name: "Linux",
    icon: <path d="M3 4h18v16H3zM7 9l3 3-3 3M12 15h5" />,
    firstOpen: (
      <>
        AppImage: make it runnable (<code className="font-mono text-xs">chmod +x Confu-*.AppImage</code>), then open it; it updates itself.
        .deb: <code className="font-mono text-xs">sudo apt install ./Confu-*.deb</code>.
      </>
    ),
  },
];

export default async function DownloadPage() {
  const release = await latestRelease();
  const builds = release?.builds ?? [];

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <SiteNav />
      <main className="flex-1">
        <section className="border-b border-ink">
          <div className="mx-auto max-w-6xl px-6 pt-16 pb-14">
            <p className={eyebrowClass}>Download</p>
            <h1 className="mt-3 max-w-3xl font-serif text-5xl leading-[1.05] tracking-tight sm:text-6xl">Confu for your computer.</h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
              Your library stays on your computer, the tutor runs on your own AI, and lectures can be recorded straight from its sound. Free and
              open source, and it keeps itself up to date.
            </p>
            <div className="mt-9">
              {builds.length ? (
                <DownloadButton builds={builds} />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Link href="/app" className={`${ghostButtonClass} px-6 py-3 text-base`}>
                    Use Confu in your browser
                  </Link>
                  <span className="text-sm text-muted">The first desktop build is on its way.</span>
                </div>
              )}
            </div>
            {release && (
              <p className="mt-6 font-mono text-xs text-muted">
                Version {release.version} · {fmt(release.date)} ·{" "}
                <a href={release.url} className="underline underline-offset-4 hover:text-ink">
                  What&apos;s in it
                </a>
              </p>
            )}
          </div>
        </section>

        <section id="builds" className="scroll-mt-16 border-b border-ink bg-panel">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="font-serif text-3xl tracking-tight">Every build</h2>
            <p className="mt-2 text-sm text-muted">
              The builds aren&apos;t signed (signing costs money every year), so the first time you open Confu your system asks you to confirm.
            </p>
            <div className="mt-8 grid gap-5 lg:grid-cols-3">
              {PLATFORMS.map((p) => (
                <PlatformCard key={p.id} platform={p} builds={builds.filter((b) => b.platform === p.id)} />
              ))}
            </div>
            <p className="mt-6 text-sm text-muted">
              Older versions are on{" "}
              <a href={RELEASES_URL} className="underline underline-offset-4 hover:text-ink">
                GitHub Releases
              </a>
              .
            </p>
          </div>
        </section>

        <section id="phones" className="scroll-mt-16 border-b border-ink">
          <div className="mx-auto grid max-w-6xl gap-5 px-6 py-16 md:grid-cols-3">
            <div>
              <h2 className="font-serif text-3xl tracking-tight">On your phone</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Confu installs from the browser: it gets its own icon, opens full screen and works offline. An Android app is on the way.
              </p>
            </div>
            <Steps title="iPhone and iPad" steps={["Open confu.lol/app in Safari", "Tap the Share button", "Choose Add to Home Screen"]} />
            <Steps title="Android" steps={["Open confu.lol/app in Chrome", "Tap the ⋮ menu", "Choose Install app (or Add to Home screen)"]} />
          </div>
        </section>

        <section className="border-b border-ink bg-panel">
          <div className="mx-auto grid max-w-6xl gap-8 px-6 py-16 md:grid-cols-2">
            <div>
              <h2 className="font-serif text-3xl tracking-tight">No install at all</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                The same app runs in any modern browser. Your library stays in that browser, and syncs to your own Google Drive if you want.
              </p>
              <Link href="/app" className={`${ghostButtonClass} mt-5 px-5 py-2.5`}>
                Open Confu in your browser
              </Link>
            </div>
            <div>
              <h2 className="font-serif text-3xl tracking-tight">Build it yourself</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Confu is MIT-licensed. With{" "}
                <a href="https://bun.sh" className="underline underline-offset-4 hover:text-ink">
                  Bun
                </a>{" "}
                installed:
              </p>
              <pre className="mt-4 overflow-x-auto rounded-xl border border-ink bg-paper p-4 font-mono text-xs leading-relaxed">
                {`git clone https://github.com/${REPO}.git\ncd Confu && bun install\nbun run --cwd apps/desktop dist`}
              </pre>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function PlatformCard({ platform: p, builds }: { platform: (typeof PLATFORMS)[number]; builds: Build[] }) {
  return (
    <article className="flex flex-col rounded-2xl border border-ink bg-paper p-6">
      <div className="flex items-center gap-3">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {p.icon}
        </svg>
        <h3 className="font-serif text-2xl">{p.name}</h3>
      </div>
      <ul className="mt-5 space-y-2">
        {builds.length ? (
          builds.map((b) => (
            <li key={b.name}>
              <a href={b.url} className="group flex items-center gap-3 rounded-xl border border-ink/20 bg-panel px-4 py-3 transition hover:border-ink">
                <DownloadIcon />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{b.label}</span>
                  <span className="block font-mono text-[11px] text-muted">
                    {b.note} · {megabytes(b.size)}
                  </span>
                </span>
              </a>
            </li>
          ))
        ) : (
          <li className="rounded-xl border border-dashed border-ink/30 px-4 py-3 text-sm text-muted">Coming with the first release.</li>
        )}
      </ul>
      <p className="mt-5 text-xs leading-relaxed text-muted">{p.firstOpen}</p>
    </article>
  );
}

function Steps({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="rounded-2xl border border-ink bg-panel p-6">
      <h3 className="font-serif text-xl">{title}</h3>
      <ol className="mt-4 space-y-2.5 text-sm">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-3">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-ink font-mono text-[10px]">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}
