import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const binPath = join(repoRoot, "dist", "bin", "swa.js");

describe("swa binary", () => {
  it("builds the executable binary", () => {
    expect(existsSync(binPath)).toBe(true);
  });

  it("prints help with the package command name", () => {
    const output = execFileSync(process.execPath, [binPath, "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });

    expect(output).toContain("Usage:");
    expect(output).toContain("swa");
    expect(output).toContain("Codex account switcher");
  });
});
