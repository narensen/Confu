"use client";

import { useCallback, useMemo, useState } from "react";
import { JSON_HEADERS, notifyAiUsed, readAiError } from "@/lib/ai-errors";
import { topicStats, type Attempt, type ExamQuestion, type QuestionKind } from "@/lib/exam";
import { createClient } from "@/lib/supabase/client";

export type Answer = { choice?: number; text?: string; score: number; feedback?: string };

export type Quiz = { questions: ExamQuestion[]; index: number; answers: Record<string, Answer>; focus: string[] };

export type StartOptions = { documentId?: string | null; topics?: string[]; mix?: "mixed" | QuestionKind; count?: number };

// Practice state for an exam session: the current quiz, marking, and the
// history of answers that weak topics are computed from.
export function useExamPractice(sessionId: string, initialAttempts: Attempt[]) {
  const supabase = useMemo(() => createClient(), []);
  const [attempts, setAttempts] = useState(initialAttempts);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => topicStats(attempts), [attempts]);

  const start = useCallback(
    async ({ documentId = null, topics = [], mix = "mixed", count = 5 }: StartOptions = {}) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/exam/quiz", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ sessionId, documentId, topics, mix, count }),
        });
        if (!res.ok) throw new Error(await readAiError(res));
        const { questions } = (await res.json()) as { questions: ExamQuestion[] };
        setQuiz({ questions, index: 0, answers: {}, focus: topics });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't make questions.");
      } finally {
        setLoading(false);
        notifyAiUsed();
      }
    },
    [sessionId],
  );

  const record = useCallback(
    async (q: ExamQuestion, answer: Answer) => {
      setQuiz((cur) => (cur ? { ...cur, answers: { ...cur.answers, [q.id]: answer } } : cur));
      const { data } = await supabase
        .from("exam_attempts")
        .insert({
          session_id: sessionId,
          document_id: q.documentId,
          page_number: q.page,
          topic: q.topic,
          question: q.question.slice(0, 2000),
          kind: q.kind,
          score: answer.score,
        })
        .select("topic, score, created_at")
        .single();
      if (data) setAttempts((list) => [data as Attempt, ...list]);
      // Missed or partly right: it comes back in spaced review, with its answer.
      if (answer.score < 1) {
        const model = q.kind === "mcq" && q.options && q.correct !== undefined ? q.options[q.correct] : (q.answer ?? "");
        await supabase.from("review_items").upsert(
          {
            session_id: sessionId,
            document_id: q.documentId,
            page_number: q.page,
            source: "mistake",
            source_key: q.question.trim().toLowerCase().slice(0, 500),
            prompt: q.question.slice(0, 2000),
            answer: [model, q.explanation].filter(Boolean).join("\n\n").slice(0, 4000),
          },
          { onConflict: "user_id,source,source_key", ignoreDuplicates: true },
        );
      }
    },
    [sessionId, supabase],
  );

  const answerChoice = useCallback((q: ExamQuestion, choice: number) => record(q, { choice, score: choice === q.correct ? 1 : 0 }), [record]);

  const answerText = useCallback(
    async (q: ExamQuestion, text: string) => {
      setMarking(true);
      setError(null);
      try {
        const res = await fetch("/api/exam/grade", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ sessionId, question: q.question, expected: q.answer, answer: text }),
        });
        if (!res.ok) throw new Error(await readAiError(res));
        const { score, feedback } = (await res.json()) as { score: number; feedback: string };
        await record(q, { text, score, feedback });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't mark that answer.");
      } finally {
        setMarking(false);
        notifyAiUsed();
      }
    },
    [record, sessionId],
  );

  const next = useCallback(() => setQuiz((cur) => (cur ? { ...cur, index: cur.index + 1 } : cur)), []);
  const reset = useCallback(() => setQuiz(null), []);

  return { attempts, stats, quiz, loading, marking, error, start, answerChoice, answerText, next, reset };
}

export type ExamPractice = ReturnType<typeof useExamPractice>;
