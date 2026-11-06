"use client";

import { useEffect, useState } from "react";
import { toast } from "@/components/dialogs";
import { ghostButtonClass } from "@/components/ui";
import { SITE } from "@/lib/site";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/telemetry";
import { Row, Section } from "./Section";

type Invites = { code: string; joined: number };

// Invite friends: a link of your own, and how many have joined with it.
export function InviteSection() {
  const [supabase] = useState(createClient);
  const [data, setData] = useState<Invites | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const [code, list] = await Promise.all([
        supabase.rpc("my_referral_code"),
        supabase.from("referrals").select("referrer", { count: "exact", head: true }).eq("referrer", auth.user.id),
      ]);
      if (!live) return;
      if (code.error || !code.data) return setMissing(true);
      setData({ code: code.data as string, joined: list.count ?? 0 });
    })();
    return () => {
      live = false;
    };
  }, [supabase]);

  if (missing) {
    return (
      <Section id="invite" title="Invite friends">
        <Row label="Not set up yet" hint="Invite links need the referrals tables (my_referral_code) in the database." />
      </Section>
    );
  }

  const link = data ? `${SITE.url}/r/${data.code}` : "";
  const message = `I study with Confu, a free, open-source AI tutor that works from your own notes and papers. Join me: ${link}`;

  return (
    <Section id="invite" title="Invite friends" description="Share Confu with friends who study.">
      <Row wide label="Your invite link" hint="Anyone who signs up with it shows up below.">
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
              className="inline-flex items-center rounded-lg border border-ink bg-ink px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-40"
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
      <Row label="Friends who joined">
        <span className="font-mono text-sm">{data ? data.joined : "…"}</span>
      </Row>
    </Section>
  );
}
