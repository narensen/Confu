export type OutlineItem = { title: string; page: number; level: number };

export type StudySession = { id: string; title: string; created_at: string; updated_at: string };

export type DocumentRow = {
  id: string;
  session_id: string;
  position: number;
  title: string;
  storage_path: string;
  page_count: number;
  outline: OutlineItem[];
  status: "processing" | "ready" | "failed";
  last_page: number;
  created_at: string;
};

export type Level = "beginner" | "intermediate" | "advanced";

export type PlanPhase = { title: string; description: string };

// A PDF as the workspace sees it. `label` ("D1", "D2"…) is how the tutor and
// the plan refer to it.
export type SessionDoc = {
  id: string;
  label: string;
  title: string;
  pageCount: number;
  lastPage: number;
  position: number;
  url: string;
};

export function docLabel(index: number) {
  return `D${index + 1}`;
}

export type StudyPlan = {
  id: string;
  session_id: string;
  goal: string;
  goal_title: string;
  goal_summary: string;
  materials: string;
  phases: PlanPhase[];
  level: Level;
  start_date: string;
  deadline: string;
  minutes_per_day: number;
  overview: string;
};

export type TopicStatus = "not_started" | "in_progress" | "completed";

export type ResourceType = "lecture" | "video" | "reading" | "course" | "practice";

// Suggested outside material. We store a search query rather than a URL so a
// suggestion can never be a dead or invented link.
export type Resource = { type: ResourceType; title: string; search: string };

export type PlanTopic = {
  id: string;
  plan_id: string;
  position: number;
  phase: number;
  source: "pdf" | "external";
  document_id: string | null;
  title: string;
  objectives: string[];
  key_concepts: string[];
  resources: Resource[];
  page_start: number | null;
  page_end: number | null;
  est_minutes: number;
  due_date: string;
  status: TopicStatus;
  mastery: number;
  completed_at: string | null;
};

export type LearnerMemory = {
  summary: string;
  understood: string[];
  struggling: string[];
  misconceptions: string[];
  open_questions: string[];
  explained: string[];
};

export const EMPTY_MEMORY: LearnerMemory = {
  summary: "",
  understood: [],
  struggling: [],
  misconceptions: [],
  open_questions: [],
  explained: [],
};

export type Rect = { x: number; y: number; w: number; h: number };

export type Highlight = {
  id: string;
  document_id: string;
  kind: "text" | "region";
  page_number: number;
  color: string;
  selected_text: string | null;
  rects: Rect[];
  image_path: string | null;
  vlm_description: string | null;
  note: string | null;
  created_at: string;
};

// What the student can ask the tutor to do. Selection actions operate on a
// highlighted passage; the rest operate on the current topic.
export type TutorAction =
  | "chat"
  | "ask"
  | "summarize"
  | "context"
  | "simplify"
  | "figure"
  | "quiz"
  | "teach";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  action: TutorAction;
  content: string;
  page_number: number | null;
  document_id: string | null;
  highlight_id: string | null;
  created_at: string;
};
