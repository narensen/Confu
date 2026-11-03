import Link from "next/link";
import type { ReactNode } from "react";
import { DailyChart } from "./DailyChart";
import { AnswerFeedback, type AnswerNote } from "./AnswerFeedback";
import { FeedbackInbox, type FeedbackItem } from "./FeedbackInbox";

// The owner's dashboard: what people do in Confu, from Confu's own database
// (admin_insights() in migration 0018). One date range scopes everything.

export type Insights = {
  generated_at: string;
  days: number;
  users: { total: number; new: number; dau: number; wau: number; mau: number };
  daily: { day: string; signups: number; active: number }[];
  funnel: { step: string; users: number }[];
  features: { feature: string; uses: number; users: number }[];
  session_kinds: Record<string, number>;
  pages: { path: string; views: number; visitors: number }[];
  landing: { visitors: number; signups: number };
  vitals: { metric: string; p75: number; samples: number; poor: number }[];
  slow_pages: { path: string; p75: number; samples: number }[];
  slow_targets?: { target: string; path: string | null; p75: number; samples: number }[];
  ai: {
    confu_tokens: number;
    own_tokens: number;
    requests: number;
    by_feature: { feature: string; requests: number; tokens: number }[];
    top_users: { email: string; tokens: number }[];
  };
  survey: { heard_from: Record<string, number>; occupation: Record<string, number>; purpose: Record<string, number> };
  retention: { week: string; size: number; weeks: (number | null)[] }[];
  recent_users: {
    email: string;
    joined: string;
    plan: string;
    occupation: string | null;
    heard_from: string | null;
    sessions: number;
    active_days: number;
    last_active: string | null;
  }[];
  feedback: FeedbackItem[];
  errors: { fingerprint: string; source: string; message: string; path: string | null; count: number; people: number; last_seen: string }[];
};

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const n = (v: number) => (v >= 10_000 ? compact.format(v) : v.toLocaleString("en"));
const day = (iso: string) => new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const FEATURE_NAMES: Record<string, string> = {
  "Tutor: chat": "Chatted with the tutor",
  "Tutor: ask": "Asked about a selection",
  "Tutor: summarize": "Summarized a selection",
  "Tutor: context": "Asked for context",
  "Tutor: simplify": "Asked to explain simply",
  "Tutor: figure": "Asked about a figure",
  "Tutor: quiz": "Check my understanding",
  "Tutor: teach": "Teach me",
  "Tutor: pass1_check": "Paper: checked the five Cs",
  "Tutor: pass2_figures": "Paper: walked through figures",
  "Tutor: pass2_check": "Paper: checked an explanation",
  "Tutor: pass3_rebuild": "Paper: re-implementation",
  "Tutor: pass3_probe": "Paper: probed weaknesses",
  "UI: reader.search": "Reader: searched a PDF",
  "UI: reader.contents": "Reader: opened contents",
  "UI: reader.theme": "Reader: changed theme",
  "UI: reader.fullscreen": "Reader: full screen",
  "UI: feedback.open": "Opened feedback",
  "UI: feedback.sent": "Sent feedback",
};
const featureName = (f: string) => FEATURE_NAMES[f] ?? f.replace(/^UI: /, "").replace(/[._]/g, " ");
const label = (s: string) => (s === "not answered" ? "Not answered" : s.replace(/[_-]/g, " ").replace(/^\w/, (c) => c.toUpperCase()));

// Web Vitals thresholds (web.dev): [good up to, poor above].
const VITALS: Record<string, { good: number; poor: number; unit: string; name: string }> = {
  LCP: { good: 2500, poor: 4000, unit: "ms", name: "Largest paint" },
  INP: { good: 200, poor: 500, unit: "ms", name: "Click response" },
  CLS: { good: 0.1, poor: 0.25, unit: "", name: "Layout shift" },
  FCP: { good: 1800, poor: 3000, unit: "ms", name: "First paint" },
  TTFB: { good: 800, poor: 1800, unit: "ms", name: "Server response" },
};

