import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { SessionTitle } from "@/components/workspace/SessionTitle";
import { Workspace } from "@/components/workspace/Workspace";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import {
  docLabel,
  EMPTY_MEMORY,
  type ChatMessage,
  type Highlight,
  type LearnerMemory,
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
  await requireUser();
  const supabase = await createClient();

  const [session, docs, plan, memory, messages] = await Promise.all([
    supabase.from("study_sessions").select("id, title").eq("id", id).maybeSingle(),
    supabase
      .from("documents")
      .select("id, title, storage_path, page_count, last_page, position, status, updated_at")
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
    storage_path: string;
    page_count: number;
    last_page: number;
    position: number;
    status: string;
    updated_at: string;
  }[];
  const docIds = docRows.map((d) => d.id);

  const [topics, signed, highlights] = await Promise.all([
    plan.data
      ? supabase.from("plan_topics").select("*").eq("plan_id", plan.data.id).order("position")
      : Promise.resolve({ data: [] }),
    docRows.length
      ? supabase.storage.from("documents").createSignedUrls(
          docRows.map((d) => d.storage_path),
          URL_TTL,
        )
      : Promise.resolve({ data: [] }),
    docIds.length
      ? supabase.from("highlights").select("*").in("document_id", docIds).order("page_number").order("created_at")
      : Promise.resolve({ data: [] }),
  ]);

  const urls = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  const sessionDocs: SessionDoc[] = docRows
    .map((d, i) => ({
      id: d.id,
      label: docLabel(i),
      title: d.title,
      pageCount: d.page_count,
      lastPage: d.last_page,
      position: d.position,
      url: urls.get(d.storage_path) ?? "",
    }))
    .filter((d) => d.url);

  // Reopen the PDF the student was reading most recently.
  const recent = [...docRows].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const m = memory.data as LearnerMemory | null;

  return (
    <>
      <AppHeader>
        <SessionTitle sessionId={session.data.id} initialTitle={session.data.title} />
      </AppHeader>
      <Workspace
        session={{ id: session.data.id, title: session.data.title }}
        initialDocs={sessionDocs}
        initialDocId={sessionDocs.find((d) => d.id === recent?.id)?.id ?? sessionDocs[0]?.id ?? null}
        initialPlan={plan.data as StudyPlan | null}
        initialTopics={(topics.data ?? []) as PlanTopic[]}
        initialMemory={m ? { ...EMPTY_MEMORY, ...m } : EMPTY_MEMORY}
        initialHighlights={(highlights.data ?? []) as Highlight[]}
        initialMessages={((messages.data ?? []) as ChatMessage[]).reverse()}
      />
    </>
  );
}
