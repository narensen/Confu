"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/dialogs";
import { eyebrowClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { routeOf, track } from "@/lib/telemetry";
import { ACTION_LABELS } from "@/lib/tutor/format";
import type { ChatMessage, PlanTopic, SessionDoc, SessionKind, StudyPlan } from "@/lib/types";
import { Markdown } from "./Markdown";
import { StartHere } from "./StartHere";
import type { CiteFiles, SendRequest } from "./Workspace";

type Props = {
  messages: ChatMessage[];
  busy: string | null;
  plan: StudyPlan | null;
  docs: SessionDoc[];
  activeTopic: PlanTopic | null;
  topics: PlanTopic[];
  onSend: (req: SendRequest) => void;
  onJump: (page: number, docId?: string | null) => void;
  onCite: (page: number, docLabel?: string) => void;
  onOpenPlan: () => void;
  kind: SessionKind;
  citeMode: boolean;
  onCiteMode: (on: boolean) => void;
  citeFiles: CiteFiles | null;
  activeDocId: string | null;
  paperFocus: { label: string; title: string; done: number; target: number } | null;
  onOpenPaper?: () => void;
};

export function ChatPanel({ messages, busy, plan, docs, activeTopic, topics, onSend, onJump, onCite, onOpenPlan, onOpenPaper, kind, citeMode, onCiteMode, citeFiles, activeDocId, paperFocus }: Props) {
  const topicDoc = docs.find((d) => d.id === activeTopic?.document_id);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Messages loaded with the page appear instantly; only new ones animate in.
  const [initialCount] = useState(messages.length);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: initialCount === messages.length ? "auto" : "smooth" });
  }, [messages, busy, initialCount]);

  function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    onSend({ action: "chat", message: text });
    setDraft("");
    stick.current = true;
  }

  function draw() {
    if (busy) return;
    const text = draft.trim();
    onSend({ action: "diagram", message: text || undefined });
    if (text) setDraft("");
    stick.current = true;
  }

  const last = messages[messages.length - 1];

  return (
    <div className="flex h-full min-w-0 flex-col">
      {paperFocus && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line bg-paper px-5 py-2.5 text-xs">
          <span className={eyebrowClass}>Reading</span>
          <button onClick={onOpenPaper ?? onOpenPlan} className="min-w-0 flex-1 truncate text-left font-medium hover:underline" title={paperFocus.title}>
            {paperFocus.label} · {paperFocus.title}
          </button>
          <span className="shrink-0 font-mono text-muted">
            {paperFocus.done >= paperFocus.target ? `done (pass ${paperFocus.target})` : `pass ${Math.min(3, paperFocus.done + 1)} of ${paperFocus.target}`}
          </span>
        </div>
      )}

      {/* Current focus keeps the conversation anchored to the goal */}
      {plan && activeTopic && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line bg-paper px-5 py-2.5 text-xs">
          <span className={eyebrowClass}>Focus</span>
          <button onClick={onOpenPlan} className="min-w-0 flex-1 truncate text-left font-medium hover:underline" title={activeTopic.title}>
            {activeTopic.title}
          </button>
          {activeTopic.source === "pdf" && activeTopic.page_start && topicDoc ? (
            <button onClick={() => onJump(activeTopic.page_start!, topicDoc.id)} className="shrink-0 font-mono text-muted transition hover:text-ink">
              {docs.length > 1 ? `${topicDoc.label} ` : ""}
              {activeTopic.page_start === activeTopic.page_end ? `p. ${activeTopic.page_start}` : `pp. ${activeTopic.page_start}–${activeTopic.page_end}`}
            </button>
          ) : (
            <span className="shrink-0 font-mono text-muted">beyond your files</span>
          )}
          <span className="shrink-0 font-mono tabular-nums">{Math.round(activeTopic.mastery * 100)}%</span>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 min-w-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto px-5 py-5"
      >
        {messages.length === 0 &&
          (kind === "paper" ? (
            <PaperEmptyState onOpenPasses={onOpenPlan} />
          ) : kind === "exam" ? (
            <ExamEmptyState onOpenPractice={onOpenPlan} />
          ) : (
            <>
              {plan && activeTopic && activeTopic.status !== "completed" && (
                <StartHere
                  topic={activeTopic}
                  topics={topics}
                  docs={docs}
                  busy={Boolean(busy)}
                  onOpen={(t) => {
                    const d = docs.find((x) => x.id === t.document_id);
                    if (t.source === "pdf" && t.page_start !== null && d) onJump(t.page_start, d.id);
                  }}
                  onOpenDoc={(id) => onJump(docs.find((d) => d.id === id)?.lastPage || 1, id)}
                  onTeach={() => onSend({ action: "teach" })}
                />
              )}
              <EmptyState hasPlan={Boolean(plan)} onOpenPlan={onOpenPlan} />
            </>
          ))}
        {messages.map((m, i) => {
          const isNew = i >= initialCount;
          return m.role === "user" ? (
            <div key={m.id} className={`ml-10 ${isNew ? "animate-enter" : ""}`}>
              <div className="rounded-xl rounded-br-sm border border-ink bg-panel px-4 py-3 text-sm shadow-hard-sm">
                {m.action !== "chat" && <p className={`${eyebrowClass} mb-1.5`}>{ACTION_LABELS[m.action]}</p>}
                <Markdown content={m.content} onPage={onCite} />
              </div>
            </div>
          ) : (
            <div key={m.id} className={`pr-2 ${isNew ? "animate-enter" : ""}`}>
              {m.content ? (
                <div className={busy && m === last ? "is-streaming" : ""}>
                  <AnswerBody content={m.content} onCite={onCite} done={!(busy && m === last)} />
                  {busy && m === last && busy !== "Thinking…" && (
                    <p className="animate-fade mt-2 flex items-center gap-2 font-mono text-[11px] text-muted">
                      <span className="size-1.5 animate-pulse rounded-full bg-ink" />
                      {busy}
                    </p>
                  )}
                </div>
              ) : (
                <Thinking label={busy ?? "Thinking…"} />
              )}
            </div>
          );
        })}
        {busy && last?.role !== "assistant" && <Thinking label={busy} />}
      </div>

      <div className="shrink-0 border-t border-ink bg-panel p-3">
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {kind === "exam" &&
            EXAM_PROMPTS.map((p) => (
              <QuickAction key={p.label} disabled={Boolean(busy)} onClick={() => onSend({ action: "chat", message: p.message })}>
                {p.label}
              </QuickAction>
            ))}
          {plan && activeTopic && (
            <>
              <QuickAction disabled={Boolean(busy)} onClick={() => onSend({ action: "teach" })}>
                Teach me this topic
              </QuickAction>
              <QuickAction disabled={Boolean(busy)} onClick={() => onSend({ action: "quiz" })}>
                Check my understanding
              </QuickAction>
            </>
          )}
          <QuickAction disabled={Boolean(busy)} onClick={draw}>
            Draw a diagram
          </QuickAction>
        </div>
        {citeFiles && <CitePicker docs={docs} activeDocId={activeDocId} citeFiles={citeFiles} />}
        <label className="mb-2 flex cursor-pointer items-start gap-2 px-1 text-xs leading-snug text-muted">
          <input type="checkbox" checked={citeMode} onChange={(e) => onCiteMode(e.target.checked)} className="mt-0.5" />
          <span>Answers have to cite a page in this session.</span>
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-end gap-2 rounded-xl border border-ink bg-panel p-1.5 transition-shadow duration-200 focus-within:shadow-hard-sm"
        >
          <textarea
            id="tutor-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={Math.min(6, Math.max(1, draft.split("\n").length))}
            placeholder={citeFiles ? "Ask about the files you've turned on…" : "Ask anything, about your files or beyond them…"}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted"
          />
          <button
            disabled={!draft.trim() || Boolean(busy)}
            aria-label="Send"
            className="flex size-9 items-center justify-center rounded-lg bg-ink text-white transition duration-200 hover:opacity-85 active:scale-95 disabled:opacity-30"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}

