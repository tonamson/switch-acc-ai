import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureProfile, linkSharedProfile, requireProfile } from "./accounts.js";
import type { ProviderConfig } from "./config.js";
import {
  logDebug,
  logError,
  logException,
  logInfo,
  logWarn,
  redactSecret,
  runtimeSnapshot,
  serializeError,
  startTimer,
} from "./log.js";
import {
  ABSENT,
  emptyUsageStatus,
  metricFromAbsoluteQuota,
  metricFromPercentWindow,
  type UsageStatus,
} from "./usage.js";

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
          new Error("failed to launch grok: command not found. Is the Grok CLI installed and on PATH?"),
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
 * Drain buffered keypresses (e.g. the Enter that submitted the menu form)
 * so the child does not instantly consume them and bail out of login.
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
    // Exit alt screen, show cursor, reset SGR, clear scrollback viewport
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

function hasLoginFlowFlag(args: string[]): boolean {
  return args.some(
    (arg) =>
      arg === "--oauth" ||
      arg === "--device-auth" ||
      arg === "--device-code" ||
      arg === "--devbox",
  );
}

async function readAuthFile(profilePath: string): Promise<AuthEntry | null> {
  const authPath = join(profilePath, "auth.json");
  try {
    const raw = await readFile(authPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const scopes = Object.keys(parsed);
    for (const value of Object.values(parsed)) {
      if (typeof value === "object" && value !== null) {
        const entry = value as AuthEntry;
        logDebug("grok auth.json loaded", {
          authPath,
          scopes,
          auth_mode: entry.auth_mode ?? null,
          email: entry.email ?? null,
          user_id: entry.user_id ?? null,
          team_id: entry.team_id ?? null,
          principal_type: entry.principal_type ?? null,
          expires_at: entry.expires_at ?? null,
          key: redactSecret(entry.key),
          hasKey: Boolean(entry.key),
        });
        return entry;
      }
    }
    logWarn("grok auth.json has no auth entry", { authPath, scopes });
    return null;
  } catch (error) {
    logDebug("grok auth.json missing or unreadable", {
      authPath,
      error: serializeError(error),
    });
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
  const timer = startTimer();
  const fetchImpl = options.fetchImpl || fetch;
  const url = `${billingBaseUrl(options.env)}${pathWithQuery}`;
  logDebug("grok billing request", {
    url,
    token: redactSecret(accessToken),
  });
  const response = await fetchImpl(url, {
    headers: billingHeaders(accessToken),
  });
  if (!response.ok) {
    let bodyText: string | null = null;
    try {
      bodyText = await response.text();
    } catch {
      bodyText = null;
    }
    logError("grok billing http error", {
      url,
      status: response.status,
      statusText: response.statusText,
      body: bodyText?.slice(0, 4000) ?? null,
      elapsedMs: timer.elapsedMs(),
    });
    throw new Error(`billing API ${response.status}`);
  }
  const json = (await response.json()) as BillingResponse;
  logDebug("grok billing response ok", {
    url,
    elapsedMs: timer.elapsedMs(),
    configKeys: json.config ? Object.keys(json.config) : [],
    body: json,
  });
  return json;
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
  const timer = startTimer();
  // Credits format first — this is the % users see on web / in Grok CLI.
  const creditsBody = await fetchBillingJson(accessToken, "/billing?format=credits", options);
  const creditsConfig = creditsBody.config || {};

  let absoluteConfig: AbsoluteBillingConfig = {};
  let absoluteError: unknown = null;
  try {
    const absoluteBody = await fetchBillingJson(accessToken, "/billing", options);
    absoluteConfig = absoluteBody.config || {};
  } catch (error) {
    // Absolute monthly is secondary; keep weekly % if this leg fails.
    absoluteError = error;
    logWarn("grok billing absolute leg failed", {
      error: serializeError(error),
    });
  }

  const used = numberVal(absoluteConfig.used);
  const monthlyLimit = numberVal(absoluteConfig.monthlyLimit);
  const onDemandCap =
    numberVal(creditsConfig.onDemandCap) ?? numberVal(absoluteConfig.onDemandCap);
  const onDemandUsed = numberVal(creditsConfig.onDemandUsed);
  const prepaidBalance = numberVal(creditsConfig.prepaidBalance);

  const usage: GrokBillingUsage = {
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

  logInfo("grok billing merged", {
    elapsedMs: timer.elapsedMs(),
    usage,
    creditsConfig,
    absoluteConfig,
    absoluteError: absoluteError ? serializeError(absoluteError) : null,
  });

  return usage;
}

export async function readAccountLabel(config: ProviderConfig, name: string): Promise<string> {
  const profilePath = await requireProfile(config, name);
  const auth = await readAuthFile(profilePath);
  if (!auth) {
    logInfo("grok label", {
      account: name,
      profilePath,
      label: "Not signed in",
      authPath: join(profilePath, "auth.json"),
    });
    return "Not signed in";
  }
  const label = identityFromAuth(auth, name);
  logInfo("grok label", {
    account: name,
    profilePath,
    label,
    auth_mode: auth.auth_mode ?? null,
    email: auth.email ?? null,
    user_id: auth.user_id ?? null,
  });
  return label;
}

export async function readAuthStatus(
  config: ProviderConfig,
  name: string,
  options: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<UsageStatus> {
  const profilePath = await requireProfile(config, name);
  const timer = startTimer();
  logInfo("grok usage start", {
    account: name,
    profilePath,
    accountsDir: config.accountsDir,
    sharedHome: config.sharedHome,
    billingBaseUrl: billingBaseUrl(options.env),
  });
  const auth = await readAuthFile(profilePath);
  if (!auth) {
    logWarn("grok usage not signed in", {
      account: name,
      profilePath,
      authPath: join(profilePath, "auth.json"),
      elapsedMs: timer.elapsedMs(),
    });
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
    logWarn("grok usage missing token", {
      account: name,
      profilePath,
      auth_mode: auth.auth_mode ?? null,
      expires_at: auth.expires_at ?? null,
      elapsedMs: timer.elapsedMs(),
    });
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
    logInfo("grok usage ok", {
      account: name,
      profilePath,
      elapsedMs: timer.elapsedMs(),
      status: base,
      billing,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    base.note = `usage error: ${message}`;
    logException("grok usage billing failed", error, {
      account: name,
      profilePath,
      elapsedMs: timer.elapsedMs(),
      statusSoFar: base,
    });
  }

  return base;
}

export async function runGrok(config: ProviderConfig, name: string, args: string[]): Promise<number> {
  const profilePath = await requireProfile(config, name);
  await linkSharedProfile(config, profilePath, "grok");
  prepareInteractiveChild(`grok run ${name}`);
  const leaderSocket = join(profilePath, "leader.sock");
  const env: NodeJS.ProcessEnv = {
    ...grokEnv(profilePath),
    // Keep leader IPC isolated per profile so an active session on another
    // account cannot steal or short-circuit this process.
    GROK_LEADER_SOCKET: leaderSocket,
  };
  const command = ["grok", ...args];
  logInfo("run start", {
    provider: "grok",
    account: name,
    args,
    command,
    profilePath,
    accountsDir: config.accountsDir,
    sharedHome: config.sharedHome,
    env: {
      GROK_HOME: env.GROK_HOME ?? null,
      GROK_LEADER_SOCKET: env.GROK_LEADER_SOCKET ?? null,
    },
    runtime: runtimeSnapshot(env),
  });
  const child = spawn("grok", args, {
    env,
    stdio: "inherit",
  });
  try {
    return await waitForExitDetailed(child, "run", {
      provider: "grok",
      account: name,
      args,
      command,
      profilePath,
      leaderSocket,
    });
  } catch (error) {
    logException("run failed", error, {
      provider: "grok",
      account: name,
      args,
      command,
      profilePath,
      leaderSocket,
    });
    throw error;
  }
}

export async function loginGrok(config: ProviderConfig, name: string, args: string[] = []): Promise<number> {
  const profilePath = await ensureProfile(config, name);
  await linkSharedProfile(config, profilePath, "grok");
  prepareInteractiveChild(`grok login ${name}`);

  // Browser OAuth is the documented default and opens the login page.
  // When the parent TUI left stdin in a half-broken state, Grok may fall back
  // to device-code; prefer an explicit --oauth unless the user picked a flow.
  const loginArgs = hasLoginFlowFlag(args) ? args : ["--oauth", ...args];
  const leaderSocket = join(profilePath, "leader.sock");
  const env: NodeJS.ProcessEnv = {
    ...grokEnv(profilePath),
    GROK_LEADER_SOCKET: leaderSocket,
  };
  const command = ["grok", "login", ...loginArgs];

  logInfo("login start", {
    provider: "grok",
    account: name,
    userArgs: args,
    effectiveArgs: loginArgs,
    command,
    profilePath,
    accountsDir: config.accountsDir,
    sharedHome: config.sharedHome,
    flowFlagInjected: !hasLoginFlowFlag(args),
    env: {
      GROK_HOME: env.GROK_HOME ?? null,
      GROK_LEADER_SOCKET: env.GROK_LEADER_SOCKET ?? null,
    },
    runtime: runtimeSnapshot(env),
  });

  if (process.stdout.isTTY) {
    process.stdout.write(`Signing in Grok profile "${name}"…\n\n`);
  }

  const child = spawn("grok", ["login", ...loginArgs], {
    env,
    stdio: "inherit",
  });
  try {
    return await waitForExitDetailed(child, "login", {
      provider: "grok",
      account: name,
      command,
      profilePath,
      leaderSocket,
    });
  } catch (error) {
    logException("login failed", error, {
      provider: "grok",
      account: name,
      command,
      profilePath,
      leaderSocket,
    });
    throw error;
  }
}
