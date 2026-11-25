import { loginClaude, readAccountLabel as claudeLabel, readAuthStatus as claudeUsage, runClaude } from "./claude.js";
import { loginCodex, readAccountLabel as codexLabel, readRateLimits, runCodex } from "./codex.js";
import type { ProviderConfig, ProviderId } from "./config.js";
import { loginGrok, readAccountLabel as grokLabel, readAuthStatus as grokUsage, runGrok } from "./grok.js";
import type { UsageStatus } from "./usage.js";

export type ProviderApi = {
  label: string;
  run(config: ProviderConfig, name: string, args: string[]): Promise<number>;
  login(config: ProviderConfig, name: string, args?: string[]): Promise<number>;
  readLabel(config: ProviderConfig, name: string): Promise<string>;
  readUsage(config: ProviderConfig, name: string): Promise<UsageStatus>;
};

export const providers: Record<ProviderId, ProviderApi> = {
  codex: {
    label: "Codex",
    run: runCodex,
    login: (c, n) => loginCodex(c, n),
    readLabel: codexLabel,
    readUsage: readRateLimits,
  },
  grok: {
    label: "Grok",
    run: runGrok,
    login: loginGrok,
    readLabel: grokLabel,
    readUsage: (c, n) => grokUsage(c, n),
  },
  claude: {
    label: "Claude",
    run: runClaude,
    login: loginClaude,
    readLabel: claudeLabel,
    readUsage: (c, n) => claudeUsage(c, n),
  },
};
