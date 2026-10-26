"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { PassesPanel } from "@/components/paper/PassesPanel";
import { UsageMeter } from "@/components/usage/UsageMeter";
import { ExamProgress } from "@/components/exam/ExamProgress";
import { PracticePanel } from "@/components/exam/PracticePanel";
import type { ExamPractice } from "@/components/exam/useExamPractice";
import type { KeyInfo } from "@/lib/groq-keys";
import { PAPER_MAX_PAGES, type PaperReview } from "@/lib/paper";
import type { ChatMessage, Highlight, LearnerMemory, PlanTopic, SessionDoc, SessionKind, StudyPlan, TopicStatus } from "@/lib/types";
import { ChatPanel } from "./ChatPanel";
import type { HighlightColor } from "@/lib/highlights";
import { HighlightsPanel } from "./HighlightsPanel";
import { MemoryPanel } from "./MemoryPanel";
import { PlanPanel } from "./PlanPanel";
import type { SendRequest } from "./Workspace";

export type Tab = "chat" | "plan" | "passes" | "practice" | "highlights" | "memory";

export type ExamProps = { practice: ExamPractice; examDate: string | null; onExamDate: (date: string | null) => void };

export type PaperProps = {
  reviews: Record<string, PaperReview>;
  researchGoal: string;
  activeDocId: string | null;
  onSelectDoc: (docId: string) => void;
  onUpdate: (docId: string, patch: Partial<PaperReview>, persist?: boolean) => void;
  onResearchGoal: (goal: string) => void;
  fetching: string | null; // papers still being fetched and added ("Adding … 2/4")
  // Study sessions: which materials are research papers (read with the passes).
  paperIds: Set<string>;
  onMarkPaper: (docId: string) => void;
  onAddPapers: () => void;
  studyGoal: string; // the study plan's goal, the default for triage and suggestions
};

type Props = {
  tab: Tab;
  onTab: (tab: Tab) => void;
  sessionId: string;
  docs: SessionDoc[];
  plan: StudyPlan | null;
  topics: PlanTopic[];
  activeTopic: PlanTopic | null;
  memory: LearnerMemory;
  highlights: Highlight[];
  messages: ChatMessage[];
  busy: string | null;
  onSend: (req: SendRequest) => void;
  onJump: (page: number, docId?: string | null) => void;
  onCite: (page: number, docLabel?: string) => void;
  onFocusTopic: (topic: PlanTopic) => void;
  onTopicStatus: (topic: PlanTopic, status: TopicStatus) => void;
  onDeleteHighlight: (h: Highlight) => void;
  onUpdateHighlight: (h: Highlight, patch: { color?: HighlightColor; note?: string | null }) => void;
  onPlanCreated: () => void;
  onClose?: () => void;
  keyInfo?: KeyInfo | null; // the user's own Groq key in use here (never the key itself)
  kind: SessionKind;
  paper: PaperProps;
  exam: ExamProps;
};

