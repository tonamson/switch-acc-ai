import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { ensureProfile, linkSharedProfile, requireProfile } from "./accounts.js";
import type { AppConfig } from "./config.js";

export type RateWindow = {
  usedPercent: string;
  resetLabel: string;
};

export type RateLimitStatus = {
  account: string;
  user: string;
  plan: string;
  primary: RateWindow;
  secondary: RateWindow;
  resetCredits: string;
  reached?: string;
};

type JsonRpcMessage = {
  id?: number;
  result?: Record<string, unknown>;
  error?: unknown;
};

function codexEnv(profilePath: string): NodeJS.ProcessEnv {
  return { ...process.env, CODEX_HOME: profilePath };
}

function usedPercent(window: Record<string, unknown> | undefined): string {
  const value = window?.usedPercent;
  return typeof value === "number" ? `${value}% used` : "unknown";
}

function resetLabel(window: Record<string, unknown> | undefined): string {
  const value = window?.resetsAt;
  if (typeof value !== "number") {
    return "unknown reset";
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

function getRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

async function appServerExchange(profilePath: string, includeLimits: boolean): Promise<Map<number, JsonRpcMessage>> {
  const child = spawn("codex", ["app-server", "--stdio"], {
    env: codexEnv(profilePath),
    stdio: ["pipe", "pipe", "pipe"],
  });

  const responses = new Map<number, JsonRpcMessage>();
  const rl = createInterface({ input: child.stdout });
  const targetId = includeLimits ? 3 : 2;
  let sawTargetResponse = false;
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, 15_000);
  const closePromise = once(child, "close");

  const reader = (async () => {
    for await (const line of rl) {
      try {
        const message = JSON.parse(line) as JsonRpcMessage;
        if (typeof message.id === "number") {
          responses.set(message.id, message);
        }
        if (responses.has(targetId)) {
          sawTargetResponse = true;
          child.stdin.end();
          break;
        }
      } catch {
        continue;
      }
    }
  })();

  child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"sacc","version":"dev"},"capabilities":{"experimentalApi":true}}}\n');
  child.stdin.write('{"jsonrpc":"2.0","id":2,"method":"account/read","params":{"refreshToken":false}}\n');
  if (includeLimits) {
    child.stdin.write('{"jsonrpc":"2.0","id":3,"method":"account/rateLimits/read","params":null}\n');
  }

  await reader;
  await closePromise;
  clearTimeout(timeout);

  if (!sawTargetResponse) {
    throw new Error("no response from codex app-server");
  }
  return responses;
}

export async function readAccountLabel(config: AppConfig, name: string): Promise<string> {
  const profilePath = await requireProfile(config, name);
  const responses = await appServerExchange(profilePath, false);
  const message = responses.get(2);
  if (message?.error) {
    throw new Error(`${name}: ${JSON.stringify(message.error)}`);
  }
  const result = getRecord(message?.result);
  const account = getRecord(result.account);
  return String(account.email || account.username || account.accountId || name);
}

export async function readRateLimits(config: AppConfig, name: string): Promise<RateLimitStatus> {
  const profilePath = await requireProfile(config, name);
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
  const resetCredits =
    credits.availableCount ?? legacyCredits.balance ?? "unknown";

  return {
    account: name,
    user: String(account.email || account.username || account.accountId || "unknown"),
    plan: String(account.planType || selectedRateLimits.planType || "unknown"),
    primary: { usedPercent: usedPercent(primary), resetLabel: resetLabel(primary) },
    secondary: { usedPercent: usedPercent(secondary), resetLabel: resetLabel(secondary) },
    resetCredits: String(resetCredits),
    reached:
      typeof selectedRateLimits.rateLimitReachedType === "string"
        ? selectedRateLimits.rateLimitReachedType
        : undefined,
  };
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
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

export async function runCodex(config: AppConfig, name: string, args: string[]): Promise<number> {
  const profilePath = await requireProfile(config, name);
  await linkSharedProfile(config, profilePath);
  restoreTerminal();
  const child = spawn("codex", args, {
    env: codexEnv(profilePath),
    stdio: "inherit",
  });
  return waitForExit(child);
}

export async function loginCodex(config: AppConfig, name: string): Promise<number> {
  const profilePath = await ensureProfile(config, name);
  await linkSharedProfile(config, profilePath);
  restoreTerminal();
  const child = spawn("codex", ["login"], {
    env: codexEnv(profilePath),
    stdio: "inherit",
  });
  return waitForExit(child);
}
