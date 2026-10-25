import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { SessionTitle } from "@/components/workspace/SessionTitle";
import { Workspace } from "@/components/workspace/Workspace";
import { trialPromptsLeft } from "@/lib/ai-access";
import { getCurrentRole, requireUser } from "@/lib/dal";
import { getKeyInfo } from "@/lib/groq-keys";
import { planOf } from "@/lib/plans";
import type { Attempt } from "@/lib/exam";
import type { PaperReview } from "@/lib/paper";
import { createClient } from "@/lib/supabase/server";
import {
  docLabel,
  EMPTY_MEMORY,
  type ChatMessage,
  type Highlight,
  type LearnerMemory,
  type PaperDocMeta,
  type PlanTopic,
  type SessionDoc,
  type StudyPlan,
} from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_TTL = 60 * 60 * 6;

export default function SessionPage({ params }: PageProps<"/session/[id]">) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Suspense fallback={<WorkspaceSkeleton />}>
        <SessionWorkspace params={params} />
      </Suspense>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <>
      <div className="h-14 shrink-0 border-b border-ink bg-panel" />
      <div className="flex min-h-0 flex-1">
        <div className="w-[40%] space-y-3 border-r border-ink bg-panel p-6">
          <div className="skeleton h-4 w-24 rounded" />
          <div className="skeleton h-8 w-64 rounded" />
          <div className="skeleton h-4 w-full rounded" />
        </div>
        <div className="flex flex-1 justify-center bg-viewer p-6">
          <div className="skeleton h-full w-full max-w-2xl border border-ink/20" />
        </div>
      </div>
    </>
  );
}

async function SessionWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requireUser();
  const supabase = await createClient();

  const [role, keyInfo, trial, session, docs, plan, memory, messages] = await Promise.all([
    getCurrentRole(),
    getKeyInfo(supabase, user.id, id),
    trialPromptsLeft(supabase, user.id),
    supabase.from("study_sessions").select("id, title, kind, research_goal, exam_date").eq("id", id).maybeSingle(),
    supabase
      .from("documents")
      .select("id, title, storage_path, page_count, last_page, position, status, updated_at, source_url, meta")
      .eq("session_id", id)
      .order("position")
      .order("created_at"),
    supabase.from("study_plans").select("*").eq("session_id", id).maybeSingle(),
    supabase.from("learner_memory").select("*").eq("session_id", id).maybeSingle(),
    supabase
      .from("messages")
      .select("id, role, action, content, page_number, document_id, highlight_id, created_at")
      .eq("session_id", id)
      .order("created_at", { ascending: false })
      .limit(60),
  ]);
  if (!session.data) notFound();

  const docRows = (docs.data ?? []) as {
    id: string;
    title: string;
    storage_path: string | null;
    source_url: string | null;
    meta: PaperDocMeta | null;
    page_count: number;
    last_page: number;
    position: number;
    status: string;
    updated_at: string;
  }[];
  const docIds = docRows.map((d) => d.id);

  const isPaper = session.data.kind === "paper";
  const isExam = session.data.kind === "exam";
  const [topics, signed, highlights, reviews, attempts] = await Promise.all([
    plan.data
      ? supabase.from("plan_topics").select("*").eq("plan_id", plan.data.id).order("position")
      : Promise.resolve({ data: [] }),
    docRows.some((d) => d.storage_path)
      ? supabase.storage.from("documents").createSignedUrls(
          docRows.flatMap((d) => (d.storage_path ? [d.storage_path] : [])),
          URL_TTL,
        )
      : Promise.resolve({ data: [] }),
    docIds.length
      ? supabase.from("highlights").select("*").in("document_id", docIds).order("page_number").order("created_at")
      : Promise.resolve({ data: [] }),
    // Study sessions can hold papers too.
    !isExam ? supabase.from("paper_reviews").select("*").eq("session_id", id) : Promise.resolve({ data: [] }),
    isExam
      ? supabase.from("exam_attempts").select("topic, score, created_at").eq("session_id", id).order("created_at", { ascending: false }).limit(500)
      : Promise.resolve({ data: [] }),
  ]);

  const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  const sessionDocs: SessionDoc[] = docRows
    // Keep papers without a PDF (added by arXiv ID / DOI); drop PDFs whose file is missing.
    .filter((d) => !d.storage_path || urls.get(d.storage_path))
    .map((d, i) => ({
      id: d.id,
      label: docLabel(i),
      title: d.title,
      pageCount: d.page_count,
      lastPage: d.last_page,
      position: d.position,
      url: d.storage_path ? (urls.get(d.storage_path) ?? "") : "",
      hasPdf: Boolean(d.storage_path),
      sourceUrl: d.source_url,
      meta: d.meta ?? {},
    }));

  // Reopen the PDF the student was reading most recently.
  const recent = [...docRows].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const m = memory.data as LearnerMemory | null;

  return (
    <>
      <AppHeader>
        <SessionTitle sessionId={session.data.id} initialTitle={session.data.title} />
      </AppHeader>
      <Workspace
        session={{ id: session.data.id, title: session.data.title, kind: session.data.kind, researchGoal: session.data.research_goal ?? "", examDate: session.data.exam_date ?? null }}
        initialDocs={sessionDocs}
        initialDocId={sessionDocs.find((d) => d.id === recent?.id)?.id ?? sessionDocs[0]?.id ?? null}
        initialPlan={plan.data as StudyPlan | null}
        initialTopics={(topics.data ?? []) as PlanTopic[]}
        initialMemory={m ? { ...EMPTY_MEMORY, ...m } : EMPTY_MEMORY}
        initialHighlights={(highlights.data ?? []) as Highlight[]}
        initialMessages={((messages.data ?? []) as ChatMessage[]).reverse()}
        needsKey={planOf(role) !== "pro"}
        initialKey={keyInfo}
        trial={trial > 0}
        initialReviews={(reviews.data ?? []) as PaperReview[]}
        initialAttempts={(attempts.data ?? []) as Attempt[]}
      />
    </>
  );
}