export function TutorPanel(props: Props) {
  const { tab, onTab, plan, topics, highlights } = props;
  const done = topics.filter((t) => t.status === "completed").length;
  // Papers inside a study session get the paper session's three-pass tools.
  const studyPapers = props.kind === "study" ? props.docs.filter((d) => props.paper.paperIds.has(d.id)) : [];
  const passDocs = props.kind === "paper" ? props.docs : studyPapers;
  const passesBadge = passDocs.length
    ? `${passDocs.filter((d) => (props.paper.reviews[d.id]?.passes_done ?? 0) >= (props.paper.reviews[d.id]?.target_pass ?? 1)).length}/${passDocs.length}`
    : undefined;
  const answered = props.exam.practice.attempts.length;
  // Exam sessions keep it simple: ask, practise, see progress.
  const tabs: { id: Tab; label: string; badge?: string }[] =
    props.kind === "exam"
      ? [
          { id: "chat", label: "Tutor" },
          { id: "practice", label: "Practice" },
          { id: "memory", label: "Progress", badge: answered ? String(answered) : undefined },
        ]
      : [
          { id: "chat", label: "Tutor" },
          props.kind === "paper"
            ? { id: "passes", label: "Passes", badge: passesBadge }
            : { id: "plan", label: "Plan", badge: plan ? `${done}/${topics.length}` : "Set goal" },
          ...(studyPapers.length ? [{ id: "passes" as const, label: "Papers", badge: passesBadge }] : []),
          { id: "highlights", label: "Highlights", badge: highlights.length ? String(highlights.length) : undefined },
          { id: "memory", label: "Progress" },
        ];
  const activePaper = props.docs.find((d) => d.id === props.paper.activeDocId && (props.kind === "paper" || props.paper.paperIds.has(d.id)));

  // Sliding underline under the active tab.
  const navRef = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = navRef.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
      if (el) setBar({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (navRef.current) ro.observe(navRef.current);
    return () => ro.disconnect();
  }, [tab, plan, topics.length, highlights.length]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className="relative flex h-12 shrink-0 items-stretch border-b border-ink px-3" role="tablist">
        <div ref={navRef} className="relative flex items-stretch gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              data-tab={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => onTab(t.id)}
              className={`flex items-center gap-1.5 px-2.5 text-sm transition-colors duration-200 ${
                tab === t.id ? "font-medium text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
              {t.badge && (
                <span
                  className={`rounded px-1.5 py-px font-mono text-[10px] ${
                    t.id === "plan" && !plan ? "bg-ink text-white" : "border border-line text-muted"
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          ))}
          {bar && (
            <span
              aria-hidden
              className="absolute -bottom-px h-0.5 bg-ink transition-all duration-300 ease-fluid"
              style={{ left: bar.left, width: bar.width }}
            />
          )}
        </div>
        <div className="flex-1" />
        <UsageMeter sessionId={props.sessionId} keyId={props.keyInfo?.id} keyLast4={props.keyInfo?.last4} />
        {props.onClose && (
          <button
            onClick={props.onClose}
            aria-label="Hide tutor"
            className="my-2 flex w-8 items-center justify-center rounded-md text-muted transition hover:bg-paper hover:text-ink"
          >
            ✕
          </button>
        )}
      </nav>
      <div key={tab} className="animate-fade min-h-0 flex-1">
        {tab === "chat" && (
          <ChatPanel
            messages={props.messages}
            busy={props.busy}
            plan={plan}
            docs={props.docs}
            activeTopic={props.activeTopic}
            topics={topics}
            onSend={props.onSend}
            onJump={props.onJump}
            onCite={props.onCite}
            onOpenPlan={() => onTab(props.kind === "paper" ? "passes" : props.kind === "exam" ? "practice" : "plan")}
            onOpenPaper={() => onTab("passes")}
            kind={props.kind}
            paperFocus={(() => {
              const r = activePaper ? props.paper.reviews[activePaper.id] : undefined;
              return activePaper && r ? { label: activePaper.label, title: activePaper.title, done: r.passes_done, target: r.target_pass } : null;
            })()}
          />
        )}
        {tab === "practice" && (
          <PracticePanel
            practice={props.exam.practice}
            docs={props.docs}
            examDate={props.exam.examDate}
            onExamDate={props.exam.onExamDate}
            onJump={props.onJump}
            onAsk={(message) => props.onSend({ action: "chat", message })}
          />
        )}
        {tab === "passes" && (
          <PassesPanel
            sessionId={props.sessionId}
            inStudy={props.kind === "study"}
            docs={passDocs}
            otherDocs={props.kind === "study" ? props.docs.filter((d) => !props.paper.paperIds.has(d.id) && d.hasPdf && d.pageCount <= PAPER_MAX_PAGES) : []}
            onMarkPaper={props.paper.onMarkPaper}
            onAddPapers={props.paper.onAddPapers}
            studyGoal={props.paper.studyGoal}
            activeDocId={props.paper.activeDocId}
            reviews={props.paper.reviews}
            researchGoal={props.paper.researchGoal}
            busy={Boolean(props.busy)}
            onSelectDoc={props.paper.onSelectDoc}
            onUpdate={props.paper.onUpdate}
            onResearchGoal={props.paper.onResearchGoal}
            fetching={props.paper.fetching}
            onSend={props.onSend}
          />
        )}
        {tab === "plan" && (
          <PlanPanel
            sessionId={props.sessionId}
            docs={props.docs}
            plan={plan}
            topics={topics}
            activeTopic={props.activeTopic}
            busy={Boolean(props.busy)}
            onJump={props.onJump}
            onFocusTopic={props.onFocusTopic}
            onTopicStatus={props.onTopicStatus}
            papers={props.paper.paperIds}
            reviews={props.paper.reviews}
            onOpenPaper={(docId) => {
              props.paper.onSelectDoc(docId);
              onTab("passes");
            }}
            onMarkPaper={(docId) => {
              props.paper.onMarkPaper(docId);
              props.paper.onSelectDoc(docId);
              onTab("passes");
            }}
            onTeach={(t) => {
              props.onFocusTopic(t);
              if (t.source === "pdf" && t.page_start && t.document_id) props.onJump(t.page_start, t.document_id);
              props.onSend({ action: "teach", topicId: t.id });
            }}
            onPlanCreated={props.onPlanCreated}
          />
        )}
        {tab === "highlights" && (
          <HighlightsPanel
            highlights={highlights}
            docs={props.docs}
            busy={Boolean(props.busy)}
            onJump={props.onJump}
            onDelete={props.onDeleteHighlight}
            onUpdate={props.onUpdateHighlight}
            onSend={props.onSend}
          />
        )}
        {tab === "memory" &&
          (props.kind === "exam" ? (
            <ExamProgress
              practice={props.exam.practice}
              examDate={props.exam.examDate}
              memorySummary={props.memory.summary}
              onPractiseWeak={(weak) => {
                onTab("practice");
                void props.exam.practice.start({ topics: weak });
              }}
            />
          ) : (
            <MemoryPanel memory={props.memory} plan={plan} topics={topics} />
          ))}
      </div>
    </div>
  );
}
