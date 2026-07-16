import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { ensureProfile, linkSharedProfile, requireProfile } from "./accounts.js";
import type { ProviderConfig } from "./config.js";
import {
  logDebug,
  logException,
  logInfo,
  logWarn,
  runtimeSnapshot,
  serializeError,
  startTimer,
} from "./log.js";
import {
  ABSENT,
  emptyUsageStatus,
  metricFromPercentWindow,
  type UsageStatus,
} from "./usage.js";

type JsonRpcMessage = {
  id?: number;
  result?: Record<string, unknown>;
  error?: unknown;
};

function codexEnv(profilePath: string): NodeJS.ProcessEnv {
  return { ...process.env, CODEX_HOME: profilePath };
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

function resetLabel(window: Record<string, unknown> | undefined): string | undefined {
  const value = window?.resetsAt;
  if (typeof value !== "number") {
    return undefined;
  }
  const resetAt = new Date(value * 1000);
  const year = String(resetAt.getFullYear()).padStart(4, "0");
  const month = String(resetAt.getMonth() + 1).padStart(2, "0");
  const day = String(resetAt.getDate()).padStart(2, "0");
  const hours = String(resetAt.getHours()).padStart(2, "0");
  const minutes = String(resetAt.getMinutes()).padStart(2, "0");
  const seconds = String(resetAt.getSeconds()).padStart(2, "0");
  const timeZoneParts = new Intl.DateTimeFormat("en-US", {
    timeZoneName: "short",
  }).formatToParts(resetAt);
  const timeZone =
    timeZoneParts.find((part) => part.type === "timeZoneName")?.value ?? "UTC";
  return `resets ${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${timeZone}`;
}

function windowUsedPercent(window: Record<string, unknown> | undefined): number | undefined {
  const value = window?.usedPercent;
  return typeof value === "number" ? value : undefined;
}

function getRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

async function appServerExchange(profilePath: string, includeLimits: boolean): Promise<Map<number, JsonRpcMessage>> {
  const timer = startTimer();
  const command = ["codex", "app-server", "--stdio"];
  logDebug("codex app-server start", {
    profilePath,
    includeLimits,
    command,
    env: { CODEX_HOME: profilePath },
  });

  const child = spawn(command[0], command.slice(1), {
    env: codexEnv(profilePath),
    stdio: ["pipe", "pipe", "pipe"],
  });

  const responses = new Map<number, JsonRpcMessage>();
  const rawLines: string[] = [];
  const stderrChunks: string[] = [];
  const rl = createInterface({ input: child.stdout });
  const targetId = includeLimits ? 3 : 2;
  let sawTargetResponse = false;
  let spawnError: Error | null = null;
  const timeout = setTimeout(() => {
    logWarn("codex app-server timeout", {
      profilePath,
      includeLimits,
      targetId,
      elapsedMs: timer.elapsedMs(),
      responseIds: [...responses.keys()],
    });
    child.kill("SIGTERM");
  }, 15_000);
  const closePromise = once(child, "close");
  child.on("error", (err: Error) => {
    spawnError = err;
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderrChunks.push(String(chunk));
  });

  const reader = (async () => {
    for await (const line of rl) {
      rawLines.push(line);
      try {
        const message = JSON.parse(line) as JsonRpcMessage;
        if (typeof message.id === "number") {
          responses.set(message.id, message);
          logDebug("codex app-server response", {
            id: message.id,
            hasResult: message.result !== undefined,
            hasError: message.error !== undefined,
            error: message.error ?? null,
            resultKeys:
              message.result && typeof message.result === "object"
                ? Object.keys(message.result)
                : [],
          });
        }
        if (responses.has(targetId)) {
          sawTargetResponse = true;
          child.stdin.end();
          break;
        }
      } catch (parseError) {
        logDebug("codex app-server non-json line", {
          line: line.slice(0, 500),
          parseError: serializeError(parseError),
        });
        continue;
      }
    }
  })();

  const requests = [
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"sacc","version":"dev"},"capabilities":{"experimentalApi":true}}}',
    '{"jsonrpc":"2.0","id":2,"method":"account/read","params":{"refreshToken":false}}',
  ];
  if (includeLimits) {
    requests.push('{"jsonrpc":"2.0","id":3,"method":"account/rateLimits/read","params":null}');
  }
  for (const request of requests) {
    child.stdin.write(`${request}\n`);
  }
  logDebug("codex app-server requests written", { requests, targetId });

  await reader;
  const closeResult = await closePromise;
  clearTimeout(timeout);

  const error = spawnError as Error | null;
  logDebug("codex app-server finished", {
    profilePath,
    includeLimits,
    elapsedMs: timer.elapsedMs(),
    sawTargetResponse,
    responseIds: [...responses.keys()],
    rawLineCount: rawLines.length,
    stderr: stderrChunks.join("").slice(0, 4000) || null,
    closeCode: Array.isArray(closeResult) ? closeResult[0] : null,
    closeSignal: Array.isArray(closeResult) ? closeResult[1] : null,
    spawnError: error ? serializeError(error) : null,
  });

  if (error) {
    throw new Error(`failed to launch codex: ${error.message}. Is the codex CLI installed and on PATH?`);
  }
  if (!sawTargetResponse) {
    throw new Error("no response from codex app-server");
  }
  return responses;
}

