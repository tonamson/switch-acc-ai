import { homedir } from "node:os";
import { join } from "node:path";

export type ProviderId = "codex" | "grok";

export type ProviderConfig = {
  accountsDir: string;
  sharedHome: string;
};

export type AppConfig = {
  codex: ProviderConfig;
  grok: ProviderConfig;
};

/**
 * Paths under sharedHome that every profile should symlink to.
 * Auth stays private (auth.json, etc.); these are install/config/session assets.
 *
 * Grok layout uses `installed-plugins` (not Codex's `plugins`).
 */
export const SHARED_ASSETS: Record<ProviderId, readonly string[]> = {
  codex: ["skills", "plugins", "sessions", "config.toml"],
  grok: [
    "config.toml",
    "skills",
    "sessions",
    "installed-plugins",
    "marketplace-cache",
    "plugins",
    "agents",
    "AGENTS.md",
    "RTK.md",
    "trusted_folders.toml",
  ],
};

/** Directory shared assets — create empty on shared home when missing so installs land in global. */
export const SHARED_DIR_ASSETS: ReadonlySet<string> = new Set([
  "skills",
  "plugins",
  "sessions",
  "agents",
  "installed-plugins",
  "marketplace-cache",
]);

export function isProviderId(value: string): value is ProviderId {
  return value === "codex" || value === "grok";
}

export function getProvider(config: AppConfig, id: ProviderId): ProviderConfig {
  return config[id];
}

export function resolveConfig(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir(),
): AppConfig {
  return {
    codex: {
      accountsDir: env.CODEX_ACCOUNTS_DIR || join(homeDir, ".codex-accounts"),
      sharedHome: env.CODEX_SHARED_HOME || join(homeDir, ".codex"),
    },
    grok: {
      accountsDir: env.GROK_ACCOUNTS_DIR || join(homeDir, ".grok-accounts"),
      sharedHome: env.GROK_SHARED_HOME || join(homeDir, ".grok"),
    },
  };
}
