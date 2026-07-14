import { describe, expect, it } from "vitest";
import {
  ABSENT,
  formatMetric,
  metricFromAbsoluteQuota,
  metricFromPercentWindow,
} from "../src/core/usage.js";

describe("usage metrics", () => {
  it("formats absent metric as dash", () => {
    expect(formatMetric(ABSENT)).toBe("-");
  });

  it("formats partial metric with dashes for missing parts", () => {
    expect(
      formatMetric({
        usedPercent: "25% used",
        remaining: null,
        reset: "resets soon",
      }),
    ).toBe("25% used  ·  -  ·  resets soon");
  });

  it("builds percent windows with remaining left", () => {
    expect(metricFromPercentWindow(25, "resets later")).toEqual({
      usedPercent: "25% used",
      remaining: "75% left",
      reset: "resets later",
    });
  });

  it("builds absolute monthly quotas", () => {
    expect(metricFromAbsoluteQuota(471, 15000, "resets 2026-08-01 UTC")).toEqual({
      usedPercent: "3.1% used",
      remaining: "14529 left (471/15000)",
      reset: "resets 2026-08-01 UTC",
    });
  });

  it("returns absent when absolute numbers missing", () => {
    expect(metricFromAbsoluteQuota(undefined, 15000, undefined)).toEqual(ABSENT);
  });
});
