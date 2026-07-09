import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/core/config.js";

describe("resolveConfig", () => {
  it("uses default account and shared home paths", () => {
    const config = resolveConfig({}, "/tmp/example-home");

    expect(config.accountsDir).toBe("/tmp/example-home/.codex-accounts");
    expect(config.currentFile).toBe("/tmp/example-home/.codex-accounts/.current");
    expect(config.sharedHome).toBe("/tmp/example-home/.codex");
  });

  it("uses environment overrides", () => {
    const config = resolveConfig(
      {
        CODEX_ACCOUNTS_DIR: "/tmp/accounts",
        CODEX_SHARED_HOME: "/tmp/shared-codex",
      },
      "/tmp/example-home",
    );

    expect(config.accountsDir).toBe("/tmp/accounts");
    expect(config.currentFile).toBe("/tmp/accounts/.current");
    expect(config.sharedHome).toBe("/tmp/shared-codex");
  });
});
