import { describe, expect, it } from "vitest";
import { ABSENT } from "../src/core/usage.js";
import {
  formatUsageWindow,
  parseUsedPercent,
  progressBar,
  usageLevel,
} from "../src/ui/usage-display.js";

describe("usage-display", () => {
  it("parses used percent from metric strings", () => {
    expect(parseUsedPercent({ usedPercent: "75% used", remaining: null, reset: null })).toBe(75);
    expect(parseUsedPercent({ usedPercent: "3.1% used", remaining: null, reset: null })).toBe(3.1);
    expect(parseUsedPercent(ABSENT)).toBeNull();
  });

  it("maps thresholds to levels", () => {
    expect(usageLevel(null)).toBe("absent");
    expect(usageLevel(10)).toBe("ok");
    expect(usageLevel(70)).toBe("warn");
    expect(usageLevel(85)).toBe("danger");
  });

  it("builds progress bars", () => {
    expect(progressBar(null, 10)).toBe("░░░░░░░░░░");
    expect(progressBar(50, 10)).toBe("█████░░░░░");
    expect(progressBar(100, 10)).toBe("██████████");
  });

  it("formats absent and present windows", () => {
    const absent = formatUsageWindow("5h", ABSENT);
    expect(absent.absent).toBe(true);
    expect(absent.percentLabel).toBe("—");

    const present = formatUsageWindow("weekly", {
      usedPercent: "90% used",
      remaining: "10% left",
      reset: "resets later",
    });
    expect(present.absent).toBe(false);
    expect(present.percentLabel).toBe("90%");
    expect(present.level).toBe("danger");
    expect(present.detail).toContain("10% left");
    expect(present.detail).toContain("resets later");
  });
});
