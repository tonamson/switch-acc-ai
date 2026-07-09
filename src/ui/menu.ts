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

async function chooseAccount(config: AppConfig): Promise<string> {
  const accounts = await listAccounts(config);
  if (accounts.length === 0) {
    throw new Error("no accounts; run: swa login <name>");
  }
  const current = await readCurrentAccount(config);
  return select({
    message: `SWA command palette / current ${current || "none"}`,
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
  const action = await select({
    message: "SWA command palette",
    choices: [
      { name: "Run with account", value: "run" },
      { name: "Login account", value: "login" },
      { name: "Set default account", value: "use" },
      { name: "Show current account", value: "current" },
      { name: "List accounts", value: "list" },
      { name: "Status and limits", value: "status" },
      { name: "Rename account", value: "rename" },
      { name: "Remove account", value: "remove" },
      { name: "Exit", value: "exit" },
    ],
  });

  if (action === "exit") return;
  if (action === "run") return pickAndRunAccount(config, forwardedArgs);
  if (action === "login") {
    const name = await input({ message: "Account profile name" });
    process.exitCode = await loginCodex(config, name);
    return;
  }
  if (action === "use") {
    const name = await chooseAccount(config);
    await writeCurrentAccount(config, name);
    console.log(name);
    return;
  }
  if (action === "current") {
    console.log((await readCurrentAccount(config)) || "none");
    return;
  }
  if (action === "list") {
    await printAccounts(config);
    return;
  }
  if (action === "status") {
    const name = await chooseAccount(config);
    console.log(formatStatus([await readRateLimits(config, name)]));
    return;
  }
  if (action === "rename") {
    const oldName = await chooseAccount(config);
    const newName = await input({ message: "New profile name" });
    await renameAccount(config, oldName, newName);
    return;
  }
  if (action === "remove") {
    const name = await chooseAccount(config);
    const answer = await input({
      message: `Delete account profile "${name}"? Type ${name} to confirm`,
    });
    if (answer === name) {
      await removeAccount(config, name);
    }
  }
}
