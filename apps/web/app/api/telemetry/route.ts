import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// Receives batched usage events and client error reports from lib/telemetry.
// Validated here, then stored by rate-limited database functions
// (track_events, report_error in migration 0018). Always answers 204: the
// browser never retries or shows anything.

const Value = z.union([z.string().max(300), z.number(), z.boolean(), z.null()]);
const Event = z.object({
  name: z.string().regex(/^[a-z0-9_.]{2,48}$/),
  path: z.string().max(300).optional(),
  props: z.record(z.string().max(40), Value).optional(),
});
const Body = z.object({
  events: z.array(Event).max(50).optional(),
  error: z
    .object({
      message: z.string().min(1).max(1000),
      stack: z.string().max(4000).optional(),
      path: z.string().max(300).optional(),
      digest: z.string().max(100).optional(),
    })
    .optional(),
  anon: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
});

const BOTS = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|monitor/i;
const done = () => new Response(null, { status: 204 });

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 32_000) return done();
  const userAgent = request.headers.get("user-agent") ?? "";
  if (BOTS.test(userAgent)) return done();

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return done();
  const { events, error, anon } = parsed.data;

  const supabase = await createClient();
  try {
    if (events?.length) await supabase.rpc("track_events", { p_events: events, p_anon: anon ?? null });
    if (error) {
      await supabase.rpc("report_error", {
        p_source: "client",
        p_message: error.message,
        p_stack: error.stack ?? null,
        p_path: error.path ?? null,
        p_digest: error.digest ?? null,
        p_user_agent: userAgent.slice(0, 300),
      });
    }
  } catch {
    // Telemetry must never break anything.
  }
  return done();
}
