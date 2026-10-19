import type { TutorAction } from "@/lib/types";

export const ACTION_LABELS: Record<TutorAction, string> = {
  chat: "Chat",
  ask: "Doubt",
  summarize: "Summarize",
  context: "Understand context",
  simplify: "Explain simply",
  figure: "Figure",
  quiz: "Check my understanding",
  teach: "Teach me",
};

function quote(text: string, max = 600): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const clipped = clean.length > max ? `${clean.slice(0, max)}…` : clean;
  return `> ${clipped}`;
}

// The user-visible text for a turn. Stored in `messages` and replayed as
// conversation history, so it must read naturally on its own.
export function displayUserTurn(input: {
  action: TutorAction;
  message?: string;
  selection?: { text: string; page: number } | null;
  figurePage?: number | null;
  docLabel?: string | null; // "D2" when the session has several PDFs
  topicTitle?: string | null;
}): string {
  const { action, message, selection, figurePage, docLabel, topicTitle } = input;
  const where = (page: number) => `${docLabel ? `${docLabel} ` : ""}p. ${page}`;
  const parts: string[] = [];
  if (selection?.text) parts.push(`${quote(selection.text)}\n> — ${where(selection.page)}`);
  if (action === "figure" && figurePage) parts.push(`📷 Captured region on ${where(figurePage)}`);

  const label = ACTION_LABELS[action];
  if (message?.trim()) {
    parts.push(action === "chat" || action === "ask" || action === "figure" ? message.trim() : `**${label}:** ${message.trim()}`);
  } else if (action === "quiz" || action === "teach") {
    parts.push(`**${label}**${topicTitle ? ` — ${topicTitle}` : ""}`);
  } else if (action !== "chat") {
    parts.push(`**${label}**`);
  }
  return parts.join("\n\n");
}
