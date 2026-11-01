// Spaced review: items come back after 1, 3, 7, 16, 35, 80 days (see
// supabase/migrations/0017_spaced_review.sql). The student answers first,
// then reveals and rates themselves; a tutor check is optional.

export type ReviewSource = "topic" | "highlight" | "asked" | "misconception" | "mistake" | "gap";
export type ReviewRating = "again" | "hard" | "good";

export type ReviewItem = {
  id: string;
  session_id: string;
  document_id: string | null;
  page_number: number | null;
  source: ReviewSource;
  prompt: string;
  question: string;
  answer: string;
  step: number;
  due_at: string;
  reviews: number;
  study_sessions: { title: string } | null;
};

export const REVIEW_SELECT = "id, session_id, document_id, page_number, source, prompt, question, answer, step, due_at, reviews, study_sessions(title)";

// "Due today" is the student's local day, not the server's.
export function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

// Days until the next review, mirroring review_interval_days() in SQL.
export function intervalDays(step: number) {
  if (step <= 0) return 1;
  return [1, 3, 7, 16, 35, 80][step] ?? Math.min(365, 80 * 2 ** (step - 5));
}

export function nextIn(step: number, rating: ReviewRating) {
  const days = rating === "good" ? intervalDays(step + 1) : rating === "hard" ? Math.max(1, Math.floor(intervalDays(step) / 2)) : 1;
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

// A highlighted passage becomes a recall cue: the opening words, the rest hidden.
function opening(text: string) {
  const words = text.split(/\s+/);
  const keep = Math.max(4, Math.min(14, Math.floor(words.length * 0.35)));
  return words.slice(0, keep).join(" ");
}

export function cueFor(item: Pick<ReviewItem, "source" | "prompt" | "question" | "page_number">): { eyebrow: string; question: string; quote?: string } {
  const page = item.page_number ? ` · p. ${item.page_number}` : "";
  switch (item.source) {
    case "topic":
      return { eyebrow: `Topic you finished${page}`, question: `Explain “${item.prompt}” from memory, as if teaching it to someone.` };
    case "highlight":
      return { eyebrow: `Passage you highlighted${page}`, question: "Continue the idea in your own words, and say why it matters.", quote: `${opening(item.prompt)} …` };
    case "asked":
      return {
        eyebrow: `Passage you asked about${page}`,
        question: item.question ? `You asked: “${item.question}” Can you answer it yourself now?` : "Explain this passage in your own words, as if to a friend.",
        quote: item.prompt,
      };
    case "misconception":
      return { eyebrow: "A mix-up the tutor caught", question: "What's actually right here, and why?", quote: item.prompt };
    case "mistake":
      // Exam questions leave `question` empty; a recall check's misses name themselves there.
      return { eyebrow: `${item.question || "Exam question you missed"}${page}`, question: item.prompt };
    case "gap":
      return { eyebrow: "A gap from explaining this page", question: "Say the missing part in your own words.", quote: item.prompt };
  }
}

// What the student compares their answer against after revealing.
export function revealFor(item: Pick<ReviewItem, "source" | "prompt" | "answer">): { label: string; body: string } | null {
  switch (item.source) {
    case "topic":
      return item.answer ? { label: "You should be able to", body: item.answer } : null;
    case "highlight":
      return { label: "The full passage", body: item.prompt };
    case "asked":
      return item.answer ? { label: "What the tutor explained", body: item.answer } : null;
    case "mistake":
      return item.answer ? { label: "Model answer", body: item.answer } : null;
    case "misconception":
      return null; // no stored answer: the tutor check or the session fills in
    case "gap":
      return null;
  }
}

export function sessionLink(item: Pick<ReviewItem, "session_id" | "document_id" | "page_number">) {
  const q = item.document_id && item.page_number ? `?doc=${item.document_id}&page=${item.page_number}` : "";
  return `/session/${item.session_id}${q}`;
}
