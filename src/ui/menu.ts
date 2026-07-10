import { input, select } from "@inquirer/prompts";
import {
  listAccounts,
  readCurrentAccount,
  removeAccount,
  renameAccount,
  writeCurrentAccount,
} from "../core/accounts.js";
import { loginCodex, readAccountLabel, readRateLimits, runCodex } from "../core/codex.js";
import type { AppConfig } from "../core/config.js";
import { formatAccountsTable, formatStatus } from "./output.js";

function resumePromptInput(): void {
  process.stdin.resume();
}

async function chooseAccount(config: AppConfig): Promise<string> {
  const accounts = await listAccounts(config);
  if (accounts.length === 0) {
    throw new Error("no accounts; run: swa login <name>");
  }
  const current = await readCurrentAccount(config);
  resumePromptInput();
  return select({
    message: `SWA  accounts  current ${current || "none"}`,
    choices: accounts.map((name) => ({
      name: name === current ? `${name} current` : name,
      value: name,
    })),
  });
}

async function printAccounts(config: AppConfig): Promise<void> {
  const current = await readCurrentAccount(config);
  const rows = [];
  for (const name of await listAccounts(config)) {
    rows.push({
      marker: name === current ? ("*" as const) : ("-" as const),
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
  await writeCurrentAccount(config, name);
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

    if (typeof action !== "string") {
      process.exitCode = await runCodex(config, action.account, forwardedArgs);
      return;
    }
    if (action === "exit") return;
    
    if (action === "login") {
      resumePromptInput();
      const name = await input({ message: "Account profile name" });
      process.exitCode = await loginCodex(config, name);
      await pause();
    }
    if (action === "use") {
      const name = await chooseAccount(config);
      await writeCurrentAccount(config, name);
      console.log(name);
      await pause();
    }
    if (action === "rename") {
      const oldName = await chooseAccount(config);
      resumePromptInput();
      const newName = await input({ message: "New profile name" });
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
