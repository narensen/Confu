"use client";

import { useEffect, useState } from "react";
import { toast } from "@/components/dialogs";
import { LocalTime } from "@/components/LocalTime";
import { ghostButtonClass } from "@/components/ui";
import { SITE } from "@/lib/site";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/telemetry";
import { Row, Section } from "./Section";

type Invites = { code: string; joined: number; rewarded: number; proUntil: string | null };

// Invite friends: they get a week of Pro when they join, and you get a week
// once they've really studied (10 minutes, or three questions).
export function InviteSection() {
  const [supabase] = useState(createClient);
  const [data, setData] = useState<Invites | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const [code, list, profile] = await Promise.all([
        supabase.rpc("my_referral_code"),
        supabase.from("referrals").select("rewarded_at").eq("referrer", auth.user.id),
        supabase.from("profiles").select("*").eq("id", auth.user.id).maybeSingle(),
      ]);
      if (!live) return;
      if (code.error || !code.data) return setMissing(true);
      const rows = (list.data ?? []) as { rewarded_at: string | null }[];
      const until = (profile.data as { pro_until?: string | null } | null)?.pro_until ?? null;
      setData({
        code: code.data as string,
        joined: rows.length,
        rewarded: rows.filter((r) => r.rewarded_at).length,
        proUntil: until && Date.parse(until) > Date.now() ? until : null,
      });
    })();
    return () => {
      live = false;
    };
  }, [supabase]);

  if (missing) {
    return (
      <Section id="invite" title="Invite friends">
        <Row label="Not set up yet" hint="Run supabase/migrations/0023_billing_referrals.sql in Supabase to turn on invites." />
      </Section>
    );
  }

  const link = data ? `${SITE.url}/r/${data.code}` : "";
  const message = `I study with Confu, an AI tutor that works from your own notes and papers. Join with my link and get a week of Pro free: ${link}`;

  return (
    <Section id="invite" title="Invite friends" description="Share Confu with friends who study. They get a week of Pro when they join; you get a week once they've studied for real.">
      <Row wide label="Your invite link" hint="Weeks add up, and they stack on top of any Pro you already have.">
        <div className="mt-1 space-y-2.5">
          <code className="block truncate rounded-lg border border-line bg-paper px-3 py-2 font-mono text-xs">{link || "…"}</code>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!data}
              onClick={() =>
                navigator.clipboard.writeText(link).then(() => {
                  toast("Invite link copied.");
                  track("invite.copy");
                })
              }
              className="inline-flex items-center rounded-lg border border-ink bg-ink px-3 py-1.5 text-xs font-medium text-white transition hover:-translate-y-px hover:shadow-[2px_2px_0_0_#facc15] disabled:opacity-40"
            >
              Copy link
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => track("invite.whatsapp")}
              className={`${ghostButtonClass} py-1 text-xs`}
            >
              WhatsApp
            </a>
            <button
              type="button"
              disabled={!data}
              onClick={async () => {
                try {
                  if (navigator.share) await navigator.share({ title: "Confu", text: message, url: link });
                  else await navigator.clipboard.writeText(message).then(() => toast("Message copied."));
                  track("invite.share");
                } catch {}
              }}
              className={`${ghostButtonClass} py-1 text-xs`}
            >
              Share…
            </button>
          </div>
        </div>
      </Row>
      <Row label="Friends who joined" hint={data && data.joined > data.rewarded ? `${data.joined - data.rewarded} still to study their first 10 minutes.` : undefined}>
        <span className="font-mono text-sm">{data ? data.joined : "…"}</span>
      </Row>
      <Row label="Weeks of Pro earned" hint={data?.proUntil ? <>Pro from invites until <LocalTime iso={data.proUntil} />.</> : "Up to five weeks every 30 days."}>
        <span className="font-mono text-sm">{data ? data.rewarded : "…"}</span>
      </Row>
    </Section>
  );
}
