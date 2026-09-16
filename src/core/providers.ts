import { loginAntigravity, readAccountLabel as readAntigravityLabel, readUsageStatus as readAntigravityStatus, runAntigravity } from "./antigravity.js";
import { loginCodex, readAccountLabel as readCodexLabel, readRateLimits, runCodex } from "./codex.js";
import type { ProviderConfig, ProviderId } from "./config.js";
import { loginGrok, readAccountLabel as readGrokLabel, readAuthStatus, runGrok } from "./grok.js";
import type { UsageStatus } from "./usage.js";

/** Single dispatch point so adding a provider means editing one switch, not every caller. */
export async function runProviderCli(
  provider: ProviderId,
  config: ProviderConfig,
  name: string,
  args: string[],
): Promise<number> {
  switch (provider) {
    case "codex":
      return runCodex(config, name, args);
    case "grok":
      return runGrok(config, name, args);
    case "antigravity":
      return runAntigravity(config, name, args);
  }
}

export async function loginProviderCli(
  provider: ProviderId,
  config: ProviderConfig,
  name: string,
  loginArgs: string[] = [],
): Promise<number> {
  switch (provider) {
    case "codex":
      return loginCodex(config, name);
    case "grok":
      return loginGrok(config, name, loginArgs);
    case "antigravity":
      return loginAntigravity(config, name);
  }
}

export async function readProviderLabel(
  provider: ProviderId,
  config: ProviderConfig,
  name: string,
): Promise<string> {
  switch (provider) {
    case "codex":
      return readCodexLabel(config, name);
    case "grok":
      return readGrokLabel(config, name);
    case "antigravity":
      return readAntigravityLabel(config, name);
  }
}

export async function readProviderStatus(
  provider: ProviderId,
  config: ProviderConfig,
  name: string,
): Promise<UsageStatus> {
  switch (provider) {
    case "codex":
      return readRateLimits(config, name);
    case "grok":
      return readAuthStatus(config, name);
    case "antigravity":
      return readAntigravityStatus(config, name);
  }
}
