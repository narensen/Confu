// Exam sessions: practice questions and weak-topic tracking. Shared by the UI
// and the server.

export type QuestionKind = "mcq" | "short";

export type ExamQuestion = {
  id: string;
  kind: QuestionKind;
  question: string;
  options?: string[]; // mcq only
  correct?: number; // mcq only: index into options
  answer?: string; // short only: model answer
  explanation: string;
  topic: string;
  documentId: string | null;
  label: string; // "D1"
  page: number | null;
};

export type Attempt = { topic: string; score: number; created_at: string };

export type TopicStat = { topic: string; attempts: number; accuracy: number; level: "weak" | "improving" | "strong" | "new" };

// Topics ranked weakest first. Fewer than two answers isn't enough to judge.
export function topicStats(attempts: Attempt[]): TopicStat[] {
  const byTopic = new Map<string, number[]>();
  for (const a of attempts) {
    const key = a.topic.trim();
    byTopic.set(key, [...(byTopic.get(key) ?? []), a.score]);
  }
  return [...byTopic]
    .map(([topic, scores]) => {
      // Recent answers matter most: average the latest five.
      const recent = scores.slice(0, 5);
      const accuracy = recent.reduce((s, x) => s + x, 0) / recent.length;
      const level: TopicStat["level"] = scores.length < 2 ? "new" : accuracy < 0.5 ? "weak" : accuracy < 0.8 ? "improving" : "strong";
      return { topic, attempts: scores.length, accuracy, level };
    })
    .sort((a, b) => (a.level === "new" ? 1 : 0) - (b.level === "new" ? 1 : 0) || a.accuracy - b.accuracy);
}

export function daysUntil(date: string | null, today: string): number | null {
  if (!date) return null;
  const [y1, m1, d1] = today.split("-").map(Number);
  const [y2, m2, d2] = date.split("-").map(Number);
  return Math.round((new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime()) / 86_400_000);
}

export function countdownLabel(days: number | null): string {
  if (days === null) return "No exam date set";
  if (days < 0) return "Exam date has passed";
  if (days === 0) return "Exam is today";
  if (days === 1) return "Exam is tomorrow";
  return `${days} days to the exam`;
}
