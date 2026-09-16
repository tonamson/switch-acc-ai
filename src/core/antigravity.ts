import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import {
  ensureProfile,
  linkSharedProfile,
  requireProfile,
  watchSharedProfileLinks,
} from "./accounts.js";
import { EFFECTIVE_HOME_SUBDIR, type ProviderConfig } from "./config.js";
import {
  logDebug,
  logException,
  logInfo,
  logWarn,
  runtimeSnapshot,
  serializeError,
  startTimer,
} from "./log.js";
import { ABSENT, emptyUsageStatus, type UsageStatus } from "./usage.js";

/**
 * agy has no env var to redirect its config dir — it always resolves
 * `$HOME/.gemini/antigravity-cli`. Isolation works by spawning with `HOME`
 * pointed at the profile dir; see EFFECTIVE_HOME_SUBDIR in config.ts.
 */
function antigravityEnv(profilePath: string): NodeJS.ProcessEnv {
  return { ...process.env, HOME: profilePath };
}

function antigravityHomeDir(profilePath: string): string {
  return join(profilePath, EFFECTIVE_HOME_SUBDIR.antigravity);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function waitForExitDetailed(
  child: ReturnType<typeof spawn>,
  label: string,
  context: Record<string, unknown>,
): Promise<number> {
  const timer = startTimer();
  return new Promise((resolve, reject) => {
    child.on("error", (error: NodeJS.ErrnoException) => {
      logException(`${label} spawn error`, error, {
        ...context,
        elapsedMs: timer.elapsedMs(),
        pid: child.pid ?? null,
      });
      if (error.code === "ENOENT") {
        reject(
          new Error(
            "failed to launch antigravity: command not found. Is the Antigravity CLI (agy) installed and on PATH?",
          ),
        );
        return;
      }
      reject(error);
    });
    child.on("close", (code, signal) => {
      const exitCode = code ?? 1;
      const payload = {
        ...context,
        code: exitCode,
        signal: signal ?? null,
        pid: child.pid ?? null,
        elapsedMs: timer.elapsedMs(),
      };
      if (exitCode === 0 && !signal) {
        logInfo(`${label} exit`, payload);
      } else {
        logWarn(`${label} exit`, payload);
      }
      resolve(exitCode);
    });
  });
}

/**
 * Hand terminal control from an Ink/TUI parent to an interactive child CLI.
 * Drain buffered keypresses so the child does not consume leftover Enter.
 */
function prepareInteractiveChild(reason: string): void {
  const before = runtimeSnapshot();
  let drainedBytes = 0;
  let rawModeError: unknown = null;
  let drainError: unknown = null;

  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    try {
      process.stdin.setRawMode(false);
    } catch (error) {
      rawModeError = error;
    }
  }
  if (process.stdin.isTTY) {
    try {
      process.stdin.resume();
      let chunk: string | Buffer | null;
      while ((chunk = process.stdin.read()) !== null) {
        drainedBytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      }
    } catch (error) {
      drainError = error;
    }
    process.stdin.pause();
  }
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?1049l\x1b[?25h\x1b[0m\x1b[2J\x1b[H");
  }

  logDebug("prepare interactive child", {
    reason,
    drainedBytes,
    rawModeError: rawModeError ? serializeError(rawModeError) : null,
    drainError: drainError ? serializeError(drainError) : null,
    before,
    after: runtimeSnapshot(),
  });
}

/**
 * agy stores auth in the OS keyring, not a file under its config dir, so we
 * cannot read back an email/identity the way Codex/Grok do. Use profile
 * initialization as a weak signal instead.
 */
export async function readAccountLabel(config: ProviderConfig, name: string): Promise<string> {
  const profilePath = await requireProfile(config, name);
  const settingsPath = join(antigravityHomeDir(profilePath), "settings.json");
  const initialized = await pathExists(settingsPath);
  const label = initialized ? "Signed in (identity hidden by OS keyring)" : "Not signed in";
  logInfo("antigravity label", { account: name, profilePath, settingsPath, initialized, label });
  return label;
}

/**
 * agy exposes no usage/rate-limit API or file — usage lives behind the
 * interactive `/usage` slash command. Report an honest "not available" status
 * instead of guessing.
 */
export async function readUsageStatus(config: ProviderConfig, name: string): Promise<UsageStatus> {
  const profilePath = await requireProfile(config, name);
  logInfo("antigravity status", { account: name, profilePath });
  return emptyUsageStatus(name, {
    user: "unknown",
    plan: "unknown",
    fiveHour: { ...ABSENT },
    weekly: { ...ABSENT },
    monthly: { ...ABSENT },
    credits: null,
    note: "usage not exposed by the CLI; run sacc antigravity <name> then /usage",
  });
}

async function spawnAgy(
  config: ProviderConfig,
  name: string,
  args: string[],
  label: "run" | "login",
): Promise<number> {
  const profilePath = label === "login" ? await ensureProfile(config, name) : await requireProfile(config, name);
  await linkSharedProfile(config, profilePath, "antigravity");
  // agy atomic-writes settings.json; keep repairing our symlinks while it runs.
  const linkGuard = watchSharedProfileLinks(config, profilePath, "antigravity");
  prepareInteractiveChild(`antigravity ${label} ${name}`);
  const env = antigravityEnv(profilePath);
  const command = ["agy", ...args];
  logInfo(`${label} start`, {
    provider: "antigravity",
    account: name,
    args,
    command,
    profilePath,
    accountsDir: config.accountsDir,
    sharedHome: config.sharedHome,
    env: { HOME: env.HOME },
    runtime: runtimeSnapshot(env),
  });
  if (label === "login" && process.stdout.isTTY) {
    process.stdout.write(`Signing in Antigravity profile "${name}"…\n\n`);
  }
  const child = spawn("agy", args, {
    env,
    stdio: "inherit",
  });
  try {
    return await waitForExitDetailed(child, label, {
      provider: "antigravity",
      account: name,
      args,
      command,
      profilePath,
    });
  } catch (error) {
    logException(`${label} failed`, error, {
      provider: "antigravity",
      account: name,
      args,
      command,
      profilePath,
    });
    throw error;
  } finally {
    await linkGuard.stop();
  }
}

export async function runAntigravity(
  config: ProviderConfig,
  name: string,
  args: string[],
): Promise<number> {
  return spawnAgy(config, name, args, "run");
}

/** agy has no `login` subcommand — launching it bare (no args) triggers its own sign-in flow. */
export async function loginAntigravity(config: ProviderConfig, name: string): Promise<number> {
  return spawnAgy(config, name, [], "login");
}