export async function readAccountLabel(config: ProviderConfig, name: string): Promise<string> {
  const profilePath = await requireProfile(config, name);
  const timer = startTimer();
  try {
    const responses = await appServerExchange(profilePath, false);
    const message = responses.get(2);
    if (message?.error) {
      throw new Error(`${name}: ${JSON.stringify(message.error)}`);
    }
    const result = getRecord(message?.result);
    const account = getRecord(result.account);
    const label = String(account.email || account.username || account.accountId || name);
    logInfo("codex label ok", {
      account: name,
      profilePath,
      label,
      accountFields: {
        email: account.email ?? null,
        username: account.username ?? null,
        accountId: account.accountId ?? null,
        planType: account.planType ?? null,
      },
      rawResult: result,
      elapsedMs: timer.elapsedMs(),
    });
    return label;
  } catch (error) {
    logException("codex label failed", error, {
      account: name,
      profilePath,
      elapsedMs: timer.elapsedMs(),
    });
    throw error;
  }
}

export async function readRateLimits(config: ProviderConfig, name: string): Promise<UsageStatus> {
  const profilePath = await requireProfile(config, name);
  const timer = startTimer();
  logInfo("codex usage start", {
    account: name,
    profilePath,
    accountsDir: config.accountsDir,
    sharedHome: config.sharedHome,
  });
  try {
    const responses = await appServerExchange(profilePath, true);
    const accountMessage = responses.get(2);
    const limitsMessage = responses.get(3);
    if (accountMessage?.error) {
      throw new Error(`${name}: ${JSON.stringify(accountMessage.error)}`);
    }
    if (limitsMessage?.error) {
      throw new Error(`${name}: ${JSON.stringify(limitsMessage.error)}`);
    }

    const accountResult = getRecord(accountMessage?.result);
    const account = getRecord(accountResult.account);
    const limitResult = getRecord(limitsMessage?.result);
    const keyedRateLimits = getRecord(limitResult.rateLimitsByLimitId);
    const rateLimits = getRecord(keyedRateLimits.codex);
    const legacyRateLimits = getRecord(limitResult.rateLimits);
    const selectedRateLimits = Object.keys(rateLimits).length > 0 ? rateLimits : legacyRateLimits;
    const primary = getRecord(selectedRateLimits.primary);
    const secondary = getRecord(selectedRateLimits.secondary);
    const credits = getRecord(limitResult.rateLimitResetCredits);
    const legacyCredits = getRecord(legacyRateLimits.credits);
    const resetCredits = credits.availableCount ?? legacyCredits.balance;
    const creditsLabel =
      typeof resetCredits === "number" || typeof resetCredits === "string"
        ? String(resetCredits)
        : null;

    const status = emptyUsageStatus(name, {
      user: String(account.email || account.username || account.accountId || "unknown"),
      plan: String(account.planType || selectedRateLimits.planType || "unknown"),
      // Codex primary ≈ 5h rolling window
      fiveHour: metricFromPercentWindow(windowUsedPercent(primary), resetLabel(primary)),
      // Codex secondary ≈ weekly window
      weekly: metricFromPercentWindow(windowUsedPercent(secondary), resetLabel(secondary)),
      // Codex has no monthly billing window in app-server
      monthly: { ...ABSENT },
      credits: creditsLabel,
      reached:
        typeof selectedRateLimits.rateLimitReachedType === "string"
          ? selectedRateLimits.rateLimitReachedType
          : undefined,
    });
    logInfo("codex usage ok", {
      account: name,
      profilePath,
      elapsedMs: timer.elapsedMs(),
      status,
      raw: {
        account,
        usedKeyedCodexLimits: Object.keys(rateLimits).length > 0,
        primary,
        secondary,
        credits,
        legacyCredits,
        rateLimitReachedType: selectedRateLimits.rateLimitReachedType ?? null,
        limitResultKeys: Object.keys(limitResult),
      },
    });
    return status;
  } catch (error) {
    logException("codex usage failed", error, {
      account: name,
      profilePath,
      elapsedMs: timer.elapsedMs(),
    });
    throw error;
  }
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

export async function runCodex(config: ProviderConfig, name: string, args: string[]): Promise<number> {
  const profilePath = await requireProfile(config, name);
  await linkSharedProfile(config, profilePath, "codex");
  prepareInteractiveChild(`codex run ${name}`);
  const env = codexEnv(profilePath);
  const command = ["codex", ...args];
  logInfo("run start", {
    provider: "codex",
    account: name,
    args,
    command,
    profilePath,
    accountsDir: config.accountsDir,
    sharedHome: config.sharedHome,
    env: { CODEX_HOME: env.CODEX_HOME },
    runtime: runtimeSnapshot(env),
  });
  const child = spawn("codex", args, {
    env,
    stdio: "inherit",
  });
  try {
    return await waitForExitDetailed(child, "run", {
      provider: "codex",
      account: name,
      args,
      command,
      profilePath,
    });
  } catch (error) {
    logException("run failed", error, {
      provider: "codex",
      account: name,
      args,
      command,
      profilePath,
    });
    throw error;
  }
}

export async function loginCodex(config: ProviderConfig, name: string): Promise<number> {
  const profilePath = await ensureProfile(config, name);
  await linkSharedProfile(config, profilePath, "codex");
  prepareInteractiveChild(`codex login ${name}`);
  const env = codexEnv(profilePath);
  const command = ["codex", "login"];
  logInfo("login start", {
    provider: "codex",
    account: name,
    command,
    profilePath,
    accountsDir: config.accountsDir,
    sharedHome: config.sharedHome,
    env: { CODEX_HOME: env.CODEX_HOME },
    runtime: runtimeSnapshot(env),
  });
  if (process.stdout.isTTY) {
    process.stdout.write(`Signing in Codex profile "${name}"…\n\n`);
  }
  const child = spawn("codex", ["login"], {
    env,
    stdio: "inherit",
  });
  try {
    return await waitForExitDetailed(child, "login", {
      provider: "codex",
      account: name,
      command,
      profilePath,
    });
  } catch (error) {
    logException("login failed", error, {
      provider: "codex",
      account: name,
      command,
      profilePath,
    });
    throw error;
  }
}
