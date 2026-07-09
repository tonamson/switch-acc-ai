import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { ensureProfile, linkSharedProfile, readCurrentAccount, requireProfile } from "./accounts.js";
import type { AppConfig } from "./config.js";

export type RateWindow = {
  usedPercent: string;
  resetLabel: string;
};

export type RateLimitStatus = {
  account: string;
  current: boolean;
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
  return `resets ${new Date(value * 1000).toLocaleString()}`;
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
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, 15_000);

  const reader = (async () => {
    for await (const line of rl) {
      try {
        const message = JSON.parse(line) as JsonRpcMessage;
        if (typeof message.id === "number") {
          responses.set(message.id, message);
        }
        if (responses.has(includeLimits ? 3 : 2)) {
          child.stdin.end();
          break;
        }
      } catch {
        continue;
      }
    }
  })();

  child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"swa","version":"dev"},"capabilities":{"experimentalApi":true}}}\n');
  child.stdin.write('{"jsonrpc":"2.0","id":2,"method":"account/read","params":{"refreshToken":false}}\n');
  if (includeLimits) {
    child.stdin.write('{"jsonrpc":"2.0","id":3,"method":"account/rateLimits/read","params":null}\n');
  }

  await Promise.race([reader, once(child, "exit")]);
  clearTimeout(timeout);
  child.kill("SIGTERM");

  if (!responses.has(includeLimits ? 3 : 2)) {
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
  const rateLimits = getRecord(limitResult.rateLimits);
  const primary = getRecord(rateLimits.primary);
  const secondary = getRecord(rateLimits.secondary);
  const credits = getRecord(limitResult.rateLimitResetCredits);
  const current = await readCurrentAccount(config);

  return {
    account: name,
    current: current === name,
    user: String(account.email || account.username || account.accountId || "unknown"),
    plan: String(account.planType || rateLimits.planType || "unknown"),
    primary: { usedPercent: usedPercent(primary), resetLabel: resetLabel(primary) },
    secondary: { usedPercent: usedPercent(secondary), resetLabel: resetLabel(secondary) },
    resetCredits: String(credits.availableCount ?? "unknown"),
    reached: typeof rateLimits.rateLimitReachedType === "string" ? rateLimits.rateLimitReachedType : undefined,
  };
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

export async function runCodex(config: AppConfig, name: string, args: string[]): Promise<number> {
  const profilePath = await requireProfile(config, name);
  await linkSharedProfile(config, profilePath);
  const child = spawn("codex", args, {
    env: codexEnv(profilePath),
    stdio: "inherit",
  });
  return waitForExit(child);
}

export async function loginCodex(config: AppConfig, name: string): Promise<number> {
  const profilePath = await ensureProfile(config, name);
  await linkSharedProfile(config, profilePath);
  const child = spawn("codex", ["login"], {
    env: codexEnv(profilePath),
    stdio: "inherit",
  });
  return waitForExit(child);
}