export function AdminDashboard({ data, days, ranges, answers = [], answersMissing = false }: { data: Insights; days: number; ranges: number[]; answers?: AnswerNote[]; answersMissing?: boolean }) {
  const u = data.users;
  const funnelTop = data.funnel[0]?.users ?? 0;
  const maxFeature = Math.max(1, ...data.features.map((f) => f.users));
  const kinds = Object.entries(data.session_kinds).sort((a, b) => b[1] - a[1]);
  const newFeedback = data.feedback.filter((f) => f.status === "new").length;

  return (
    <div className="animate-enter space-y-8">
      {/* Title + the one filter that scopes everything */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] font-medium tracking-[0.12em] text-muted uppercase">Owner</p>
          <h1 className="mt-1 font-serif text-4xl tracking-tight sm:text-5xl">Insights</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            What people actually do in Confu, from your own database. No third-party trackers. Updated {ago(data.generated_at)}.
          </p>
        </div>
        <nav aria-label="Date range" className="flex rounded-lg border border-ink p-1">
          {ranges.map((r) => (
            <Link
              key={r}
              href={`/admin?days=${r}`}
              aria-current={r === days ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${r === days ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
            >
              {r} days
            </Link>
          ))}
        </nav>
      </header>

      {/* Headline numbers */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="People" value={n(u.total)} note={`+${n(u.new)} in the last ${days} days`} />
        <Stat label="Active, last 7 days" value={n(u.wau)} note={`${n(u.dau)} today · ${n(u.mau)} in 30 days`} />
        <Stat
          label="Landing to sign-up"
          value={data.landing.visitors ? `${pct(data.landing.signups, data.landing.visitors)}%` : "–"}
          note={`${n(data.landing.visitors)} visitors · ${n(data.landing.signups)} sign-ups`}
        />
        <Stat label="AI tokens on the server's keys" value={n(data.ai.confu_tokens)} note={`${n(data.ai.own_tokens)} on people's own AI · ${n(data.ai.requests)} requests`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <DailyChart title="Active people per day" points={data.daily.map((d) => ({ day: d.day, value: d.active }))} unit="active" />
        <DailyChart title="Sign-ups per day" points={data.daily.map((d) => ({ day: d.day, value: d.signups }))} unit="sign-ups" />
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2" title="Where new people drop off" sub={`Everyone who signed up in the last ${days} days, and how far they got.`}>
          {funnelTop === 0 ? (
            <Empty>No sign-ups in this range yet.</Empty>
          ) : (
            <ol className="space-y-3">
              {data.funnel.map((s, i) => (
                <li key={s.step}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span>
                      <span className="mr-2 font-mono text-[11px] text-muted tabular-nums">{i + 1}</span>
                      {s.step}
                    </span>
                    <span className="font-mono text-xs tabular-nums">
                      {n(s.users)} <span className="text-muted">· {pct(s.users, funnelTop)}%</span>
                    </span>
                  </div>
                  <Bar share={s.users / funnelTop} />
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="lg:col-span-3" title="What people use" sub="Ranked by how many different people used it in this range.">
          {data.features.length === 0 ? (
            <Empty>Nothing used in this range yet.</Empty>
          ) : (
            <Table head={["Feature", "People", "Uses"]} align={["left", "right", "right"]}>
              {data.features.slice(0, 18).map((f) => (
                <tr key={f.feature} className="border-t border-line">
                  <td className="py-2 pr-3">
                    <span className="block text-sm">{featureName(f.feature)}</span>
                    <Bar share={f.users / maxFeature} thin />
                  </td>
                  <td className="py-2 text-right font-mono text-xs tabular-nums">{n(f.users)}</td>
                  <td className="py-2 pl-3 text-right font-mono text-xs text-muted tabular-nums">{n(f.uses)}</td>
                </tr>
              ))}
            </Table>
          )}
          {kinds.length > 0 && (
            <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
              New sessions: {kinds.map(([k, v]) => `${n(v)} ${k === "exam" ? "exam prep" : k === "paper" ? "papers" : "study"}`).join(" · ")}
            </p>
          )}
        </Card>
      </section>

      <Card
        title="Answer corrections"
        sub="Thumbs on a tutor answer, with a correction and a comment. The correction is the useful part. Not sold, and not used to train a model."
      >
        <AnswerFeedback notes={answers} missing={answersMissing} />
      </Card>

      <Card
        title={`Feedback${newFeedback ? ` · ${newFeedback} new` : ""}`}
        sub="From the Send feedback box (account menu and error pages). Newest unread first."
      >
        <FeedbackInbox initial={data.feedback} />
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="Do people come back?" sub="Of those who joined in a week, the share active 1, 2, 3 and 4 weeks later.">
          {data.retention.length === 0 ? (
            <Empty>Needs a few weeks of sign-ups.</Empty>
          ) : (
            <Table head={["Joined week of", "People", "Wk 1", "Wk 2", "Wk 3", "Wk 4"]} align={["left", "right", "right", "right", "right", "right"]}>
              {data.retention.map((r) => (
                <tr key={r.week} className="border-t border-line">
                  <td className="py-1.5 pr-3 text-sm">{day(r.week)}</td>
                  <td className="py-1.5 text-right font-mono text-xs tabular-nums">{n(r.size)}</td>
                  {r.weeks.map((w, i) => (
                    <td key={i} className="py-1.5 pl-1.5 text-right">
                      <RetentionCell value={w} />
                    </td>
                  ))}
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Errors" sub="Grouped by message. Browser and server, reported automatically.">
          {data.errors.length === 0 ? (
            <Empty>No errors in this range.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {data.errors.map((e) => (
                <li key={e.fingerprint} className="py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 font-mono text-xs leading-relaxed wrap-break-word">{e.message}</p>
                    <span className="shrink-0 rounded bg-danger/10 px-1.5 py-0.5 font-mono text-[11px] text-danger tabular-nums">×{n(e.count)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted">
                    {e.source} · {e.path ?? "unknown page"} · {n(e.people)} {e.people === 1 ? "person" : "people"} · last {ago(e.last_seen)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="Page speed" sub="75th percentile of real visits. Click response is how fast buttons react.">
          {data.vitals.length === 0 ? (
            <Empty>Collecting. Shows after a few visits.</Empty>
          ) : (
            <Table head={["Metric", "p75", "Samples", ""]} align={["left", "right", "right", "right"]}>
              {data.vitals
                .filter((v) => VITALS[v.metric])
                .map((v) => {
                  const t = VITALS[v.metric];
                  const status = v.p75 <= t.good ? "good" : v.p75 > t.poor ? "poor" : "work";
                  return (
                    <tr key={v.metric} className="border-t border-line">
                      <td className="py-2 pr-3 text-sm">
                        {t.name} <span className="font-mono text-[11px] text-muted">{v.metric}</span>
                      </td>
                      <td className="py-2 text-right font-mono text-xs tabular-nums">
                        {v.metric === "CLS" ? v.p75 : n(Math.round(v.p75))}
                        {t.unit}
                      </td>
                      <td className="py-2 pl-3 text-right font-mono text-xs text-muted tabular-nums">{n(v.samples)}</td>
                      <td className="py-2 pl-3 text-right">
                        <Status kind={status} />
                      </td>
                    </tr>
                  );
                })}
            </Table>
          )}
          {(data.slow_targets?.length ?? 0) > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-xs font-medium">Slowest things to click</p>
              <ul className="mt-2 space-y-1.5">
                {data.slow_targets!.map((s) => (
                  <li key={s.target} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate font-mono" title={s.target}>
                      {s.target} <span className="text-muted">on {s.path ?? "?"}</span>
                    </span>
                    <span className="shrink-0 font-mono tabular-nums">{n(s.p75)}ms</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Most visited pages" sub="Views and unique visitors (signed in or not).">
          {data.pages.length === 0 ? (
            <Empty>Collecting.</Empty>
          ) : (
            <Table head={["Page", "Visitors", "Views"]} align={["left", "right", "right"]}>
              {data.pages.map((p) => (
                <tr key={p.path} className="border-t border-line">
                  <td className="max-w-0 truncate py-2 pr-3 font-mono text-xs">{p.path}</td>
                  <td className="py-2 text-right font-mono text-xs tabular-nums">{n(p.visitors)}</td>
                  <td className="py-2 pl-3 text-right font-mono text-xs text-muted tabular-nums">{n(p.views)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <SurveyCard title="How they found Confu" data={data.survey.heard_from} />
        <SurveyCard title="Who they are" data={data.survey.occupation} />
        <SurveyCard title="What they want it for" data={data.survey.purpose} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="AI cost by feature" sub="Requests and tokens in this range, all keys.">
          {data.ai.by_feature.length === 0 ? (
            <Empty>No AI requests in this range.</Empty>
          ) : (
            <Table head={["Feature", "Requests", "Tokens"]} align={["left", "right", "right"]}>
              {data.ai.by_feature.map((f) => (
                <tr key={f.feature} className="border-t border-line">
                  <td className="py-2 pr-3 text-sm capitalize">{f.feature}</td>
                  <td className="py-2 text-right font-mono text-xs tabular-nums">{n(f.requests)}</td>
                  <td className="py-2 pl-3 text-right font-mono text-xs tabular-nums">{n(f.tokens)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="Heaviest users of the server's keys" sub="Free prompts and owner usage. Watch this for cost.">
          {data.ai.top_users.length === 0 ? (
            <Empty>Nobody yet.</Empty>
          ) : (
            <Table head={["Account", "Tokens"]} align={["left", "right"]}>
              {data.ai.top_users.map((t) => (
                <tr key={t.email} className="border-t border-line">
                  <td className="max-w-0 truncate py-2 pr-3 text-sm">{t.email}</td>
                  <td className="py-2 text-right font-mono text-xs tabular-nums">{n(t.tokens)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </section>

      <Card title="Newest people" sub="The latest 40 accounts and how much they've done.">
        <div className="overflow-x-auto">
          <Table
            fixed={false}
            head={["Account", "Joined", "Plan", "Who", "Found via", "Sessions", "Active days", "Last active"]}
            align={["left", "left", "left", "left", "left", "right", "right", "right"]}
          >
            {data.recent_users.map((r) => (
              <tr key={r.email} className="border-t border-line text-sm">
                <td className="py-2 pr-3 whitespace-nowrap">{r.email}</td>
                <td className="py-2 pr-3 whitespace-nowrap text-muted">{day(r.joined)}</td>
                <td className="py-2 pr-3 capitalize">{r.plan === "admin" ? "Owner" : r.plan}</td>
                <td className="py-2 pr-3 whitespace-nowrap text-muted">{r.occupation ? label(r.occupation) : "–"}</td>
                <td className="py-2 pr-3 whitespace-nowrap text-muted">{r.heard_from ? label(r.heard_from) : "–"}</td>
                <td className="py-2 text-right font-mono text-xs tabular-nums">{r.sessions}</td>
                <td className="py-2 pl-3 text-right font-mono text-xs tabular-nums">{r.active_days}</td>
                <td className="py-2 pl-3 text-right whitespace-nowrap text-muted">{r.last_active ? day(r.last_active) : "never"}</td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>
    </div>
  );
}

function Card({ title, sub, className = "", children }: { title: string; sub?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-xl border border-ink bg-panel p-5 ${className}`}>
      <h2 className="font-serif text-xl leading-tight">{title}</h2>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-ink bg-panel p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-4xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] text-muted">{note}</p>
    </div>
  );
}

// A thin magnitude bar (single series: ink on a hairline track).
function Bar({ share, thin = false }: { share: number; thin?: boolean }) {
  return (
    <div className={`mt-1 overflow-hidden rounded-full bg-line ${thin ? "h-1" : "h-2"}`}>
      <div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }} />
    </div>
  );
}

// Retention cell: one hue (ink), light to dark with the share; the number is always shown.
function RetentionCell({ value }: { value: number | null }) {
  if (value === null) return <span className="font-mono text-[11px] text-muted">·</span>;
  const alpha = 0.06 + (Math.min(100, value) / 100) * 0.84;
  return (
    <span
      className="inline-block min-w-11 rounded px-1.5 py-0.5 text-center font-mono text-[11px] tabular-nums"
      style={{ background: `color-mix(in srgb, var(--ink) ${alpha * 100}%, transparent)`, color: alpha > 0.45 ? "var(--paper)" : "var(--ink)" }}
    >
      {value}%
    </span>
  );
}

function Status({ kind }: { kind: "good" | "work" | "poor" }) {
  const map = {
    good: { text: "Good", cls: "text-ok", icon: "●" },
    work: { text: "Needs work", cls: "text-warn", icon: "▲" },
    poor: { text: "Poor", cls: "text-danger", icon: "■" },
  }[kind];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap ${map.cls}`}>
      <span aria-hidden className="text-[9px]">
        {map.icon}
      </span>
      {map.text}
    </span>
  );
}

function SurveyCard({ title, data }: { title: string; data: Record<string, number> }) {
  const rows = Object.entries(data).sort((a, b) => (a[0] === "not answered" ? 1 : b[0] === "not answered" ? -1 : b[1] - a[1]));
  const total = rows.reduce((s, [, v]) => s + v, 0);
  const max = Math.max(1, ...rows.map(([, v]) => v));
  return (
    <Card title={title} sub="From the sign-up questions, all time.">
      {rows.length === 0 ? (
        <Empty>No answers yet.</Empty>
      ) : (
        <ul className="space-y-2.5">
          {rows.slice(0, 8).map(([k, v]) => (
            <li key={k}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className={k === "not answered" ? "text-muted" : ""}>{label(k)}</span>
                <span className="font-mono text-xs tabular-nums">
                  {n(v)} <span className="text-muted">· {pct(v, total)}%</span>
                </span>
              </div>
              <Bar share={v / max} thin />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Table({ head, align, fixed = true, children }: { head: string[]; align: ("left" | "right")[]; fixed?: boolean; children: ReactNode }) {
  return (
    <table className={`w-full border-collapse ${fixed ? "table-fixed" : "min-w-190 table-auto"}`}>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th
              key={`${h}-${i}`}
              scope="col"
              className={`pb-2 font-mono text-[10px] font-medium tracking-wider whitespace-nowrap text-muted uppercase ${align[i] === "right" ? "text-right" : "text-left"} ${fixed && i === 0 ? "w-[45%]" : ""}`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-ink/30 px-4 py-6 text-center text-sm text-muted">{children}</p>;
}
