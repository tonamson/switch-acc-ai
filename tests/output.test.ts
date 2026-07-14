import { afterEach, describe, expect, it, vi } from "vitest";
import { formatAccountsTable, formatError, formatHelp, formatStatus } from "../src/ui/output.js";
import { ABSENT } from "../src/core/usage.js";

afterEach(() => {
  delete process.env.NO_COLOR;
  vi.resetModules();
});

describe("output formatting", () => {
  it("formats help with sacc command sections", () => {
    const output = formatHelp();

    expect(output).toContain("Run");
    expect(output).toContain("sacc pick [args]");
    expect(output).toContain("sacc grok login <name>");
    expect(output).toContain("Accounts");
    expect(output).toContain("Status");
  });

  it("formats account table", () => {
    const output = formatAccountsTable([
      { profile: "acc1", identity: "acc1@example.com" },
      { profile: "acc2", identity: "acc2@example.com" },
    ]);

    expect(output).toContain("codex accounts");
    expect(output).toContain("acc1");
    expect(output).toContain("acc2@example.com");
    expect(output).not.toContain("*");
    expect(output).not.toMatch(/[┌┐└┘│─├┤┬┴┼]/);
  });

  it("formats unified codex status with dashes for missing windows", () => {
    const output = formatStatus([
      {
        account: "acc2",
        user: "acc2@example.com",
        plan: "plus",
        fiveHour: {
          usedPercent: "75% used",
          remaining: "25% left",
          reset: "resets later",
        },
        weekly: {
          usedPercent: "90% used",
          remaining: "10% left",
          reset: "resets later",
        },
        monthly: { ...ABSENT },
        credits: "1",
      },
      { account: "broken", error: "no response from codex app-server" },
    ]);

    expect(output).toContain("codex status");
    expect(output).toContain("acc2");
    expect(output).toContain("75% used");
    expect(output).toContain("25% left");
    expect(output).toContain("90% used");
    // monthly absent → "-"
    expect(output).toMatch(/monthly\s+-/);
    expect(output).toContain("broken");
    expect(output).toContain("no response from codex app-server");
  });

  it("formats unified grok status with dashes for 5h/weekly", () => {
    const output = formatStatus(
      [
        {
          account: "work",
          user: "work@example.com",
          plan: "oidc",
          fiveHour: { ...ABSENT },
          weekly: { ...ABSENT },
          monthly: {
            usedPercent: "3.1% used",
            remaining: "14529 left (471/15000)",
            reset: "resets 2026-08-01 UTC",
          },
          credits: "14529",
        },
      ],
      "grok",
    );

    expect(output).toContain("grok status");
    expect(output).toContain("work@example.com");
    expect(output).toMatch(/5h\s+-/);
    expect(output).toMatch(/weekly\s+-/);
    expect(output).toContain("3.1% used");
    expect(output).toContain("14529 left (471/15000)");
    expect(output).toContain("resets 2026-08-01 UTC");
  });

  it("formats actionable errors", () => {
    const output = formatError("account not found: acc3", "Run sacc list to see profiles.");

    expect(output).toContain("error");
    expect(output).toContain("account not found: acc3");
    expect(output).toContain("Run sacc list to see profiles.");
  });

  it("disables color when NO_COLOR is present even if empty", async () => {
    process.env.NO_COLOR = "";
    const { danger } = await import("../src/ui/theme.js");
    expect(danger("x")).toBe("x");
  });
});
