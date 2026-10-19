"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteDocument } from "@/components/dashboard/actions";
import type { RegionCapture, TextSelection } from "@/components/pdf/PdfViewer";
import { JSON_HEADERS, KEY_ERROR_EVENT, notifyAiUsed, readAiError } from "@/lib/ai-errors";
import type { KeyInfo } from "@/lib/groq-keys";
import { emptyReview, type PaperReview } from "@/lib/paper";
import type { Attempt } from "@/lib/exam";
import { useExamPractice } from "@/components/exam/useExamPractice";
import { addPaperFromMeta, type PaperMeta } from "@/lib/pdf/add-paper";
import { attachPdfToDocument, uploadPdfToSession } from "@/lib/pdf/upload";
import { AddPaperDialog } from "@/components/paper/AddPaperDialog";
import { PaperCard } from "@/components/paper/PaperCard";
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
import { DocTabs } from "./DocTabs";
import { KeyGate } from "./KeyGate";
import { TutorPanel, type Tab } from "./TutorPanel";

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
  initialReviews,
  initialAttempts,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [docs, setDocs] = useState(initialDocs);
  const [activeDocId, setActiveDocId] = useState(initialDocId);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [addPaperOpen, setAddPaperOpen] = useState(false);
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
  const [mobileView, setMobileView] = useState<"tutor" | "pdf">("pdf");
  const [split, setSplit] = useState(40);
  const rootRef = useRef<HTMLDivElement>(null);
  const [keyInfo, setKeyInfo] = useState(initialKey);
  const [keyNotice, setKeyNotice] = useState<string | null>(null);
  const locked = needsKey && !keyInfo;

  // An AI request reported a missing or rejected key: ask for one again.
  useEffect(() => {
    const onKeyError = (e: Event) => {
      setKeyNotice((e as CustomEvent<{ message: string }>).detail.message);
      setKeyInfo(null);
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
      setDrawerOpen(false);
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
    async (selection: TextSelection) => {
      if (!activeDoc) return;
      const { data, error } = await supabase
        .from("highlights")
        .insert({
          document_id: activeDoc.id,
          kind: "text",
          page_number: selection.page,
          selected_text: selection.text,
          rects: selection.rects,
          color: "yellow",
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
    async (adders: ((userId: string, position: number) => Promise<string>)[]) => {
      if (uploadStatus) return;
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) throw new Error("Your session expired. Sign in again.");
        let position = Math.max(-1, ...docs.map((d) => d.position)) + 1;
        const added: SessionDoc[] = [];
        for (const add of adders) {
          const doc = await loadDoc(await add(auth.user.id, position++));
          if (doc) added.push(doc);
        }
        setDocs((list) => relabel([...list, ...added]));
        if (added.length) selectDoc(added[added.length - 1].id);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Couldn't add that.");
      } finally {
        setUploadStatus(null);
      }
    },
    [docs, loadDoc, selectDoc, supabase, uploadStatus],
  );

  const addPdfs = useCallback(
    (files: File[]) =>
      addDocs(
        files.map((file) => async (userId, position) => {
          const { id } = await uploadPdfToSession(supabase, { userId, sessionId: session.id, file, position, onStatus: setUploadStatus });
          return id;
        }),
      ),
    [addDocs, session.id, supabase],
  );

  const addPapers = useCallback(
    async (papers: PaperMeta[]) => {
      const skipped: string[] = [];
      await addDocs(
        papers.map((paper) => async (userId, position) => {
          const res = await addPaperFromMeta(supabase, { userId, sessionId: session.id, position, paper, onStatus: setUploadStatus });
          if (!res.hasPdf) skipped.push(`• ${paper.title}${res.note ? ` (${res.note})` : ""}`);
          return res.id;
        }),
      );
      if (skipped.length) {
        alert(`Added without a PDF (abstract only):\n${skipped.join("\n")}\n\nYou can still do a first pass, and the tutor can look these up. Upload the PDF later for a deeper read.`);
      }
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
        alert(err instanceof Error ? err.message : "Couldn't attach the PDF.");
      } finally {
        setUploadStatus(null);
      }
    },
    [loadDoc, supabase, uploadStatus],
  );

  const removePdf = useCallback(
    async (doc: SessionDoc) => {
      if (!confirm(`Remove “${doc.title}” from this session? Its highlights are deleted too. Plan topics that use it stay, without page links.`)) return;
      const remaining = relabel(docs.filter((d) => d.id !== doc.id));
      setDocs(remaining);
      setHighlights((list) => list.filter((h) => h.document_id !== doc.id));
      setTopics((list) => list.map((t) => (t.document_id === doc.id ? { ...t, document_id: null } : t)));
      if (activeDoc?.id === doc.id) {
        setGoTo(null);
        setActiveDocId(remaining[0]?.id ?? null);
      }
      await deleteDocument(doc.id);
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

  const panel = locked ? (
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
      }}
      exam={{ practice, examDate, onExamDate: saveExamDate }}
    />
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

      <section className={`relative min-w-0 flex-1 flex-col md:flex ${focusMode || mobileView === "pdf" ? "flex" : "hidden"}`}>
        <DocTabs
          docs={docs}
          activeId={activeDoc?.id ?? null}
          uploadStatus={uploadStatus}
          onSelect={selectDoc}
          onAdd={addPdfs}
          onRemove={removePdf}
          onAddClick={isPaper ? () => setAddPaperOpen(true) : undefined}
          addLabel={isPaper ? "+ Add paper" : "+ Add PDF"}
        />
        <div className="relative min-h-0 flex-1">
          {activeDoc && !activeDoc.hasPdf ? (
            <PaperCard key={activeDoc.id} doc={activeDoc} busy={Boolean(uploadStatus)} onAttach={(file) => attachPdf(activeDoc.id, file)} />
          ) : activeDoc ? (
            <PdfViewer
              key={activeDoc.id}
              url={activeDoc.url}
              initialPage={activeDoc.lastPage}
              goTo={goTo}
              highlights={docHighlights}
              busy={Boolean(busy)}
              focusMode={focusMode}
              onToggleFocus={toggleFocus}
              onPageChange={onPageChange}
              onTextAction={onTextAction}
              onSaveHighlight={saveHighlight}
              onRegion={onRegion}
              toolbarStart={
                focusMode ? (
                  <button
                    type="button"
                    onClick={() => setDrawerOpen((v) => !v)}
                    className={`mr-1 flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition duration-200 ${
                      drawerOpen ? "border-ink bg-ink text-white" : "border-ink hover:bg-paper"
                    }`}
                  >
                    Tutor{busy ? " ·" : ""}
                  </button>
                ) : null
              }
            />
          ) : (
            <div className="animate-enter flex h-full flex-col items-center justify-center gap-2 bg-viewer px-6 text-center">
              <p className="font-serif text-2xl">{isPaper ? "No papers yet" : "No PDFs in this session"}</p>
              <p className="max-w-sm text-sm text-muted">
                {isPaper
                  ? "Add papers by arXiv ID, DOI, link or title. No PDF needed."
                  : "Use “+ Add PDF” above. The tutor still works from your goal and outside resources meanwhile."}
              </p>
              {isPaper && (
                <button onClick={() => setAddPaperOpen(true)} className="mt-3 rounded-lg border border-ink bg-ink px-4 py-2 text-sm font-medium text-white transition hover:-translate-y-px hover:shadow-hard-sm">
                  + Add papers
                </button>
              )}
            </div>
          )}
          {focusMode && drawerOpen && (
            <div className="animate-slide-in absolute inset-y-0 top-12 left-0 z-30 flex w-[min(480px,92%)] flex-col border-r border-ink bg-panel shadow-[6px_0_0_0_rgba(13,13,12,0.08)]">
              {panel}
            </div>
          )}
        </div>
      </section>

      {addPaperOpen && <AddPaperDialog onClose={() => setAddPaperOpen(false)} onAdd={(papers) => void addPapers(papers)} onUpload={(files) => void addPdfs(files)} />}

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
