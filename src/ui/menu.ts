import { input, select } from "@inquirer/prompts";
import {
  listAccounts,
  removeAccount,
  renameAccount,
} from "../core/accounts.js";
import { loginCodex, readAccountLabel, readRateLimits, runCodex } from "../core/codex.js";
import type { AppConfig } from "../core/config.js";
import { formatAccountsTable, formatStatus } from "./output.js";

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

async function printAccounts(config: AppConfig): Promise<void> {
  const rows = [];
  for (const name of await listAccounts(config)) {
    rows.push({
      profile: name,
      identity: await readAccountLabel(config, name).catch(() => "unknown"),
    });
  }
  console.log(formatAccountsTable(rows));
}

async function pause(): Promise<void> {
  resumePromptInput();
  await input({ message: "Enter to return" });
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
    
    if (action === "login") {
      resumePromptInput();
      const name = (await input({ message: "Account profile name" })).trim();
      if (!name) {
        await pause();
        continue;
      }
      process.exitCode = await loginCodex(config, name);
      await pause();
    }
    if (action === "rename") {
      const oldName = await chooseAccount(config);
      resumePromptInput();
      const newName = (await input({ message: "New profile name" })).trim();
      if (!newName) {
        await pause();
        continue;
      }
      await renameAccount(config, oldName, newName);
      await pause();
    }
    if (action === "remove") {
      const name = await chooseAccount(config);
      resumePromptInput();
      const answer = await input({
        message: `Delete account profile "${name}"? Type ${name} to confirm`,
      });
      if (answer === name) {
        await removeAccount(config, name);
      }
      await pause();
    }
  }
}
