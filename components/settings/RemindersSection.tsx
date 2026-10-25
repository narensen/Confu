"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "@/components/dialogs";
import { ghostButtonClass } from "@/components/ui";
import { canInstall, isStandalone, promptInstall, subscribeInstall } from "@/lib/pwa/install";
import { currentSubscription, disablePush, enablePush, pushAvailable } from "@/lib/pwa/push";
import { SITE } from "@/lib/site";
import { createClient } from "@/lib/supabase/client";
import { Row, Section } from "./Section";

type Prefs = { timezone: string | null; email_digest: boolean; email_reminders: boolean; push_reminders: boolean; calendar_token: string | null };

export function RemindersSection() {
  const [supabase] = useState(createClient);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [missing, setMissing] = useState(false);
  const [push, setPush] = useState<"on" | "off" | "unavailable" | "loading">("loading");
  const installable = useSyncExternalStore(subscribeInstall, canInstall, () => false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data, error } = await supabase.from("profiles").select("timezone, email_digest, email_reminders, push_reminders, calendar_token").eq("id", auth.user.id).maybeSingle();
      if (!live) return;
      if (error || !data) return setMissing(true);
      const p = data as Prefs;
      setPrefs(p);
      // Keep the time zone current, so streaks and emails use local days.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && p.timezone !== tz) await supabase.from("profiles").update({ timezone: tz }).eq("id", auth.user.id);
    })();
    void (async () => {
      if (!pushAvailable()) return setPush("unavailable");
      setPush((await currentSubscription()) ? "on" : "off");
    })();
    return () => {
      live = false;
    };
  }, [supabase]);

  async function save(patch: Partial<Prefs>) {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, ...patch });
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from("profiles").update(patch).eq("id", auth.user?.id ?? "");
    if (error) {
      setPrefs(before);
      toast("Couldn't save that setting.", "error");
    }
  }

  const feed = prefs?.calendar_token ? `${SITE.url.replace(/^https?/, "https")}/api/calendar/${prefs.calendar_token}.ics` : null;
  const webcal = feed?.replace(/^https:/, "webcal:");

  if (missing) {
    return (
      <Section id="reminders" title="Reminders & calendar">
        <Row label="Not set up yet" hint="Run supabase/migrations/0020_habit.sql in Supabase to turn on reminders, notifications and the calendar feed." />
      </Section>
    );
  }

  return (
    <Section id="reminders" title="Reminders & calendar" description="Gentle nudges to keep your reviews and plan on track. Everything here is optional.">
      <Row label="Weekly summary email" hint="Once a week: time studied, topics done and what's due.">
        <Toggle on={prefs?.email_digest ?? false} disabled={!prefs} onChange={(v) => save({ email_digest: v })} label="Weekly summary email" />
      </Row>
      <Row label="Review reminder emails" hint="When reviews have been waiting for a while. At most one every three days.">
        <Toggle on={prefs?.email_reminders ?? false} disabled={!prefs} onChange={(v) => save({ email_reminders: v })} label="Review reminder emails" />
      </Row>
      <Row
        label="Notifications on this device"
        hint={
          push === "unavailable"
            ? "Not available in this browser. On iPhone, add Confu to your Home Screen first (Share → Add to Home Screen), then turn this on there."
            : "A notification when reviews are due, instead of (or as well as) email."
        }
      >
        {push !== "unavailable" && (
          <Toggle
            on={push === "on" && (prefs?.push_reminders ?? true)}
            disabled={push === "loading" || !prefs}
            label="Notifications on this device"
            onChange={async (v) => {
              try {
                if (v) {
                  const r = await enablePush();
                  if (r === "denied") return toast("Notifications are blocked for Confu in your browser's site settings.", "error");
                  setPush(r === "on" ? "on" : "unavailable");
                  if (!prefs?.push_reminders) await save({ push_reminders: true });
                } else {
                  await disablePush();
                  setPush("off");
                }
              } catch (err) {
                toast(err instanceof Error ? err.message : "Couldn't change notifications.", "error");
              }
            }}
          />
        )}
      </Row>
      <Row
        label="Install the app"
        hint={
          isStandalone()
            ? "You're using the installed app."
            : installable
              ? "Open Confu in its own window, from your dock or home screen."
              : "In Chrome or Edge, use the install icon in the address bar. On iPhone: Share → Add to Home Screen."
        }
      >
        {installable && !isStandalone() && (
          <button type="button" onClick={() => void promptInstall()} className={`${ghostButtonClass} py-1 text-xs`}>
            Install Confu
          </button>
        )}
      </Row>
      <Row
        wide
        label="Study plan in your calendar"
        hint="Subscribe once and your plan's topics appear on their due dates, updating as your plan changes. The link is private: anyone with it can see your topic titles."
      >
        {feed && (
          <div className="mt-1 space-y-2.5">
            <code className="block truncate rounded-lg border border-line bg-paper px-3 py-2 font-mono text-xs">{feed}</code>
            <div className="flex flex-wrap gap-2">
              <a
                href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal!)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-lg border border-ink bg-ink px-3 py-1.5 text-xs font-medium text-white transition hover:-translate-y-px hover:shadow-[2px_2px_0_0_#facc15]"
              >
                Add to Google Calendar
              </a>
              <a href={webcal} className={`${ghostButtonClass} py-1 text-xs`}>
                Apple / Outlook
              </a>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(feed).then(() => toast("Calendar link copied."))}
                className={`${ghostButtonClass} py-1 text-xs`}
              >
                Copy link
              </button>
              <a href={feed} download="confu-study-plan.ics" className={`${ghostButtonClass} py-1 text-xs`}>
                Download .ics
              </a>
              <button
                type="button"
                onClick={async () => {
                  const { data, error } = await supabase.rpc("rotate_calendar_token");
                  if (error) return toast("Couldn't reset the link.", "error");
                  setPrefs((p) => (p ? { ...p, calendar_token: data as string } : p));
                  toast("New link made. The old one no longer works; subscribe again with the new one.");
                }}
                className="px-1 text-xs text-muted underline-offset-4 hover:text-ink hover:underline"
              >
                Reset link
              </button>
            </div>
          </div>
        )}
      </Row>
    </Section>
  );
}

function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full border border-ink transition-colors disabled:opacity-40 ${on ? "bg-ink" : "bg-panel"}`}
    >
      <span className={`absolute top-0.5 left-0.5 size-[18px] rounded-full transition-transform duration-200 ${on ? "translate-x-5 bg-yellow-400" : "bg-ink/70"}`} />
    </button>
  );
}
