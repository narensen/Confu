"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { deleteDocument } from "@/components/dashboard/actions";
import type { RegionCapture, TextSelection } from "@/components/pdf/PdfViewer";
import { JSON_HEADERS, KEY_ERROR_EVENT, notifyAiUsed, readAiError } from "@/lib/ai-errors";
import { GROQ_LINK, teachWithHarness, type TutorLink } from "@/lib/harness-client";
import { harnessById } from "@/lib/harnesses";
import { HarnessBar } from "@/components/workspace/HarnessBar";
import { hashText } from "@/lib/hash";
import type { KeyInfo } from "@/lib/groq-keys";
import { emptyReview, isPaperDoc, type PaperReview } from "@/lib/paper";
import { daysUntil, type Attempt } from "@/lib/exam";
import { useExamPractice } from "@/components/exam/useExamPractice";
import { addPaperFromMeta, type PaperMeta } from "@/lib/pdf/add-paper";
import { docForResource, FIND_PAPER_EVENT, isPaperResource } from "@/lib/find-paper";
import { speechLoading, speechPlay, speechStop, speechSupported } from "@/lib/speech";
import { closeTab, keepTabs, openTab, orderOpenDocs, reorderTabs, useOpenTabs } from "@/lib/open-tabs";
import { fire } from "@/lib/supabase/fire";
import { peekHandoff, takeHandoff } from "@/lib/pdf/handoff";
import { attachPdfToDocument, titleFromFile, uploadPdfToSession } from "@/lib/pdf/upload";
import { AddPaperDialog } from "@/components/paper/AddPaperDialog";
import { AddMaterialDialog, type ImportedFile } from "@/components/import/AddMaterialDialog";
import { ConvertFiles } from "@/components/import/ConvertFiles";
import { needsConversion } from "@/lib/import/drive";
import { openRecommendPapers, RecommendPapers } from "@/components/paper/RecommendDialog";
import { PaperCard } from "@/components/paper/PaperCard";
import { PackSources, PendingSourceCard, pendingSource } from "@/components/packs/PackSources";
import { ExplainBack } from "@/components/workspace/ExplainBack";
import { PagePins } from "@/components/workspace/PagePins";
import { LiteratureMap } from "@/components/paper/LiteratureMap";
import { exportBibtex, PaperTools } from "@/components/paper/PaperTools";
import type { PaperTool } from "@/components/paper/PassesPanel";
import { addLater, removeLater, useLater, type GoalHint, type GoalLink, type GoalPaper } from "@/lib/goal-later";
import { lecturePdf } from "@/lib/import/fetch-client";
import { assignDueDates, currentTopic, toISODate } from "@/lib/schedule";
import { track } from "@/lib/telemetry";
import { createClient } from "@/lib/supabase/client";
import { citeLabelsForTurn, displayUserTurn } from "@/lib/tutor/format";
import { answerKey } from "@/lib/tutor/saved";
import {
  docLabel,
  EMPTY_MEMORY,
  type ChatMessage,
  type Highlight,
  type LearnerMemory,
  type PlanTopic,
  type SavedAnswer,
  type SessionDoc,
  type SessionKind,
  type StudyPlan,
  type TopicStatus,
  type TutorAction,
} from "@/lib/types";
import type { HighlightColor } from "@/lib/highlights";
import { DocTabs } from "./DocTabs";
import { KeyGate } from "./KeyGate";
import type { UploadItem } from "./FilesPanel";
import { AudioBar } from "./AudioBar";
import { RecallCheck, recallOffered } from "./RecallCheck";
import { ShortcutsDialog } from "./Shortcuts";
import type { PlanJob } from "./PlanPanel";
import { toolSections, TutorPanel, type PanelProps, type Section, type Tab, type ToolTab } from "./TutorPanel";
import { MobileNav, ResizeHandle, ToolDock, ToolHeader, TutorHeader, TutorRail, type MobileItem } from "./Chrome";
import { UsageMeter } from "@/components/usage/UsageMeter";
import { ask, toast } from "@/components/dialogs";

const PdfViewer = dynamic(() => import("@/components/pdf/PdfViewer"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-viewer text-sm text-muted">Loading viewer…</div>,
});

type Props = {
  session: { id: string; title: string; kind: SessionKind; researchGoal: string; examDate: string | null; draftGoal?: string; citeMode?: boolean };
  initialDocs: SessionDoc[];
  initialDocId: string | null;
  initialPlan: StudyPlan | null;
  initialTopics: PlanTopic[];
  initialMemory: LearnerMemory;
  initialHighlights: Highlight[];
  initialMessages: ChatMessage[];
  initialSaved?: SavedAnswer[]; // tutor answers kept under Highlights (migration 0041)
  // Regular users bring their own Groq key; admins use the server's.
  needsKey: boolean;
  initialKey: KeyInfo | null;
  trial: boolean; // no key yet, but free-trial tokens left on Confu's keys
  // Paper sessions: three-pass notes per paper.
  initialReviews: PaperReview[];
  // Exam sessions: past practice answers.
  initialAttempts: Attempt[];
};

export type SendRequest = {
  action: TutorAction;
  topicId?: string;
  message?: string;
  selection?: { text: string; page: number; documentId: string } | null;
  highlightId?: string | null;
  figure?: { page: number; documentId: string } | null;
};

// Which files the tutor may cite for the next question. The open file starts
// on; `custom` means the student has changed that.
export type CiteFiles = {
  ids: string[];
  custom: boolean;
  onToggle: (id: string) => void;
  onAll: () => void;
  onOpenOnly: () => void;
};

// The layout, remembered on this device: the tutor's and the tools' widths,
// whether the tutor is folded away and whether tools are pinned beside the reader.
const LAYOUT_KEY = "confu:layout";
type Layout = { tutor: number; sheet: number; tutorOpen: boolean; pinned: boolean };
const DEFAULT_LAYOUT: Layout = { tutor: 400, sheet: 440, tutorOpen: true, pinned: false };
const TUTOR_RAIL = 32; // the folded tutor (w-8): only the logo peeks out
const READER_MIN = 440; // a tool is only pinned beside the reader if this much is left for it
const SHEET_MIN = 340;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
// Side by side from this width up (tutor · reader · tools); below it, one thing at a time.
const WIDE = "(min-width: 768px)";
const subscribeWide = (fn: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", fn);
  return () => m.removeEventListener("change", fn);
};
const noSubscribe = () => () => {};
const URL_TTL = 60 * 60 * 6;

// Labels follow the order of the tabs: D1, D2, …
const relabel = (docs: SessionDoc[]) => docs.map((d, i) => ({ ...d, label: docLabel(i) }));

