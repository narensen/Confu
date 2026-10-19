import { eyebrowClass } from "@/components/ui";
import { ago, FEATURE_LABELS, formatTokens, resetIn } from "@/lib/format-usage";
import type { KeyUsage, ModelUsage } from "@/lib/usage-summary";
import { CheckNowButton } from "./CheckNowButton";

export type UsageKey = {
  keyRef: string;
  label: string;
  sessionId: string | null;
  usage: KeyUsage | undefined;
  // Pro: the plan's daily allowance (cap null = unlimited owner), counted by Confu.
  allowance?: { used: number; cap: number | null };
};

export function UsageSection({ keys, modelLabels }: { keys: UsageKey[]; modelLabels: Record<string, string> }) {
  return (
    <div className="px-5 py-5 sm:px-6">
      {keys.length === 0 ? (
        <p className="text-sm text-muted">No key yet. Add one above to start.</p>
      ) : (
        <div className="space-y-5">
          {keys.map((k) => (
            <div key={k.keyRef} className="rounded-xl border border-line p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{k.label}</p>
                {!k.allowance && <CheckNowButton sessionId={k.sessionId} />}
              </div>

              {k.allowance && <Allowance used={k.allowance.used} cap={k.allowance.cap} />}

              {!k.usage?.models.length ? (
                <p className="mt-3 text-sm text-muted">No usage on this {k.allowance ? "plan" : "key"} yet.</p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {k.usage.models.map((m) => (
                    <ModelRow key={m.model} m={m} label={modelLabels[m.model]} plan={Boolean(k.allowance)} />
                  ))}
                </ul>
              )}
              {k.usage && k.usage.byFeature.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className={eyebrowClass}>Last 24 hours by feature</p>
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    {k.usage.byFeature.map((f) => (
                      <li key={f.feature}>
                        {FEATURE_LABELS[f.feature] ?? f.feature} <span className="font-mono text-ink">{formatTokens(f.tokens)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {keys.length > 0 && keys.every((k) => k.allowance) ? (
        <p className="mt-4 text-[11px] leading-relaxed text-muted">
          Counted by Confu for every request you make. The allowance is a rolling 24 hours: tokens free up as usage from a day ago
          ages out.
        </p>
      ) : (
        <p className="mt-4 text-[11px] leading-relaxed text-muted">
          Counted by Confu for requests made here, per key: replacing a key starts a fresh count. Groq frees tokens gradually, 24
          hours after use. Request limits come from Groq, “~” marks the free-tier daily allowance as an estimate until Groq
          reports the exact limit, and “Check now” asks Groq directly (a 1-token request). Exact figures: console.groq.com.
        </p>
      )}
    </div>
  );
}

function Allowance({ used, cap }: { used: number; cap: number | null }) {
  const share = cap ? Math.min(1, used / cap) : 0;
  const tone = share >= 1 ? "bg-danger" : share > 0.9 ? "bg-danger" : share > 0.7 ? "bg-warn" : "bg-ink";
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{cap === null ? "Unlimited (admin)" : share >= 1 ? "Today's allowance is used up" : `${Math.round((1 - share) * 100)}% of today's allowance left`}</span>
        <span className="font-mono text-xs text-muted">
          {formatTokens(used)}
          {cap ? ` / ${formatTokens(cap)}` : ""} tokens · 24 h
        </span>
      </div>
      {cap !== null && (
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line">
          <div className={`h-full rounded-full transition-[width] duration-700 ease-fluid ${tone}`} style={{ width: `${share * 100}%` }} />
        </div>
      )}
    </div>
  );
}

function ModelRow({ m, label, plan }: { m: ModelUsage; label?: string; plan: boolean }) {
  const blocked = m.status === "blocked";
  const stale = m.status === "stale";
  const left = m.dailyLimit ? Math.max(0, 1 - m.used24h / m.dailyLimit) : null;
  const bar = blocked || (left !== null && left < 0.1) ? "bg-danger" : left !== null && left < 0.3 ? "bg-warn" : "bg-ink";
  const reset = resetIn(m.requestsResetAt);
  return (
    <li>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-sm">
          {label ?? m.model} <span className="font-mono text-[11px] text-muted">{m.model}</span>
        </p>
        <p className="font-mono text-xs">
          {formatTokens(m.used24h)}
          <span className="text-muted">
            {!plan && m.dailyLimit ? ` / ${m.dailyLimitEstimated ? "~" : ""}${formatTokens(m.dailyLimit)}` : ""} tokens, last 24 h
          </span>
        </p>
      </div>
      {!plan && m.dailyLimit !== null && (
        <div className={`mt-1.5 h-1.5 overflow-hidden rounded-full bg-line ${stale ? "opacity-50" : ""}`}>
          <div className={`h-full rounded-full transition-[width] duration-700 ease-fluid ${bar}`} style={{ width: `${blocked ? 100 : Math.min(100, (m.used24h / m.dailyLimit) * 100)}%` }} />
        </div>
      )}
      <p className="mt-1.5 text-xs text-muted">
        {plan ? null : blocked ? (
          <span className="font-medium text-danger">
            Daily limit reached at {new Date(m.blockedSince!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. It frees up gradually; Confu
            re-checks with Groq automatically.{" "}
          </span>
        ) : stale ? (
          <span>
            <span className="rounded border border-dashed border-ink/30 px-1 font-mono text-[10px] uppercase">stale</span> Last checked {ago(m.checkedAt)}, so this may
            be out of date. {left !== null ? `About ${Math.round(left * 100)}% left then. ` : ""}
          </span>
        ) : (
          <span>
            {left !== null ? `${Math.round(left * 100)}% of the daily allowance left. ` : ""}Checked {ago(m.checkedAt)}.{" "}
          </span>
        )}
        {!plan && !blocked && m.requestsLimit !== null && (
          <span>
            {(m.requestsRemaining ?? m.requestsLimit).toLocaleString()} of {m.requestsLimit.toLocaleString()} requests left today
            {reset ? `, next frees up in ${reset}` : ""}.{" "}
          </span>
        )}
        <span>{formatTokens(m.used7d)} in the last 7 days.</span>
      </p>
    </li>
  );
}
