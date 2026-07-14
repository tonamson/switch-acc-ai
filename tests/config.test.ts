import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/core/config.js";

describe("resolveConfig", () => {
  it("uses account and shared home fallback paths", () => {
    const config = resolveConfig({}, "/tmp/example-home");

    expect(config.codex.accountsDir).toBe("/tmp/example-home/.codex-accounts");
    expect(config.codex.sharedHome).toBe("/tmp/example-home/.codex");
    expect(config.grok.accountsDir).toBe("/tmp/example-home/.grok-accounts");
    expect(config.grok.sharedHome).toBe("/tmp/example-home/.grok");
  });

  it("uses environment overrides", () => {
    const config = resolveConfig(
      {
        CODEX_ACCOUNTS_DIR: "/tmp/accounts",
        CODEX_SHARED_HOME: "/tmp/shared-codex",
        GROK_ACCOUNTS_DIR: "/tmp/grok-accounts",
        GROK_SHARED_HOME: "/tmp/shared-grok",
      },
      "/tmp/example-home",
    );

    expect(config.codex.accountsDir).toBe("/tmp/accounts");
    expect(config.codex.sharedHome).toBe("/tmp/shared-codex");
    expect(config.grok.accountsDir).toBe("/tmp/grok-accounts");
    expect(config.grok.sharedHome).toBe("/tmp/shared-grok");
  });
});
