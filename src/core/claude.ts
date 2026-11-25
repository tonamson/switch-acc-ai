import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureProfile, linkSharedProfile, requireProfile, watchSharedProfileLinks } from "./accounts.js";
import { prepareInteractiveChild } from "./grok.js";
import type { ProviderConfig } from "./config.js";
import { logException, logInfo, logWarn, redactSecret, serializeError } from "./log.js";
import {
  ABSENT,
  emptyUsageStatus,
  metricFromPercentWindow,
  type UsageStatus,
} from "./usage.js";

type OauthBlob = { accessToken?: string; expiresAt?: number; subscriptionType?: string };
type UsageWindow = { utilization?: number; resets_at?: string };
type UsageBody = { five_hour?: UsageWindow | null; seven_day?: UsageWindow | null };

export type ClaudeStatusOptions = {
  fetchImpl?: typeof fetch;
  /** Returns the raw credentials JSON stored in the macOS Keychain for this profile. */
  readKeychain?: (profilePath: string) => Promise<string | null>;
};

// ponytail: unofficial endpoint, may change; override in tests via CLAUDE_USAGE_URL.
const usageUrl = () => process.env.CLAUDE_USAGE_URL || "https://api.anthropic.com/api/oauth/usage";

/** Claude Code suffixes the Keychain service with a hash of CLAUDE_CONFIG_DIR (verify, plan Task 6). */
export function keychainService(profilePath: string): string {
  return `Claude Code-credentials-${createHash("sha256").update(profilePath).digest("hex").slice(0, 8)}`;
}

function deleteKeychain(profilePath: string): Promise<void> {
  if (process.platform !== "darwin") return Promise.resolve();
  return new Promise((resolve) => {
    execFile("security", ["delete-generic-password", "-s", keychainService(profilePath)], () => resolve());
  });
}

/** Env vars that would make every profile run as one account regardless of CLAUDE_CONFIG_DIR. */
const AUTH_OVERRIDES = ["CLAUDE_SECURESTORAGE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"];

export function claudeEnv(profilePath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: profilePath };
  for (const key of AUTH_OVERRIDES) delete env[key];
  return env;
}

/** Call before remove/rename: Keychain items are keyed by profile path and would otherwise outlive it. */
export async function forgetClaudeLogin(
  config: ProviderConfig,
  name: string,
  del: (profilePath: string) => Promise<void> = deleteKeychain,
): Promise<void> {
  await del(await requireProfile(config, name));
}

function defaultReadKeychain(profilePath: string): Promise<string | null> {
  if (process.platform !== "darwin") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      "security",
      ["find-generic-password", "-s", keychainService(profilePath), "-w"],
      (error, stdout) => resolve(error ? null : stdout.trim() || null),
    );
  });
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readOauth(profilePath: string, readKeychain: NonNullable<ClaudeStatusOptions["readKeychain"]>): Promise<OauthBlob | null> {
  const file = await readJson<{ claudeAiOauth?: OauthBlob }>(join(profilePath, ".credentials.json"));
  if (file?.claudeAiOauth?.accessToken) return file.claudeAiOauth;
  const raw = await readKeychain(profilePath);
  if (!raw) return null;
  try {
    const blob = (JSON.parse(raw) as { claudeAiOauth?: OauthBlob }).claudeAiOauth;
    return blob?.accessToken ? blob : null;
  } catch {
    return null;
  }
}

function resetLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return `resets ${value}`;
  return `resets ${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export async function readAccountLabel(config: ProviderConfig, name: string): Promise<string> {
  const profilePath = await requireProfile(config, name);
  const cfg = await readJson<{ oauthAccount?: { emailAddress?: string } }>(join(profilePath, ".claude.json"));
  const label = cfg?.oauthAccount?.emailAddress || "Not signed in";
  logInfo("claude label", { account: name, profilePath, label });
  return label;
}

export async function readAuthStatus(
  config: ProviderConfig,
  name: string,
  options: ClaudeStatusOptions = {},
): Promise<UsageStatus> {
  const profilePath = await requireProfile(config, name);
  const fetchImpl = options.fetchImpl || fetch;
  const oauth = await readOauth(profilePath, options.readKeychain || defaultReadKeychain);
  const base = emptyUsageStatus(name, {
    user: await readAccountLabel(config, name),
    plan: oauth?.subscriptionType || "claude",
    fiveHour: { ...ABSENT },
    weekly: { ...ABSENT },
    monthly: { ...ABSENT },
  });
  if (!oauth?.accessToken) {
    base.user = "unknown";
    base.plan = "unknown";
    base.note = "not signed in";
    return base;
  }
  if (typeof oauth.expiresAt === "number" && oauth.expiresAt <= Date.now()) {
    base.note = "token expired, run claude to refresh";
    return base;
  }
  try {
    logInfo("claude usage request", { account: name, token: redactSecret(oauth.accessToken) });
    const response = await fetchImpl(usageUrl(), {
      headers: {
        Authorization: `Bearer ${oauth.accessToken}`,
        Accept: "application/json",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "sacc",
      },
    });
    if (!response.ok) throw new Error(`usage API ${response.status}`);
    const usage = (await response.json()) as UsageBody;
    if (typeof usage?.five_hour !== "object" && typeof usage?.seven_day !== "object") {
      throw new Error("unexpected usage response shape");
    }
    base.fiveHour = metricFromPercentWindow(usage.five_hour?.utilization, resetLabel(usage.five_hour?.resets_at));
    base.weekly = metricFromPercentWindow(usage.seven_day?.utilization, resetLabel(usage.seven_day?.resets_at));
  } catch (error) {
    base.note = `usage error: ${error instanceof Error ? error.message : String(error)}`;
    logWarn("claude usage failed", { account: name, error: serializeError(error) });
  }
  return base;
}

function launch(config: ProviderConfig, profilePath: string, args: string[], label: string): Promise<number> {
  const env = claudeEnv(profilePath);
  logInfo(`${label} start`, { provider: "claude", profilePath, args, CLAUDE_CONFIG_DIR: profilePath });
  const child = spawn("claude", args, { env, stdio: "inherit" });
  return new Promise((resolve, reject) => {
    child.on("error", (error: NodeJS.ErrnoException) => {
      logException(`${label} spawn error`, error, { profilePath });
      reject(
        error.code === "ENOENT"
          ? new Error("failed to launch claude: command not found. Is the Claude CLI installed and on PATH?")
          : error,
      );
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

// ponytail: mirrors grok.ts run/login; share helpers if a 4th provider arrives.
async function withSharedLinks(config: ProviderConfig, profilePath: string, fn: () => Promise<number>): Promise<number> {
  await linkSharedProfile(config, profilePath, "claude");
  const guard = watchSharedProfileLinks(config, profilePath, "claude");
  try {
    return await fn();
  } finally {
    await guard.stop();
  }
}

export async function runClaude(config: ProviderConfig, name: string, args: string[]): Promise<number> {
  const profilePath = await requireProfile(config, name);
  return withSharedLinks(config, profilePath, async () => {
    prepareInteractiveChild(`claude run ${name}`);
    return launch(config, profilePath, args, "run");
  });
}

export async function loginClaude(config: ProviderConfig, name: string, args: string[] = []): Promise<number> {
  const isNew = await requireProfile(config, name).then(() => false, () => true);
  const profilePath = await ensureProfile(config, name);
  // A new profile must not inherit a stale Keychain item from a removed/renamed profile of the same name.
  if (isNew) await deleteKeychain(profilePath);
  return withSharedLinks(config, profilePath, async () => {
    prepareInteractiveChild(`claude login ${name}`);
    if (process.stdout.isTTY) process.stdout.write(`Signing in Claude profile "${name}"…\n\n`);
    return launch(config, profilePath, ["auth", "login", ...args], "login");
  });
}
