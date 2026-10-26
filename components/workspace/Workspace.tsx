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
import { attachPdfToDocument, uploadPdfToSession } from "@/lib/pdf/upload";
import { AddPaperDialog } from "@/components/paper/AddPaperDialog";
import { AddMaterialDialog, type ImportedFile } from "@/components/import/AddMaterialDialog";
import { openRecommendPapers, RecommendPapers } from "@/components/paper/RecommendDialog";
import { PaperCard } from "@/components/paper/PaperCard";
import { GoalPapers } from "@/components/paper/GoalPapers";
import { currentTopic } from "@/lib/schedule";
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
import { TutorPanel, type Tab } from "./TutorPanel";
import { ask, toast } from "@/components/dialogs";

const PdfViewer = dynamic(() => import("@/components/pdf/PdfViewer"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-viewer text-sm text-muted">Loading viewer…</div>,
});

type Props = {
  session: { id: string; title: string; kind: SessionKind; researchGoal: string; examDate: string | null };
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

  const activeDoc = docs.find((d) => d.id === activeDocId) ?? docs[0] ?? null;
  const page = activeDoc?.lastPage ?? 1;
  const multi = docs.length > 1;
  const labelOf = useCallback((id: string | null | undefined) => docs.find((d) => d.id === id)?.label, [docs]);
  const activeTopic = topics.find((t) => t.id === activeTopicId) ?? currentTopic(topics);
  const docHighlights = useMemo(() => highlights.filter((h) => h.document_id === activeDoc?.id), [highlights, activeDoc?.id]);

  // Switching PDFs remounts the viewer (it's keyed by PDF) at that PDF's last
  // page; clear any pending jump so it isn't replayed into the new PDF.
  const selectDoc = useCallback((docId: string) => {
    setGoTo(null);
    setActiveDocId(docId);
  }, []);

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
      void supabase.from("documents").update({ last_page: page }).eq("id", activeId);
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
  const addDocs = useCallback(
    async (adders: ((userId: string, position: number) => Promise<string>)[]): Promise<SessionDoc[]> => {
      if (uploadStatus) return [];
      const added: SessionDoc[] = [];
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) throw new Error("Your session expired. Sign in again.");
        let position = Math.max(-1, ...docs.map((d) => d.position)) + 1;
        for (const add of adders) {
          const doc = await loadDoc(await add(auth.user.id, position++));
          if (doc) added.push(doc);
        }
        setDocs((list) => relabel([...list, ...added]));
        if (added.length) selectDoc(added[added.length - 1].id);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Couldn't add that.", "error");
      } finally {
        setUploadStatus(null);
      }
      return added;
    },
    [docs, loadDoc, selectDoc, supabase, uploadStatus],
  );

  const addPdfs = useCallback(
    (files: File[]) =>
      addDocs(
        files.map((file) => async (userId, position) => {
          const { id, ocrNote } = await uploadPdfToSession(supabase, { userId, sessionId: session.id, file, position, onStatus: setUploadStatus });
          if (ocrNote) toast(ocrNote);
          return id;
        }),
      ),
    [addDocs, session.id, supabase],
  );

  // Imported material (web pages, courses, lectures, Drive, Zotero PDFs):
  // PDFs built or downloaded in the browser, with their title and source.
  const addImported = useCallback(
    (items: ImportedFile[]) =>
      addDocs(
        items.map((it) => async (userId, position) => {
          const { id } = await uploadPdfToSession(supabase, {
            userId,
            sessionId: session.id,
            file: it.file,
            position,
            onStatus: setUploadStatus,
            title: it.title,
            meta: it.meta,
            sourceUrl: it.sourceUrl ?? null,
          });
          return id;
        }),
      ),
    [addDocs, session.id, supabase],
  );

  const addPapers = useCallback(
    async (papers: PaperMeta[]) => {
      const skipped: string[] = [];
      const added = await addDocs(
        papers.map((paper) => async (userId, position) => {
          const res = await addPaperFromMeta(supabase, { userId, sessionId: session.id, position, paper, onStatus: setUploadStatus });
          if (!res.hasPdf) skipped.push(`• ${paper.title}${res.note ? ` (${res.note})` : ""}`);
          return res.id;
        }),
      );
      if (skipped.length) {
        toast(`Added without a PDF (abstract only):\n${skipped.join("\n")}\n\nYou can still do a first pass, and the tutor can look these up. Upload the PDF later for a deeper read.`);
      }
      return added;
    },
    [addDocs, session.id, supabase],
  );

  // Give a metadata-only paper its PDF, keeping its id (and so its notes).
  const attachPdf = useCallback(
    async (docId: string, file: File) => {
      if (uploadStatus) return;
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) throw new Error("Your session expired. Sign in again.");
        await attachPdfToDocument(supabase, { userId: auth.user.id, documentId: docId, file, onStatus: setUploadStatus });
        const fresh = await loadDoc(docId);
        if (fresh) setDocs((list) => relabel(list.map((d) => (d.id === docId ? fresh : d))));
      } catch (err) {
        toast(err instanceof Error ? err.message : "Couldn't attach the PDF.", "error");
      } finally {
        setUploadStatus(null);
      }
    },
    [loadDoc, supabase, uploadStatus],
  );

  const removePdf = useCallback(
    async (doc: SessionDoc) => {
      const ok = await ask({
        title: `Remove “${doc.title}”?`,
        body: "Its highlights are deleted too. Plan topics that use it stay, without page links.",
        confirm: "Remove PDF",
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
              void supabase
                .from("paper_reviews")
                .upsert(
                  { document_id, session_id: session.id, target_pass, passes_done, triage_reason, pass1, pass2, pass3 },
                  { onConflict: "document_id" },
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
  const markPaper = useCallback((docId: string) => updateReview(docId, {}), [updateReview]);

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
      if (isPaper || !added.length) return;
      for (const d of added) markPaper(d.id);
      setTab("passes");
    },
    [addPapers, isPaper, markPaper],
  );

  // The papers a study goal names, offered once per goal (see /api/paper/from-goal).
  const [goalPapers, setGoalPapers] = useState<{ papers: PaperMeta[]; unresolved: string[] } | null>(null);
  const goalKey = !isPaper && !isExam && plan ? `confu:goal-papers:${session.id}:${hashText(`${plan.goal_title}\n${plan.goal}`)}` : null;
  useEffect(() => {
    if (!goalKey || locked) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(goalKey);
    } catch {}
    if (saved === "done") return;
    if (saved) {
      try {
        setGoalPapers(JSON.parse(saved));
        return;
      } catch {}
    }
    let live = true;
    void (async () => {
      const res = await fetch("/api/paper/from-goal", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ sessionId: session.id }) }).catch(() => null);
      notifyAiUsed();
      if (!res?.ok) return;
      const found = (await res.json()) as { papers: PaperMeta[]; unresolved: string[] };
      const any = found.papers.length || found.unresolved.length;
      try {
        localStorage.setItem(goalKey, any ? JSON.stringify(found) : "done");
      } catch {}
      if (live && any) setGoalPapers(found);
    })();
    return () => {
      live = false;
    };
  }, [goalKey, locked, session.id]);
  const closeGoalPapers = useCallback(() => {
    setGoalPapers(null);
    try {
      if (goalKey) localStorage.setItem(goalKey, "done");
    } catch {}
  }, [goalKey]);

  const saveExamDate = useCallback(
    (date: string | null) => {
      setExamDate(date);
      void supabase.from("study_sessions").update({ exam_date: date }).eq("id", session.id);
    },
    [session.id, supabase],
  );

  const saveResearchGoal = useCallback(
    (goal: string) => {
      setResearchGoal(goal);
      void supabase.from("study_sessions").update({ research_goal: goal }).eq("id", session.id);
    },
    [session.id, supabase],
  );

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
      onTopicStatus={setTopicStatus}
      onDeleteHighlight={deleteHighlight}
      onUpdateHighlight={updateHighlight}
      onPlanCreated={reloadPlan}
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
      }}
      exam={{ practice, examDate, onExamDate: saveExamDate }}
    />
  );
  const panel =
    goalPapers && !locked ? (
      <div className="flex h-full min-h-0 flex-col">
        <GoalPapers
          key={goalKey}
          papers={goalPapers.papers}
          unresolved={goalPapers.unresolved}
          busy={Boolean(uploadStatus)}
          onAdd={(papers) => {
            closeGoalPapers();
            void addPaperMetas(papers);
          }}
          onDismiss={closeGoalPapers}
        />
        <div className="min-h-0 flex-1">{tutor}</div>
      </div>
    ) : (
      tutor
    );

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
        <DocTabs
          docs={docs}
          activeId={activeDoc?.id ?? null}
          uploadStatus={uploadStatus}
          onSelect={openDocTab}
          onAdd={addPdfs}
          onRemove={removePdf}
          onAddClick={isPaper ? () => setAddPaperOpen(true) : () => setAddMaterialOpen(true)}
          addLabel={isPaper ? "+ Add paper" : "+ Add material"}
        />
        <div className="relative min-h-0 flex-1">
          {activeDoc && !activeDoc.hasPdf ? (
            <PaperCard key={activeDoc.id} doc={activeDoc} busy={Boolean(uploadStatus)} onAttach={(file) => attachPdf(activeDoc.id, file)} />
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
          ) : (
            <div className="animate-enter flex h-full flex-col items-center justify-center gap-2 bg-viewer px-6 text-center">
              <p className="font-serif text-2xl">{isPaper ? "No papers yet" : "No PDFs in this session"}</p>
              <p className="max-w-sm text-sm text-muted">
                {isPaper
                  ? "Add papers by arXiv ID, DOI, link or title. No PDF needed."
                  : "Use “+ Add material” above: PDFs, web pages and courses, YouTube lectures, Google Drive or Zotero. The tutor still works from your goal meanwhile."}
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
          onClose={() => setAddPaperOpen(false)}
          onAdd={(papers) => void addPaperMetas(papers)}
          onUpload={(files) => void addPaperPdfs(files)}
          onMoreSources={() => {
            setAddPaperOpen(false);
            setAddMaterialOpen(true);
          }}
        />
      )}
      {addMaterialOpen && (
        <AddMaterialDialog
          initialTab={isPaper ? "zotero" : "upload"}
          onClose={() => setAddMaterialOpen(false)}
          onFiles={(files) => void addPdfs(files)}
          onImported={(items) => void addImported(items)}
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
          {mobileView === "pdf" ? "Tutor" : "PDF"}
        </button>
      )}
    </div>
  );
}
