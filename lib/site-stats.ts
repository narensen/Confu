import "server-only";
import { cacheLife } from "next/cache";
import { adminClient } from "@/lib/supabase/admin";
import { SITE } from "@/lib/site";

// Real numbers for the landing page: how many people study with Confu, and
// the repository's stars. Anything that can't be counted is null and simply
// isn't shown; nothing here is estimated or padded.
export type SiteStats = { students: number | null; sessions: number | null; answers: number | null; stars: number | null };

export async function siteStats(): Promise<SiteStats> {
  "use cache";
  cacheLife("hours");
  const [counts, stars] = await Promise.all([countRows(), repoStars()]);
  return { ...counts, stars };
}

async function countRows(): Promise<Pick<SiteStats, "students" | "sessions" | "answers">> {
  const admin = adminClient();
  if (!admin) return { students: null, sessions: null, answers: null };
  const count = async (table: string, filter?: [string, string]) => {
    let q = admin.from(table).select("*", { count: "exact", head: true });
    if (filter) q = q.eq(filter[0], filter[1]);
    const { count: n, error } = await q;
    return error ? null : n;
  };
  const [students, sessions, answers] = await Promise.all([
    count("profiles"),
    count("study_sessions"),
    count("messages", ["role", "assistant"]),
  ]);
  return { students, sessions, answers };
}

async function repoStars(): Promise<number | null> {
  const path = new URL(SITE.repo).pathname.replace(/^\/|\/$/g, "");
  try {
    const res = await fetch(`https://api.github.com/repos/${path}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "confu-site" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const n = ((await res.json()) as { stargazers_count?: number }).stargazers_count;
    return typeof n === "number" ? n : null;
  } catch {
    return null;
  }
}
