"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage, Highlight, LearnerMemory, PlanTopic, SessionDoc, StudyPlan, TopicStatus } from "@/lib/types";
import { ChatPanel } from "./ChatPanel";
import { HighlightsPanel } from "./HighlightsPanel";
import { MemoryPanel } from "./MemoryPanel";
import { PlanPanel } from "./PlanPanel";
import type { SendRequest } from "./Workspace";

export type Tab = "chat" | "plan" | "highlights" | "memory";

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
  onPlanCreated: () => void;
  onClose?: () => void;
};

export function TutorPanel(props: Props) {
  const { tab, onTab, plan, topics, highlights } = props;
  const done = topics.filter((t) => t.status === "completed").length;
  const tabs: { id: Tab; label: string; badge?: string }[] = [
    { id: "chat", label: "Tutor" },
    { id: "plan", label: "Plan", badge: plan ? `${done}/${topics.length}` : "Set goal" },
    { id: "highlights", label: "Highlights", badge: highlights.length ? String(highlights.length) : undefined },
    { id: "memory", label: "Progress" },
  ];

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
            onSend={props.onSend}
            onJump={props.onJump}
            onCite={props.onCite}
            onOpenPlan={() => onTab("plan")}
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
            onSend={props.onSend}
          />
        )}
        {tab === "memory" && <MemoryPanel memory={props.memory} plan={plan} topics={topics} />}
      </div>
    </div>
  );
}
