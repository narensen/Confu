"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteDocument } from "@/components/dashboard/actions";
import type { RegionCapture, TextSelection } from "@/components/pdf/PdfViewer";
import { JSON_HEADERS, KEY_ERROR_EVENT, notifyAiUsed, readAiError } from "@/lib/ai-errors";
import { hashText } from "@/lib/hash";
import type { KeyInfo } from "@/lib/groq-keys";
import { emptyReview, isPaperDoc, type PaperReview } from "@/lib/paper";
import type { Attempt } from "@/lib/exam";
import { useExamPractice } from "@/components/exam/useExamPractice";
import { addPaperFromMeta, type PaperMeta } from "@/lib/pdf/add-paper";
import { docForResource, FIND_PAPER_EVENT, isPaperResource } from "@/lib/find-paper";
import { speechLoading, speechPlay, speechStop, speechSupported } from "@/lib/speech";
import { closeTab, isOpenIn, keepTabs, openTab, useOpenTabs } from "@/lib/open-tabs";
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
import { LiteratureMap } from "@/components/paper/LiteratureMap";
import { exportBibtex, PaperTools } from "@/components/paper/PaperTools";
import type { PaperTool } from "@/components/paper/PassesPanel";
import { addLater, removeLater, useLater, type GoalHint, type GoalLink, type GoalPaper } from "@/lib/goal-later";
import { lecturePdf, webPagePdf } from "@/lib/import/fetch-client";
import { assignDueDates, currentTopic, toISODate } from "@/lib/schedule";
import { track } from "@/lib/telemetry";
import { createClient } from "@/lib/supabase/client";
import { displayUserTurn } from "@/lib/tutor/format";
import {
  docLabel,
  EMPTY_MEMORY,
  type ChatMessage,
  type Highlight,
  type LearnerMemory,
  type PlanTopic,
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
import { TutorPanel, type Tab } from "./TutorPanel";
import { ask, toast } from "@/components/dialogs";

const PdfViewer = dynamic(() => import("@/components/pdf/PdfViewer"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-viewer text-sm text-muted">Loading viewer…</div>,
});

type Props = {
  session: { id: string; title: string; kind: SessionKind; researchGoal: string; examDate: string | null; draftGoal?: string };
  initialDocs: SessionDoc[];
  initialDocId: string | null;
  initialPlan: StudyPlan | null;
  initialTopics: PlanTopic[];
  initialMemory: LearnerMemory;
  initialHighlights: Highlight[];
  initialMessages: ChatMessage[];
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

const SPLIT_KEY = "confu:split";
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
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [goTo, setGoTo] = useState<{ page: number; n: number } | null>(null);
  const isPaper = session.kind === "paper";
  const isExam = session.kind === "exam";
  const [tab, setTab] = useState<Tab>(isExam ? "practice" : isPaper ? "passes" : initialPlan ? "chat" : "plan");
  const practice = useExamPractice(session.id, initialAttempts);
  const [examDate, setExamDate] = useState(session.examDate);
  const [researchGoal, setResearchGoal] = useState(session.researchGoal);
  const [storedReviews, setStoredReviews] = useState<Record<string, PaperReview>>(() =>
    Object.fromEntries(initialReviews.map((r) => [r.document_id, r])),
  );
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // In full screen, a short tip under the Tutor button explains it toggles.
  const [tutorTip, setTutorTip] = useState(false);
  useEffect(() => {
    if (!tutorTip) return;
    const id = setTimeout(() => setTutorTip(false), 5000);
    return () => clearTimeout(id);
  }, [tutorTip]);
  const [mobileView, setMobileView] = useState<"tutor" | "pdf">("pdf");
  const [split, setSplit] = useState(40);
  const rootRef = useRef<HTMLDivElement>(null);
  const [keyInfo, setKeyInfo] = useState(initialKey);
  const [keyNotice, setKeyNotice] = useState<string | null>(null);
  const [onTrial, setOnTrial] = useState(trial);
  const locked = needsKey && !keyInfo && !onTrial;

  // An AI request reported a missing or rejected key: ask for one again.
  useEffect(() => {
    const onKeyError = (e: Event) => {
      setKeyNotice((e as CustomEvent<{ message: string }>).detail.message);
      setKeyInfo(null);
      setOnTrial(false); // the trial ran out (or there never was one)
      setDrawerOpen(true);
      setMobileView("tutor");
    };
    window.addEventListener(KEY_ERROR_EVENT, onKeyError);
    return () => window.removeEventListener(KEY_ERROR_EVENT, onKeyError);
  }, []);

  // Without a key, AI actions open the tutor panel, where the key form is.
  const revealGate = useCallback(() => {
    setDrawerOpen(true);
    setMobileView("tutor");
  }, []);

  // The tabs above the viewer: every PDF the student hasn't closed.
  // PDFs are added to Files without opening a tab; opening one does.
  const tabs = useOpenTabs(session.id);
  const openDocs = useMemo(() => docs.filter((d) => isOpenIn(tabs, d.id)), [docs, tabs]);
  const openIds = useMemo(() => new Set(openDocs.map((d) => d.id)), [openDocs]);
  const docIds = useRef<string[]>([]);
  useEffect(() => {
    docIds.current = docs.map((d) => d.id);
  }, [docs]);
  const activeDoc = openDocs.find((d) => d.id === activeDocId) ?? openDocs[0] ?? null;
  const page = activeDoc?.lastPage ?? 1;
  const multi = docs.length > 1;
  const labelOf = useCallback((id: string | null | undefined) => docs.find((d) => d.id === id)?.label, [docs]);
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
      if (docId && docId !== activeDoc?.id && docs.some((d) => d.id === docId)) {
        setDocs((list) => list.map((d) => (d.id === docId ? { ...d, lastPage: p } : d)));
        selectDoc(docId);
        return;
      }
      setGoTo((g) => ({ page: p, n: (g?.n ?? 0) + 1 }));
    },
    [activeDoc?.id, docs, selectDoc],
  );

  // Citations from the tutor: "p. 12" (current PDF) or "D2 p. 12".
  const jumpToCitation = useCallback(
    (p: number, label?: string) => jumpTo(p, label ? docs.find((d) => d.label === label)?.id : undefined),
    [docs, jumpTo],
  );

  // Deep links from the review page: /session/:id?doc=…&page=…
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current) return;
    deepLinked.current = true;
    const q = new URLSearchParams(window.location.search);
    const doc = q.get("doc");
    const p = Number(q.get("page"));
    if (!q.has("page")) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (doc && p >= 1 && docs.some((d) => d.id === doc)) jumpTo(p, doc);
  }, [docs, jumpTo]);

  // Restore the panel split.
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(SPLIT_KEY));
      if (saved >= 25 && saved <= 70) setSplit(saved);
    } catch {}
  }, []);

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
      if (!document.fullscreenElement) setFocusMode(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFocus = useCallback(() => {
    if (focusMode) {
      setFocusMode(false);
      if (document.fullscreenElement) void document.exitFullscreen();
    } else {
      setFocusMode(true);
      setDrawerOpen(true); // the tutor starts open in full screen
      setTutorTip(true);
      rootRef.current?.requestFullscreen?.().catch(() => {});
    }
  }, [focusMode]);

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
      if (locked) return revealGate();
      if (busyRef.current) return;
      busyRef.current = true;
      const topic = topics.find((t) => t.id === req.topicId) ?? activeTopic;
      const now = new Date().toISOString();
      const userId = `local-u-${Date.now()}`;
      const replyId = `local-a-${Date.now()}`;
      const where = req.selection ?? req.figure ?? (activeDoc ? { page, documentId: activeDoc.id } : null);
      const content = displayUserTurn({
        action: req.action,
        message: req.message,
        selection: req.selection,
        figurePage: req.figure?.page,
        docLabel: multi ? labelOf(where?.documentId) : undefined,
        topicTitle: topic?.title,
      });
      const meta = { page_number: where?.page ?? null, document_id: where?.documentId ?? null };
      setMessages((m) => [
        ...m,
        { id: userId, role: "user", action: req.action, content, ...meta, highlight_id: req.highlightId ?? null, created_at: now },
        { id: replyId, role: "assistant", action: req.action, content: "", ...meta, highlight_id: null, created_at: now },
      ]);
      setTab("chat");
      setDrawerOpen(true);
      setMobileView("tutor");
      setBusy("Thinking…");

      const setReply = (text: string) => setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, content: text } : x)));
      try {
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
        setReply(`⚠️ ${err instanceof Error ? err.message : "Something went wrong."}`);
      } finally {
        busyRef.current = false;
        setBusy(null);
        notifyAiUsed();
        // Memory and mastery are updated server-side after the reply finishes.
        window.setTimeout(refreshProgress, 4000);
        window.setTimeout(refreshProgress, 10000);
      }
    },
    [activeDoc, activeTopic, labelOf, locked, multi, page, refreshProgress, revealGate, session.id, topics],
  );

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
      setTab("chat");
      setDrawerOpen(true);
      setMobileView("tutor");
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
    [activeDoc, locked, revealGate, send],
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

  // Imported material (web pages, lectures, Drive, Zotero PDFs):
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

  const startDrag = (e: React.PointerEvent) => {
    const root = rootRef.current;
    if (!root) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = root.getBoundingClientRect();
    const move = (ev: PointerEvent) => setSplit(Math.min(70, Math.max(25, ((ev.clientX - box.left) / box.width) * 100)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setSplit((s) => {
        try {
          localStorage.setItem(SPLIT_KEY, String(Math.round(s)));
        } catch {}
        return s;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

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
  // A study session's PDF read as a paper, or not. "Not a paper" keeps its
  // pass notes (marking it again brings them back), and detection leaves it be.
  const setPaperCheck = useCallback(
    (docId: string, value: "yes" | "off") => {
      const doc = docs.find((d) => d.id === docId);
      if (!doc) return;
      const meta = { ...(doc.meta ?? {}), paper_check: value };
      setDocs((list) => list.map((d) => (d.id === docId ? { ...d, meta } : d)));
      fire(supabase.from("documents").update({ meta }).eq("id", docId), "whether it's a paper");
    },
    [docs, supabase],
  );
  const markPaper = useCallback(
    (docId: string) => {
      if (docs.find((d) => d.id === docId)?.meta?.paper_check === "off") setPaperCheck(docId, "yes");
      updateReview(docId, {});
    },
    [docs, setPaperCheck, updateReview],
  );
  const unmarkPaper = useCallback(
    (docId: string) => {
      setPaperCheck(docId, "off");
      if (tab === "passes" && paperIds.size <= 1) setTab(plan ? "plan" : "chat");
      toast("Not read as a paper any more. Its pass notes are kept, if you change your mind.");
    },
    [paperIds, plan, setPaperCheck, tab],
  );

  // Study sessions: spot the PDFs that are research papers (Semantic Scholar,
  // OpenAlex and the goal; see /api/paper/detect) whenever PDFs or the goal change.
  const detectKey = isPaper || isExam ? "" : `${docs.map((d) => d.id).join(",")}|${plan?.id ?? ""}|${plan?.goal ?? ""}`;
  useEffect(() => {
    if (!detectKey || !docs.some((d) => d.hasPdf && !paperIds.has(d.id))) return;
    let live = true;
    const id = window.setTimeout(async () => {
      try {
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

  // Opening a paper in a study session brings up its passes; leaving papers goes back to the plan.
  const openDocTab = useCallback(
    (docId: string) => {
      selectDoc(docId);
      if (isPaper || isExam) return;
      if (paperIds.has(docId)) {
        setTab("passes");
        setDrawerOpen(true);
      } else setTab((t) => (t === "passes" ? (plan ? "plan" : "chat") : t));
    },
    [isExam, isPaper, paperIds, plan, selectDoc],
  );

  // The literature map and the paper tools (BibTeX, Zotero, related work, compare).
  const [mapOpen, setMapOpen] = useState(false);
  const [paperTool, setPaperTool] = useState<Exclude<PaperTool, "bibtex"> | null>(null);
  const paperDocs = useMemo(() => docs.filter((d) => paperIds.has(d.id)), [docs, paperIds]);

  // Uploaded through "Add paper" in a study session: mark them as papers.
  const addPaperPdfs = useCallback(
    async (files: File[]) => {
      const added = await addPdfs(files);
      if (isPaper || !added.length) return;
      for (const d of added) markPaper(d.id);
      setTab("passes");
    },
    [addPdfs, isPaper, markPaper],
  );

  // Papers found by arXiv ID, DOI, title, Zotero or a suggestion. In a study
  // session they're marked as papers (some have no DOI or arXiv ID to tell).
  const addPaperMetas = useCallback(
    async (papers: PaperMeta[]) => {
      const added = await addPapers(papers);
      if (isPaper || !added.length) return added;
      for (const d of added) markPaper(d.id);
      setTab("passes");
      return added;
    },
    [addPapers, isPaper, markPaper],
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

  // Lectures and pages (from the goal, or a playlist), read into PDFs one by
  // one, each listed in Files as it comes in. `keep`: a failure stays there
  // with Retry; otherwise it's handed back (a goal's links return to its list).
  const importLinks = useCallback(
    async (links: (GoalLink & { title?: string })[], keep = false) => {
      const done: string[] = [];
      const added = await addDocs(
        links.map((l) =>
          tracked(
            l.title || l.url.replace(/^https?:\/\/(www\.)?/, ""),
            async (userId, position, onStatus) => {
              const got = l.kind === "youtube" ? await lecturePdf({ url: l.url }, onStatus) : await webPagePdf(l.url, onStatus);
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
  const goalActions = useRef({ addPaperMetas, importLinks, uploadsSettled, openGoalSearch });
  useEffect(() => {
    goalActions.current = { addPaperMetas, importLinks, uploadsSettled, openGoalSearch };
  });
  useEffect(() => {
    if (!goalKey || locked) return;
    try {
      if (localStorage.getItem(goalKey) === "done") return;
    } catch {}
    let live = true;
    // The plan's own papers wait for this to finish (see below), so nothing is added twice.
    goalJob.current = (async () => {
      const res = await fetch("/api/paper/from-goal", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ sessionId: session.id }) }).catch(() => null);
      notifyAiUsed();
      if (!res?.ok || !live) return;
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
      await act.uploadsSettled();
      const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const notes: string[] = [];
      if (sure.length) {
        const added = await act.addPaperMetas(sure.map((p) => p.paper!));
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
    return () => {
      live = false;
    };
  }, [goalKey, locked, session.id]);

  // The papers the plan itself recommends ("Go deeper"), added the same way:
  // found for sure, added; not sure, waiting in Files to be searched for. Once
  // per plan, after the goal's papers are in, skipping any already in Files.
  const goalJob = useRef<Promise<unknown>>(Promise.resolve());
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
    } catch {}
    planPapersFor.current = plan.id;
    const titles = [...new Map(topics.flatMap((t) => t.resources ?? []).filter(isPaperResource).map((r) => [r.title.toLowerCase(), r])).values()];
    void (async () => {
      await goalJob.current;
      const wanted = titles.filter((r) => !docForResource(r, docsNow.current) && !laterNow.current.papers.some((p) => p.name === r.title)).slice(0, 12);
      if (wanted.length) {
        const res = await fetch("/api/paper/resolve-titles", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ sessionId: session.id, titles: wanted.map((r) => r.title), field: plan.goal_title ?? "" }),
        }).catch(() => null);
        if (!res?.ok) return; // try again next time
        const { papers } = (await res.json()) as { papers: GoalPaper[] };
        addLater(session.id, { papers: papers.filter((p) => !p.paper).map((p) => ({ name: p.name, title: p.title })) });
        const act = goalActions.current;
        await act.uploadsSettled();
        const sure = papers.flatMap((p) => (p.paper && !docsNow.current.some((d) => d.title.toLowerCase() === p.paper!.title.toLowerCase()) ? [p.paper] : []));
        if (sure.length) {
          const added = await act.addPaperMetas(sure);
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

  // Keyboard shortcuts (see Shortcuts.tsx). Only when not typing and no
  // dialog is open; one listener, reading the latest state through a ref.
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
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const show = (t: Tab) => {
        setTab(t);
        setDrawerOpen(true);
        setMobileView("tutor");
      };
      const i = openDocs.findIndex((d) => d.id === activeDoc?.id);
      const go: Record<string, () => void> = {
        "?": () => setShortcutsOpen(true),
        t: () => show("chat"),
        p: () => show(isExam ? "practice" : isPaper ? "passes" : "plan"),
        f: () => show("files"),
        h: () => !isExam && show("highlights"),
        "/": () => {
          show("chat");
          window.setTimeout(() => document.getElementById("tutor-input")?.focus(), 50);
        },
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
            show("plan");
          }
        },
        ".": () => toggleFocus(),
      };
      const run = go[e.key];
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

  const tutor = locked ? (
    <KeyGate
      sessionId={session.id}
      notice={keyNotice}
      onSaved={(info) => {
        setKeyInfo(info);
        setKeyNotice(null);
      }}
      onClose={focusMode ? () => setDrawerOpen(false) : undefined}
    />
  ) : (
    <TutorPanel
      tab={tab}
      onTab={setTab}
      sessionId={session.id}
      docs={docs}
      plan={plan}
      topics={topics}
      activeTopic={activeTopic}
      memory={memory}
      highlights={highlights}
      messages={messages}
      busy={busy}
      onSend={send}
      onJump={jumpTo}
      onCite={jumpToCitation}
      onFocusTopic={(t) => setActiveTopicId(t.id)}
      onTopicStatus={(t, s) => {
        void setTopicStatus(t, s);
        // Just finished: offer a quick recall check (unless turned off).
        if (s === "completed" && recallOffered()) setRecall({ topic: t, offer: true });
      }}
      onRecall={(t) => setRecall({ topic: t, offer: false })}
      onListen={listen}
      onDeleteHighlight={deleteHighlight}
      onUpdateHighlight={updateHighlight}
      onPlanCreated={onPlanCreated}
      onRepace={repace}
      files={{
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
                onImport: async (links) => {
                  const { done, failed } = await importLinks(links);
                  removeLater(session.id, { links: done });
                  if (failed.length) toast(`Couldn't bring in:\n${failed.map((l) => l.url).join("\n")}\n\nThey stay in Files; try them from + Add material too.`, "error");
                },
                onPlaylist: (url) => {
                  setMaterialStart({ tab: "youtube", url });
                  setAddMaterialOpen(true);
                },
                onRemoveLink: (url) => removeLater(session.id, { links: [url] }),
              },
        // Shows it, and stays on Files (no jump to a paper's passes).
        onOpen: (docId) => {
          selectDoc(docId);
          setMobileView("pdf");
        },
        onCloseTab: closeDocTab,
        onDelete: removePdf,
        ...(isPaper || isExam
          ? {}
          : {
              paperIds,
              onPaper: (docId: string) => markPaper(docId),
              onNotPaper: unmarkPaper,
            }),
      }}
      draftGoal={session.draftGoal ?? ""}
      setup={{ upload: uploading, incoming, settled: uploadsSettled, job: planJob, setJob: setPlanJob }}
      onClose={focusMode ? () => setDrawerOpen(false) : undefined}
      keyInfo={needsKey ? keyInfo : null}
      kind={session.kind}
      paper={{
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
        onTool: (t) => (t === "bibtex" ? exportBibtex(paperDocs, session.title) : setPaperTool(t)),
      }}
      exam={{ practice, examDate, onExamDate: saveExamDate }}
    />
  );
  const panel = tutor;

  return (
    <div ref={rootRef} className={`flex min-h-0 flex-1 bg-paper ${focusMode ? "fixed inset-0 z-40" : "relative"}`}>
      {!focusMode && (
        <>
          <aside
            className={`min-w-0 flex-col bg-panel md:flex md:min-w-90 ${mobileView === "tutor" ? "flex w-full" : "hidden"}`}
            style={{ flexBasis: `${split}%` }}
          >
            {panel}
          </aside>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panels"
            onPointerDown={startDrag}
            className="group hidden w-2 shrink-0 cursor-col-resize justify-center bg-panel md:flex"
          >
            <span className="h-full w-px bg-ink transition-all duration-200 group-hover:w-0.75 group-active:w-0.75" />
          </div>
        </>
      )}

      {/* Full screen: the tutor sits beside the PDF (not over it), and the PDF
          refits to the space that's left. */}
      {focusMode && drawerOpen && (
        <aside className="animate-slide-in flex w-[min(480px,40%)] min-w-80 shrink-0 flex-col border-r border-ink bg-panel">
          {panel}
        </aside>
      )}

      <section className={`relative min-w-0 flex-1 flex-col md:flex ${focusMode || mobileView === "pdf" ? "flex" : "hidden"}`}>
        <PackSources sessionId={session.id} docs={docs} busy={Boolean(uploadStatus)} onAttach={attachPdf} onSelect={openDocTab} />
        <DocTabs
          docs={openDocs}
          activeId={activeDoc?.id ?? null}
          uploadStatus={uploadStatus}
          onSelect={openDocTab}
          onAdd={addPdfs}
          onClose={closeDocTab}
          onAddClick={isPaper ? () => setAddPaperOpen(true) : () => setAddMaterialOpen(true)}
          addLabel={isPaper ? "+ Add paper" : "+ Add material"}
          paperIds={isPaper || isExam ? undefined : paperIds}
          onNotPaper={isPaper || isExam ? undefined : unmarkPaper}
          onShortcuts={() => setShortcutsOpen(true)}
          onPaper={
            isPaper || isExam
              ? undefined
              : (docId) => {
                  // Mark it (keeps any notes), then open its passes beside the PDF.
                  if (!paperIds.has(docId)) markPaper(docId);
                  setTab("passes");
                  setDrawerOpen(true);
                  setMobileView("tutor");
                }
          }
        />
        <div className="relative min-h-0 flex-1">
          {activeDoc && !activeDoc.hasPdf && pendingSource(activeDoc) && pendingSource(activeDoc)!.kind !== "paper" ? (
            <PendingSourceCard key={activeDoc.id} doc={activeDoc} busy={Boolean(uploadStatus)} onAttach={attachPdf} />
          ) : activeDoc && !activeDoc.hasPdf ? (
            <PaperCard key={activeDoc.id} doc={activeDoc} busy={Boolean(uploadStatus)} onAttach={(file) => void attachPdf(activeDoc.id, file)} />
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
              onTextAction={onTextAction}
              onSaveHighlight={saveHighlight}
              onUpdateHighlight={updateHighlight}
              onDeleteHighlight={deleteHighlight}
              onRegion={onRegion}
              toolbarStart={
                focusMode ? (
                  <div className="relative mr-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDrawerOpen((v) => !v);
                        setTutorTip(false);
                      }}
                      aria-pressed={drawerOpen}
                      title={drawerOpen ? "Hide the tutor" : "Show the tutor"}
                      className="flex h-7 items-center gap-1.5 rounded-md border border-ink bg-ink px-2.5 text-xs font-medium text-white shadow-[2px_2px_0_0_#facc15] transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-[3px_3px_0_0_#facc15] active:translate-y-0 active:shadow-[1px_1px_0_0_#facc15]"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <rect x="3" y="4" width="18" height="16" rx="2" />
                        <path d="M9 4v16" />
                        {drawerOpen ? <path d="M15 10l-2 2 2 2" /> : <path d="M13 10l2 2-2 2" />}
                      </svg>
                      Tutor{busy ? " ·" : ""}
                    </button>
                    {tutorTip && (
                      <div role="status" className="animate-pop absolute top-full left-0 z-40 mt-2.5 w-max max-w-60 origin-top-left rounded-lg border border-ink bg-ink px-3 py-2 text-xs text-white shadow-[3px_3px_0_0_#facc15]">
                        <span className="absolute -top-1.5 left-4 size-2.5 rotate-45 border-t border-l border-ink bg-ink" />
                        Press <b className="text-yellow-400">Tutor</b> anytime to hide or show the tutor.
                      </div>
                    )}
                  </div>
                ) : null
              }
            />
          ) : docs.length ? (
            <div className="animate-enter flex h-full flex-col items-center justify-center gap-2 bg-viewer px-6 text-center">
              <p className="font-serif text-2xl">Nothing open</p>
              <p className="max-w-sm text-sm text-muted">Everything is in Files. Open something there to read it here.</p>
              <button
                type="button"
                onClick={() => {
                  setTab("files");
                  setDrawerOpen(true);
                  setMobileView("tutor");
                }}
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
                  : "Use “+ Add material” above: PDFs, slides, Word docs, web pages, YouTube lectures, Google Drive or Zotero. The tutor still works from your goal meanwhile."}
              </p>
              {isPaper && (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <button onClick={() => setAddPaperOpen(true)} className="rounded-lg border border-ink bg-ink px-4 py-2 text-sm font-medium text-white transition hover:-translate-y-px hover:shadow-hard-sm">
                    + Add papers
                  </button>
                  <button onClick={openRecommendPapers} className="rounded-lg border border-ink bg-panel px-4 py-2 text-sm font-medium transition hover:-translate-y-px hover:shadow-hard-sm">
                    Suggest papers for my goal
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

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

      {!focusMode && (
        <button
          type="button"
          onClick={() => setMobileView((v) => (v === "pdf" ? "tutor" : "pdf"))}
          className="fixed right-4 bottom-4 z-30 rounded-full border border-ink bg-ink px-5 py-2.5 text-sm font-medium text-white shadow-hard transition active:scale-95 md:hidden"
        >
          {mobileView === "pdf" ? "Tutor" : "Reader"}
        </button>
      )}
    </div>
  );
}
