import { spawnSync } from "node:child_process";
import { Command } from "commander";
import {
  listAccounts,
  removeAccount,
  renameAccount,
  requireProfile,
} from "../core/accounts.js";
import { loginCodex, readAccountLabel, readRateLimits, runCodex } from "../core/codex.js";
import { resolveConfig, type AppConfig } from "../core/config.js";
import { formatAccountsTable, formatError, formatHelp, formatStatus } from "../ui/output.js";

export type CreateProgramOptions = {
  config?: AppConfig;
};

function hintForError(message: string): string | undefined {
  if (message.startsWith("account not found:")) {
    return "Run sacc login <name> to create it, or sacc list to see profiles.";
  }
  if (message.startsWith("invalid account name:")) {
    return "Use any non-empty name.";
  }
  return undefined;
}

async function printList(config: AppConfig): Promise<void> {
  const rows = [];
  for (const name of await listAccounts(config)) {
    rows.push({
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

  if (!target) {
    throw new Error("missing account name; use sacc status <name> or sacc status --all");
  }
  const name = target;
  console.log(formatStatus([await readRateLimits(config, name)]));
}

export function createProgram(options: CreateProgramOptions = {}): Command {
  const config = options.config || resolveConfig();
  const program = new Command();

  program
    .name("sacc")
    .description("Codex account switcher")
    .helpOption("-h, --help", "show help")
    .showHelpAfterError(false)
    .exitOverride();
  program.helpInformation = () => `${formatHelp()}\n`;

  program.command("login <name>").action(async (name: string) => {
    process.exitCode = await loginCodex(config, name);
  });

  program.command("list").action(async () => printList(config));

  program.command("update").action(() => {
    const result = spawnSync("npm", ["install", "-g", "switch-acc-ai@latest"], {
      stdio: "inherit",
    });
    if (result.error) {
      throw result.error;
    }
    process.exitCode = result.status ?? 1;
  });

  program
    .command("status [name]")
    .option("--all", "show all accounts")
    .action(async (name: string | undefined, command: { all?: boolean }) => {
      await printStatus(config, name, Boolean(command.all));
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
        "sacc pick requires an interactive terminal; use sacc <account> [codex args] in scripts",
      );
    });

  program.command("rename <oldName> <newName>").action(async (oldName: string, newName: string) => {
    await renameAccount(config, oldName, newName);
  });

  program.command("remove <name>").action(async (name: string) => {
    await requireProfile(config, name);
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error("sacc remove requires an interactive terminal");
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
