"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { PassesPanel, type PaperTool } from "@/components/paper/PassesPanel";
import { UsageMeter } from "@/components/usage/UsageMeter";
import { ExamProgress } from "@/components/exam/ExamProgress";
import { PracticePanel } from "@/components/exam/PracticePanel";
import type { ExamPractice } from "@/components/exam/useExamPractice";
import type { KeyInfo } from "@/lib/groq-keys";
import type { PaperReview } from "@/lib/paper";
import type { ChatMessage, Highlight, LearnerMemory, PlanTopic, SessionDoc, SessionKind, StudyPlan, TopicStatus } from "@/lib/types";
import { ChatPanel } from "./ChatPanel";
import type { HighlightColor } from "@/lib/highlights";
import { HighlightsPanel } from "./HighlightsPanel";
import { MemoryPanel } from "./MemoryPanel";
import { PlanPanel, type PlanSetup } from "./PlanPanel";
import { FilesPanel, type FilesProps } from "./FilesPanel";
import type { SendRequest } from "./Workspace";

export type Tab = "chat" | "plan" | "passes" | "practice" | "highlights" | "memory" | "files";

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
  onOpenMap: () => void;
  onTool: (tool: PaperTool) => void;
  passesOpen: boolean; // one paper's passes shown, rather than the reading list
  onPassesOpen: (open: boolean) => void;
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
  onRecall: (topic: PlanTopic) => void;
  onListen: (topic: PlanTopic) => void;
  onDeleteHighlight: (h: Highlight) => void;
  onUpdateHighlight: (h: Highlight, patch: { color?: HighlightColor; note?: string | null }) => void;
  onPlanCreated: () => void;
  onRepace: (minutesPerDay: number, deadline: string) => Promise<void>;
  draftGoal: string; // a template's or pack's goal, to start the plan from
  setup: PlanSetup;
  files: FilesProps; // every PDF: open, close its tab, delete
  onClose?: () => void;
  // Where it's shown: everything with tabs (phones, full screen), the study
  // sections on the left (no chat), or the tutor chat on the right.
  layout?: "full" | "sections" | "chat";
  onCollapse?: () => void; // the side layouts can fold away
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
  // Files: how many, and "+n" for what's still coming in or waiting to be added from the goal.
  const waiting = props.files.uploads.length + (props.files.later ? props.files.later.later.papers.length + props.files.later.later.links.length : 0);
  const filesBadge = props.files.docs.length || waiting ? `${props.files.docs.length}${waiting ? ` +${waiting}` : ""}` : undefined;
  // Exam sessions keep it simple: ask, practise, see progress.
  const tabs: { id: Tab; label: string; badge?: string }[] =
    props.kind === "exam"
      ? [
          { id: "chat", label: "Tutor" },
          { id: "practice", label: "Practice" },
          { id: "memory", label: "Progress", badge: answered ? String(answered) : undefined },
          { id: "files", label: "Files", badge: filesBadge },
        ]
      : [
          { id: "chat", label: "Tutor" },
          props.kind === "paper"
            ? { id: "passes", label: "Passes", badge: passesBadge }
            : { id: "plan", label: "Plan", badge: plan ? `${done}/${topics.length}` : "Set goal" },
          ...(studyPapers.length ? [{ id: "passes" as const, label: "Papers", badge: passesBadge }] : []),
          { id: "highlights", label: "Highlights", badge: highlights.length ? String(highlights.length) : undefined },
          { id: "memory", label: "Progress" },
          { id: "files", label: "Files", badge: filesBadge },
        ];
  const layout = props.layout ?? "full";
  const navTabs = layout === "sections" ? tabs.filter((t) => t.id !== "chat") : tabs;
  // What's on screen: the chat side always shows the chat; the sections side
  // shows the chosen section (its first one while the chat is "the tab").
  const shown: Tab = layout === "chat" ? "chat" : navTabs.some((t) => t.id === tab) ? tab : navTabs[0].id;
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

  const closeButton = props.onClose && (
    <button
      onClick={props.onClose}
      aria-label="Hide tutor"
      className="my-2 flex w-8 items-center justify-center rounded-md text-muted transition hover:bg-paper hover:text-ink"
    >
      ✕
    </button>
  );
  const collapseButton = (side: "left" | "right") =>
    props.onCollapse && (
      <button
        type="button"
        onClick={props.onCollapse}
        aria-label={side === "left" ? "Fold the sections away" : "Fold the tutor away"}
        title={side === "left" ? "Fold away" : "Fold the tutor away"}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-paper hover:text-ink"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          {side === "left" ? <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" /> : <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />}
        </svg>
      </button>
    );

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      {layout === "chat" ? (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-ink pr-2 pl-4">
          <p className="font-medium">Tutor</p>
          <div className="flex-1" />
          <UsageMeter sessionId={props.sessionId} keyId={props.keyInfo?.id} keyLast4={props.keyInfo?.last4} />
          {closeButton}
          {collapseButton("right")}
        </div>
      ) : layout === "sections" ? (
        // Every section listed, none hidden behind scrolling.
        <nav className="shrink-0 border-b border-ink px-2 py-2" role="tablist" aria-orientation="vertical" aria-label="Sections">
          <div className="flex items-center justify-between px-2 pb-1">
            <p className="font-mono text-[10px] tracking-wider text-muted uppercase">This session</p>
            {collapseButton("left")}
          </div>
          {navTabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={shown === t.id}
              onClick={() => onTab(t.id)}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-150 ${
                shown === t.id ? "bg-ink font-medium text-white" : "text-muted hover:bg-paper hover:text-ink"
              }`}
            >
              {t.label}
              {t.badge && (
                <span
                  className={`rounded px-1.5 py-px font-mono text-[10px] ${
                    shown === t.id ? "bg-white/15" : t.id === "plan" && !plan ? "bg-ink text-white" : "border border-line"
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </nav>
      ) : (
      <nav className="relative flex h-12 shrink-0 items-stretch gap-2 border-b border-ink px-3">
        {/* Only the tabs scroll when there are many; the usage meter stays put at the right. */}
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto [mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent)] [scrollbar-width:none]" role="tablist">
        <div ref={navRef} className="relative flex items-stretch gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              data-tab={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => onTab(t.id)}
              className={`flex shrink-0 items-center gap-1.5 px-2.5 text-sm whitespace-nowrap transition-colors duration-200 ${
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
        </div>
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
      )}
      <div key={shown} className="animate-fade min-h-0 flex-1">
        {shown === "chat" && (
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
        {shown === "practice" && (
          <PracticePanel
            practice={props.exam.practice}
            docs={props.docs}
            examDate={props.exam.examDate}
            onExamDate={props.exam.onExamDate}
            onJump={props.onJump}
            onAsk={(message) => props.onSend({ action: "chat", message })}
          />
        )}
        {shown === "passes" && (
          <PassesPanel
            sessionId={props.sessionId}
            inStudy={props.kind === "study"}
            docs={passDocs}
            onMarkPaper={props.paper.onMarkPaper}
            onAddPapers={props.paper.onAddPapers}
            studyGoal={props.paper.studyGoal}
            onOpenMap={props.paper.onOpenMap}
            onTool={props.paper.onTool}
            activeDocId={props.paper.activeDocId}
            reviews={props.paper.reviews}
            researchGoal={props.paper.researchGoal}
            busy={Boolean(props.busy)}
            onSelectDoc={props.paper.onSelectDoc}
            onUpdate={props.paper.onUpdate}
            onResearchGoal={props.paper.onResearchGoal}
            fetching={props.paper.fetching}
            onSend={props.onSend}
            passesOpen={props.paper.passesOpen}
            onPassesOpen={props.paper.onPassesOpen}
          />
        )}
        {shown === "plan" && (
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
            onRecall={props.onRecall}
            onListen={props.onListen}
            papers={props.paper.paperIds}
            reviews={props.paper.reviews}
            onOpenPaper={(docId) => {
              props.paper.onSelectDoc(docId);
              props.paper.onPassesOpen(true);
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
            onRepace={props.onRepace}
            draftGoal={props.draftGoal}
            setup={props.setup}
          />
        )}
        {shown === "files" && <FilesPanel {...props.files} />}
        {shown === "highlights" && (
          <HighlightsPanel
            sessionId={props.sessionId}
            highlights={highlights}
            docs={props.docs}
            busy={Boolean(props.busy)}
            onJump={props.onJump}
            onDelete={props.onDeleteHighlight}
            onUpdate={props.onUpdateHighlight}
            onSend={props.onSend}
          />
        )}
        {shown === "memory" &&
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
