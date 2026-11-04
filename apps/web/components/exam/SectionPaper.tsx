"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";
import { JSON_HEADERS } from "@/lib/ai-errors";
import { SITTING_SECONDS } from "@/lib/sitting";
import { SITE } from "@/lib/site";
import { createClient } from "@/lib/supabase/client";
import type { SessionDoc } from "@confu/core/types";

type PublicQ = { id: string; question: string; options: string[]; topic: string; sourceTitle: string; page: number };
type Handin = { score: number; outOf: number; minutes: number; topics: string[]; explanations?: { topic: string; explanation: string; sourceTitle: string; page: number }[]; already?: boolean };
type Paper = { owner: boolean; lines: string[]; questions: PublicQ[] | null; handin: { score: number; outOf: number; topics: string[]; minutes: number } | null };

const QUIET = /Packs are not in this database|Pack copies are not in this database|Publish the pack first|schema cache|Could not find the function|my_pack_copy|save_section_lines|get_section_paper/i;

export function SectionPaper({ sessionId, docs, onJump }: { sessionId: string; docs: SessionDoc[]; onJump: (page: number, docId?: string | null) => void }) {
  const [paper, setPaper] = useState<Paper | null>(null);
  const [hidden, setHidden] = useState(false);
  const [lines, setLines] = useState<string[]>(Array.from({ length: 8 }, () => ""));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sitting, setSitting] = useState(false);
  const [result, setResult] = useState<Handin | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase.rpc("get_section_paper", { p_session: sessionId }).then(({ data, error: rpcError }) => {
      if (rpcError) {
        if (QUIET.test(rpcError.message)) setHidden(true);
        return;
      }
      const row = data as Paper | null;
      if (!row) return setHidden(true);
      setPaper(row);
      if (row.lines?.length) setLines((cur) => cur.map((c, i) => row.lines[i] ?? c));
      if (!row.owner && !row.questions) setHidden(true);
    });
  }, [sessionId]);

  if (hidden || !paper) return null;
  const questions = paper.questions;

  async function generate() {
    const body = lines.map((l) => l.trim()).filter(Boolean);
    if (!body.length) return setError("Add a line for what the paper covers.");
    if (body.some((l) => l.length > 80)) return setError("Each line has to be 80 characters or fewer.");
    setBusy("Writing the section paper…");
    setError(null);
    try {
      const res = await fetch("/api/exam/section", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ sessionId, lines: body }) });
      const json = (await res.json().catch(() => ({}))) as { questions?: PublicQ[]; error?: string };
      if (!res.ok || !json.questions) throw new Error(json.error ?? "Couldn't make questions this time. Try again.");
      setPaper((p) => (p ? { ...p, questions: json.questions!, lines: body } : p));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make questions this time. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function withdraw() {
    setBusy("Withdrawing…");
    const { error: rpcError } = await createClient().rpc("withdraw_section_paper", { p_session: sessionId });
    setBusy(null);
    if (rpcError) return setError(rpcError.message);
    setPaper((p) => (p ? { ...p, questions: null, handin: null } : p));
    setResult(null);
    setSitting(false);
  }

  if (busy) {
    return (
      <section className="border-b border-ink px-6 py-8 text-center">
        <p className="font-serif text-2xl">{busy}</p>
        <div className="indeterminate mx-auto mt-4 h-[3px] w-48 rounded-full bg-line" />
      </section>
    );
  }

  if (sitting && questions) {
    return (
      <Sit
        questions={questions}
        docs={docs}
        sessionId={sessionId}
        onJump={onJump}
        onDone={(handin) => {
          setResult(handin);
          setSitting(false);
          setPaper((p) => (p ? { ...p, handin: { score: handin.score, outOf: handin.outOf, topics: handin.topics, minutes: handin.minutes } } : p));
        }}
      />
    );
  }

  const shown = result ?? (paper.handin ? { ...paper.handin, explanations: [] } : null);
  return (
    <section className="space-y-4 border-b border-ink px-6 py-6">
      <div>
        <p className={eyebrowClass}>Section paper</p>
        <h2 className="mt-1 font-serif text-2xl leading-tight">{questions ? "Sit the section paper" : "What the paper covers"}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          {questions
            ? "Ten questions, fifteen minutes, the same paper as the section. Marks stay hidden until you hand it in. The key never comes to this browser."
            : "Up to eight lines. A line over 80 characters is refused, so a pasted question doesn't fit."}
        </p>
      </div>
      {!questions && paper.owner && (
        <div className="space-y-2">
          {lines.map((line, i) => (
            <input
              key={i}
              value={line}
              maxLength={80}
              onChange={(e) => setLines((cur) => cur.map((c, j) => (j === i ? e.target.value.replace(/\n/g, "") : c)))}
              placeholder={i === 0 ? "Three charges on a line" : `Line ${i + 1}`}
              className={`${inputClass} py-1.5 text-sm`}
            />
          ))}
          <button type="button" onClick={() => void generate()} disabled={!docs.length} className={`${buttonClass} w-full py-2.5`}>
            Make the section paper
          </button>
        </div>
      )}
      {questions && !shown && (
        <button type="button" onClick={() => setSitting(true)} className={`${buttonClass} w-full py-2.5`}>
          Sit the section paper
        </button>
      )}
      {shown && <Result sessionId={sessionId} handin={shown} docs={docs} onJump={onJump} />}
      {error && <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
      {paper.owner && questions && (
        <button type="button" onClick={() => void withdraw()} className={`${ghostButtonClass} py-1.5 text-xs`}>
          Withdraw this paper
        </button>
      )}
    </section>
  );
}

