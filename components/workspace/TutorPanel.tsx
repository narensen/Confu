"use client";

import { PassesPanel, type PaperTool } from "@/components/paper/PassesPanel";
import { ExamProgress } from "@/components/exam/ExamProgress";
import { PracticePanel } from "@/components/exam/PracticePanel";
import type { ExamPractice } from "@/components/exam/useExamPractice";
import type { PaperReview } from "@/lib/paper";
import type { ChatMessage, Highlight, LearnerMemory, PlanTopic, SessionDoc, SessionKind, StudyPlan, TopicStatus } from "@/lib/types";
import { ChatPanel } from "./ChatPanel";
import type { HighlightColor } from "@/lib/highlights";
import { HighlightsPanel } from "./HighlightsPanel";
import { MemoryPanel } from "./MemoryPanel";
import { PlanPanel, type PlanSetup } from "./PlanPanel";
import { FilesPanel, type FilesProps } from "./FilesPanel";
import type { SendRequest } from "./Workspace";

// What can be on screen beside the PDF: the tutor's chat, or one of the
// session's tools (the plan, a paper's passes, practice, highlights, progress,
// files). The workspace decides where each is shown; this only draws it.
export type Tab = "chat" | "plan" | "passes" | "practice" | "highlights" | "memory" | "files";
export type ToolTab = Exclude<Tab, "chat">;

// A tool as it's listed in the rail: its name, what it's for, a short count
// and whether it's waiting on the student (a dot).
export type Section = { id: ToolTab; label: string; hint: string; badge?: string; dot?: boolean; shortcut?: string };

export type ExamProps = { practice: ExamPractice; examDate: string | null; onExamDate: (date: string | null) => void; onTrial: boolean };

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

export type PanelProps = {
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
  onExplain: (topic: PlanTopic) => void;
  onDeleteHighlight: (h: Highlight) => void;
  onUpdateHighlight: (h: Highlight, patch: { color?: HighlightColor; note?: string | null }) => void;
  onPlanCreated: () => void;
  onRepace: (minutesPerDay: number, deadline: string) => Promise<void>;
  draftGoal: string; // a template's or pack's goal, to start the plan from
  setup: PlanSetup;
  files: FilesProps; // every PDF: open, close its tab, delete
  kind: SessionKind;
  paper: PaperProps;
  exam: ExamProps;
  citeMode: boolean;
  onCiteMode: (on: boolean) => void;
  // Moving to another view from inside one ("Open the plan", "Practise these").
  onView: (view: Tab) => void;
};

// The tools of a session, in the order they're listed. Exam sessions keep it
// simple: practise, see progress, files.
export function toolSections(p: Pick<PanelProps, "kind" | "docs" | "plan" | "topics" | "highlights" | "files" | "paper" | "exam">): Section[] {
  const done = p.topics.filter((t) => t.status === "completed").length;
  // Papers inside a study session get the paper session's three-pass tools.
  const studyPapers = p.kind === "study" ? p.docs.filter((d) => p.paper.paperIds.has(d.id)) : [];
  const passDocs = p.kind === "paper" ? p.docs : studyPapers;
  const finished = passDocs.filter((d) => (p.paper.reviews[d.id]?.passes_done ?? 0) >= (p.paper.reviews[d.id]?.target_pass ?? 1)).length;
  const passesBadge = passDocs.length ? `${finished}/${passDocs.length}` : undefined;
  // Files: how many, and a dot for what's still coming in or waiting to be added from the goal.
  const waiting = p.files.uploads.length + (p.files.later ? p.files.later.later.papers.length + p.files.later.later.links.length : 0);
  const files: Section = {
    id: "files",
    label: "Files",
    hint: waiting ? `Everything in this session, ${waiting} still to come in` : "Everything in this session",
    badge: p.files.docs.length ? String(p.files.docs.length) : undefined,
    dot: waiting > 0,
    shortcut: "F",
  };
  const answered = p.exam.practice.attempts.length;

  if (p.kind === "exam")
    return [
      { id: "practice", label: "Practice", hint: "Exam-style questions from your notes", shortcut: "P" },
      { id: "memory", label: "Progress", hint: "Your accuracy and weak topics", badge: answered ? String(answered) : undefined },
      files,
    ];

  return [
    p.kind === "paper"
      ? { id: "passes", label: "Passes", hint: "Read each paper in three passes", badge: passesBadge, shortcut: "P" }
      : p.plan
        ? { id: "plan", label: "Plan", hint: "Your goal, broken into topics", badge: `${done}/${p.topics.length}`, shortcut: "P" }
        : { id: "plan", label: "Plan", hint: "Set your goal to get a plan", dot: true, shortcut: "P" },
    ...(studyPapers.length ? [{ id: "passes" as const, label: "Papers", hint: "The research papers here, read in three passes", badge: passesBadge }] : []),
    { id: "highlights", label: "Highlights", hint: "Everything you've marked", badge: p.highlights.length ? String(p.highlights.length) : undefined, shortcut: "H" },
    { id: "memory", label: "Progress", hint: "What the tutor knows about you" },
    files,
  ];
}

export function TutorPanel({ view, ...props }: PanelProps & { view: Tab }) {
  const { onView, plan, topics, highlights } = props;
  const activePaper = props.docs.find((d) => d.id === props.paper.activeDocId && (props.kind === "paper" || props.paper.paperIds.has(d.id)));

  return (
    <div key={view} className="animate-fade h-full min-h-0">
      {view === "chat" && (
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
          onOpenPlan={() => onView(props.kind === "paper" ? "passes" : props.kind === "exam" ? "practice" : "plan")}
          onOpenPaper={() => onView("passes")}
          kind={props.kind}
          citeMode={props.citeMode}
          onCiteMode={props.onCiteMode}
          paperFocus={(() => {
            const r = activePaper ? props.paper.reviews[activePaper.id] : undefined;
            return activePaper && r ? { label: activePaper.label, title: activePaper.title, done: r.passes_done, target: r.target_pass } : null;
          })()}
        />
      )}
      {view === "practice" && (
        <PracticePanel
          practice={props.exam.practice}
          docs={props.docs}
          examDate={props.exam.examDate}
          onExamDate={props.exam.onExamDate}
          onTrial={props.exam.onTrial}
          onJump={props.onJump}
          onAsk={(message) => props.onSend({ action: "chat", message })}
        />
      )}
      {view === "passes" && (
        <PassesPanel
          sessionId={props.sessionId}
          inStudy={props.kind === "study"}
          docs={props.kind === "paper" ? props.docs : props.docs.filter((d) => props.paper.paperIds.has(d.id))}
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
      {view === "plan" && (
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
          onExplain={props.onExplain}
          papers={props.paper.paperIds}
          reviews={props.paper.reviews}
          onOpenPaper={(docId) => {
            props.paper.onSelectDoc(docId);
            props.paper.onPassesOpen(true);
            onView("passes");
          }}
          onMarkPaper={(docId) => {
            props.paper.onMarkPaper(docId);
            props.paper.onSelectDoc(docId);
            onView("passes");
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
      {view === "files" && <FilesPanel {...props.files} />}
      {view === "highlights" && (
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
      {view === "memory" &&
        (props.kind === "exam" ? (
          <ExamProgress
            practice={props.exam.practice}
            examDate={props.exam.examDate}
            memorySummary={props.memory.summary}
            onPractiseWeak={(weak) => {
              onView("practice");
              void props.exam.practice.start({ topics: weak });
            }}
          />
        ) : (
          <MemoryPanel memory={props.memory} plan={plan} topics={topics} />
        ))}
    </div>
  );
}
