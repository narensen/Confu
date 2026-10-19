"use client";

import { useEffect, useRef, useState } from "react";
import { eyebrowClass } from "@/components/ui";
import { ACTION_LABELS } from "@/lib/tutor/format";
import type { ChatMessage, PlanTopic, SessionDoc, StudyPlan } from "@/lib/types";
import { Markdown } from "./Markdown";
import type { SendRequest } from "./Workspace";

type Props = {
  messages: ChatMessage[];
  busy: string | null;
  plan: StudyPlan | null;
  docs: SessionDoc[];
  activeTopic: PlanTopic | null;
  onSend: (req: SendRequest) => void;
  onJump: (page: number, docId?: string | null) => void;
  onCite: (page: number, docLabel?: string) => void;
  onOpenPlan: () => void;
};

export function ChatPanel({ messages, busy, plan, docs, activeTopic, onSend, onJump, onCite, onOpenPlan }: Props) {
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

  const last = messages[messages.length - 1];

  return (
    <div className="flex h-full flex-col">
      {/* Current focus keeps the conversation anchored to the goal */}
      {plan && activeTopic && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line bg-paper px-5 py-2.5 text-xs">
          <span className={eyebrowClass}>Focus</span>
          <button onClick={onOpenPlan} className="min-w-0 flex-1 truncate text-left font-medium hover:underline" title={activeTopic.title}>
            {activeTopic.title}
          </button>
          {activeTopic.source === "pdf" && activeTopic.page_start && topicDoc ? (
            <button onClick={() => onJump(activeTopic.page_start!, topicDoc.id)} className="shrink-0 font-mono text-muted transition hover:text-ink">
              {docs.length > 1 ? `${topicDoc.label} ` : ""}pp. {activeTopic.page_start}–{activeTopic.page_end}
            </button>
          ) : (
            <span className="shrink-0 font-mono text-muted">beyond PDFs</span>
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
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5"
      >
        {messages.length === 0 && <EmptyState hasPlan={Boolean(plan)} onOpenPlan={onOpenPlan} />}
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
                  <Markdown content={m.content} onPage={onCite} />
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
        {plan && activeTopic && (
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            <QuickAction disabled={Boolean(busy)} onClick={() => onSend({ action: "teach" })}>
              Teach me this topic
            </QuickAction>
            <QuickAction disabled={Boolean(busy)} onClick={() => onSend({ action: "quiz" })}>
              Check my understanding
            </QuickAction>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-end gap-2 rounded-xl border border-ink bg-panel p-1.5 transition-shadow duration-200 focus-within:shadow-hard-sm"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={Math.min(6, Math.max(1, draft.split("\n").length))}
            placeholder="Ask anything — about your PDFs or beyond them…"
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
    ["Capture region", "in the toolbar, then drag over a figure, table or equation. A vision model reads it and the tutor explains it."],
    ["Teach me / Check my understanding", "work through your plan one idea at a time, including topics beyond the PDF. Your progress is remembered."],
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
