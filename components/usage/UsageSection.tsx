import { eyebrowClass } from "@/components/ui";
import { ago, FEATURE_LABELS, formatTokens, resetIn } from "@/lib/format-usage";
import type { KeyUsage, ModelUsage } from "@/lib/usage-summary";
import { CheckNowButton } from "./CheckNowButton";

export type UsageKey = { keyRef: string; label: string; sessionId: string | null; usage: KeyUsage | undefined };

export function UsageSection({ keys, modelLabels }: { keys: UsageKey[]; modelLabels: Record<string, string> }) {
  return (
    <section id="usage" className="animate-enter scroll-mt-20 rounded-xl border border-ink bg-panel p-6" style={{ animationDelay: "150ms" }}>
      <p className={eyebrowClass}>Usage</p>
      <h2 className="mt-1 font-serif text-2xl">Groq usage</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Tokens used in the last 24 hours and what&apos;s left of each key&apos;s daily allowance. Groq frees tokens up gradually, 24
        hours after they&apos;re used.
      </p>

      {keys.length === 0 ? (
        <p className="mt-5 text-sm text-muted">No key yet. Add one above to start.</p>
      ) : (
        <div className="mt-5 space-y-5">
          {keys.map((k) => (
            <div key={k.keyRef} className="rounded-lg border border-line p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{k.label}</p>
                <CheckNowButton sessionId={k.sessionId} />
              </div>
              {!k.usage?.models.length ? (
                <p className="mt-3 text-sm text-muted">No usage on this key yet.</p>
              ) : (
                <ul className="mt-3 space-y-4">
                  {k.usage.models.map((m) => (
                    <ModelRow key={m.model} m={m} label={modelLabels[m.model]} />
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

      <p className="mt-4 text-[11px] leading-relaxed text-muted">
        Usage is counted by Confu for requests made here, per key: replacing a key starts a fresh count. Request limits
        come from Groq. Groq only reports the daily token limit when a key reaches it, so “~” marks the free-tier allowance
        as an estimate. “Check now” asks Groq directly with a 1-token request. On the shared server key, only your own
        usage is counted. Exact figures: console.groq.com.
      </p>
    </section>
  );
}

function ModelRow({ m, label }: { m: ModelUsage; label?: string }) {
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
            {m.dailyLimit ? ` / ${m.dailyLimitEstimated ? "~" : ""}${formatTokens(m.dailyLimit)}` : ""} tokens, last 24 h
          </span>
        </p>
      </div>
      {m.dailyLimit !== null && (
        <div className={`mt-1.5 h-1.5 overflow-hidden rounded-full bg-line ${stale ? "opacity-50" : ""}`}>
          <div
            className={`h-full rounded-full transition-[width] duration-700 ease-fluid ${bar}`}
            style={{ width: `${blocked ? 100 : Math.min(100, (m.used24h / m.dailyLimit) * 100)}%` }}
          />
        </div>
      )}
      <p className="mt-1.5 text-xs text-muted">
        {blocked ? (
          <span className="font-medium text-danger">
            Daily limit reached at {new Date(m.blockedSince!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. It frees
            up gradually; Confu re-checks with Groq automatically.{" "}
          </span>
        ) : stale ? (
          <span>
            <span className="rounded border border-dashed border-ink/30 px-1 font-mono text-[10px] uppercase">stale</span> Last checked{" "}
            {ago(m.checkedAt)}, so this may be out of date. {left !== null ? `About ${Math.round(left * 100)}% left then. ` : ""}
          </span>
        ) : (
          <span>
            {left !== null ? `${Math.round(left * 100)}% of the daily allowance left. ` : ""}Checked {ago(m.checkedAt)}.{" "}
          </span>
        )}
        {!blocked && m.requestsLimit !== null && (
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