function Sit({
  questions,
  docs,
  sessionId,
  onJump,
  onDone,
}: {
  questions: PublicQ[];
  docs: SessionDoc[];
  sessionId: string;
  onJump: (page: number, docId?: string | null) => void;
  onDone: (handin: Handin) => void;
}) {
  const [index, setIndex] = useState(0);
  const [choices, setChoices] = useState<number[]>(() => questions.map(() => -1));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const q = questions[index];

  async function handIn() {
    setPending(true);
    setError(null);
    const minutes = Math.max(0, Math.round((Date.now() - startedAt) / 60000));
    try {
      const res = await fetch("/api/exam/section/hand-in", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ sessionId, choices, minutes }),
      });
      const json = (await res.json().catch(() => ({}))) as Handin & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Couldn't hand it in.");
      onDone(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't hand it in.");
      setPending(false);
    }
  }

  return (
    <section className="space-y-4 border-b border-ink px-6 py-6">
      <div className="flex items-center justify-between">
        <p className={eyebrowClass}>
          {index + 1} / {questions.length}
        </p>
        <Clock startedAt={startedAt} onDone={() => void handIn()} />
      </div>
      <p className="font-serif text-xl leading-snug">{q.question}</p>
      <div className="space-y-2">
        {q.options.map((option, i) => (
          <button
            key={option}
            type="button"
            onClick={() => setChoices((cur) => cur.map((c, j) => (j === index ? i : c)))}
            className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${choices[index] === i ? "border-ink bg-yellow-50" : "border-ink/30"}`}
          >
            {option}
          </button>
        ))}
      </div>
      <PageHint q={q} docs={docs} onJump={onJump} />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        {index > 0 && (
          <button type="button" onClick={() => setIndex((n) => n - 1)} className={`${ghostButtonClass} py-1.5 text-xs`}>
            Back
          </button>
        )}
        {index < questions.length - 1 ? (
          <button type="button" onClick={() => setIndex((n) => n + 1)} className={`${buttonClass} py-1.5 text-xs`}>
            Next
          </button>
        ) : (
          <button type="button" disabled={pending} onClick={() => void handIn()} className={`${buttonClass} py-1.5 text-xs`}>
            {pending ? "Handing in…" : "Hand in"}
          </button>
        )}
      </div>
    </section>
  );
}

function Result({ sessionId, handin, docs, onJump }: { sessionId: string; handin: Handin; docs: SessionDoc[]; onJump: (page: number, docId?: string | null) => void }) {
  const [showName, setShowName] = useState(true);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function share() {
    setError(null);
    const res = await fetch("/api/sitting/share", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId, score: handin.score, outOf: handin.outOf, minutes: handin.minutes, topics: handin.topics, showName }),
    });
    const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
    if (!res.ok || !body.token) return setError(body.error ?? "Couldn't share it.");
    setLink(`${SITE.url}/sit/${body.token}`);
  }
  return (
    <div>
      <p className="font-serif text-4xl tabular-nums">
        {handin.score}
        <span className="text-2xl text-muted"> / {handin.outOf}</span>
      </p>
      {handin.topics.length > 0 && <p className="mt-2 text-sm">Missed: {handin.topics.join(", ")}</p>}
      {(handin.explanations ?? []).map((e) => (
        <div key={`${e.topic}-${e.page}`} className="mt-3 text-sm">
          <p className="font-medium">{e.topic}</p>
          <p className="mt-1 text-muted">{e.explanation}</p>
          <PageHint q={{ sourceTitle: e.sourceTitle, page: e.page }} docs={docs} onJump={onJump} />
        </div>
      ))}
      <div className="mt-4">
        {link ? (
          <code className="block truncate rounded-md border border-line bg-panel px-2 py-1 font-mono text-[11px]">{link}</code>
        ) : (
          <div className="rounded-lg border border-dashed border-ink/40 p-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} className="mt-0.5 size-4 accent-[var(--ink)]" />
              <span>Show my first name on the card</span>
            </label>
            <button type="button" onClick={() => void share()} className={`${ghostButtonClass} mt-3 py-1.5 text-xs`}>
              Share a card
            </button>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}

function PageHint({ q, docs, onJump }: { q: { sourceTitle: string; page: number }; docs: SessionDoc[]; onJump: (page: number, docId?: string | null) => void }) {
  const doc = docs.find((d) => d.title === q.sourceTitle && q.page >= 1 && q.page <= Math.max(1, d.pageCount));
  if (!doc) return <p className="mt-2 font-mono text-[11px] text-muted">{q.sourceTitle}, p. {q.page}</p>;
  return (
    <button type="button" onClick={() => onJump(q.page, doc.id)} className="mt-2 font-mono text-[11px] underline">
      {q.sourceTitle}, p. {q.page}
    </button>
  );
}

function Clock({ startedAt, onDone }: { startedAt: number; onDone: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, SITTING_SECONDS * 1000 - (now - startedAt));
  useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      onDone();
    }
  }, [left, onDone]);
  const sec = Math.ceil(left / 1000);
  return (
    <span className={`font-mono text-xs tabular-nums ${sec <= 60 ? "text-warn" : "text-muted"}`}>
      {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
    </span>
  );
}
