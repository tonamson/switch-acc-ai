import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureProfile, linkSharedProfile, requireProfile } from "./accounts.js";
import type { ProviderConfig } from "./config.js";
import {
  ABSENT,
  emptyUsageStatus,
  metricFromAbsoluteQuota,
  type UsageStatus,
} from "./usage.js";

/** @deprecated Use UsageStatus from core/usage.js */
export type GrokAuthStatus = UsageStatus;

type AuthEntry = {
  key?: string;
  email?: string;
  user_id?: string;
  team_id?: string;
  auth_mode?: string;
  expires_at?: string;
  first_name?: string;
  last_name?: string;
  principal_type?: string;
};

type BillingVal = { val?: number };
type BillingConfig = {
  monthlyLimit?: BillingVal;
  used?: BillingVal;
  onDemandCap?: BillingVal;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
};
type BillingResponse = {
  config?: BillingConfig;
};

export type FetchLike = typeof fetch;

function grokEnv(profilePath: string): NodeJS.ProcessEnv {
  return { ...process.env, GROK_HOME: profilePath };
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error("failed to launch grok: command not found. Is the Grok CLI installed and on PATH?"));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function restoreTerminal(): void {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?1049l\x1b[?25h\x1b[0m");
  }
}

async function readAuthFile(profilePath: string): Promise<AuthEntry | null> {
  try {
    const raw = await readFile(join(profilePath, "auth.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const value of Object.values(parsed)) {
      if (typeof value === "object" && value !== null) {
        return value as AuthEntry;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function identityFromAuth(auth: AuthEntry | null, fallback: string): string {
  if (!auth) return fallback;
  if (auth.email) return auth.email;
  const fullName = [auth.first_name, auth.last_name].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  if (auth.user_id) return auth.user_id;
  return fallback;
}

function formatPeriodEnd(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `resets ${value}`;
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `resets ${year}-${month}-${day} UTC`;
}

function billingBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.GROK_CLI_CHAT_PROXY_BASE_URL || "https://cli-chat-proxy.grok.com/v1";
  return base.replace(/\/$/, "");
}

function numberVal(value: BillingVal | undefined): number | undefined {
  return typeof value?.val === "number" ? value.val : undefined;
}

export async function fetchBillingUsage(
  accessToken: string,
  options: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<{
  used?: number;
  monthlyLimit?: number;
  remaining?: number;
  onDemandCap?: number;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
}> {
  const fetchImpl = options.fetchImpl || fetch;
  const url = `${billingBaseUrl(options.env)}/billing`;
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "sacc",
    },
  });

  if (!response.ok) {
    throw new Error(`billing API ${response.status}`);
  }

  const body = (await response.json()) as BillingResponse;
  const config = body.config || {};
  const used = numberVal(config.used);
  const monthlyLimit = numberVal(config.monthlyLimit);
  const onDemandCap = numberVal(config.onDemandCap);

  return {
    used,
    monthlyLimit,
    remaining:
      typeof used === "number" && typeof monthlyLimit === "number"
        ? Math.max(0, monthlyLimit - used)
        : undefined,
    onDemandCap,
    billingPeriodStart: config.billingPeriodStart,
    billingPeriodEnd: config.billingPeriodEnd,
  };
}

export async function readAccountLabel(config: ProviderConfig, name: string): Promise<string> {
  const profilePath = await requireProfile(config, name);
  const auth = await readAuthFile(profilePath);
  if (!auth) {
    return "Not signed in";
  }
  return identityFromAuth(auth, name);
}

export async function readAuthStatus(
  config: ProviderConfig,
  name: string,
  options: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<UsageStatus> {
  const profilePath = await requireProfile(config, name);
  const auth = await readAuthFile(profilePath);
  if (!auth) {
    return emptyUsageStatus(name, {
      user: "unknown",
      plan: "unknown",
      fiveHour: { ...ABSENT },
      weekly: { ...ABSENT },
      monthly: { ...ABSENT },
      credits: null,
      note: "not signed in",
    });
  }

  const base = emptyUsageStatus(name, {
    user: identityFromAuth(auth, name),
    plan: auth.auth_mode || auth.principal_type || "grok",
    // Grok has no 5h / weekly windows
    fiveHour: { ...ABSENT },
    weekly: { ...ABSENT },
    monthly: { ...ABSENT },
    credits: null,
  });

  if (!auth.key) {
    base.note = "missing access token";
    return base;
  }

  try {
    const billing = await fetchBillingUsage(auth.key, options);
    base.monthly = metricFromAbsoluteQuota(
      billing.used,
      billing.monthlyLimit,
      formatPeriodEnd(billing.billingPeriodEnd),
    );
    if (typeof billing.remaining === "number") {
      base.credits = String(billing.remaining);
    }
    if (typeof billing.onDemandCap === "number" && billing.onDemandCap > 0) {
      base.note = `on-demand cap ${billing.onDemandCap}`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    base.note = `usage error: ${message}`;
  }

  return base;
}

export async function runGrok(config: ProviderConfig, name: string, args: string[]): Promise<number> {
  const profilePath = await requireProfile(config, name);
  await linkSharedProfile(config, profilePath, "grok");
  restoreTerminal();
  const child = spawn("grok", args, {
    env: grokEnv(profilePath),
    stdio: "inherit",
  });
  return waitForExit(child);
}

export async function loginGrok(config: ProviderConfig, name: string, args: string[] = []): Promise<number> {
  const profilePath = await ensureProfile(config, name);
  await linkSharedProfile(config, profilePath, "grok");
  restoreTerminal();
  const child = spawn("grok", ["login", ...args], {
    env: grokEnv(profilePath),
    stdio: "inherit",
  });
  return waitForExit(child);
}
