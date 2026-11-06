import type { Sql } from "./driver";
import { TABLES, type Column, type TableSpec } from "./tables";

// Migrations, applied in order and recorded in PRAGMA user_version.
// Append new ones; never edit one that has shipped.

const SQL_TYPE: Record<Column["type"], string> = { text: "TEXT", int: "INTEGER", real: "REAL", json: "TEXT", bool: "INTEGER" };

function createTable(s: TableSpec): string {
  const cols = s.columns.map((c) => `"${c.name}" ${SQL_TYPE[c.type]}${c.notNull ? " NOT NULL" : ""}${c.default ? ` DEFAULT ${c.default}` : ""}`);
  if (s.synced) cols.push(`"_hlc" TEXT NOT NULL DEFAULT ''`);
  cols.push(`PRIMARY KEY (${s.key.map((k) => `"${k}"`).join(", ")})`);
  const idx = (s.indexes ?? []).map((cols) => `CREATE INDEX IF NOT EXISTS "${s.name}_${cols.join("_")}_idx" ON "${s.name}" (${cols.map((c) => `"${c}"`).join(", ")});`);
  return [`CREATE TABLE IF NOT EXISTS "${s.name}" (\n  ${cols.join(",\n  ")}\n);`, ...idx].join("\n");
}

export const MIGRATIONS: string[] = [
  // 1. The study tables, the sync bookkeeping, and page search.
  [
    ...TABLES.filter((t) => !t.since).map(createTable),
    // Every local change to a synced table, in order, until it's uploaded.
    `CREATE TABLE IF NOT EXISTS "_changes" (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      tbl TEXT NOT NULL,
      row_key TEXT NOT NULL,
      op TEXT NOT NULL CHECK (op IN ('put', 'delete')),
      hlc TEXT NOT NULL,
      data TEXT,
      synced INTEGER NOT NULL DEFAULT 0
    );`,
    `CREATE INDEX IF NOT EXISTS "_changes_pending_idx" ON "_changes" (synced, seq);`,
    // A deleted row, remembered so an older edit from another device can't bring it back.
    `CREATE TABLE IF NOT EXISTS "_tombstones" (tbl TEXT NOT NULL, row_key TEXT NOT NULL, hlc TEXT NOT NULL, PRIMARY KEY (tbl, row_key));`,
    `CREATE TABLE IF NOT EXISTS "_meta" (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
    // Full-text search over page text, kept in step with document_pages.
    `CREATE VIRTUAL TABLE IF NOT EXISTS "page_fts" USING fts5(content, content='document_pages', content_rowid='rowid', tokenize='porter unicode61');`,
    `CREATE TRIGGER IF NOT EXISTS "page_fts_insert" AFTER INSERT ON "document_pages" BEGIN
      INSERT INTO page_fts(rowid, content) VALUES (new.rowid, new.content);
    END;`,
    `CREATE TRIGGER IF NOT EXISTS "page_fts_delete" AFTER DELETE ON "document_pages" BEGIN
      INSERT INTO page_fts(page_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    END;`,
    `CREATE TRIGGER IF NOT EXISTS "page_fts_update" AFTER UPDATE OF content ON "document_pages" BEGIN
      INSERT INTO page_fts(page_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      INSERT INTO page_fts(rowid, content) VALUES (new.rowid, new.content);
    END;`,
  ].join("\n"),
  // 2. Flashcards, notes, recorded lectures and podcasts.
  TABLES.filter((t) => t.since === 2)
    .map(createTable)
    .join("\n"),
];

export async function migrate(db: Sql): Promise<number> {
  const [{ user_version: from }] = await db.all<{ user_version: number }>("PRAGMA user_version");
  for (let v = from; v < MIGRATIONS.length; v++) {
    for (const stmt of splitStatements(MIGRATIONS[v])) await db.run(stmt);
    await db.run(`PRAGMA user_version = ${v + 1}`);
  }
  return MIGRATIONS.length;
}

// Split on semicolons that end a statement, keeping trigger bodies whole.
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  for (const line of sql.split("\n")) {
    buf += line + "\n";
    if (/\bBEGIN\s*$/i.test(line.trim())) depth++;
    if (/^\s*END;\s*$/i.test(line)) depth--;
    if (depth === 0 && /;\s*$/.test(line)) {
      out.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
