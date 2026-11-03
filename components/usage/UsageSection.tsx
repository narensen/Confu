import { eyebrowClass } from "@/components/ui";
import { ago, FEATURE_LABELS, formatTokens, resetIn } from "@/lib/format-usage";
import type { KeyUsage, ModelUsage } from "@/lib/usage-summary";
import { CheckNowButton } from "./CheckNowButton";

export type UsageKey = {
  keyRef: string;
  label: string;
  sessionId: string | null;
  usage: KeyUsage | undefined;
  modelLabels: Record<string, string>; // what each model is used for
  server?: boolean; // the server's keys (owner): no limits to show or check
};

export function UsageSection({ keys }: { keys: UsageKey[] }) {
  return (
    <div className="px-5 py-5 sm:px-6">
      {keys.length === 0 ? (
        <p className="text-sm text-muted">Nothing connected yet. Connect your AI above to start.</p>
      ) : (
        <div className="space-y-5">
          {keys.map((k) => (
            <div key={k.keyRef} className="rounded-xl border border-line p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 text-sm font-medium break-words">{k.label}</p>
                {!k.server && <CheckNowButton sessionId={k.sessionId} />}
              </div>

              {!k.usage?.models.length ? (
                <p className="mt-3 text-sm text-muted">No usage on this key yet.</p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {k.usage.models.map((m) => (
                    <ModelRow key={m.model} m={m} label={k.modelLabels[m.model]} plan={Boolean(k.server)} />
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
        Counted by Confu for requests made here, per key: replacing a key starts a fresh count, and use outside Confu isn&apos;t
        included. Your provider&apos;s dashboard has the exact figures and what they cost. Request limits are shown when the
        provider reports them (Groq, OpenAI). For Groq keys, “~” marks Groq&apos;s free-tier daily allowance as an estimate until
        Groq reports the exact limit. “Check now” asks the provider directly (a 1-token request).
      </p>
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
            re-checks automatically.{" "}
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
