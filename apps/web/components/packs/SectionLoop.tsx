"use client";

import { useEffect, useState } from "react";
import { ghostButtonClass, inputClass } from "@/components/ui";
import { SITE } from "@/lib/site";
import { createClient } from "@/lib/supabase/client";

const MISSING = /schema cache|Could not find the function|Packs are not in this database/i;

// Library hour, miss map, crib, and the January page. Each hides if its RPC isn't there.
export function SectionLoop({ sessionId, slug }: { sessionId: string; slug: string }) {
  const [requests, setRequests] = useState<number | null>(null);
  const [place, setPlace] = useState("");
  const [topic, setTopic] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [room, setRoom] = useState("");
  const [hour, setHour] = useState<string | null>(null);
  const [map, setMap] = useState<string | null>(null);
  const [crib, setCrib] = useState<string | null>(null);
  const [wrapped, setWrapped] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void createClient()
      .rpc("course_requests_recent", { p_slug: slug })
      .then(({ data, error }) => {
        if (!error && typeof data === "number") setRequests(data);
      });
  }, [slug]);

  async function run(label: string, call: () => PromiseLike<{ data: unknown; error: { message: string } | null }>, set: (token: string) => void) {
    setBusy(true);
    setNote(null);
    const { data, error } = await call();
    setBusy(false);
    if (error) {
      if (!MISSING.test(error.message)) setNote(error.message);
      return;
    }
    if (typeof data === "string" && data) set(data);
    else setNote(`${label} didn't come back.`);
  }

  return (
    <div className="space-y-3 rounded-xl border border-line p-3">
      {requests !== null && (
        <p className="font-mono text-[11px] text-muted">
          {requests} course-link requests, not people · last 14 days
        </p>
      )}
      <div className="space-y-2">
        <p className="text-xs font-medium">Library hour</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={place} maxLength={80} onChange={(e) => setPlace(e.target.value)} placeholder="Second floor" aria-label="Place" className={`${inputClass} py-1 text-xs`} />
          <input value={topic} maxLength={80} onChange={(e) => setTopic(e.target.value)} placeholder="Coulomb" aria-label="Topic" className={`${inputClass} py-1 text-xs`} />
          <input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} aria-label="Starts" className={`${inputClass} py-1 text-xs`} />
          <input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} aria-label="Ends" className={`${inputClass} py-1 text-xs`} />
        </div>
        <input value={room} maxLength={80} onChange={(e) => setRoom(e.target.value)} placeholder="Room link, optional" aria-label="Room" className={`${inputClass} py-1 text-xs`} />
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(
              "Library hour",
              () =>
                createClient().rpc("create_library_hour", {
                  p_session: sessionId,
                  p_starts: new Date(starts).toISOString(),
                  p_ends: new Date(ends).toISOString(),
                  p_place: place,
                  p_topic: topic,
                  p_room: room,
                }),
              setHour,
            )
          }
          className={`${ghostButtonClass} py-1 text-xs`}
        >
          Add to a calendar
        </button>
        {hour && <code className="block truncate font-mono text-[11px]">{SITE.url}/api/library-hour/{hour}</code>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void run("Miss map", () => createClient().rpc("roll_miss_map", { p_session: sessionId }), setMap)} className={`${ghostButtonClass} py-1 text-xs`}>
          Roll the miss map
        </button>
        <button type="button" disabled={busy} onClick={() => void run("Crib", () => createClient().rpc("roll_section_crib", { p_session: sessionId }), setCrib)} className={`${ghostButtonClass} py-1 text-xs`}>
          Print the crib
        </button>
        <button type="button" disabled={busy} onClick={() => void run("January page", () => createClient().rpc("roll_section_wrapped", { p_session: sessionId }), setWrapped)} className={`${ghostButtonClass} py-1 text-xs`}>
          January page
        </button>
      </div>
      {map && <a className="block truncate font-mono text-[11px] underline" href={`/m/${map}`}>{SITE.url}/m/{map}</a>}
      {crib && <a className="block truncate font-mono text-[11px] underline" href={`/crib/${crib}`}>{SITE.url}/crib/{crib}</a>}
      {wrapped && <a className="block truncate font-mono text-[11px] underline" href={`/w/section/${wrapped}`}>{SITE.url}/w/section/{wrapped}</a>}
      {note && <p className="text-xs text-danger">{note}</p>}
    </div>
  );
}
