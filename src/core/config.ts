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

export const SHARED_ASSETS: Record<ProviderId, readonly string[]> = {
  codex: ["skills", "plugins", "sessions", "config.toml"],
  grok: ["skills", "plugins", "agents", "sessions", "config.toml"],
};

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
