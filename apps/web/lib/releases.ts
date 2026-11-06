import { cacheLife } from "next/cache";

// The desktop app's newest build, from GitHub Releases (published by
// .github/workflows/desktop.yml). Looked up at most every ten minutes, so a
// new release shows on /download by itself.

export const REPO = "narensen/Confu";
export const RELEASES_URL = `https://github.com/${REPO}/releases`;

export type Platform = "mac" | "windows" | "linux";
export type Build = { platform: Platform; label: string; note: string; name: string; url: string; size: number };
export type Release = { version: string; date: string; url: string; builds: Build[] };

type Asset = { name: string; browser_download_url: string; size: number };

// electron-builder's names: Confu-<version>-<os>-<arch>.<ext>. The .zip,
// .blockmap and latest*.yml files are for updating, not for people.
function describe(a: Asset): Build | null {
  const m = a.name.match(/-(mac|win|linux)-([\w]+)\.(dmg|exe|AppImage|deb)$/);
  if (!m) return null;
  const [, os, arch, ext] = m;
  const base = { name: a.name, url: a.browser_download_url, size: a.size };
  if (os === "mac") return { ...base, platform: "mac", label: arch === "arm64" ? "Apple silicon (M1 and later)" : "Intel", note: ".dmg" };
  if (os === "win") return { ...base, platform: "windows", label: arch === "arm64" ? "Windows on Arm" : "Windows 10 and 11", note: ".exe installer" };
  return { ...base, platform: "linux", label: ext === "deb" ? "Debian, Ubuntu" : "Any distribution", note: ext === "deb" ? ".deb package" : "AppImage" };
}

const ORDER: Record<string, number> = { "Apple silicon (M1 and later)": 0, Intel: 1, "Windows 10 and 11": 0, "Windows on Arm": 1, "Any distribution": 0, "Debian, Ubuntu": 1 };

export async function latestRelease(): Promise<Release | null> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 600, expire: 86400 });
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null; // 404 until the first release
    const r = (await res.json()) as { tag_name: string; published_at: string; html_url: string; assets: Asset[] };
    const builds = r.assets
      .map(describe)
      .filter((b): b is Build => b !== null)
      .sort((a, b) => (ORDER[a.label] ?? 9) - (ORDER[b.label] ?? 9));
    return { version: r.tag_name.replace(/^v/, ""), date: r.published_at, url: r.html_url, builds };
  } catch {
    return null;
  }
}
