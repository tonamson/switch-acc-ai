import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureProfile, linkSharedProfile, requireProfile } from "./accounts.js";
import type { ProviderConfig } from "./config.js";
import {
  ABSENT,
  emptyUsageStatus,
  metricFromAbsoluteQuota,
  metricFromPercentWindow,
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
type BillingPeriod = {
  type?: string;
  start?: string;
  end?: string;
};
type ProductUsage = {
  product?: string;
  usagePercent?: number;
};
/** Absolute monthly quota shape from GET /billing (default). */
type AbsoluteBillingConfig = {
  monthlyLimit?: BillingVal;
  used?: BillingVal;
  onDemandCap?: BillingVal;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
};
/**
 * Rate-limit style credits shape from GET /billing?format=credits.
 * This is what Grok CLI / web use for the % bar (often a weekly window).
 */
type CreditsBillingConfig = {
  creditUsagePercent?: number;
  currentPeriod?: BillingPeriod;
  onDemandCap?: BillingVal;
  onDemandUsed?: BillingVal;
  prepaidBalance?: BillingVal;
  productUsage?: ProductUsage[];
  isUnifiedBillingUser?: boolean;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
};
type BillingResponse = {
  config?: AbsoluteBillingConfig & CreditsBillingConfig;
};

export type FetchLike = typeof fetch;

export type GrokBillingUsage = {
  /** Weekly (or current-period) usage % — matches web / Grok CLI format=credits */
  creditUsagePercent?: number;
  creditPeriodEnd?: string;
  productUsage?: ProductUsage[];
  /** Absolute monthly credits from default /billing */
  used?: number;
  monthlyLimit?: number;
  remaining?: number;
  onDemandCap?: number;
  onDemandUsed?: number;
  prepaidBalance?: number;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
};

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

function billingHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": "sacc",
  };
}

async function fetchBillingJson(
  accessToken: string,
  pathWithQuery: string,
  options: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<BillingResponse> {
  const fetchImpl = options.fetchImpl || fetch;
  const url = `${billingBaseUrl(options.env)}${pathWithQuery}`;
  const response = await fetchImpl(url, {
    headers: billingHeaders(accessToken),
  });
  if (!response.ok) {
    throw new Error(`billing API ${response.status}`);
  }
  return (await response.json()) as BillingResponse;
}

function periodEndFromCredits(config: CreditsBillingConfig): string | undefined {
  return config.currentPeriod?.end || config.billingPeriodEnd;
}

/**
 * Prefer product-specific GrokBuild % when present; else top-level creditUsagePercent.
 * Web / Grok CLI show this value (not absolute used/monthlyLimit from default /billing).
 */
function creditUsagePercentFrom(config: CreditsBillingConfig): number | undefined {
  const products = config.productUsage;
  if (Array.isArray(products)) {
    const grokBuild = products.find(
      (item) => typeof item.product === "string" && item.product.toLowerCase() === "grokbuild",
    );
    if (typeof grokBuild?.usagePercent === "number") {
      return grokBuild.usagePercent;
    }
    const first = products.find((item) => typeof item.usagePercent === "number");
    if (typeof first?.usagePercent === "number") {
      return first.usagePercent;
    }
  }
  return typeof config.creditUsagePercent === "number" ? config.creditUsagePercent : undefined;
}

/**
 * Fetch Grok billing.
 *
 * Two shapes exist on the same host:
 * - GET /billing?format=credits → weekly rate-limit % (matches web / Grok CLI)
 * - GET /billing → absolute monthly credits (used / monthlyLimit)
 *
 * We merge both so weekly matches the web bar and monthly still shows absolute quota.
 */
export async function fetchBillingUsage(
  accessToken: string,
  options: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<GrokBillingUsage> {
  // Credits format first — this is the % users see on web / in Grok CLI.
  const creditsBody = await fetchBillingJson(accessToken, "/billing?format=credits", options);
  const creditsConfig = creditsBody.config || {};

  let absoluteConfig: AbsoluteBillingConfig = {};
  try {
    const absoluteBody = await fetchBillingJson(accessToken, "/billing", options);
    absoluteConfig = absoluteBody.config || {};
  } catch {
    // Absolute monthly is secondary; keep weekly % if this leg fails.
  }

  const used = numberVal(absoluteConfig.used);
  const monthlyLimit = numberVal(absoluteConfig.monthlyLimit);
  const onDemandCap =
    numberVal(creditsConfig.onDemandCap) ?? numberVal(absoluteConfig.onDemandCap);
  const onDemandUsed = numberVal(creditsConfig.onDemandUsed);
  const prepaidBalance = numberVal(creditsConfig.prepaidBalance);

  return {
    creditUsagePercent: creditUsagePercentFrom(creditsConfig),
    creditPeriodEnd: periodEndFromCredits(creditsConfig),
    productUsage: creditsConfig.productUsage,
    used,
    monthlyLimit,
    remaining:
      typeof used === "number" && typeof monthlyLimit === "number"
        ? Math.max(0, monthlyLimit - used)
        : undefined,
    onDemandCap,
    onDemandUsed,
    prepaidBalance,
    billingPeriodStart: absoluteConfig.billingPeriodStart || creditsConfig.billingPeriodStart,
    billingPeriodEnd: absoluteConfig.billingPeriodEnd || creditsConfig.billingPeriodEnd,
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
    // Grok: no 5h window; weekly = format=credits %; monthly = absolute quota
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
    // Weekly window: format=credits creditUsagePercent (matches web ~10% bar)
    base.weekly = metricFromPercentWindow(
      billing.creditUsagePercent,
      formatPeriodEnd(billing.creditPeriodEnd),
    );
    // Monthly window: absolute used / monthlyLimit from default /billing
    base.monthly = metricFromAbsoluteQuota(
      billing.used,
      billing.monthlyLimit,
      formatPeriodEnd(billing.billingPeriodEnd),
    );
    if (typeof billing.remaining === "number") {
      base.credits = String(billing.remaining);
    } else if (typeof billing.prepaidBalance === "number") {
      base.credits = String(billing.prepaidBalance);
    }
    const notes: string[] = [];
    if (typeof billing.onDemandCap === "number" && billing.onDemandCap > 0) {
      const usedPart =
        typeof billing.onDemandUsed === "number" ? ` used ${billing.onDemandUsed}` : "";
      notes.push(`on-demand cap ${billing.onDemandCap}${usedPart}`);
    }
    if (notes.length > 0) {
      base.note = notes.join("; ");
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
