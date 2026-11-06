import { connection } from "next/server";
import { TABLES } from "@confu/storage/tables";
import { createClient } from "@/lib/supabase/server";

// Everything the signed-in student has on the server, in the device's
// table shapes, so the on-device app (/app) can take it over: rows, plus
// signed links (valid an hour) to their PDFs. Row-level security limits
// every query to their own rows.

// The tables that exist on the server too (the device-only ones were added later).
const SERVER_TABLES = TABLES.filter((t) => t.synced && !t.since);
const PAGE = 1000;

type Row = Record<string, unknown>;

export async function GET() {
  await connection();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Sign in to bring your sessions over." }, { status: 401 });

  // Every row, a page at a time (the API returns at most 1000 per request).
  async function all(table: string): Promise<Row[]> {
    const out: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...((data ?? []) as Row[]));
      if (!data || data.length < PAGE) return out;
    }
  }

  try {
    const tables: Record<string, Row[]> = {};
    for (const spec of SERVER_TABLES) {
      const known = new Set(spec.columns.map((c) => c.name));
      tables[spec.name] = (await all(spec.name)).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => known.has(k))));
    }
    // Server file paths ("<user>/<doc>.pdf") become the device's ("docs/<doc>.pdf").
    const docs = tables.documents.filter((d) => typeof d.storage_path === "string");
    const files: { path: string; url: string }[] = [];
    for (let i = 0; i < docs.length; i += 100) {
      const chunk = docs.slice(i, i + 100);
      const { data } = await supabase.storage.from("documents").createSignedUrls(
        chunk.map((d) => d.storage_path as string),
        3600,
      );
      chunk.forEach((d, j) => {
        const url = data?.[j]?.signedUrl;
        const path = `docs/${d.id}.pdf`;
        d.storage_path = url ? path : null;
        if (url) files.push({ path, url });
      });
    }
    return Response.json({ format: "confu-account", version: 1, exported_at: new Date().toISOString(), tables, files }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Couldn't read your sessions." }, { status: 500 });
  }
}
