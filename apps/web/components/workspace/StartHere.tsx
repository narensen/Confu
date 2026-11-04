"use client";

import { docForResource, findPaper, isPaperResource } from "@/lib/find-paper";
import { eyebrowClass } from "@/components/ui";
import { formatMinutes } from "@confu/core/schedule";
import type { PlanTopic, Resource, SessionDoc } from "@confu/core/types";
import { track } from "@/lib/telemetry";

export function resourceHref(r: Resource) {
  const q = encodeURIComponent(r.search);
  return r.type === "lecture" || r.type === "video"
    ? `https://www.youtube.com/results?search_query=${q}`
    : `https://www.google.com/search?q=${q}`;
}

// The one thing to do next: which topic, which pages, how long. Opening it
// takes the student to the material; the tutor only teaches when asked.
export function StartHere({
  topic,
  topics,
  docs,
  busy,
  onOpen,
  onOpenDoc,
  onTeach,
}: {
  topic: PlanTopic;
  topics: PlanTopic[];
  docs: SessionDoc[];
  busy: boolean;
  onOpen: (t: PlanTopic) => void;
  onOpenDoc: (docId: string) => void; // a paper the topic recommends that's already in Files
  onTeach: (t: PlanTopic) => void;
}) {
  const fresh = !topics.some((t) => t.status === "completed");
  const doc = docs.find((d) => d.id === topic.document_id);
  const inPdf = topic.source === "pdf" && topic.page_start !== null && Boolean(doc);
  const pages = inPdf ? (topic.page_start === topic.page_end ? `p. ${topic.page_start}` : `pp. ${topic.page_start}–${topic.page_end}`) : null;
  const resource = !inPdf ? topic.resources?.[0] : undefined;
  const have = resource && isPaperResource(resource) ? docForResource(resource, docs) : null;

  return (
    <div className="animate-enter rounded-xl border border-ink bg-panel p-4 shadow-[4px_4px_0_0_#facc15]">
      <div className="flex items-center justify-between gap-3">
        <p className={eyebrowClass}>{fresh ? "Start here" : "Up next"}</p>
        <span className="font-mono text-[11px] text-muted">
          Topic {topic.position + 1} of {topics.length}
        </span>
      </div>
      <p className="mt-1.5 font-serif text-xl leading-snug">{topic.title}</p>
      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
        {pages && (
          <span className="rounded border border-ink/60 px-1.5 py-px font-mono text-ink">
            {docs.length > 1 ? `${doc!.label} ` : ""}
            {pages}
          </span>
        )}
        {!inPdf && <span className="rounded border border-dashed border-ink/60 px-1.5 py-px font-mono text-ink">Beyond your files</span>}
        <span>~{formatMinutes(topic.est_minutes)}</span>
      </p>
      {topic.objectives[0] && (
        <p className="mt-3 text-sm leading-relaxed">
          <span className="text-muted">Aim: </span>
          {topic.objectives[0]}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {inPdf ? (
          <button
            type="button"
            onClick={() => {
              track("start_here.open");
              onOpen(topic);
            }}
            className="rounded-lg border border-ink bg-ink px-3.5 py-2 text-sm font-medium text-white transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-[2px_2px_0_0_#facc15] active:translate-y-0"
          >
            Open {pages} →
          </button>
        ) : have && resource ? (
          <button
            type="button"
            onClick={() => {
              track("start_here.open_paper");
              onOpenDoc(have.id);
            }}
            className="rounded-lg border border-ink bg-ink px-3.5 py-2 text-sm font-medium text-white transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-[2px_2px_0_0_#facc15] active:translate-y-0"
          >
            Open the paper: {resource.title} →
          </button>
        ) : resource && isPaperResource(resource) ? (
          <button
            type="button"
            onClick={() => {
              track("start_here.find_paper");
              findPaper(resource.search || resource.title);
            }}
            className="rounded-lg border border-ink bg-ink px-3.5 py-2 text-sm font-medium text-white transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-[2px_2px_0_0_#facc15] active:translate-y-0"
          >
            Find the paper: {resource.title}
          </button>
        ) : resource ? (
          <a
            href={resourceHref(resource)}
            target="_blank"
            rel="noreferrer"
            onClick={() => onOpen(topic)}
            className="rounded-lg border border-ink bg-ink px-3.5 py-2 text-sm font-medium text-white transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-[2px_2px_0_0_#facc15] active:translate-y-0"
          >
            Find: {resource.title} ↗
          </a>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            track("start_here.teach");
            onTeach(topic);
          }}
          className="rounded-lg border border-ink bg-panel px-3.5 py-2 text-sm font-medium transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-hard-sm active:translate-y-0 disabled:pointer-events-none disabled:opacity-40"
        >
          Teach me instead
        </button>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        Read it yourself first. Select anything that stops you to ask about it, and mark the topic done when you can explain it.
      </p>
    </div>
  );
}
