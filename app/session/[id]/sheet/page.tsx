import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/workspace/PrintButton";
import { requireUser } from "@/lib/dal";
import { sheetOf } from "@/lib/sheet";
import { createClient } from "@/lib/supabase/server";
import type { PlanTopic } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One page for a topic, from the plan and the pages already read. Nothing is generated.
export default async function SheetPage({ params, searchParams }: PageProps<"/session/[id]/sheet">) {
  const { id } = await params;
  const topicId = (await searchParams).topic;
  const wanted = typeof topicId === "string" ? topicId : null;
  if (!UUID.test(id) || !wanted || !UUID.test(wanted)) notFound();
  await requireUser();
  const supabase = await createClient();

  const { data: session } = await supabase.from("study_sessions").select("id, title").eq("id", id).maybeSingle();
  if (!session) notFound();
  const { data: topicRow } = await supabase.from("plan_topics").select("*").eq("id", wanted).maybeSingle();
  const topic = topicRow as PlanTopic | null;
  if (!topic) notFound();
  const { data: plan } = await supabase.from("study_plans").select("id, session_id").eq("id", topic.plan_id).maybeSingle();
  if (!plan || plan.session_id !== id) notFound();

  let pages: { page_number: number; content: string }[] = [];
  if (topic.document_id && topic.page_start && topic.page_end) {
    const from = topic.page_start;
    const to = Math.min(topic.page_end, topic.page_start + 3);
    const { data } = await supabase.from("document_pages").select("page_number, content").eq("document_id", topic.document_id).gte("page_number", from).lte("page_number", to);
    pages = (data ?? []) as { page_number: number; content: string }[];
  }
  const sheet = sheetOf(topic, pages);
  const pagesLabel =
    topic.page_start == null ? "" : topic.page_start === topic.page_end ? `p. ${topic.page_start}` : `pp. ${topic.page_start}–${topic.page_end}`;

  return (
    <div className="min-h-dvh bg-paper text-ink print:bg-white print:text-black">
      <div className="mx-auto flex max-w-[190mm] items-center justify-between gap-3 px-6 pt-6 print:hidden">
        <Link href={`/session/${id}`} className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
          ← Back to the session
        </Link>
        <PrintButton />
      </div>
      <article className="mx-auto box-border h-[297mm] max-w-[190mm] overflow-hidden px-[14mm] py-[12mm]">
        <p className="font-mono text-[10px] tracking-wider text-neutral-500 uppercase">{session.title}</p>
        <h1 className="mt-1 font-serif text-[26px] leading-tight">{topic.title}</h1>
        {pagesLabel && <p className="mt-1 font-mono text-[11px] text-neutral-500">{pagesLabel}</p>}
        {sheet.objectives.length > 0 && (
          <section className="mt-4">
            <h2 className="font-mono text-[10px] tracking-wider text-neutral-500 uppercase">You should be able to</h2>
            <ul className="mt-1.5 space-y-1 text-[13px] leading-snug">
              {sheet.objectives.map((o) => (
                <li key={o}>· {o}</li>
              ))}
            </ul>
          </section>
        )}
        {sheet.concepts.length > 0 && <p className="mt-3 text-[12px] leading-snug text-neutral-700">{sheet.concepts.join(" · ")}</p>}
        {sheet.excerpts.length > 0 && (
          <section className="mt-4 space-y-2">
            <h2 className="font-mono text-[10px] tracking-wider text-neutral-500 uppercase">From the page</h2>
            {sheet.excerpts.map((e) => (
              <p key={e.page} className="text-[11px] leading-snug">
                <span className="font-mono text-[10px] text-neutral-500">p. {e.page} </span>
                {e.text}
              </p>
            ))}
          </section>
        )}
        {sheet.objectives.length === 0 && sheet.excerpts.length === 0 && (
          <p className="mt-6 text-sm text-neutral-600">This topic doesn&apos;t have objectives or page text yet.</p>
        )}
      </article>
    </div>
  );
}
