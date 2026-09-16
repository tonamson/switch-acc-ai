import { homedir } from "node:os";
import { join } from "node:path";

export type ProviderId = "codex" | "grok" | "antigravity";

export type ProviderConfig = {
  accountsDir: string;
  sharedHome: string;
};

export type AppConfig = {
  codex: ProviderConfig;
  grok: ProviderConfig;
  antigravity: ProviderConfig;
};

/**
 * Paths under sharedHome that every profile should symlink to.
 * Auth stays private (auth.json, etc.); these are install/config/session assets.
 *
 * Grok layout uses `installed-plugins` (not Codex's `plugins`).
 *
 * Sessions (provider repairs differ — do not share one fix path):
 * - Codex + Grok share `sessions/` under the global home.
 * - Codex: private `state_5.sqlite` index + absolute paths → `repairCodexResumeIndex`.
 * - Grok: FS layout `sessions/<cwd>/<id>/` only → `repairGrokSessions` (nested
 *   merge private trees + force symlink; no SQLite).
 * - Antigravity (`agy`): no env var to redirect its config dir — it always reads
 *   `$HOME/.gemini/antigravity-cli`, so isolation works by spawning with a
 *   per-profile `HOME` override (see EFFECTIVE_HOME_SUBDIR). Auth itself lives in
 *   the OS keyring, not a file under that dir, so per-profile auth isolation is
 *   best-effort only — session/conversation state is intentionally NOT shared
 *   (unverified whether its sqlite/proto state tolerates the same symlink tricks
 *   as Codex's state_5.sqlite).
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
    "rules",
    "AGENTS.md",
    "RTK.md",
    "trusted_folders.toml",
  ],
  antigravity: ["plugins", "AGENTS.md"],
};

/** Directory shared assets — create empty on shared home when missing so installs land in global. */
export const SHARED_DIR_ASSETS: ReadonlySet<string> = new Set([
  "skills",
  "plugins",
  "sessions",
  "agents",
  "rules",
  "installed-plugins",
  "marketplace-cache",
]);

/**
 * Path (relative to a profile dir) where the provider's own config actually lands.
 * Codex/Grok are told their home directly via CODEX_HOME/GROK_HOME, so the profile
 * dir IS that home. Antigravity has no such env var — it derives its config dir
 * from the process `HOME`, nested under `.gemini/antigravity-cli`.
 */
export const EFFECTIVE_HOME_SUBDIR: Record<ProviderId, string> = {
  codex: "",
  grok: "",
  antigravity: join(".gemini", "antigravity-cli"),
};

export function isProviderId(value: string): value is ProviderId {
  return value === "codex" || value === "grok" || value === "antigravity";
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
    antigravity: {
      accountsDir: env.ANTIGRAVITY_ACCOUNTS_DIR || join(homeDir, ".antigravity-accounts"),
      sharedHome:
        env.ANTIGRAVITY_SHARED_HOME || join(homeDir, ".gemini", "antigravity-cli"),
    },
  };
}