export function Workspace({
  session,
  initialDocs,
  initialDocId,
  initialPlan,
  initialTopics,
  initialMemory,
  initialHighlights,
  initialMessages,
  initialSaved,
  needsKey,
  initialKey,
  trial,
  initialReviews,
  initialAttempts,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [docs, setDocs] = useState(initialDocs);
  const [activeDocId, setActiveDocId] = useState(initialDocId);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [addPaperOpen, setAddPaperOpen] = useState(false);
  const [addMaterialOpen, setAddMaterialOpen] = useState(false);
  // "Choose" on a goal's playlist opens the YouTube tab on it.
  const [materialStart, setMaterialStart] = useState<{ tab: "youtube"; url: string } | null>(null);
  const [plan, setPlan] = useState(initialPlan);
  const [topics, setTopics] = useState(initialTopics);
  const [memory, setMemory] = useState(initialMemory);
  const [highlights, setHighlights] = useState(initialHighlights);
  const [messages, setMessages] = useState(initialMessages);
  const [saved, setSaved] = useState<SavedAnswer[]>(initialSaved ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [goTo, setGoTo] = useState<{ page: number; n: number } | null>(null);
  const isPaper = session.kind === "paper";
  const isExam = session.kind === "exam";
  // The Papers tool: one paper's passes, or (false) just the reading list.
  const [passesOpen, setPassesOpen] = useState(false);
  const practice = useExamPractice(session.id, initialAttempts);
  const [examDate, setExamDate] = useState(session.examDate);
  const [citeMode, setCiteModeOn] = useState(session.citeMode === true);
  // null until the student picks files. Until then the open file is the only one cited.
  const [citeTouched, setCiteTouched] = useState(false);
  const [citePicked, setCitePicked] = useState<string[]>([]);
  const [researchGoal, setResearchGoal] = useState(session.researchGoal);
  const [storedReviews, setStoredReviews] = useState<Record<string, PaperReview>>(() =>
    Object.fromEntries(initialReviews.map((r) => [r.document_id, r])),
  );
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  // In full screen the tutor can take the whole screen. It widens over the
  // reader, which keeps its size underneath (the page isn't laid out again),
  // and shrinks back the same way. Going to a page or a tool brings it back.
  const [tutorFull, setTutorFull] = useState(false);
  const [tutorMotion, setTutorMotion] = useState(false);
  const tutorFullNow = useRef(false);
  const motionTimer = useRef(0);
  const showTutorFull = useCallback((on: boolean, animate = true) => {
    if (tutorFullNow.current === on) return;
    tutorFullNow.current = on;
    window.clearTimeout(motionTimer.current);
    setTutorMotion(animate);
    if (animate) motionTimer.current = window.setTimeout(() => setTutorMotion(false), 360);
    setTutorFull(on);
  }, []);
  useEffect(() => () => window.clearTimeout(motionTimer.current), []);

  // The layout: the tutor on the left, what you're reading in the middle, and
  // the session's tools in a small bar on the right edge that tucks itself
  // away until the pointer comes near (see ToolDock). A tool slides out over the
  // reader and goes away when you click back into the page, or is pinned
  // beside it. Full screen is the same layout without the app's header.
  // Phones show one thing at a time, switched from a tab bar.
  const wide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
  const wideRef = useRef(true);
  useEffect(() => {
    wideRef.current = wide;
  }, [wide]);
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  // A calendar link can fold the tutor for this visit without replacing the
  // layout saved on this device. Cleared once the student opens or folds it themselves.
  const foldTutor = useRef(false);
  const preferTutorOpen = useRef(true);
  // Read once, inside the layout effect. A later date change does not re-fold.
  const foldSource = useRef({ kind: session.kind, examDate: session.examDate });
  const [pinDraft, setPinDraft] = useState<{ page: number; text: string } | null>(null);
  const [explain, setExplain] = useState<{ documentId: string; page: number; topic: string } | null>(null);
  // A change the student made: kept for next time.
  const updateLayout = useCallback((patch: Partial<Layout>) => {
    setLayout((l) => {
      const next = { ...l, ...patch };
      if ("tutorOpen" in patch) foldTutor.current = false;
      const stored = foldTutor.current ? { ...next, tutorOpen: preferTutorOpen.current } : next;
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(stored));
      } catch {}
      return next;
    });
  }, []);
  // The tool that's out. A new session opens on what it needs first: the goal,
  // the research question, or practice.
  const [tool, setTool] = useState<ToolTab | null>(() =>
    isExam ? (initialAttempts.length ? null : "practice") : isPaper ? (session.researchGoal ? null : "passes") : initialPlan ? null : "plan",
  );
  // The last tool out stays mounted (hidden) after it's put away, so a half-
  // written answer or a scrolled list is still there when it comes back.
  const [lastTool, setLastTool] = useState<ToolTab | null>(tool);
  if (tool && tool !== lastTool) setLastTool(tool);
  const [mobileView, setMobileView] = useState<"pdf" | "tutor" | "tool">(!isExam && !isPaper && !initialPlan ? "tool" : "pdf");
  const openTool = useCallback(
    (t: ToolTab) => {
      showTutorFull(false);
      setTool(t);
      setMobileView("tool");
    },
    [showTutorFull],
  );
  const revealTutor = useCallback(() => {
    setLayout((l) => {
      if (l.tutorOpen) return l;
      foldTutor.current = false;
      const next = { ...l, tutorOpen: true };
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    setMobileView("tutor");
  }, []);
  // Moving to another view from inside one ("Open the plan", "Practise these").
  const showView = useCallback((v: Tab) => (v === "chat" ? revealTutor() : openTool(v)), [openTool, revealTutor]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [keyInfo, setKeyInfo] = useState(initialKey);
  const [keyNotice, setKeyNotice] = useState<string | null>(null);
  const [onTrial, setOnTrial] = useState(trial);
  const locked = needsKey && !keyInfo && !onTrial;
  // A local harness teaches without a Groq key. The ref is what send() reads.
  const harnessRef = useRef<TutorLink>(GROQ_LINK);
  const [localTutor, setLocalTutor] = useState(false);

  // An AI request reported a missing or rejected key: ask for one again.
  useEffect(() => {
    const onKeyError = (e: Event) => {
      setKeyNotice((e as CustomEvent<{ message: string }>).detail.message);
      setKeyInfo(null);
      setOnTrial(false); // the trial ran out (or there never was one)
      revealTutor();
    };
    window.addEventListener(KEY_ERROR_EVENT, onKeyError);
    return () => window.removeEventListener(KEY_ERROR_EVENT, onKeyError);
  }, [revealTutor]);

  // Without a key, AI actions open the tutor, where the key form is.
  const revealGate = revealTutor;

  // The tabs above the viewer: every PDF the student hasn't closed.
  // PDFs are added to Files without opening a tab; opening one does.
  const tabs = useOpenTabs(session.id);
  const openDocs = useMemo(() => orderOpenDocs(docs, tabs), [docs, tabs]);
  const openIds = useMemo(() => new Set(openDocs.map((d) => d.id)), [openDocs]);
  const docIds = useRef<string[]>([]);
  useEffect(() => {
    docIds.current = docs.map((d) => d.id);
  }, [docs]);
  const activeDoc = openDocs.find((d) => d.id === activeDocId) ?? openDocs[0] ?? null;
  // The open tabs are only known in the browser. Until then, don't start
  // loading a PDF: the server's pick (the most recently changed file) is often
  // not an open tab, and loading it first meant loading two PDFs.
  const tabsKnown = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

  // Background work (adding the goal's and plan's papers and lectures: each is
  // downloaded and read in this browser) waits until the PDF being read is
  // open, so it never slows that down. At most 8 seconds.
  const viewer = useRef<{ ready: boolean; waiters: (() => void)[] }>({ ready: false, waiters: [] });
  const viewerLoaded = useCallback(() => {
    viewer.current.ready = true;
    for (const done of viewer.current.waiters.splice(0)) done();
  }, []);
  const viewerReady = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (viewer.current.ready) return resolve();
        viewer.current.waiters.push(resolve);
        window.setTimeout(resolve, 8000);
      }),
    [],
  );
  // Nothing to load (no open file, or one without a PDF): don't keep anyone waiting.
  useEffect(() => {
    if (tabsKnown && (!activeDoc || !activeDoc.hasPdf)) viewerLoaded();
  }, [activeDoc, tabsKnown, viewerLoaded]);
  const page = activeDoc?.lastPage ?? 1;
  const multi = docs.length > 1;
  const labelOf = useCallback((id: string | null | undefined) => docs.find((d) => d.id === id)?.label, [docs]);
  const citeIds = useMemo(() => {
    // Nothing on screen yet: cite every file, so a question isn't stuck on a closed one.
    if (!citeTouched) return activeDoc ? [activeDoc.id] : docs.map((d) => d.id);
    const known = new Set(docs.map((d) => d.id));
    const kept = citePicked.filter((id) => known.has(id));
    if (kept.length) return kept;
    return activeDoc ? [activeDoc.id] : docs.map((d) => d.id);
  }, [activeDoc, citePicked, citeTouched, docs]);
  const activeTopic = topics.find((t) => t.id === activeTopicId) ?? currentTopic(topics);
  const docHighlights = useMemo(() => highlights.filter((h) => h.document_id === activeDoc?.id), [highlights, activeDoc?.id]);

  // Switching PDFs remounts the viewer (it's keyed by PDF) at that PDF's last
  // page; clear any pending jump so it isn't replayed into the new PDF.
  // Showing a PDF (from its tab, Files, the plan, a citation…) opens its tab again if it was closed.
  const selectDoc = useCallback(
    (docId: string) => {
      openTab(session.id, docId, docIds.current);
      setGoTo(null);
      setActiveDocId(docId);
    },
    [session.id],
  );

  // Jump to a page, switching PDFs if needed.
  const jumpTo = useCallback(
    (p: number, docId?: string | null) => {
      setMobileView("pdf");
      showTutorFull(false);
      if (docId && docId !== activeDoc?.id && docs.some((d) => d.id === docId)) {
        setDocs((list) => list.map((d) => (d.id === docId ? { ...d, lastPage: p } : d)));
        selectDoc(docId);
        return;
      }
      setGoTo((g) => ({ page: p, n: (g?.n ?? 0) + 1 }));
    },
    [activeDoc?.id, docs, selectDoc, showTutorFull],
  );

  // Deep links: /session/:id?doc=…&page=…&tutor=closed
  // tutor=closed folds the tutor for this visit and is not written back.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current) return;
    deepLinked.current = true;
    const q = new URLSearchParams(window.location.search);
    const doc = q.get("doc");
    const p = Number(q.get("page"));
    if (q.get("tutor") === "closed") {
      foldTutor.current = true;
      setMobileView("pdf");
      // Direct set. updateLayout would clear the fold and write the preference.
      setLayout((l) => ({ ...l, tutorOpen: false }));
    }
    if (!q.has("page") && q.get("tutor") !== "closed") return;
    window.history.replaceState(null, "", window.location.pathname);
    if (q.has("page") && p >= 1) {
      if (doc && docs.some((d) => d.id === doc)) jumpTo(p, doc);
      else jumpTo(p);
    }
  }, [docs, jumpTo]);

  // Restore the layout, and fold an exam that's inside two weeks, before paint.
  // today is computed here once. It is not useToday(), and not a render-time Date.
  useLayoutEffect(() => {
    const today = toISODate(new Date());
    const left = daysUntil(foldSource.current.examDate, today);
    if (foldSource.current.kind === "exam" && left !== null && left >= 0 && left <= 14) foldTutor.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<Layout> | null;
      const open = saved ? saved.tutorOpen !== false : true;
      preferTutorOpen.current = open;
      if (!saved && !foldTutor.current) return;
      setLayout({
        tutor: clamp(Number(saved?.tutor) || DEFAULT_LAYOUT.tutor, 300, 720),
        sheet: clamp(Number(saved?.sheet) || DEFAULT_LAYOUT.sheet, SHEET_MIN, 760),
        tutorOpen: foldTutor.current ? false : open,
        pinned: saved?.pinned === true,
      });
    } catch {}
  }, []);

  // How wide the workspace is: what fits beside the reader depends on it.
  const [rootWidth, setRootWidth] = useState(1440);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setRootWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The tutor never takes more than ~45% of the width, and a tool never covers
  // the tutor. A pinned tool sits beside the reader (narrower if it must) only
  // while the reader keeps enough room; otherwise it floats over it.
  const tutorWidth = clamp(layout.tutor, 300, Math.max(300, Math.round(rootWidth * 0.45)));
  const leftWidth = layout.tutorOpen ? tutorWidth : TUTOR_RAIL;
  const floatWidth = clamp(layout.sheet, SHEET_MIN, Math.max(SHEET_MIN, Math.min(Math.round(rootWidth * 0.55), rootWidth - leftWidth - 120)));
  const roomBeside = rootWidth - leftWidth - READER_MIN;
  const canPin = roomBeside >= SHEET_MIN;
  const docked = layout.pinned && canPin;
  const sheetWidth = docked ? Math.min(floatWidth, roomBeside) : floatWidth;
  const tutorFullShown = tutorFull && focusMode && wide && layout.tutorOpen;
  // Folding it away also ends the whole-screen tutor.
  const foldTutorAway = useCallback(() => {
    showTutorFull(false, false);
    updateLayout({ tutorOpen: false });
  }, [showTutorFull, updateLayout]);

  // Remember the reading position per PDF.
  const activeId = activeDoc?.id;
  useEffect(() => {
    if (!activeId) return;
    const id = window.setTimeout(() => {
      fire(supabase.from("documents").update({ last_page: page }).eq("id", activeId), "your page");
    }, 1500);
    return () => window.clearTimeout(id);
  }, [activeId, page, supabase]);

  const onPageChange = useCallback(
    (p: number) => setDocs((list) => list.map((d) => (d.id === activeDoc?.id ? { ...d, lastPage: p } : d))),
    [activeDoc?.id],
  );

  // Full screen: native where available, with a CSS fallback (e.g. iOS Safari).
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement) return;
      setFocusMode(false);
      showTutorFull(false, false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [showTutorFull]);

  // The whole page goes full screen, not just the workspace: dialogs and
  // notices are drawn over the page, and would be hidden behind the workspace.
  const toggleFocus = useCallback(() => {
    if (focusMode) {
      setFocusMode(false);
      showTutorFull(false, false);
      if (document.fullscreenElement) void document.exitFullscreen();
    } else {
      setFocusMode(true);
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }, [focusMode, showTutorFull]);

  const refreshProgress = useCallback(async () => {
    const [t, m] = await Promise.all([
      plan ? supabase.from("plan_topics").select("*").eq("plan_id", plan.id).order("position") : Promise.resolve(null),
      supabase.from("learner_memory").select("*").eq("session_id", session.id).maybeSingle(),
    ]);
    if (t?.data) setTopics(t.data as PlanTopic[]);
    if (m.data) setMemory({ ...EMPTY_MEMORY, ...(m.data as LearnerMemory) });
  }, [plan, session.id, supabase]);

  const send = useCallback(
    async (req: SendRequest) => {
      const harness = harnessRef.current;
      const viaHarness = harness.id !== "groq";
      if (locked && !viaHarness) return revealGate();
      if (busyRef.current) return;
      busyRef.current = true;
      const topic = topics.find((t) => t.id === req.topicId) ?? activeTopic;
      const now = new Date().toISOString();
      const userId = `local-u-${Date.now()}`;
      const replyId = `local-a-${Date.now()}`;
      const where = req.selection ?? req.figure ?? (activeDoc ? { page, documentId: activeDoc.id } : null);
      const citing = multi && !req.action.startsWith("pass") ? citeIds : [];
      const content = displayUserTurn({
        action: req.action,
        message: req.message,
        selection: req.selection,
        figurePage: req.figure?.page,
        docLabel: multi ? labelOf(where?.documentId) : undefined,
        topicTitle: topic?.title,
        citeLabels: citeLabelsForTurn(
          docs.filter((d) => citing.includes(d.id)).map((d) => d.label),
          activeDoc?.label,
        ),
      });
      const meta = { page_number: where?.page ?? null, document_id: where?.documentId ?? null };
      setMessages((m) => [
        ...m,
        { id: userId, role: "user", action: req.action, content, ...meta, highlight_id: req.highlightId ?? null, created_at: now },
        { id: replyId, role: "assistant", action: req.action, content: "", ...meta, highlight_id: null, created_at: now },
      ]);
      revealTutor();
      setBusy(viaHarness ? `Asking ${harnessById(harness.id)?.name ?? "the harness"}…` : "Thinking…");

      const setReply = (text: string) => setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, content: text } : x)));
      try {
        if (viaHarness) {
          if (!harness.connected) throw new Error("That tutor isn't connected. Open Tutors — the bridge has to be running, and the harness has to be installed.");
          const prepared = await fetch("/api/chat", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({
              sessionId: session.id,
              documentId: activeDoc?.id ?? null,
              action: req.action,
              message: req.message,
              page: activeDoc ? page : null,
              topicId: topic?.id ?? null,
              selection: req.selection ?? null,
              highlightId: req.highlightId ?? null,
              documentIds: citing.length ? citing : undefined,
              local: true,
            }),
          });
          if (!prepared.ok) throw new Error(await readAiError(prepared));
          const prep = (await prepared.json()) as {
            system: string;
            history: { role: string; content: string }[];
            instruction: string;
            display: string;
            citeMode: boolean;
            multi: boolean;
            retrieved: { label: string; page: number }[];
          };
          const answer = await teachWithHarness(harness, prep, setReply);
          const saved = await fetch("/api/chat/commit", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({
              sessionId: session.id,
              action: req.action,
              display: prep.display,
              reply: answer,
              documentId: where?.documentId ?? null,
              page: where?.page ?? null,
              topicId: topic?.id ?? null,
              highlightId: req.highlightId ?? null,
              citeMode: prep.citeMode,
              multi: prep.multi,
              retrieved: prep.retrieved,
              selection: req.selection ?? null,
            }),
          });
          if (saved.ok) {
            const body = (await saved.json()) as { reply?: string };
            if (body.reply) setReply(body.reply);
          }
          return;
        }
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            sessionId: session.id,
            documentId: activeDoc?.id ?? null,
            action: req.action,
            message: req.message,
            page: activeDoc ? page : null,
            topicId: topic?.id ?? null,
            selection: req.selection ?? null,
            highlightId: req.highlightId ?? null,
            documentIds: citing.length ? citing : undefined,
          }),
        });
        if (!res.ok || !res.body) throw new Error(await readAiError(res));
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let raw = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          raw += decoder.decode(value, { stream: true });
          // Status records ("Searching papers…") are \u001e{json}\n; show the latest, keep the rest as the answer.
          let text = "";
          let rest = raw;
          for (;;) {
            const start = rest.indexOf("\u001e");
            if (start === -1) {
              text += rest;
              break;
            }
            text += rest.slice(0, start);
            const end = rest.indexOf("\n", start);
            if (end === -1) break; // record still arriving
            try {
              const event = JSON.parse(rest.slice(start + 1, end)) as { type: string; label?: string };
              if (event.type === "status" && event.label) setBusy(event.label);
            } catch {}
            rest = rest.slice(end + 1);
          }
          setReply(text);
        }
      } catch (err) {
        const raw = err instanceof Error ? err.message : "Something went wrong.";
        const message =
          viaHarness && /failed to fetch|networkerror|load failed/i.test(raw)
            ? "Couldn't reach the bridge. Leave its window open, and allow loopback access if the browser asks."
            : raw;
        setReply(`⚠️ ${message}`);
      } finally {
        busyRef.current = false;
        setBusy(null);
        notifyAiUsed();
        // Memory and mastery are updated server-side after the reply finishes.
        window.setTimeout(refreshProgress, 4000);
        window.setTimeout(refreshProgress, 10000);
      }
    },
    [activeDoc, activeTopic, citeIds, docs, labelOf, locked, multi, page, refreshProgress, revealGate, revealTutor, session.id, topics],
  );

  // Keep a tutor answer. It is copied (with the question it answered) under
  // Highlights, and sent to the tutor with every question for the rest of the
  // session, so clearing the chat doesn't lose it.
  const saving = useRef(new Set<string>());
  const saveAnswer = useCallback(
    async (message: ChatMessage) => {
      const answer = answerKey(message.content);
      if (!answer || saving.current.has(answer) || saved.some((s) => answerKey(s.answer) === answer)) return;
      saving.current.add(answer);
      const at = messages.findIndex((m) => m.id === message.id);
      const question = at > 0 ? (messages.slice(0, at).findLast((m) => m.role === "user")?.content ?? null) : null;
      const { data, error } = await supabase
        .from("saved_answers")
        .insert({
          session_id: session.id,
          question: question ? question.slice(0, 2000) : null,
          answer,
          page_number: message.page_number,
          document_id: message.document_id && docs.some((d) => d.id === message.document_id) ? message.document_id : null,
        })
        .select("id, question, answer, page_number, document_id, created_at")
        .single();
      saving.current.delete(answer);
      if (error || !data) {
        toast("Couldn't save that answer. Try again.", "error");
        return;
      }
      setSaved((list) => [data as SavedAnswer, ...list]);
      track("answer.saved");
      toast("Saved under Highlights. The tutor keeps it in mind for the rest of this session.");
    },
    [docs, messages, saved, session.id, supabase],
  );
  const unsaveAnswer = useCallback(
    async (id: string) => {
      const item = saved.find((s) => s.id === id);
      if (!item) return;
      setSaved((list) => list.filter((s) => s.id !== id));
      const { error } = await supabase.from("saved_answers").delete().eq("id", id);
      if (error) {
        setSaved((list) => [item, ...list].sort((a, b) => b.created_at.localeCompare(a.created_at)));
        toast("Couldn't remove it. Try again.", "error");
      }
    },
    [saved, supabase],
  );

  // Clear the chat: the tutor starts fresh. The words are deleted; the rows
  // keep their dates so the streak and heatmap keep those study days.
  // Saved answers stay, in Highlights and in the tutor's context.
  const clearChat = useCallback(async () => {
    if (busyRef.current || !messages.length) return;
    const ok = await ask({
      title: "Clear this chat?",
      body: saved.length
        ? "The tutor starts fresh and won't see this conversation again. Your saved answers stay under Highlights, and the tutor keeps using them."
        : "The tutor starts fresh and won't see this conversation again. To keep an answer, press Save under it first.",
      confirm: "Clear chat",
      danger: true,
    });
    if (!ok || busyRef.current) return;
    const { error } = await supabase.from("messages").update({ content: "" }).eq("session_id", session.id);
    if (error) {
      toast("Couldn't clear the chat. Try again.", "error");
      return;
    }
    setMessages([]);
    track("chat.cleared", { saved: saved.length });
    toast(saved.length ? "Chat cleared. Your saved answers are still here." : "Chat cleared. The tutor starts fresh.");
  }, [messages.length, saved.length, session.id, supabase]);

  const onTextAction = useCallback(
    (action: TutorAction, selection: TextSelection, message?: string) => {
      if (!activeDoc) return;
      void send({ action, message, selection: { text: selection.text, page: selection.page, documentId: activeDoc.id } });
    },
    [activeDoc, send],
  );

  const saveHighlight = useCallback(
    async (selection: TextSelection, color: HighlightColor = "yellow", note?: string) => {
      if (!activeDoc) return;
      const { data, error } = await supabase
        .from("highlights")
        .insert({
          document_id: activeDoc.id,
          kind: "text",
          page_number: selection.page,
          selected_text: selection.text,
          rects: selection.rects,
          color,
          note: note ?? null,
        })
        .select("*")
        .single();
      if (!error && data) setHighlights((h) => [...h, data as Highlight]);
    },
    [activeDoc, supabase],
  );

  const onRegion = useCallback(
    async (capture: RegionCapture, message?: string) => {
      if (locked) return revealGate();
      if (busyRef.current || !activeDoc) return;
      const documentId = activeDoc.id;
      busyRef.current = true;
      setBusy("Reading the figure…");
      revealTutor();
      let highlight: Highlight | null = null;
      try {
        const res = await fetch("/api/figure", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ documentId, ...capture }),
        });
        if (!res.ok) throw new Error(await readAiError(res));
        const json = await res.json();
        highlight = json.highlight as Highlight;
        setHighlights((h) => [...h, highlight!]);
      } catch (err) {
        notifyAiUsed();
        setMessages((m) => [
          ...m,
          {
            id: `local-e-${Date.now()}`,
            role: "assistant",
            action: "figure",
            content: `⚠️ ${err instanceof Error ? err.message : "Could not read the figure."}`,
            page_number: capture.page,
            document_id: documentId,
            highlight_id: null,
            created_at: new Date().toISOString(),
          },
        ]);
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
      if (highlight) await send({ action: "figure", message, highlightId: highlight.id, figure: { page: capture.page, documentId } });
    },
    [activeDoc, locked, revealGate, revealTutor, send],
  );

  // Change a highlight's colour or note (optimistic; restored on failure).
  const updateHighlight = useCallback(
    async (h: Highlight, patch: { color?: HighlightColor; note?: string | null }) => {
      setHighlights((list) => list.map((x) => (x.id === h.id ? { ...x, ...patch } : x)));
      const { error } = await supabase.from("highlights").update(patch).eq("id", h.id);
      if (error) {
        setHighlights((list) => list.map((x) => (x.id === h.id ? h : x)));
        toast("Couldn't save that change.", "error");
      }
    },
    [supabase],
  );

  const deleteHighlight = useCallback(
    async (h: Highlight) => {
      setHighlights((list) => list.filter((x) => x.id !== h.id));
      await supabase.from("highlights").delete().eq("id", h.id);
      if (h.image_path) await supabase.storage.from("documents").remove([h.image_path]);
    },
    [supabase],
  );

  // Load a freshly added document (uploaded or found by identifier) as a tab.
  const loadDoc = useCallback(
    async (id: string): Promise<SessionDoc | null> => {
      const { data: row } = await supabase
        .from("documents")
        .select("id, title, storage_path, page_count, last_page, position, source_url, meta")
        .eq("id", id)
        .single();
      if (!row) return null;
      const signed = row.storage_path ? (await supabase.storage.from("documents").createSignedUrl(row.storage_path, URL_TTL)).data : null;
      return {
        id,
        label: "",
        title: row.title,
        pageCount: row.page_count,
        lastPage: row.last_page,
        position: row.position,
        url: signed?.signedUrl ?? "",
        hasPdf: Boolean(row.storage_path),
        sourceUrl: row.source_url,
        meta: row.meta ?? {},
      };
    },
    [supabase],
  );

  // Shared by "+ Add PDF" uploads and papers added by arXiv ID / DOI.
  // Files on their way in, listed in Files with their progress. A failure
  // stays there with Retry and doesn't stop the files after it.
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const retries = useRef(new Map<string, () => void>());
  const patchUpload = useCallback((key: string, patch: Partial<UploadItem> | null) => {
    setUploads((list) => (patch ? list.map((u) => (u.key === key ? { ...u, ...patch } : u)) : list.filter((u) => u.key !== key)));
  }, []);
  const tracked = useCallback(
    (name: string, run: (userId: string, position: number, onStatus: (s: string) => void) => Promise<string>, retry: () => void, keepFailure = true) => {
      const key = crypto.randomUUID();
      retries.current.set(key, retry);
      setUploads((list) => [...list, { key, name, status: "waiting" }]);
      return async (userId: string, position: number): Promise<string | null> => {
        patchUpload(key, { status: "working", note: undefined });
        try {
          const id = await run(userId, position, (note) => {
            setUploadStatus(note);
            patchUpload(key, { note });
          });
          patchUpload(key, null);
          retries.current.delete(key);
          return id;
        } catch (err) {
          if (keepFailure) patchUpload(key, { status: "failed", note: err instanceof Error ? err.message : "Couldn't add it." });
          else {
            patchUpload(key, null);
            retries.current.delete(key);
          }
          return null;
        }
      };
    },
    [patchUpload],
  );
  const retryUpload = useCallback(
    (key: string) => {
      const again = retries.current.get(key);
      retries.current.delete(key);
      patchUpload(key, null);
      again?.();
    },
    [patchUpload],
  );
  // Retry runs the same add again (through the latest version of it).
  const addAgain = useRef<{
    pdfs: (files: File[]) => unknown;
    imported: (items: ImportedFile[]) => unknown;
    papers: (papers: PaperMeta[]) => unknown;
    links?: (links: GoalLink[], keep: boolean) => unknown;
  } | null>(null);

  // Additions wait their turn: a paper still downloading never makes the
  // next one get dropped. Positions keep counting up across queued batches.
  const addQueue = useRef<Promise<unknown>>(Promise.resolve());
  const nextPosition = useRef(0);
  const addDocs = useCallback(
    (adders: ((userId: string, position: number) => Promise<string | null>)[]): Promise<SessionDoc[]> => {
      const run = addQueue.current.then(async () => {
        const added: SessionDoc[] = [];
        try {
          const { data: auth } = await supabase.auth.getUser();
          if (!auth.user) throw new Error("Your session expired. Sign in again.");
          nextPosition.current = Math.max(nextPosition.current, Math.max(-1, ...docs.map((d) => d.position)) + 1);
          // New PDFs go to Files; the tabs open now stay the only ones open.
          keepTabs(session.id, docIds.current);
          for (const add of adders) {
            // A failed file (null) is listed in Files with Retry; the rest carry on.
            const id = await add(auth.user.id, nextPosition.current++);
            const doc = id ? await loadDoc(id) : null;
            if (!doc) continue;
            added.push(doc);
            // Each is listed as soon as it's indexed, not after the whole batch.
            setDocs((list) => relabel([...list, doc]));
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Couldn't add that.";
          toast(message, "error");
          setUploads((list) => list.map((u) => (u.status === "failed" ? u : { ...u, status: "failed", note: message })));
        } finally {
          setUploadStatus(null);
        }
        return added;
      });
      addQueue.current = run.catch(() => {});
      return run;
    },
    [docs, loadDoc, session.id, supabase],
  );

  // Where a newly added PDF went: Files, not a tab.
  const addedToFiles = useCallback((added: SessionDoc[]) => {
    if (!added.length) return added;
    toast(`${added.length === 1 ? `“${added[0].title.slice(0, 60)}” is` : `${added.length} files are`} in Files. Open ${added.length === 1 ? "it" : "one"} there to read.`);
    return added;
  }, []);

  // Slides and Word files are turned into PDFs through Google first (ConvertFiles).
  const [converting, setConverting] = useState<File[] | null>(null);
  const addPdfs = useCallback(
    async (files: File[]) => {
      const office = files.filter(needsConversion);
      if (office.length) setConverting(office);
      const pdfs = files.filter((f) => !needsConversion(f));
      if (!pdfs.length) return [];
      return addedToFiles(
        await addDocs(
          pdfs.map((file) =>
            tracked(
              file.name,
              async (userId, position, onStatus) => {
                const { id, ocrNote } = await uploadPdfToSession(supabase, { userId, sessionId: session.id, file, position, onStatus });
                if (ocrNote) toast(ocrNote);
                return id;
              },
              () => void addAgain.current?.pdfs([file]),
            ),
          ),
        ),
      );
    },
    [addDocs, addedToFiles, session.id, supabase, tracked],
  );

  // PDFs picked when the session was created upload here, so the goal can be
  // written (and the plan queued) while they're read and indexed.
  const [incoming, setIncoming] = useState(() => peekHandoff(session.id).map(titleFromFile));
  useEffect(() => {
    const files = takeHandoff(session.id);
    if (files.length) void addPdfs(files).finally(() => setIncoming([]));
  }, [addPdfs, session.id]);

  const uploading = uploadStatus ?? (incoming.length ? "Getting your files ready…" : null);

  // A plan asked for mid-upload waits for the PDFs, so it can use them. The
  // wait lives here, not in the goal form, so switching tabs doesn't drop it.
  const uploadWaiters = useRef<(() => void)[]>([]);
  const stillUploading = useRef(Boolean(uploading));
  useEffect(() => {
    stillUploading.current = Boolean(uploading);
    if (uploading) {
      // Closing the tab mid-upload loses the rest of the PDFs.
      const warn = (e: BeforeUnloadEvent) => e.preventDefault();
      window.addEventListener("beforeunload", warn);
      return () => window.removeEventListener("beforeunload", warn);
    }
    for (const done of uploadWaiters.current.splice(0)) done();
  }, [uploading]);
  const uploadsSettled = useCallback(
    () => new Promise<void>((resolve) => (stillUploading.current ? uploadWaiters.current.push(resolve) : resolve())),
    [],
  );
  // A plan being queued or built: kept here, so leaving the Plan tab doesn't lose it.
  const [planJob, setPlanJob] = useState<PlanJob | null>(null);

  // Imported material (lectures, Drive, Zotero, printed web pages):
  // PDFs built or downloaded in the browser, with their title and source.
  const addImported = useCallback(
    (items: ImportedFile[]) =>
      addDocs(
        items.map((it) =>
          tracked(
            it.title || it.file.name,
            async (userId, position, onStatus) => {
              const { id } = await uploadPdfToSession(supabase, {
                userId,
                sessionId: session.id,
                file: it.file,
                position,
                onStatus,
                title: it.title,
                meta: it.meta,
                sourceUrl: it.sourceUrl ?? null,
              });
              return id;
            },
            () => void addAgain.current?.imported([it]),
          ),
        ),
      ),
    [addDocs, session.id, supabase, tracked],
  );

  const addPapers = useCallback(
    async (papers: PaperMeta[]) => {
      const skipped: string[] = [];
      const added = await addDocs(
        papers.map((paper) =>
          tracked(
            paper.title,
            async (userId, position, onStatus) => {
              const res = await addPaperFromMeta(supabase, { userId, sessionId: session.id, position, paper, onStatus });
              if (!res.hasPdf) skipped.push(`• ${paper.title}${res.note ? ` (${res.note})` : ""}`);
              return res.id;
            },
            () => void addAgain.current?.papers([paper]),
          ),
        ),
      );
      if (skipped.length) {
        toast(`Added without a PDF (abstract only):\n${skipped.join("\n")}\n\nYou can still do a first pass, and the tutor can look these up. Upload the PDF later for a deeper read.`);
      }
      return added;
    },
    [addDocs, session.id, supabase, tracked],
  );
  useEffect(() => {
    addAgain.current = { ...addAgain.current, pdfs: addPdfs, imported: addImported, papers: addPapers };
  }, [addImported, addPapers, addPdfs]);

  // Give a document without a PDF its file, keeping its id (and so its notes,
  // highlights and plan links): papers added by ID, and a pack's sources.
  const attachPdf = useCallback(
    async (docId: string, file: File): Promise<boolean> => {
      if (uploadStatus) return false;
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) throw new Error("Your session expired. Sign in again.");
        await attachPdfToDocument(supabase, { userId: auth.user.id, documentId: docId, file, onStatus: setUploadStatus });
        const fresh = await loadDoc(docId);
        if (fresh) setDocs((list) => relabel(list.map((d) => (d.id === docId ? fresh : d))));
        return true;
      } catch (err) {
        toast(err instanceof Error ? err.message : "Couldn't attach the PDF.", "error");
        return false;
      } finally {
        setUploadStatus(null);
      }
    },
    [loadDoc, supabase, uploadStatus],
  );

  const removePdf = useCallback(
    async (doc: SessionDoc) => {
      const ok = await ask({
        title: `Delete “${doc.title}”?`,
        body: "Its highlights are deleted too. Plan topics that use it stay, without page links.",
        confirm: "Delete it",
        danger: true,
      });
      if (!ok) return;
      const res = await deleteDocument(doc.id);
      if (res.error) return toast(res.error, "error");
      const remaining = relabel(docs.filter((d) => d.id !== doc.id));
      setDocs(remaining);
      setHighlights((list) => list.filter((h) => h.document_id !== doc.id));
      setTopics((list) => list.map((t) => (t.document_id === doc.id ? { ...t, document_id: null } : t)));
      if (activeDoc?.id === doc.id) {
        setGoTo(null);
        setActiveDocId(remaining[0]?.id ?? null);
      }
    },
    [activeDoc?.id, docs],
  );

  // Closing a tab keeps the PDF (it's in Files); the next open tab shows.
  const closeDocTab = useCallback(
    (doc: SessionDoc) => {
      closeTab(session.id, doc.id, docIds.current);
      if (activeDoc?.id === doc.id) {
        const i = openDocs.findIndex((d) => d.id === doc.id);
        const next = openDocs[i + 1] ?? openDocs[i - 1] ?? null;
        setGoTo(null);
        setActiveDocId(next?.id ?? null);
      }
    },
    [activeDoc?.id, openDocs, session.id],
  );

  const setTopicStatus = useCallback(
    async (topic: PlanTopic, status: TopicStatus) => {
      const patch = { status, completed_at: status === "completed" ? new Date().toISOString() : null };
      setTopics((list) => list.map((t) => (t.id === topic.id ? { ...t, ...patch } : t)));
      if (status === "completed" && activeTopicId === topic.id) setActiveTopicId(null);
      await supabase.from("plan_topics").update(patch).eq("id", topic.id);
    },
    [activeTopicId, supabase],
  );

  const reloadPlan = useCallback(async () => {
    const { data: p } = await supabase.from("study_plans").select("*").eq("session_id", session.id).maybeSingle();
    setPlan(p as StudyPlan | null);
    if (p) {
      const { data: t } = await supabase.from("plan_topics").select("*").eq("plan_id", p.id).order("position");
      setTopics((t ?? []) as PlanTopic[]);
      setActiveTopicId(null);
      const firstInPdf = ((t ?? []) as PlanTopic[]).find((x) => x.source === "pdf" && x.page_start && x.document_id);
      if (firstInPdf?.page_start) jumpTo(firstInPdf.page_start, firstInPdf.document_id);
    }
  }, [jumpTo, session.id, supabase]);

  // Custom pace: a new daily time and deadline. The plan stays; the topics
  // still to do are spread again from today to the new deadline.
  const repace = useCallback(
    async (minutesPerDay: number, deadline: string) => {
      if (!plan) return;
      const left = topics.filter((t) => t.status !== "completed");
      const dates = assignDueDates(
        left.map((t) => t.est_minutes),
        toISODate(new Date()),
        deadline,
      );
      const due = new Map(left.map((t, i) => [t.id, dates[i]]));
      const results = await Promise.all([
        supabase.from("study_plans").update({ deadline, minutes_per_day: minutesPerDay }).eq("id", plan.id),
        ...left.map((t) => supabase.from("plan_topics").update({ due_date: due.get(t.id) }).eq("id", t.id)),
      ]);
      if (results.some((r) => r.error)) throw new Error("Couldn't save the new pace. Check your connection and try again.");
      setPlan({ ...plan, deadline, minutes_per_day: minutesPerDay });
      setTopics((list) => list.map((t) => (due.has(t.id) ? { ...t, due_date: due.get(t.id)! } : t)));
      track("plan.repace", { minutesPerDay, topics: left.length });
      toast("New pace set: your topics are rescheduled.");
    },
    [plan, supabase, topics],
  );

  // A plan finishes after its uploads, maybe long after it was asked for:
  // reload with the latest documents, not the ones from back then.
  const reloadPlanRef = useRef(reloadPlan);
  useEffect(() => {
    reloadPlanRef.current = reloadPlan;
  }, [reloadPlan]);
  const onPlanCreated = useCallback(() => reloadPlanRef.current(), []);

  // Every paper has a review, even before its first note is saved.
  const reviews = useMemo(
    () => Object.fromEntries(docs.map((d) => [d.id, storedReviews[d.id] ?? emptyReview(d.id)])),
    [docs, storedReviews],
  );

  // Notes save as you type, debounced per paper.
  const saveTimers = useRef(new Map<string, number>());
  const updateReview = useCallback(
    (docId: string, patch: Partial<PaperReview>, persist = true) => {
      setStoredReviews((all) => {
        const next = { ...(all[docId] ?? emptyReview(docId)), ...patch };
        if (persist) {
          window.clearTimeout(saveTimers.current.get(docId));
          saveTimers.current.set(
            docId,
            window.setTimeout(() => {
              const { document_id, target_pass, passes_done, triage_reason, pass1, pass2, pass3 } = next;
              fire(
                supabase
                  .from("paper_reviews")
                  .upsert({ document_id, session_id: session.id, target_pass, passes_done, triage_reason, pass1, pass2, pass3 }, { onConflict: "document_id" }),
                "the paper's notes",
              );
            }, 600),
          );
        }
        return { ...all, [docId]: next };
      });
    },
    [session.id, supabase],
  );

  // Study sessions can hold papers too: they get the three passes.
  const paperIds = useMemo(
    () => new Set(isExam ? [] : docs.filter((d) => isPaper || isPaperDoc(d, storedReviews)).map((d) => d.id)),
    [docs, isExam, isPaper, storedReviews],
  );
  // Papers added through the paper search (or the goal and plan) are papers;
  // the rest are recognised automatically (see /api/paper/detect).
  const markPaper = useCallback((docId: string) => updateReview(docId, {}), [updateReview]);

  // Study sessions: spot the PDFs that are research papers (Semantic Scholar,
  // OpenAlex and the goal; see /api/paper/detect) whenever PDFs or the goal change.
  const detectKey = isPaper || isExam ? "" : `${docs.map((d) => d.id).join(",")}|${plan?.id ?? ""}|${plan?.goal ?? ""}`;
  useEffect(() => {
    if (!detectKey || !docs.some((d) => d.hasPdf && !paperIds.has(d.id))) return;
    let live = true;
    const id = window.setTimeout(async () => {
      try {
        await viewerReady(); // the PDF being read loads first
        if (!live) return;
        const res = await fetch("/api/paper/detect", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ sessionId: session.id }) });
        if (!res.ok || !live) return;
        const { papers } = (await res.json()) as { papers: { id: string; title: string; meta: SessionDoc["meta"] }[] };
        if (!papers.length || !live) return;
        const found = new Map(papers.map((p) => [p.id, p]));
        setDocs((list) => list.map((d) => (found.has(d.id) ? { ...d, title: found.get(d.id)!.title, meta: found.get(d.id)!.meta } : d)));
        // Already saved by the server.
        for (const p of papers) updateReview(p.id, {}, false);
        toast(
          papers.length === 1
            ? `“${papers[0].title}” is a research paper. Open it to read it with the three passes.`
            : `Found ${papers.length} research papers. Open one to read it with the three passes.`,
        );
      } catch {}
    }, 1500);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
    // Runs when the PDFs or the goal change, not on every edit to the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectKey]);

  // Opening a paper in a study session switches a tool that's out to its
  // passes (it doesn't slide one out over the page you asked to read);
  // leaving the papers switches back to the plan.
  const openDocTab = useCallback(
    (docId: string) => {
      selectDoc(docId);
      if (isPaper || isExam) return;
      if (paperIds.has(docId)) {
        setPassesOpen(true);
        setTool((t) => (t ? "passes" : t));
      } else setTool((t) => (t === "passes" ? (plan ? "plan" : null) : t));
    },
    [isExam, isPaper, paperIds, plan, selectDoc],
  );

  // The literature map and the paper tools (BibTeX, Zotero, related work, compare).
  const [mapOpen, setMapOpen] = useState(false);
  const [paperTool, setPaperTool] = useState<Exclude<PaperTool, "bibtex"> | null>(null);
  const paperDocs = useMemo(() => docs.filter((d) => paperIds.has(d.id)), [docs, paperIds]);

  // Uploaded through "Add paper" in a study session: mark them as papers,
  // and show them in Papers.
  const addPaperPdfs = useCallback(
    async (files: File[]) => {
      const added = await addPdfs(files);
      if (isPaper || !added.length) return;
      for (const d of added) markPaper(d.id);
      openTool("passes");
    },
    [addPdfs, isPaper, markPaper, openTool],
  );

  // Papers found by arXiv ID, DOI, title, Zotero or a suggestion. In a study
  // session they're marked as papers (some have no DOI or arXiv ID to tell).
  // `reveal`: show them in Papers. Not for papers added in the background
  // (from the goal or the plan): nothing slides out unasked.
  const addPaperMetas = useCallback(
    async (papers: PaperMeta[], reveal = true) => {
      const added = await addPapers(papers);
      if (isPaper || !added.length) return added;
      for (const d of added) markPaper(d.id);
      if (reveal) openTool("passes");
      return added;
    },
    [addPapers, isPaper, markPaper, openTool],
  );

  // What the goal names that isn't in the session yet: the "To add" tab.
  const later = useLater(session.id);
  const laterNow = useRef(later);
  useEffect(() => {
    laterNow.current = later;
  }, [later]);
  // The paper search listing those papers (and, from "Add", looking one up).
  const [goalSearch, setGoalSearch] = useState<{ focus?: string } | null>(null);
  const openGoalSearch = useCallback((focus?: string) => {
    setGoalSearch({ focus });
    setAddPaperOpen(true);
  }, []);
  // A paper named in the plan ("Find & add"): the paper search, on its title.
  const [paperQuery, setPaperQuery] = useState<string | null>(null);
  useEffect(() => {
    const onFind = (e: Event) => {
      setGoalSearch(null);
      setPaperQuery((e as CustomEvent<{ query: string }>).detail.query);
      setAddPaperOpen(true);
    };
    window.addEventListener(FIND_PAPER_EVENT, onFind);
    return () => window.removeEventListener(FIND_PAPER_EVENT, onFind);
  }, []);

  // YouTube lectures (from the goal, or a playlist), read into PDFs one by
  // one, each listed in Files as it comes in. `keep`: a failure stays there
  // with Retry; otherwise it's handed back (a goal's links return to its list).
  // Web pages aren't fetched: the student prints them to PDF (see ToAddSection).
  const importLinks = useCallback(
    async (links: (GoalLink & { title?: string })[], keep = false) => {
      const done: string[] = [];
      const added = await addDocs(
        links.map((l) =>
          tracked(
            l.title || l.url.replace(/^https?:\/\/(www\.)?/, ""),
            async (userId, position, onStatus) => {
              const got = await lecturePdf({ url: l.url }, onStatus);
              const { id } = await uploadPdfToSession(supabase, {
                userId,
                sessionId: session.id,
                file: got.file,
                position,
                onStatus,
                title: got.title,
                meta: got.meta,
                sourceUrl: got.sourceUrl ?? null,
              });
              done.push(l.url);
              return id;
            },
            () => void addAgain.current?.links?.([l], keep),
            keep,
          ),
        ),
      );
      return { added, done, failed: links.filter((l) => !done.includes(l.url)) };
    },
    [addDocs, session.id, supabase, tracked],
  );
  useEffect(() => {
    if (addAgain.current) addAgain.current.links = importLinks;
  }, [importLinks]);

  // The papers and links a study goal names, handled once per goal (see
  // /api/paper/from-goal). Papers found for sure and YouTube lectures are
  // added straight away; papers that couldn't be found open the paper search
  // (and, like other links, wait in "To add" until they're dealt with).
  const goalKey = !isPaper && !isExam && plan ? `confu:goal-papers2:${session.id}:${hashText(`${plan.goal_title}\n${plan.goal}\n${plan.materials}`)}` : null;
  const goalActions = useRef({ addPaperMetas, importLinks, uploadsSettled, openGoalSearch, viewerReady });
  useEffect(() => {
    goalActions.current = { addPaperMetas, importLinks, uploadsSettled, openGoalSearch, viewerReady };
  });
  useEffect(() => {
    // Once per goal per visit (effects can run twice); its own work runs to the end.
    if (!goalKey || locked || goalRunFor.current === goalKey) return;
    goalRunFor.current = goalKey;
    try {
      if (localStorage.getItem(goalKey) === "done") return;
      // A failed attempt (the AI busy, offline) waits ten minutes before the next.
      if (Date.now() - Number(localStorage.getItem(`${goalKey}:tried`) ?? 0) < 600_000) return;
    } catch {}
    // The plan's own papers wait for this to finish (see below), so nothing is added twice.
    goalJob.current = (async () => {
      await goalActions.current.viewerReady(); // the PDF being read loads first
      const res = await fetch("/api/paper/from-goal", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ sessionId: session.id }) }).catch(() => null);
      notifyAiUsed();
      if (!res?.ok) {
        try {
          localStorage.setItem(`${goalKey}:tried`, String(Date.now()));
        } catch {}
        return;
      }
      try {
        localStorage.setItem(goalKey, "done");
      } catch {}
      const found = (await res.json()) as { papers: GoalPaper[]; links: GoalLink[] };
      const hint = (p: GoalPaper): GoalHint => ({ name: p.name, title: p.title, doi: p.doi, arxiv: p.arxiv, authors: p.authors });
      const sure = found.papers.filter((p) => p.paper);
      const unsure = found.papers.filter((p) => !p.paper).map(hint);
      const lectures = found.links.filter((l) => l.kind === "youtube");
      addLater(session.id, { papers: unsure, links: found.links.filter((l) => l.kind !== "youtube") });

      const act = goalActions.current;
      await act.viewerReady();
      await act.uploadsSettled();
      const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const notes: string[] = [];
      if (sure.length) {
        const added = await act.addPaperMetas(
          sure.map((p) => p.paper!),
          false,
        );
        const missed = sure.filter((p) => !added.some((d) => squash(d.title) === squash(p.paper!.title)));
        if (missed.length) addLater(session.id, { papers: missed.map(hint) });
        if (added.length) notes.push(`${added.length} ${added.length === 1 ? "paper" : "papers"}`);
      }
      if (lectures.length) {
        const { done, failed } = await act.importLinks(lectures);
        if (failed.length) addLater(session.id, { links: failed });
        if (done.length) notes.push(`${done.length} ${done.length === 1 ? "lecture" : "lectures"}`);
      }
      if (notes.length) toast(`Added ${notes.join(" and ")} from your goal.`);
      if (unsure.length) act.openGoalSearch();
    })();
  }, [goalKey, locked, session.id]);

  // The papers the plan itself recommends ("Go deeper"), added the same way:
  // found for sure, added; not sure, waiting in Files to be searched for. Once
  // per plan, after the goal's papers are in, skipping any already in Files.
  const goalJob = useRef<Promise<unknown>>(Promise.resolve());
  const goalRunFor = useRef<string | null>(null);
  const docsNow = useRef(docs);
  useEffect(() => {
    docsNow.current = docs;
  }, [docs]);
  const planPapersFor = useRef<string | null>(null);
  useEffect(() => {
    if (isPaper || isExam || !plan || locked || !topics.length || topics[0].plan_id !== plan.id) return;
    if (planPapersFor.current === plan.id) return;
    const key = `confu:plan-papers:${plan.id}`;
    try {
      if (localStorage.getItem(key)) return;
      if (Date.now() - Number(localStorage.getItem(`${key}:tried`) ?? 0) < 600_000) return;
    } catch {}
    planPapersFor.current = plan.id;
    const titles = [...new Map(topics.flatMap((t) => t.resources ?? []).filter(isPaperResource).map((r) => [r.title.toLowerCase(), r])).values()];
    void (async () => {
      await goalJob.current;
      await goalActions.current.viewerReady(); // the PDF being read loads first
      const wanted = titles.filter((r) => !docForResource(r, docsNow.current) && !laterNow.current.papers.some((p) => p.name === r.title)).slice(0, 12);
      if (wanted.length) {
        const res = await fetch("/api/paper/resolve-titles", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ sessionId: session.id, titles: wanted.map((r) => r.title), field: plan.goal_title ?? "" }),
        }).catch(() => null);
        if (!res?.ok) {
          // Try again on a later visit, not straight away.
          try {
            localStorage.setItem(`${key}:tried`, String(Date.now()));
          } catch {}
          return;
        }
        const { papers } = (await res.json()) as { papers: GoalPaper[] };
        addLater(session.id, { papers: papers.filter((p) => !p.paper).map((p) => ({ name: p.name, title: p.title })) });
        const act = goalActions.current;
        await act.viewerReady();
        await act.uploadsSettled();
        const sure = papers.flatMap((p) => (p.paper && !docsNow.current.some((d) => d.title.toLowerCase() === p.paper!.title.toLowerCase()) ? [p.paper] : []));
        if (sure.length) {
          const added = await act.addPaperMetas(sure, false);
          if (added.length) toast(`Added ${added.length} ${added.length === 1 ? "paper" : "papers"} your plan recommends. They're in Files.`);
        }
      }
      try {
        localStorage.setItem(key, "done");
      } catch {}
    })();
  }, [isExam, isPaper, locked, plan, session.id, topics]);

  const saveExamDate = useCallback(
    (date: string | null) => {
      setExamDate(date);
      fire(supabase.from("study_sessions").update({ exam_date: date }).eq("id", session.id), "the exam date");
    },
    [session.id, supabase],
  );

  const saveResearchGoal = useCallback(
    (goal: string) => {
      setResearchGoal(goal);
      fire(supabase.from("study_sessions").update({ research_goal: goal }).eq("id", session.id), "the research question");
    },
    [session.id, supabase],
  );

  const setCiteMode = useCallback(
    (on: boolean) => {
      setCiteModeOn(on);
      void supabase
        .from("study_sessions")
        .update({ cite_mode: on })
        .eq("id", session.id)
        .then(({ error }) => {
          if (!error) return;
          setCiteModeOn(!on);
          toast(/cite_mode/i.test(error.message) ? "Cite mode needs migration 0035 to be run." : "Couldn't save that.", "error");
        });
    },
    [session.id, supabase],
  );

  // Keyboard shortcuts (see Shortcuts.tsx). Only when not typing and no
  // dialog is open; one listener, reading the latest state through a ref.
  // Ctrl/Cmd+E and Ctrl/Cmd+T are the exception: they still run while the
  // tutor box is focused, because plain e and t would just be typed.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [recall, setRecall] = useState<{ topic: PlanTopic; offer: boolean } | null>(null);

  // A topic's audio overview: written once (then kept in this browser) and
  // read aloud by the browser's own voice.
  const listen = useCallback(async (t: PlanTopic) => {
    if (!speechSupported()) return toast("This browser can't read aloud. Try Chrome, Edge or Safari.", "error");
    const key = `confu:overview:${t.id}`;
    let script: string | null = null;
    try {
      script = localStorage.getItem(key);
    } catch {}
    speechLoading(t.title);
    track("overview.listen", { cached: Boolean(script) });
    if (!script) {
      const res = await fetch("/api/topic/overview", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ topicId: t.id }) }).catch(() => null);
      notifyAiUsed();
      if (!res?.ok) {
        speechStop();
        return toast(res ? await readAiError(res) : "Couldn't reach Confu. Check your connection.", "error");
      }
      script = ((await res.json()) as { script: string }).script;
      try {
        localStorage.setItem(key, script);
      } catch {}
    }
    speechPlay(t.title, script);
  }, []);
  // Leaving the session ends the overview.
  useEffect(() => speechStop, []);
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKey.current = (e) => {
      if (e.defaultPrevented) return;
      const key = e.key.toLowerCase();
      // Plain e and t type into the box. Ctrl/Cmd+E and Ctrl/Cmd+T still
      // run those commands from there.
      const tutorChord = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (key === "e" || key === "t");
      if (tutorChord && e.repeat) return;
      if ((e.ctrlKey || e.metaKey || e.altKey) && !tutorChord) return;
      const el = e.target as HTMLElement | null;
      const typing = Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
      if (typing && !tutorChord) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      // A tool's key brings it out, or puts it away if it's already out.
      const toggleTool = (t: ToolTab) => (wideRef.current && tool === t ? setTool(null) : openTool(t));
      const writeToTutor = () => {
        revealTutor();
        window.setTimeout(() => document.getElementById("tutor-input")?.focus(), 50);
      };
      const i = openDocs.findIndex((d) => d.id === activeDoc?.id);
      const go: Record<string, (() => void) | undefined> = {
        "?": () => setShortcutsOpen(true),
        t: () => (wideRef.current && layout.tutorOpen ? foldTutorAway() : writeToTutor()),
        // In full screen: the tutor across the whole screen, or back beside the page.
        e:
          wideRef.current && focusMode
            ? () => {
                if (!layout.tutorOpen) revealTutor();
                showTutorFull(!tutorFullShown);
              }
            : undefined,
        "/": writeToTutor,
        p: () => toggleTool(isExam ? "practice" : isPaper ? "passes" : "plan"),
        f: () => toggleTool("files"),
        h: isExam && !saved.length ? undefined : () => toggleTool("highlights"),
        // A floating tool; a pinned one stays until it's closed.
        Escape: tutorFullShown ? () => showTutorFull(false) : wideRef.current && tool && !docked ? () => setTool(null) : undefined,
        "[": () => openDocs.length > 1 && selectDoc(openDocs[(i - 1 + openDocs.length) % openDocs.length].id),
        "]": () => openDocs.length > 1 && selectDoc(openDocs[(i + 1) % openDocs.length].id),
        w: () => activeDoc && closeDocTab(activeDoc),
        n: () => {
          const next = currentTopic(topics);
          if (next?.source === "pdf" && next.page_start && next.document_id) {
            setActiveTopicId(next.id);
            jumpTo(next.page_start, next.document_id);
          } else if (next) {
            setActiveTopicId(next.id);
            openTool("plan");
          }
        },
        // Tab, not Shift+Tab, so moving focus backward still works.
        Tab: e.shiftKey ? undefined : () => toggleFocus(),
      };
      const run = tutorChord ? go[key] : go[e.key];
      if (!run) return;
      e.preventDefault();
      run();
    };
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // Going to a page from a floating tool (or a citation) puts the tool away,
  // so the page is in view. A pinned tool stays.
  const jumpIntoView = useCallback(
    (p: number, docId?: string | null) => {
      if (wideRef.current && !docked) setTool(null);
      jumpTo(p, docId);
    },
    [docked, jumpTo],
  );
  // Citations from the tutor: "p. 12" (current PDF) or "D2 p. 12".
  const citeIntoView = useCallback(
    (p: number, label?: string) => jumpIntoView(p, label ? docs.find((d) => d.label === label)?.id : undefined),
    [docs, jumpIntoView],
  );

  // Everything the tutor and the tools draw from.
  const panelProps: PanelProps = {
    sessionId: session.id,
    docs,
    plan,
    topics,
    activeTopic,
    memory,
    highlights,
    messages,
    busy,
    onSend: send,
    onJump: jumpIntoView,
    onCite: citeIntoView,
    onFocusTopic: (t) => setActiveTopicId(t.id),
    onTopicStatus: (t, s) => {
      void setTopicStatus(t, s);
      // Just finished: offer a quick recall check (unless turned off).
      if (s === "completed" && recallOffered()) setRecall({ topic: t, offer: true });
    },
    onRecall: (t) => setRecall({ topic: t, offer: false }),
    onListen: listen,
    onExplain: (t) => {
      const docId = t.document_id ?? activeDoc?.id ?? null;
      const pageNo = t.page_start ?? activeDoc?.lastPage ?? 1;
      if (!docId) return;
      if (t.page_start && t.document_id) jumpTo(t.page_start, t.document_id);
      setMobileView("pdf");
      setExplain({ documentId: docId, page: pageNo, topic: t.title });
    },
    saved,
    onSaveAnswer: (m) => void saveAnswer(m),
    onUnsaveAnswer: (id) => void unsaveAnswer(id),
    onDeleteHighlight: deleteHighlight,
    onUpdateHighlight: updateHighlight,
    onPlanCreated,
    onRepace: repace,
    files: {
      docs,
      activeId: activeDoc?.id ?? null,
      open: openIds,
      addLabel: isPaper ? "+ Add paper" : "+ Add material",
      onAdd: isPaper ? () => setAddPaperOpen(true) : () => setAddMaterialOpen(true),
      onAddPapers: isPaper || isExam ? undefined : () => setAddPaperOpen(true),
      uploads,
      onRetry: retryUpload,
      onDismiss: (key) => {
        retries.current.delete(key);
        patchUpload(key, null);
      },
      later:
        isPaper || isExam
          ? undefined
          : {
              later,
              busy: false,
              onFind: openGoalSearch,
              onRemovePaper: (name) => removeLater(session.id, { papers: [name] }),
              // They leave this list at once for "Coming in" (with progress); any that fail come back.
              onImport: async (links) => {
                removeLater(session.id, { links: links.map((l) => l.url) });
                const { failed } = await importLinks(links);
                if (failed.length) {
                  addLater(session.id, { links: failed });
                  toast(`Couldn't bring in:\n${failed.map((l) => l.url).join("\n")}\n\nThey're back under “From your goal”; try them from + Add material too.`, "error");
                }
              },
              onPlaylist: (url) => {
                setMaterialStart({ tab: "youtube", url });
                setAddMaterialOpen(true);
              },
              onRemoveLink: (url) => removeLater(session.id, { links: [url] }),
              // A web page from the goal, printed to PDF by the student: kept with its link.
              onPrinted: (url, file) => {
                removeLater(session.id, { links: [url] });
                void addImported([{ file, sourceUrl: url, meta: { source: "web" } }]).then(addedToFiles);
              },
            },
      // Shows it in the reader (Files stays out if it's pinned).
      onOpen: (docId) => {
        selectDoc(docId);
        if (wideRef.current && !docked) setTool(null);
        setMobileView("pdf");
      },
      onCloseTab: closeDocTab,
      onDelete: removePdf,
      paperIds: isPaper || isExam ? undefined : paperIds,
    },
    draftGoal: session.draftGoal ?? "",
    setup: { upload: uploading, incoming, settled: uploadsSettled, job: planJob, setJob: setPlanJob },
    kind: session.kind,
    paper: {
      reviews,
      researchGoal,
      activeDocId: activeDoc?.id ?? null,
      onSelectDoc: selectDoc,
      onUpdate: updateReview,
      onResearchGoal: saveResearchGoal,
      fetching: uploadStatus,
      paperIds,
      onMarkPaper: markPaper,
      onAddPapers: () => setAddPaperOpen(true),
      studyGoal: plan ? plan.goal_title || plan.goal : "",
      onOpenMap: () => setMapOpen(true),
      passesOpen,
      onPassesOpen: setPassesOpen,
      onTool: (t) => (t === "bibtex" ? exportBibtex(paperDocs, session.title) : setPaperTool(t)),
    },
    exam: { practice, examDate, onExamDate: saveExamDate, onTrial },
    citeMode,
    onCiteMode: setCiteMode,
    citeFiles: multi
      ? {
          ids: citeIds,
          custom: citeTouched,
          onToggle: (id: string) => {
            setCiteTouched(true);
            setCitePicked(citeIds.includes(id) ? (citeIds.length === 1 ? citeIds : citeIds.filter((x) => x !== id)) : [...citeIds, id]);
          },
          onAll: () => {
            setCiteTouched(true);
            setCitePicked(docs.map((d) => d.id));
          },
          onOpenOnly: () => {
            setCiteTouched(false);
            setCitePicked([]);
          },
        }
      : null,
    onView: showView,
  };

  const sections = toolSections(panelProps);
  const sectionOf = (id: ToolTab): Section => sections.find((s) => s.id === id) ?? { id, label: id === "passes" ? "Papers" : "Tool", hint: "" };

  // The tutor: its header (what page it's reading along with, usage), then
  // the chat, or the key form while there's no key.
  const where = activeDoc?.hasPdf ? `Reading ${multi ? `${activeDoc.label} · ` : ""}p. ${page}` : null;
  const tutor = (onFold?: () => void, onExpand?: () => void, expanded = false) => (
    <>
      <TutorHeader
        where={where}
        busy={Boolean(busy)}
        onClear={messages.length && !locked ? () => void clearChat() : undefined}
        onFold={onFold}
        onExpand={onExpand}
        expanded={expanded}
        onShortcuts={wide ? () => setShortcutsOpen(true) : undefined}
        tutors={
          <HarnessBar
            onChange={(link) => {
              harnessRef.current = link;
              setLocalTutor(link.id !== "groq");
            }}
          />
        }
        usage={<UsageMeter sessionId={session.id} keyId={needsKey ? keyInfo?.id : undefined} keyLast4={needsKey ? keyInfo?.last4 : undefined} />}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
        {locked && !localTutor ? (
          <KeyGate
            sessionId={session.id}
            notice={keyNotice}
            onSaved={(info) => {
              setKeyInfo(info);
              setKeyNotice(null);
            }}
          />
        ) : (
          <TutorPanel view="chat" {...panelProps} />
        )}
      </div>
    </>
  );

  // Resizing: the tutor from its right edge, a tool from its left edge.
  const dragTutor = (x: number) => {
    const box = rootRef.current?.getBoundingClientRect();
    if (box) setLayout((l) => ({ ...l, tutor: clamp(Math.round(x - box.left), 300, 720) }));
  };
  const dragSheet = (x: number) => {
    const box = rootRef.current?.getBoundingClientRect();
    if (box) setLayout((l) => ({ ...l, sheet: clamp(Math.round(box.right - x), SHEET_MIN, 760) }));
  };

  // Phones: one thing at a time.
  const mobileShown = mobileView === "tool" && !tool ? "pdf" : mobileView;
  const mobileItems: MobileItem[] = [
    { id: "pdf", label: "Read", icon: "reader" },
    { id: "chat", label: "Tutor", icon: "chat", dot: Boolean(busy) },
    ...sections.map((s) => ({ id: s.id, label: s.label, icon: s.id, badge: s.badge, dot: s.dot })),
  ];

  const sheetOpen = Boolean(tool);
  const sheetDocked = sheetOpen && docked;

  return (
    <div ref={rootRef} className={`flex min-h-0 flex-1 flex-col bg-paper ${focusMode ? "fixed inset-0 z-40" : "relative"}`}>
      <div className="relative flex min-h-0 flex-1">
        {/* Left: the tutor, or (phones) the tutor or a tool in place of the reader. */}
        {wide ? (
          layout.tutorOpen ? (
            <>
              {/* The tutor's place in the row. Across the whole screen, it
                  widens from here over the reader and the tools. */}
              <div className="relative shrink-0" style={{ width: tutorWidth }}>
                <aside
                  aria-label="Tutor"
                  style={{ width: tutorFullShown ? rootWidth : tutorWidth }}
                  className={`@container absolute inset-y-0 left-0 flex min-w-0 flex-col bg-panel ${tutorFullShown || tutorMotion ? "z-30" : ""} ${
                    tutorMotion ? "shadow-[14px_0_40px_-20px_rgba(13,13,12,0.5)] transition-[width] duration-300 ease-fluid motion-reduce:transition-none" : ""
                  }`}
                >
                  {tutor(foldTutorAway, focusMode ? () => showTutorFull(!tutorFullShown) : undefined, tutorFullShown)}
                </aside>
              </div>
              {!tutorFullShown && (
                <ResizeHandle
                  label="Resize the tutor"
                  className="relative -mx-1"
                  onDrag={dragTutor}
                  onDone={() => updateLayout({})}
                  onNudge={(by) => updateLayout({ tutor: clamp(tutorWidth + by, 300, 720) })}
                  onReset={() => updateLayout({ tutor: DEFAULT_LAYOUT.tutor })}
                />
              )}
            </>
          ) : (
            <TutorRail busy={Boolean(busy)} onOpen={revealTutor} />
          )
        ) : mobileShown === "tutor" ? (
          <aside aria-label="Tutor" className="@container flex w-full min-w-0 flex-col bg-panel">
            {tutor()}
          </aside>
        ) : mobileShown === "tool" && tool ? (
          <aside aria-label={sectionOf(tool).label} className="@container flex w-full min-w-0 flex-col bg-panel">
            <ToolHeader section={sectionOf(tool)} />
            <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
              <TutorPanel view={tool} {...panelProps} />
            </div>
          </aside>
        ) : null}

        {/* Middle: what you're reading. Clicking back into it puts a floating tool away. */}
        <section
          aria-label="Reader"
          inert={tutorFullShown}
          onPointerDownCapture={() => {
            if (wide && tool && !docked) setTool(null);
          }}
          className={`relative min-w-0 flex-1 flex-col ${wide || mobileShown === "pdf" ? "flex" : "hidden"}`}
        >
          <PackSources sessionId={session.id} docs={docs} busy={Boolean(uploadStatus)} onAttach={attachPdf} onSelect={openDocTab} />
          <DocTabs
            docs={openDocs}
            activeId={activeDoc?.id ?? null}
            uploadStatus={uploadStatus}
            onSelect={openDocTab}
            onAdd={addPdfs}
            onClose={closeDocTab}
            onReorder={(ids) => reorderTabs(session.id, ids, docIds.current)}
            onAddClick={isPaper ? () => setAddPaperOpen(true) : () => setAddMaterialOpen(true)}
            addLabel={isPaper ? "+ Add paper" : "+ Add material"}
            paperIds={isPaper || isExam ? undefined : paperIds}
            onPaper={
              isPaper || isExam
                ? undefined
                : () => {
                    // Its passes, beside the PDF.
                    setPassesOpen(true);
                    openTool("passes");
                  }
            }
          />
          <div className="relative min-h-0 flex-1">
            {activeDoc && !activeDoc.hasPdf && pendingSource(activeDoc) && pendingSource(activeDoc)!.kind !== "paper" ? (
              <PendingSourceCard key={activeDoc.id} doc={activeDoc} busy={Boolean(uploadStatus)} onAttach={attachPdf} />
            ) : activeDoc && !activeDoc.hasPdf ? (
              <PaperCard key={activeDoc.id} doc={activeDoc} busy={Boolean(uploadStatus)} onAttach={(file) => void attachPdf(activeDoc.id, file)} />
            ) : activeDoc && !tabsKnown ? (
              <div className="h-full bg-viewer" />
            ) : activeDoc ? (
              <PdfViewer
                key={activeDoc.id}
                url={activeDoc.url}
                documentId={activeDoc.id}
                initialPage={activeDoc.lastPage}
                goTo={goTo}
                highlights={docHighlights}
                busy={Boolean(busy)}
                focusMode={focusMode}
                onToggleFocus={toggleFocus}
                onPageChange={onPageChange}
                onLoaded={viewerLoaded}
                onTextAction={onTextAction}
                onSaveHighlight={saveHighlight}
                onUpdateHighlight={updateHighlight}
                onDeleteHighlight={deleteHighlight}
                onPin={(selection) => setPinDraft({ page: selection.page, text: selection.text.slice(0, 500) })}
                onRegion={onRegion}
              />
            ) : docs.length ? (
              <div className="animate-enter flex h-full flex-col items-center justify-center gap-2 bg-viewer px-6 text-center">
                <p className="font-serif text-2xl">Nothing open</p>
                <p className="max-w-sm text-sm text-muted">Everything is in Files. Open something there to read it here.</p>
                <button
                  type="button"
                  onClick={() => openTool("files")}
                  className="mt-3 rounded-lg border border-ink bg-ink px-4 py-2 text-sm font-medium text-white transition hover:-translate-y-px hover:shadow-hard-sm"
                >
                  Open Files
                </button>
              </div>
            ) : (
              <div className="animate-enter flex h-full flex-col items-center justify-center gap-2 bg-viewer px-6 text-center">
                <p className="font-serif text-2xl">{isPaper ? "No papers yet" : "Nothing in this session yet"}</p>
                <p className="max-w-sm text-sm text-muted">
                  {isPaper
                    ? "Add papers by arXiv ID, DOI, link or title. No PDF needed."
                    : "Add PDFs, slides, Word docs, web pages saved as PDFs, YouTube lectures, Google Drive or Zotero. The tutor still works from your goal meanwhile."}
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <button
                    onClick={isPaper ? () => setAddPaperOpen(true) : () => setAddMaterialOpen(true)}
                    className="rounded-lg border border-ink bg-ink px-4 py-2 text-sm font-medium text-white transition hover:-translate-y-px hover:shadow-hard-sm"
                  >
                    {isPaper ? "+ Add papers" : "+ Add material"}
                  </button>
                  {isPaper && (
                    <button onClick={openRecommendPapers} className="rounded-lg border border-ink bg-panel px-4 py-2 text-sm font-medium transition hover:-translate-y-px hover:shadow-hard-sm">
                      Suggest papers for my goal
                    </button>
                  )}
                </div>
              </div>
            )}
            {activeDoc?.hasPdf && (
              <PagePins
                sessionId={session.id}
                documentId={activeDoc.id}
                page={activeDoc.lastPage || 1}
                draft={pinDraft}
                onExplain={() => {
                  setMobileView("pdf");
                  setExplain({ documentId: activeDoc.id, page: activeDoc.lastPage || 1, topic: activeTopic?.title ?? "" });
                }}
              />
            )}
          </div>
        </section>

        {/* Right: the tool that's out (floating over the reader, or pinned
            beside it), and the small bar of every tool at its edge. */}
        {wide && lastTool && (
          <aside
            aria-label={sectionOf(lastTool).label}
            aria-hidden={!sheetOpen}
            inert={!sheetOpen || tutorFullShown}
            style={{ width: sheetWidth, right: sheetDocked ? undefined : 0 }}
            className={`@container flex min-w-0 flex-col border-l border-ink bg-panel transition-[translate,opacity,visibility] duration-200 ease-fluid ${
              sheetDocked ? "relative shrink-0" : "absolute inset-y-0 z-20 shadow-[-12px_0_32px_-16px_rgba(13,13,12,0.45)]"
            } ${sheetOpen ? "visible translate-x-0 opacity-100" : "pointer-events-none invisible translate-x-6 opacity-0"}`}
          >
            <ResizeHandle
              label="Resize the panel"
              className="absolute inset-y-0 -left-1"
              onDrag={dragSheet}
              onDone={() => updateLayout({})}
              onNudge={(by) => updateLayout({ sheet: clamp(sheetWidth - by, SHEET_MIN, 760) })}
              onReset={() => updateLayout({ sheet: DEFAULT_LAYOUT.sheet })}
            />
            <ToolHeader
              section={sectionOf(lastTool)}
              pinned={sheetDocked}
              canPin={canPin}
              onPin={() => updateLayout({ pinned: !sheetDocked })}
              onClose={() => setTool(null)}
            />
            <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
              <TutorPanel view={lastTool} {...panelProps} />
            </div>
          </aside>
        )}
        {wide && (
          <ToolDock
            sections={sections}
            active={tool}
            offset={sheetOpen ? sheetWidth : 0}
            hidden={tutorFullShown}
            onPick={(id) => (tool === id ? setTool(null) : openTool(id))}
          />
        )}
      </div>

      {!wide && (
        <MobileNav
          items={mobileItems}
          active={mobileShown === "pdf" ? "pdf" : mobileShown === "tutor" ? "chat" : (tool ?? "pdf")}
          onPick={(id) => (id === "pdf" ? setMobileView("pdf") : id === "chat" ? setMobileView("tutor") : openTool(id))}
        />
      )}

      {!isExam && (
        <RecommendPapers
          sessionId={session.id}
          researchGoal={researchGoal || (plan ? plan.goal_title || plan.goal : "")}
          onAdd={(papers) => void addPaperMetas(papers)}
        />
      )}
      {addPaperOpen && (
        <AddPaperDialog
          key={paperQuery ?? goalSearch?.focus ?? (goalSearch ? "goal" : "plain")}
          onClose={() => {
            setAddPaperOpen(false);
            setGoalSearch(null);
            setPaperQuery(null);
          }}
          initialQuery={paperQuery ?? undefined}
          hints={goalSearch ? later.papers : undefined}
          focus={goalSearch?.focus}
          onHintDone={(name) => removeLater(session.id, { papers: [name] })}
          onAdd={(papers) => void addPaperMetas(papers)}
          onUpload={(files) => void addPaperPdfs(files)}
          onMoreSources={() => {
            setAddPaperOpen(false);
            setAddMaterialOpen(true);
          }}
        />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      <AudioBar />
      {recall && <RecallCheck key={recall.topic.id} topic={recall.topic} sessionId={session.id} offer={recall.offer} onClose={() => setRecall(null)} />}
      {mapOpen && (
        <LiteratureMap
          scope={{ kind: "session", sessionId: session.id, papers: paperDocs }}
          onOpenDoc={(docId) => openDocTab(docId)}
          onAdd={async (paper) => {
            await addPaperMetas([paper]);
          }}
          onClose={() => setMapOpen(false)}
        />
      )}
      {paperTool && (
        <PaperTools
          tool={paperTool}
          sessionId={session.id}
          papers={paperDocs}
          reviews={reviews}
          goal={researchGoal || (plan ? plan.goal_title || plan.goal : "")}
          onClose={() => setPaperTool(null)}
        />
      )}
      {converting && <ConvertFiles files={converting} onDone={(pdfs) => void addPdfs(pdfs)} onClose={() => setConverting(null)} />}
      {explain && <ExplainBack sessionId={session.id} documentId={explain.documentId} page={explain.page} topic={explain.topic} onClose={() => setExplain(null)} />}
      {addMaterialOpen && (
        <AddMaterialDialog
          initialTab={materialStart?.tab ?? (isPaper ? "zotero" : "upload")}
          initialUrl={materialStart?.url}
          onClose={() => {
            setAddMaterialOpen(false);
            setMaterialStart(null);
          }}
          onFiles={(files) => void addPdfs(files)}
          onImported={(items) => void addImported(items).then(addedToFiles)}
          onLectures={(list) => void importLinks(list.map((l) => ({ ...l, kind: "youtube" as const })), true).then((r) => addedToFiles(r.added))}
          onPapers={(papers) => void addPaperMetas(papers)}
          onFindPaper={
            isPaper
              ? undefined
              : () => {
                  setAddMaterialOpen(false);
                  setAddPaperOpen(true);
                }
          }
        />
      )}

    </div>
  );
}
