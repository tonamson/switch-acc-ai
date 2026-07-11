import { select } from "@inquirer/prompts";
import { listAccounts, removeAccount, renameAccount } from "../core/accounts.js";
import { loginCodex, runCodex } from "../core/codex.js";
import type { AppConfig } from "../core/config.js";

function resumePromptInput(): void {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(false);
  }
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?1049l\x1b[?25h\x1b[0m");
  }
  process.stdin.resume();
}

async function chooseAccount(config: AppConfig): Promise<string> {
  const accounts = await listAccounts(config);
  if (accounts.length === 0) {
    throw new Error("no accounts; run: sacc login <name>");
  }
  resumePromptInput();
  return select({
    message: "Switch Account AI  accounts",
    choices: accounts.map((name) => ({
      name,
      value: name,
    })),
  });
}

export async function pickAndRunAccount(
  config: AppConfig,
  forwardedArgs: string[] = [],
): Promise<void> {
  const name = await chooseAccount(config);
  process.exitCode = await runCodex(config, name, forwardedArgs);
}

export async function openMainMenu(
  config: AppConfig,
  forwardedArgs: string[] = [],
): Promise<void> {
  while (true) {
    console.clear();
    const { runInkApp } = await import("./tui/index.js");
    const action = await runInkApp(config);

    if (typeof action !== "string" && action.type === "run") {
      process.exitCode = await runCodex(config, action.account, forwardedArgs);
      return;
    }
    if (typeof action !== "string" && action.type === "login") {
      process.exitCode = await loginCodex(config, action.name);
      continue;
    }
    if (typeof action !== "string" && action.type === "rename") {
      await renameAccount(config, action.account, action.newName);
      continue;
    }
    if (typeof action !== "string" && action.type === "remove") {
      await removeAccount(config, action.account);
      continue;
    }
    if (action === "exit") return;
  }
}
