import { homedir } from "node:os";
import { join } from "node:path";

export type AppConfig = {
  accountsDir: string;
  sharedHome: string;
};

export function resolveConfig(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir(),
): AppConfig {
  const accountsDir = env.CODEX_ACCOUNTS_DIR || join(homeDir, ".codex-accounts");
  const sharedHome = env.CODEX_SHARED_HOME || join(homeDir, ".codex");

  return {
    accountsDir,
    sharedHome,
  };
}
