import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/core/config.js";

describe("resolveConfig", () => {
  it("uses account and shared home fallback paths", () => {
    const config = resolveConfig({}, "/tmp/example-home");

    expect(config.codex.accountsDir).toBe("/tmp/example-home/.codex-accounts");
    expect(config.codex.sharedHome).toBe("/tmp/example-home/.codex");
    expect(config.grok.accountsDir).toBe("/tmp/example-home/.grok-accounts");
    expect(config.grok.sharedHome).toBe("/tmp/example-home/.grok");
    expect(config.antigravity.accountsDir).toBe("/tmp/example-home/.antigravity-accounts");
    expect(config.antigravity.sharedHome).toBe(
      "/tmp/example-home/.gemini/antigravity-cli",
    );
  });

  it("uses environment overrides", () => {
    const config = resolveConfig(
      {
        CODEX_ACCOUNTS_DIR: "/tmp/accounts",
        CODEX_SHARED_HOME: "/tmp/shared-codex",
        GROK_ACCOUNTS_DIR: "/tmp/grok-accounts",
        GROK_SHARED_HOME: "/tmp/shared-grok",
        ANTIGRAVITY_ACCOUNTS_DIR: "/tmp/antigravity-accounts",
        ANTIGRAVITY_SHARED_HOME: "/tmp/shared-antigravity",
      },
      "/tmp/example-home",
    );

    expect(config.codex.accountsDir).toBe("/tmp/accounts");
    expect(config.codex.sharedHome).toBe("/tmp/shared-codex");
    expect(config.grok.accountsDir).toBe("/tmp/grok-accounts");
    expect(config.grok.sharedHome).toBe("/tmp/shared-grok");
    expect(config.antigravity.accountsDir).toBe("/tmp/antigravity-accounts");
    expect(config.antigravity.sharedHome).toBe("/tmp/shared-antigravity");
  });
});
