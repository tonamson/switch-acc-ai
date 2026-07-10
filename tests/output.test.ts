import { afterEach, describe, expect, it, vi } from "vitest";
import { formatAccountsTable, formatError, formatHelp, formatStatus } from "../src/ui/output.js";

afterEach(() => {
  delete process.env.NO_COLOR;
  vi.resetModules();
});

describe("output formatting", () => {
  it("formats help with sacc command sections", () => {
    const output = formatHelp();

    expect(output).toContain("Run");
    expect(output).toContain("sacc pick [codex args]");
    expect(output).toContain("Accounts");
    expect(output).toContain("Status");
  });

  it("formats account table", () => {
    const output = formatAccountsTable([
      { profile: "acc1", identity: "acc1@example.com" },
      { profile: "acc2", identity: "acc2@example.com" },
    ]);

    expect(output).toContain("Accounts");
    expect(output).toContain("acc1");
    expect(output).toContain("acc2@example.com");
    expect(output).not.toContain("*");
    expect(output).not.toMatch(/[┌┐└┘│─├┤┬┴┼]/);
  });

  it("formats status rows and account errors", () => {
    const output = formatStatus([
      {
        account: "acc2",
        user: "acc2@example.com",
        plan: "plus",
        primary: { usedPercent: "75% used", resetLabel: "resets later" },
        secondary: { usedPercent: "90% used", resetLabel: "resets later" },
        resetCredits: "1",
      },
      { account: "broken", error: "no response from codex app-server" },
    ]);

    expect(output).toContain("Status");
    expect(output).toContain("acc2");
    expect(output).toContain("75% used");
    expect(output).toContain("broken");
    expect(output).toContain("no response from codex app-server");
  });

  it("formats actionable errors", () => {
    const output = formatError("account not found: acc3", "Run sacc list to see profiles.");

    expect(output).toContain("error");
    expect(output).toContain("account not found: acc3");
    expect(output).toContain("Run sacc list to see profiles.");
  });

  it("disables color when NO_COLOR is present even if empty", async () => {
    process.env.NO_COLOR = "";
    vi.resetModules();

    const theme = await import("../src/ui/theme.js");

    expect(theme.enabled).toBe(false);
    expect(theme.brand("Switch Account AI")).toBe("Switch Account AI");
  });
});
