import { Command } from "commander";
import {
  listAccounts,
  readCurrentAccount,
  removeAccount,
  renameAccount,
  requireProfile,
  writeCurrentAccount,
} from "../core/accounts.js";
import { loginCodex, readAccountLabel, readRateLimits, runCodex } from "../core/codex.js";
import { resolveConfig, type AppConfig } from "../core/config.js";
import { formatAccountsTable, formatError, formatHelp, formatStatus } from "../ui/output.js";

export type CreateProgramOptions = {
  config?: AppConfig;
};

function hintForError(message: string): string | undefined {
  if (message.startsWith("account not found:")) {
    return "Run swa login <name> to create it, or swa list to see profiles.";
  }
  if (message.includes("no current account")) {
    return "Run swa use <name> or swa pick.";
  }
  if (message.startsWith("invalid account name:")) {
    return "Use letters, numbers, dot, underscore, or dash.";
  }
  return undefined;
}

async function currentOrThrow(config: AppConfig): Promise<string> {
  const current = await readCurrentAccount(config);
  if (!current) {
    throw new Error("no current account");
  }
  return current;
}

async function printList(config: AppConfig): Promise<void> {
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

async function printStatus(config: AppConfig, target?: string, all = false): Promise<void> {
  if (all) {
    const rows = [];
    let failed = false;
    for (const name of await listAccounts(config)) {
      try {
        rows.push(await readRateLimits(config, name));
      } catch (error) {
        failed = true;
        rows.push({ account: name, error: error instanceof Error ? error.message : String(error) });
      }
    }
    console.log(formatStatus(rows));
    if (failed) {
      process.exitCode = 1;
    }
    return;
  }

  const name = target || (await currentOrThrow(config));
  console.log(formatStatus([await readRateLimits(config, name)]));
}

export function createProgram(options: CreateProgramOptions = {}): Command {
  const config = options.config || resolveConfig();
  const program = new Command();

  program
    .name("swa")
    .description("Codex account switcher")
    .helpOption("-h, --help", "show help")
    .showHelpAfterError(false)
    .exitOverride();
  program.helpInformation = () => `${formatHelp()}\n`;

  program.command("login <name>").action(async (name: string) => {
    process.exitCode = await loginCodex(config, name);
  });

  program.command("use <name>").action(async (name: string) => {
    await requireProfile(config, name);
    await writeCurrentAccount(config, name);
    console.log(name);
  });

  program.command("current").action(async () => {
    console.log(await currentOrThrow(config));
  });

  program.command("list").action(async () => printList(config));

  program
    .command("status [name]")
    .option("--all", "show all accounts")
    .action(async (name: string | undefined, command: { all?: boolean }) => {
      await printStatus(config, name, Boolean(command.all));
    });

  program
    .command("run")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument("[args...]", "codex args")
    .action(async (args: string[]) => {
      process.exitCode = await runCodex(config, await currentOrThrow(config), args);
    });

  program
    .command("resume <id> [args...]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (id: string, args: string[] = []) => {
      process.exitCode = await runCodex(config, await currentOrThrow(config), [
        "--resume",
        id,
        ...args,
      ]);
    });

  program
    .command("pick")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument("[args...]", "codex args")
    .action(async (args: string[]) => {
      if (process.stdin.isTTY && process.stdout.isTTY) {
        const { pickAndRunAccount } = await import("../ui/menu.js");
        await pickAndRunAccount(config, args);
        return;
      }
      throw new Error(
        "swa pick requires an interactive terminal; use swa <account> [codex args] in scripts",
      );
    });

  program.command("rename <oldName> <newName>").action(async (oldName: string, newName: string) => {
    await renameAccount(config, oldName, newName);
  });

  program.command("remove <name>").action(async (name: string) => {
    await requireProfile(config, name);
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error("swa remove requires an interactive terminal");
    }
    const { input } = await import("@inquirer/prompts");
    const answer = await input({ message: `Delete account profile "${name}"? Type ${name} to confirm` });
    if (answer === name) {
      await removeAccount(config, name);
    }
  });

  program
    .argument("[account]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument("[codexArgs...]")
    .action(async (account: string | undefined, codexArgs: string[]) => {
      if (!account) {
        if (process.stdin.isTTY && process.stdout.isTTY) {
          const { openMainMenu } = await import("../ui/menu.js");
          await openMainMenu(config);
        } else {
          console.log(formatHelp());
        }
        return;
      }
      await requireProfile(config, account);
      process.exitCode = await runCodex(config, account, codexArgs);
    });

  program.configureOutput({
    outputError: (str) => {
      process.stderr.write(formatError(str.trim()));
    },
  });

  return program;
}

export async function runProgram(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof Error && error.name === "ExitPromptError") {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("(outputHelp)")) {
      return;
    }
    console.error(formatError(message, hintForError(message)));
    process.exitCode = 1;
  }
}
