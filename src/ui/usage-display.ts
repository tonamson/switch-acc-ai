import type { UsageMetric } from "../core/usage.js";
import { danger, muted, success, warning } from "./theme.js";

const BAR_WIDTH = 18;
const FILLED = "█";
const EMPTY = "░";

/** Extract used% number from metric strings like "75% used" / "3.1% used". */
export function parseUsedPercent(metric: UsageMetric): number | null {
  if (!metric.usedPercent) return null;
  const match = metric.usedPercent.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]!);
  return Number.isNaN(value) ? null : Math.min(100, Math.max(0, value));
}

export type UsageLevel = "ok" | "warn" | "danger" | "absent";

export function usageLevel(usedPercent: number | null): UsageLevel {
  if (usedPercent === null) return "absent";
  if (usedPercent >= 85) return "danger";
  if (usedPercent >= 70) return "warn";
  return "ok";
}

/** Raw progress bar string without ANSI color. */
export function progressBar(usedPercent: number | null, width = BAR_WIDTH): string {
  if (usedPercent === null) {
    return EMPTY.repeat(width);
  }
  const filled = Math.round((usedPercent / 100) * width);
  const clamped = Math.min(width, Math.max(0, filled));
  return FILLED.repeat(clamped) + EMPTY.repeat(width - clamped);
}

/** Color a bar (or any token) by usage level for CLI (picocolors). */
export function colorByLevel(text: string, level: UsageLevel): string {
  if (level === "danger") return danger(text);
  if (level === "warn") return warning(text);
  if (level === "ok") return success(text);
  return muted(text);
}

/** Ink-compatible color name for a usage level. */
export function inkColorByLevel(level: UsageLevel): "green" | "yellow" | "red" | "gray" {
  if (level === "danger") return "red";
  if (level === "warn") return "yellow";
  if (level === "ok") return "green";
  return "gray";
}

export type FormattedWindow = {
  label: string;
  usedPercent: number | null;
  level: UsageLevel;
  bar: string;
  percentLabel: string;
  detail: string | null;
  absent: boolean;
};

/** Build display model for one usage window (5h / weekly / monthly). */
export function formatUsageWindow(label: string, metric: UsageMetric): FormattedWindow {
  const usedPercent = parseUsedPercent(metric);
  const level = usageLevel(usedPercent);
  const bar = progressBar(usedPercent);
  const absent = usedPercent === null && !metric.remaining && !metric.reset;

  if (absent) {
    return {
      label,
      usedPercent: null,
      level: "absent",
      bar,
      percentLabel: "—",
      detail: null,
      absent: true,
    };
  }

  const percentLabel =
    usedPercent === null
      ? "—"
      : `${usedPercent % 1 === 0 ? usedPercent.toFixed(0) : usedPercent}%`;

  const detailParts = [metric.remaining, metric.reset].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );

  return {
    label,
    usedPercent,
    level,
    bar,
    percentLabel,
    detail: detailParts.length > 0 ? detailParts.join("  ·  ") : null,
    absent: false,
  };
}
