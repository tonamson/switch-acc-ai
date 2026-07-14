import { spawnSync } from "node:child_process";
import { Command } from "commander";
import {
  listAccounts,
  removeAccount,
  renameAccount,
  requireProfile,
} from "../core/accounts.js";
import {
  loginCodex,
  readAccountLabel as readCodexLabel,
  readRateLimits,
  runCodex,
} from "../core/codex.js";
import {
  getProvider,
  isProviderId,
  resolveConfig,
  type AppConfig,
  type ProviderId,
} from "../core/config.js";
import {
  loginGrok,
  readAccountLabel as readGrokLabel,
  readAuthStatus,
  runGrok,
} from "../core/grok.js";
import { formatAccountsTable, formatError, formatHelp, formatStatus } from "../ui/output.js";

export type CreateProgramOptions = {
  config?: AppConfig;
};

function hintForError(message: string): string | undefined {
  if (message.startsWith("account not found:")) {
    return "Run sacc login <provider> <name> or sacc list <provider>.";
  }
  if (message.startsWith("invalid account name:")) {
    return "Use any non-empty name.";
  }
  if (message.includes("Is the Grok CLI installed")) {
    return "Install Grok CLI: curl -fsSL https://x.ai/cli/install.sh | bash";
  }
  if (message.includes("Is the codex CLI installed")) {
    return "Install Codex CLI and ensure it is on PATH.";
  }
  return undefined;
}

async function printList(config: AppConfig, provider: ProviderId): Promise<void> {
  const providerConfig = getProvider(config, provider);
  const rows = [];
  for (const name of await listAccounts(providerConfig)) {
    const identity =
      provider === "codex"
        ? await readCodexLabel(providerConfig, name).catch(() => "unknown")
        : await readGrokLabel(providerConfig, name).catch(() => "unknown");
    rows.push({
      profile: name,
      identity,
    });
  }
  console.log(formatAccountsTable(rows, provider));
}

async function printStatus(
  config: AppConfig,
  provider: ProviderId,
  target?: string,
  all = false,
): Promise<void> {
  const providerConfig = getProvider(config, provider);

  if (all) {
    const rows = [];
    let failed = false;
    for (const name of await listAccounts(providerConfig)) {
      try {
        rows.push(
          provider === "codex"
            ? await readRateLimits(providerConfig, name)
            : await readAuthStatus(providerConfig, name),
        );
      } catch (error) {
        failed = true;
        rows.push({ account: name, error: error instanceof Error ? error.message : String(error) });
      }
    }
    console.log(formatStatus(rows, provider));
    if (failed) {
      process.exitCode = 1;
    }
    return;
  }

  if (!target) {
    throw new Error(`missing account name; use sacc ${provider} status <name> or sacc ${provider} status --all`);
  }
  const row =
    provider === "codex"
      ? await readRateLimits(providerConfig, target)
      : await readAuthStatus(providerConfig, target);
  console.log(formatStatus([row], provider));
}

async function runProvider(
  config: AppConfig,
  provider: ProviderId,
  account: string,
  args: string[],
): Promise<void> {
  const providerConfig = getProvider(config, provider);
  await requireProfile(providerConfig, account);
  process.exitCode =
    provider === "codex"
      ? await runCodex(providerConfig, account, args)
      : await runGrok(providerConfig, account, args);
}

async function loginProvider(
  config: AppConfig,
  provider: ProviderId,
  name: string,
  loginArgs: string[] = [],
): Promise<void> {
  const providerConfig = getProvider(config, provider);
  process.exitCode =
    provider === "codex"
      ? await loginCodex(providerConfig, name)
      : await loginGrok(providerConfig, name, loginArgs);
}

