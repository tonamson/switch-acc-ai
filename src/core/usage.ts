/**
 * Unified usage model for every provider.
 *
 * Always expose the same windows:
 * - 5h: short rolling window (Codex has it; Grok does not → "-")
 * - weekly: week window (Codex secondary; Grok does not → "-")
 * - monthly: calendar billing month (Grok has it; Codex does not → "-")
 *
 * Missing metrics must be `null` so the UI can render "-".
 */

export type UsageMetric = {
  /** e.g. "25% used" — null means provider has no such metric */
  usedPercent: string | null;
  /** e.g. "75% left" or "14529 left" — null means unknown/unavailable */
  remaining: string | null;
  /** e.g. "resets 2026-08-01 UTC" — null means no countdown */
  reset: string | null;
};

export type UsageStatus = {
  account: string;
  user: string;
  plan: string;
  fiveHour: UsageMetric;
  weekly: UsageMetric;
  monthly: UsageMetric;
  /** Extra balance / reset-credits when available */
  credits: string | null;
  reached?: string;
  note?: string;
};

export const ABSENT: UsageMetric = {
  usedPercent: null,
  remaining: null,
  reset: null,
};

export function emptyUsageStatus(account: string, extras: Partial<UsageStatus> = {}): UsageStatus {
  return {
    account,
    user: "unknown",
    plan: "unknown",
    fiveHour: { ...ABSENT },
    weekly: { ...ABSENT },
    monthly: { ...ABSENT },
    credits: null,
    ...extras,
  };
}

/** Format a single metric line: missing whole window → "-", else join parts with " · " and "-" per missing part. */
export function formatMetric(metric: UsageMetric): string {
  const parts = [metric.usedPercent, metric.remaining, metric.reset];
  if (parts.every((part) => part === null)) {
    return "-";
  }
  return parts.map((part) => part ?? "-").join("  ·  ");
}

export function usedPercentFromNumber(usedPercent: number | undefined): string | null {
  if (typeof usedPercent !== "number" || Number.isNaN(usedPercent)) {
    return null;
  }
  return `${usedPercent}% used`;
}

/** Approximate remaining from used% when absolute quota is unknown. */
export function remainingFromUsedPercent(usedPercent: number | undefined): string | null {
  if (typeof usedPercent !== "number" || Number.isNaN(usedPercent)) {
    return null;
  }
  const left = Math.min(100, Math.max(0, 100 - usedPercent));
  const rounded = left >= 10 ? left.toFixed(0) : left.toFixed(1);
  return `${rounded}% left`;
}

export function metricFromPercentWindow(
  usedPercent: number | undefined,
  resetLabel: string | undefined,
): UsageMetric {
  if (typeof usedPercent !== "number" || Number.isNaN(usedPercent)) {
    return { ...ABSENT };
  }
  return {
    usedPercent: usedPercentFromNumber(usedPercent),
    remaining: remainingFromUsedPercent(usedPercent),
    reset: resetLabel && resetLabel !== "unknown reset" ? resetLabel : null,
  };
}

export function metricFromAbsoluteQuota(
  used: number | undefined,
  limit: number | undefined,
  resetLabel: string | undefined,
): UsageMetric {
  if (typeof used !== "number" || typeof limit !== "number" || limit <= 0) {
    return { ...ABSENT };
  }
  const pct = Math.min(100, Math.max(0, (used / limit) * 100));
  const rounded = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
  const remaining = Math.max(0, limit - used);
  return {
    usedPercent: `${rounded}% used`,
    remaining: `${remaining} left (${used}/${limit})`,
    reset: resetLabel || null,
  };
}
