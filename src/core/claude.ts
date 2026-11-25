import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { requireProfile } from "./accounts.js";
import type { ProviderConfig } from "./config.js";
import { logInfo, logWarn, redactSecret, serializeError } from "./log.js";
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
    base.fiveHour = metricFromPercentWindow(usage.five_hour?.utilization, resetLabel(usage.five_hour?.resets_at));
    base.weekly = metricFromPercentWindow(usage.seven_day?.utilization, resetLabel(usage.seven_day?.resets_at));
  } catch (error) {
    base.note = `usage error: ${error instanceof Error ? error.message : String(error)}`;
    logWarn("claude usage failed", { account: name, error: serializeError(error) });
  }
  return base;
}