function AnswerBody({ content, onCite, done }: { content: string; onCite: (page: number, docLabel?: string) => void; done: boolean }) {
  const body = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  async function copy() {
    const text = body.current?.innerText.replace(/\n{3,}/g, "\n\n").trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("Couldn't copy that.", "error");
    }
  }

  function choose(next: "up" | "down") {
    setRating(next);
    setOpen(true);
    setSent(false);
  }

  async function send() {
    if (!rating || sending) return;
    setSending(true);
    const verdict = rating === "up" ? "Tutor answer · helpful" : "Tutor answer · not helpful";
    const message = [verdict, note.trim(), "Answer:", content.replace(/\s+/g, " ").trim().slice(0, 1200)].filter(Boolean).join("\n\n").slice(0, 4000);
    const { error } = await createClient()
      .from("feedback")
      .insert({ kind: rating === "up" ? "love" : "confusing", message, path: routeOf(location.pathname), user_agent: navigator.userAgent.slice(0, 300) });
    setSending(false);
    if (error) {
      toast("Couldn't send that. Try again once you're signed in.", "error");
      return;
    }
    setSent(true);
    setOpen(false);
    track("feedback.sent", { kind: rating === "up" ? "love" : "confusing" });
    toast(rating === "up" ? "Glad that one helped." : "Thanks. That note goes to the person building Confu.");
  }

  return (
    <div>
      <div ref={body}>
        <Markdown content={content} onPage={onCite} />
      </div>
      {done && (
        <div className="mt-2">
          <div className="flex flex-wrap items-center gap-1">
            <AnswerButton onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</AnswerButton>
            <AnswerButton pressed={rating === "up"} onClick={() => choose("up")}>
              Helpful
            </AnswerButton>
            <AnswerButton pressed={rating === "down"} onClick={() => choose("down")}>
              Not quite
            </AnswerButton>
          </div>
          {open && !sent && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="mt-2"
            >
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder={rating === "down" ? "What was wrong or missing?" : "What worked? Optional."}
                className="w-full resize-none rounded-lg border border-ink/25 bg-panel px-2.5 py-1.5 text-xs leading-relaxed outline-none placeholder:text-muted/70 focus:border-ink"
              />
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <p className="text-[11px] leading-snug text-muted">Stays with Confu. Not sold, and not used to train a model.</p>
                <button type="submit" disabled={sending} className="shrink-0 rounded-md border border-ink bg-ink px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function AnswerButton({ children, pressed, onClick }: { children: React.ReactNode; pressed?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
        pressed ? "border-ink bg-ink text-white" : "border-ink/25 text-muted hover:border-ink hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function CitePicker({ docs, activeDocId, citeFiles }: { docs: SessionDoc[]; activeDocId: string | null; citeFiles: CiteFiles }) {
  const { ids, custom, onToggle, onAll, onOpenOnly } = citeFiles;
  const on = new Set(ids);
  const summary = ids.length === docs.length ? "All files" : ids.length === 1 ? "One file" : `${ids.length} files`;
  return (
    <div className="mb-2.5">
      <div className="mb-1.5 flex items-center gap-2 px-1">
        <span className={eyebrowClass}>Cite</span>
        <span className="text-xs text-muted">{summary}</span>
        <span className="ml-auto flex items-center gap-2">
          {ids.length < docs.length && (
            <button type="button" onClick={onAll} className="text-xs font-medium underline underline-offset-2 transition hover:opacity-70">
              All
            </button>
          )}
          {custom && activeDocId && (
            <button type="button" onClick={onOpenOnly} className="text-xs text-muted underline underline-offset-2 transition hover:text-ink">
              Just the open file
            </button>
          )}
        </span>
      </div>
      <div role="group" aria-label="Files the tutor may cite" className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
        {docs.map((d) => {
          const selected = on.has(d.id);
          const open = d.id === activeDocId;
          return (
            <button
              key={d.id}
              type="button"
              aria-pressed={selected}
              title={selected ? (ids.length === 1 ? `${d.title} is the only file this answer can cite` : `Citing ${d.title}. Click to leave it out.`) : `Also cite ${d.title}`}
              onClick={() => onToggle(d.id)}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-left text-xs transition ${
                selected ? "border-ink bg-ink text-white" : "border-ink/30 bg-panel text-muted hover:border-ink hover:text-ink"
              }`}
            >
              <span className="font-mono">{d.label}</span>
              <span className="max-w-[10rem] truncate">{d.title}</span>
              {open && <span className={selected ? "text-white/70" : ""}>open</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Thinking({ label }: { label: string }) {
  return (
    <div className="animate-fade flex items-center gap-2.5 text-sm text-muted">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-bounce rounded-full bg-ink" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </span>
      {label}
    </div>
  );
}

function QuickAction({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="rounded-full border border-ink px-3 py-1 text-xs font-medium transition duration-200 ease-fluid hover:bg-ink hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-40"
      {...rest}
    >
      {children}
    </button>
  );
}

function EmptyState({ hasPlan, onOpenPlan }: { hasPlan: boolean; onOpenPlan: () => void }) {
  const items = [
    ["Select text", "in the PDF to ask a doubt, summarize it, see its context, or get it explained simply."],
    ["Capture", "in the toolbar, then drag over a figure, table or equation. A vision model reads it and the tutor explains it."],
    ["Teach me / Check my understanding", "work through your plan one idea at a time, including topics beyond the PDF. Your progress is remembered."],
    ["Draw a diagram", "asks for a picture of the idea. It shows up in the chat as an image you can look at."],
    ["Cite", "turn on more than one file under the box. The answer can use each of them, and a citation still opens that page."],
  ];
  return (
    <div className="animate-enter py-4">
      <p className={eyebrowClass}>Getting started</p>
      <h3 className="mt-1 font-serif text-2xl">How to learn here</h3>
      <ol className="mt-5 space-y-4">
        {items.map(([title, body], i) => (
          <li key={title} className="animate-enter flex gap-3 text-sm" style={{ animationDelay: `${100 + i * 80}ms` }}>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-ink font-mono text-[11px]">{i + 1}</span>
            <p className="leading-relaxed text-muted">
              <span className="font-medium text-ink">{title}</span> {body}
            </p>
          </li>
        ))}
      </ol>
      {!hasPlan && (
        <button onClick={onOpenPlan} className="mt-6 text-sm font-medium underline underline-offset-4 transition hover:opacity-70">
          Start by setting your goal →
        </button>
      )}
    </div>
  );
}

function PaperEmptyState({ onOpenPasses }: { onOpenPasses: () => void }) {
  const items = [
    ["Pass 1, bird's-eye view", "Title, abstract, introduction, headings, conclusion. Answer the five Cs and decide if the paper deserves more."],
    ["Pass 2, the content", "Read it properly but skip the proofs. Scrutinise the figures, then explain the main idea and its evidence."],
    ["Pass 3, virtual re-implementation", "Rebuild it from its assumptions. The hidden assumptions and gaps you find are your research ideas."],
  ];
  return (
    <div className="animate-enter py-4">
      <p className={eyebrowClass}>Paper session</p>
      <h3 className="mt-1 font-serif text-2xl">Read papers in three passes</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Each pass goes deeper, and you stop as soon as you have what you need. Most papers only need the first.
      </p>
      <ol className="mt-5 space-y-4">
        {items.map(([title, body], i) => (
          <li key={title} className="animate-enter flex gap-3 text-sm" style={{ animationDelay: `${100 + i * 80}ms` }}>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-ink font-mono text-[11px]">{i + 1}</span>
            <p className="leading-relaxed text-muted">
              <span className="font-medium text-ink">{title}.</span> {body}
            </p>
          </li>
        ))}
      </ol>
      <button onClick={onOpenPasses} className="mt-6 text-sm font-medium underline underline-offset-4 transition hover:opacity-70">
        Set your research goal and triage your papers →
      </button>
    </div>
  );
}

const EXAM_PROMPTS = [
  { label: "What's likely to come up?", message: "Based on my notes, what topics and question types are most likely to come up in the exam? Rank them and say why." },
  { label: "Make a cheat sheet", message: "Make me a one-page revision cheat sheet from my notes: key definitions, formulas and facts, grouped by topic, with page references." },
  { label: "Explain my weakest topic", message: "Explain my weakest topic from practice so I can answer exam questions on it. Keep it exam-focused." },
];

function ExamEmptyState({ onOpenPractice }: { onOpenPractice: () => void }) {
  return (
    <div className="animate-enter py-4">
      <p className={eyebrowClass}>Exam prep</p>
      <h3 className="mt-1 font-serif text-2xl">Ask anything from your notes</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Select text in your PDF to ask about it, or use the buttons below. Answers come from your own course material, with page
        references, and show how to write it in the exam.
      </p>
      <button onClick={onOpenPractice} className="mt-5 text-sm font-medium underline underline-offset-4 transition hover:opacity-70">
        Or test yourself with practice questions →
      </button>
    </div>
  );
}
