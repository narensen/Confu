// What lives on the device. Each table mirrors the server table of the same
// name (supabase/schema.sql), minus user_id: one device, one student. That
// keeps moving data between them a straight copy.
//
// Types: text (also ids, dates and timestamps, as ISO strings), int, real,
// json (stored as text, parsed on read) and bool (0/1, read as true/false).

export type ColType = "text" | "int" | "real" | "json" | "bool";
export type Column = { name: string; type: ColType; notNull?: boolean; default?: string };
export type TableSpec = {
  name: string;
  key: string[];
  columns: Column[];
  // Synced tables carry a clock column (_hlc) and every change is logged for
  // the sync to Drive. Device-only tables (keys, usage) never leave it.
  synced: boolean;
  indexes?: string[][];
};

const t = (name: string, type: ColType = "text", notNull = false, def?: string): Column => ({ name, type, notNull, default: def });
const now = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
const created = t("created_at", "text", true, now);
const updated = t("updated_at", "text", true, now);
const json = (name: string, def: "[]" | "{}") => t(name, "json", true, `'${def}'`);

export const TABLES: TableSpec[] = [
  {
    name: "study_sessions",
    key: ["id"],
    synced: true,
    columns: [
      t("id", "text", true),
      t("title", "text", true, "'Untitled session'"),
      t("kind", "text", true, "'study'"),
      t("research_goal", "text", true, "''"),
      t("exam_date"),
      t("archived_at"),
      t("cite_mode", "bool", true, "0"),
      created,
      updated,
    ],
  },
  {
    name: "documents",
    key: ["id"],
    synced: true,
    indexes: [["session_id", "position"]],
    columns: [
      t("id", "text", true),
      t("session_id", "text", true),
      t("title", "text", true),
      t("storage_path"),
      t("page_count", "int", true, "0"),
      json("outline", "[]"),
      t("status", "text", true, "'processing'"),
      t("last_page", "int", true, "1"),
      t("position", "int", true, "0"),
      t("source_url"),
      json("meta", "{}"),
      created,
      updated,
    ],
  },
  {
    name: "document_pages",
    key: ["document_id", "page_number"],
    synced: true,
    columns: [t("document_id", "text", true), t("page_number", "int", true), t("content", "text", true, "''")],
  },
  {
    name: "highlights",
    key: ["id"],
    synced: true,
    indexes: [["document_id"]],
    columns: [
      t("id", "text", true),
      t("document_id", "text", true),
      t("kind", "text", true),
      t("page_number", "int", true),
      t("color", "text", true, "'yellow'"),
      t("selected_text"),
      json("rects", "[]"),
      t("image_path"),
      t("vlm_description"),
      t("note"),
      created,
    ],
  },
  {
    name: "messages",
    key: ["id"],
    synced: true,
    indexes: [["session_id", "created_at"]],
    columns: [
      t("id", "text", true),
      t("session_id", "text", true),
      t("document_id"),
      t("topic_id"),
      t("highlight_id"),
      t("role", "text", true),
      t("action", "text", true, "'chat'"),
      t("content", "text", true),
      t("page_number", "int"),
      created,
    ],
  },
  {
    name: "saved_answers",
    key: ["id"],
    synced: true,
    indexes: [["session_id", "created_at"]],
    columns: [t("id", "text", true), t("session_id", "text", true), t("question"), t("answer", "text", true), t("page_number", "int"), t("document_id"), created],
  },
  {
    name: "learner_memory",
    key: ["session_id"],
    synced: true,
    columns: [
      t("session_id", "text", true),
      t("summary", "text", true, "''"),
      json("understood", "[]"),
      json("struggling", "[]"),
      json("misconceptions", "[]"),
      json("open_questions", "[]"),
      json("explained", "[]"),
      updated,
    ],
  },
  {
    name: "study_plans",
    key: ["id"],
    synced: true,
    indexes: [["session_id"]],
    columns: [
      t("id", "text", true),
      t("session_id", "text", true),
      t("goal", "text", true),
      t("level", "text", true, "'intermediate'"),
      t("start_date", "text", true, "(date('now'))"),
      t("deadline", "text", true),
      t("minutes_per_day", "int", true, "45"),
      t("overview", "text", true, "''"),
      t("goal_title", "text", true, "''"),
      t("goal_summary", "text", true, "''"),
      t("materials", "text", true, "''"),
      json("phases", "[]"),
      created,
      updated,
    ],
  },
  {
    name: "plan_topics",
    key: ["id"],
    synced: true,
    indexes: [["plan_id", "position"]],
    columns: [
      t("id", "text", true),
      t("plan_id", "text", true),
      t("position", "int", true),
      t("title", "text", true),
      json("objectives", "[]"),
      json("key_concepts", "[]"),
      t("page_start", "int"),
      t("page_end", "int"),
      t("est_minutes", "int", true, "30"),
      t("due_date", "text", true),
      t("status", "text", true, "'not_started'"),
      t("mastery", "real", true, "0"),
      t("completed_at"),
      updated,
      t("phase", "int", true, "0"),
      t("source", "text", true, "'pdf'"),
      json("resources", "[]"),
      t("document_id"),
    ],
  },
  {
    name: "review_items",
    key: ["id"],
    synced: true,
    indexes: [["session_id", "due_at"]],
    columns: [
      t("id", "text", true),
      t("session_id", "text", true),
      t("document_id"),
      t("page_number", "int"),
      t("source", "text", true),
      t("source_key", "text", true),
      t("prompt", "text", true),
      t("question", "text", true, "''"),
      t("answer", "text", true, "''"),
      t("step", "int", true, "0"),
      t("due_at", "text", true, "(strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day'))"),
      t("last_reviewed_at"),
      t("reviews", "int", true, "0"),
      t("lapses", "int", true, "0"),
      t("suspended", "bool", true, "0"),
      created,
    ],
  },
  {
    name: "paper_reviews",
    key: ["document_id"],
    synced: true,
    columns: [
      t("document_id", "text", true),
      t("session_id", "text", true),
      t("target_pass", "int", true, "1"),
      t("passes_done", "int", true, "0"),
      t("triage_reason", "text", true, "''"),
      json("pass1", "{}"),
      json("pass2", "{}"),
      json("pass3", "{}"),
      updated,
    ],
  },
  {
    name: "exam_attempts",
    key: ["id"],
    synced: true,
    indexes: [["session_id"]],
    columns: [
      t("id", "text", true),
      t("session_id", "text", true),
      t("document_id"),
      t("page_number", "int"),
      t("topic", "text", true),
      t("question", "text", true),
      t("kind", "text", true),
      t("score", "real", true),
      created,
    ],
  },
  {
    name: "explain_backs",
    key: ["id"],
    synced: true,
    indexes: [["session_id"]],
    columns: [
      t("id", "text", true),
      t("session_id", "text", true),
      t("document_id"),
      t("page_number", "int"),
      t("topic", "text", true, "''"),
      t("score", "real", true),
      t("gap", "text", true),
      created,
    ],
  },
  {
    name: "page_pins",
    key: ["id"],
    synced: true,
    indexes: [["session_id"]],
    columns: [
      t("id", "text", true),
      t("session_id", "text", true),
      t("document_id", "text", true),
      t("page_number", "int", true),
      t("quote", "text", true, "''"),
      t("question", "text", true, "''"),
      t("answer"),
      t("pack_slug"),
      t("doc_index", "int"),
      created,
    ],
  },
  {
    name: "page_time",
    key: ["document_id", "page_number"],
    synced: true,
    columns: [t("document_id", "text", true), t("page_number", "int", true), t("seconds", "int", true, "0"), t("visits", "int", true, "0"), updated],
  },
  {
    name: "study_days",
    key: ["day"],
    synced: true,
    columns: [t("day", "text", true), t("seconds", "int", true, "0")],
  },
  // Device only. A key never leaves the device it was added on.
  {
    name: "ai_keys",
    key: ["id"],
    synced: false,
    columns: [
      t("id", "text", true),
      t("session_id"),
      t("provider", "text", true),
      t("secret", "text", true), // sealed with the device's key (see keys.ts), never stored in the clear
      t("last4", "text", true, "''"),
      t("base_url"),
      t("chat_model"),
      t("fast_model"),
      t("vision_model"),
      t("via", "text", true, "'key'"),
      created,
    ],
  },
  {
    name: "ai_usage",
    key: ["id"],
    synced: false,
    indexes: [["key_ref", "created_at"]],
    columns: [
      t("id", "text", true),
      t("session_id"),
      t("key_ref", "text", true),
      t("model", "text", true),
      t("feature", "text", true),
      t("prompt_tokens", "int", true, "0"),
      t("completion_tokens", "int", true, "0"),
      t("total_tokens", "int", true, "0"),
      created,
    ],
  },
];

export const TABLE: Record<string, TableSpec> = Object.fromEntries(TABLES.map((s) => [s.name, s]));
export type TableName = (typeof TABLES)[number]["name"];