function addProviderCommands(parent: Command, config: AppConfig, provider: ProviderId): void {
  const cmd = parent
    .command(provider)
    .description(`${provider === "codex" ? "Codex" : "Grok"} account profiles`);

  cmd
    .command("login <name>")
    .description(`login ${provider} into a profile`)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument("[loginArgs...]", "extra login args")
    .action(async (name: string, loginArgs: string[]) => {
      await loginProvider(config, provider, name, loginArgs);
    });

  cmd.command("list").action(async () => printList(config, provider));

  cmd
    .command("status [name]")
    .option("--all", "show all accounts")
    .action(async (name: string | undefined, command: { all?: boolean }) => {
      await printStatus(config, provider, name, Boolean(command.all));
    });

  cmd
    .command("pick")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument("[args...]", `${provider} args`)
    .action(async (args: string[]) => {
      if (process.stdin.isTTY && process.stdout.isTTY) {
        const { pickAndRunAccount } = await import("../ui/menu.js");
        await pickAndRunAccount(config, provider, args);
        return;
      }
      throw new Error(
        `sacc ${provider} pick requires an interactive terminal; use sacc ${provider} <account> [args] in scripts`,
      );
    });

  cmd.command("rename <oldName> <newName>").action(async (oldName: string, newName: string) => {
    await renameAccount(getProvider(config, provider), oldName, newName);
  });

  cmd.command("remove <name>").action(async (name: string) => {
    await requireProfile(getProvider(config, provider), name);
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error(`sacc ${provider} remove requires an interactive terminal`);
    }
    const { input } = await import("@inquirer/prompts");
    const answer = await input({
      message: `Delete ${provider} account profile "${name}"? Type ${name} to confirm`,
    });
    if (answer === name) {
      await removeAccount(getProvider(config, provider), name);
    }
  });

  cmd
    .argument("[account]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument("[cliArgs...]")
    .action(async (account: string | undefined, cliArgs: string[]) => {
      if (!account) {
        if (process.stdin.isTTY && process.stdout.isTTY) {
          const { openMainMenu } = await import("../ui/menu.js");
          await openMainMenu(config, provider);
        } else {
          console.log(formatHelp());
        }
        return;
      }
      await runProvider(config, provider, account, cliArgs);
    });
}

export function createProgram(options: CreateProgramOptions = {}): Command {
  const config = options.config || resolveConfig();
  const program = new Command();

  program
    .name("sacc")
    .description("Multi-provider AI account switcher (Codex + Grok)")
    .helpOption("-h, --help", "show help")
    .showHelpAfterError(false)
    .exitOverride();
  program.helpInformation = () => `${formatHelp()}\n`;

  program.command("update").action(() => {
    const result = spawnSync("npm", ["install", "-g", "switch-acc-ai@latest"], {
      stdio: "inherit",
      shell: true,
    });
    if (result.error) {
      throw result.error;
    }
    process.exitCode = result.status ?? 1;
  });

  addProviderCommands(program, config, "codex");
  addProviderCommands(program, config, "grok");

  // Backward-compatible shortcuts default to Codex.
  program.command("login <name>").action(async (name: string) => {
    await loginProvider(config, "codex", name);
  });
  program.command("list").action(async () => printList(config, "codex"));
  program
    .command("status [name]")
    .option("--all", "show all accounts")
    .action(async (name: string | undefined, command: { all?: boolean }) => {
      await printStatus(config, "codex", name, Boolean(command.all));
    });
  program
    .command("pick")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument("[args...]", "codex args")
    .action(async (args: string[]) => {
      if (process.stdin.isTTY && process.stdout.isTTY) {
        const { pickAndRunAccount } = await import("../ui/menu.js");
        await pickAndRunAccount(config, "codex", args);
        return;
      }
      throw new Error(
        "sacc pick requires an interactive terminal; use sacc codex <account> [args] in scripts",
      );
    });
  program.command("rename <oldName> <newName>").action(async (oldName: string, newName: string) => {
    await renameAccount(config.codex, oldName, newName);
  });
  program.command("remove <name>").action(async (name: string) => {
    await requireProfile(config.codex, name);
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error("sacc remove requires an interactive terminal");
    }
    const { input } = await import("@inquirer/prompts");
    const answer = await input({ message: `Delete account profile "${name}"? Type ${name} to confirm` });
    if (answer === name) {
      await removeAccount(config.codex, name);
    }
  });

  program
    .argument("[accountOrProvider]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument("[rest...]")
    .action(async (accountOrProvider: string | undefined, rest: string[]) => {
      if (!accountOrProvider) {
        if (process.stdin.isTTY && process.stdout.isTTY) {
          const { openMainMenu } = await import("../ui/menu.js");
          await openMainMenu(config);
        } else {
          console.log(formatHelp());
        }
        return;
      }

      // If first arg is a provider name and no subcommand matched, treat as provider account run:
      // sacc codex work  -> handled by provider command tree already when subcommands match.
      // Bare account name defaults to Codex for backward compatibility.
      if (isProviderId(accountOrProvider)) {
        // Commander should have routed provider subcommands; if we land here with only the
        // provider name and no args, open that provider menu when TTY.
        if (rest.length === 0) {
          if (process.stdin.isTTY && process.stdout.isTTY) {
            const { openMainMenu } = await import("../ui/menu.js");
            await openMainMenu(config, accountOrProvider);
          } else {
            console.log(formatHelp());
          }
          return;
        }
        await runProvider(config, accountOrProvider, rest[0], rest.slice(1));
        return;
      }

      await runProvider(config, "codex", accountOrProvider, rest);
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
