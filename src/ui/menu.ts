import { select } from "@inquirer/prompts";
import { listAccounts, removeAccount, renameAccount } from "../core/accounts.js";
import { loginCodex, runCodex } from "../core/codex.js";
import { getProvider, type AppConfig, type ProviderId } from "../core/config.js";
import { loginGrok, runGrok } from "../core/grok.js";

function resumePromptInput(): void {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(false);
  }
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?1049l\x1b[?25h\x1b[0m");
  }
  process.stdin.resume();
}

async function chooseAccount(config: AppConfig, provider: ProviderId): Promise<string> {
  const accounts = await listAccounts(getProvider(config, provider));
  if (accounts.length === 0) {
    throw new Error(`no ${provider} accounts; run: sacc ${provider} login <name>`);
  }
  resumePromptInput();
  return select({
    message: `Switch Account AI  ${provider} accounts`,
    choices: accounts.map((name) => ({
      name,
      value: name,
    })),
  });
}

async function runAccount(
  config: AppConfig,
  provider: ProviderId,
  account: string,
  args: string[],
): Promise<number> {
  const providerConfig = getProvider(config, provider);
  return provider === "codex"
    ? runCodex(providerConfig, account, args)
    : runGrok(providerConfig, account, args);
}

async function loginAccount(config: AppConfig, provider: ProviderId, name: string): Promise<number> {
  const providerConfig = getProvider(config, provider);
  return provider === "codex" ? loginCodex(providerConfig, name) : loginGrok(providerConfig, name);
}

export async function pickAndRunAccount(
  config: AppConfig,
  provider: ProviderId = "codex",
  forwardedArgs: string[] = [],
): Promise<void> {
  const name = await chooseAccount(config, provider);
  process.exitCode = await runAccount(config, provider, name, forwardedArgs);
}

export async function openMainMenu(
  config: AppConfig,
  initialProvider?: ProviderId,
  forwardedArgs: string[] = [],
): Promise<void> {
  while (true) {
    console.clear();
    const { runInkApp } = await import("./tui/index.js");
    const action = await runInkApp(config, initialProvider);

    if (typeof action !== "string" && action.type === "run") {
      process.exitCode = await runAccount(config, action.provider, action.account, forwardedArgs);
      return;
    }
    if (typeof action !== "string" && action.type === "login") {
      process.exitCode = await loginAccount(config, action.provider, action.name);
      continue;
    }
    if (typeof action !== "string" && action.type === "rename") {
      await renameAccount(getProvider(config, action.provider), action.account, action.newName);
      continue;
    }
    if (typeof action !== "string" && action.type === "remove") {
      await removeAccount(getProvider(config, action.provider), action.account);
      continue;
    }
    if (action === "exit") return;
  }
}
