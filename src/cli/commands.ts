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
import {
  getSessionId,
  getTodayLogPath,
  initLogger,
  logException,
  logInfo,
  logWarn,
  runtimeSnapshot,
  serializeError,
} from "../core/log.js";
import { formatAccountsTable, formatError, formatHelp, formatStatus } from "../ui/output.js";

type CreateProgramOptions = {
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

function errorHintWithLog(message: string): string {
  const hint = hintForError(message);
  const logLine = `Log: ${getTodayLogPath()}`;
  return hint ? `${hint}\n${logLine}` : logLine;
}

async function printLogsPath(): Promise<void> {
  const path = getTodayLogPath();
  console.log(`sacc logs (today)\n  ${path}`);
}

async function printList(config: AppConfig, provider: ProviderId): Promise<void> {
  const providerConfig = getProvider(config, provider);
  logInfo("list start", {
    provider,
    accountsDir: providerConfig.accountsDir,
    sharedHome: providerConfig.sharedHome,
  });
  const rows = [];
  for (const name of await listAccounts(providerConfig)) {
    try {
      const identity =
        provider === "codex"
          ? await readCodexLabel(providerConfig, name)
          : await readGrokLabel(providerConfig, name);
      rows.push({ profile: name, identity });
    } catch (error) {
      logWarn("list identity failed", {
        provider,
        account: name,
        error: serializeError(error),
      });
      rows.push({ profile: name, identity: "unknown" });
    }
  }
  logInfo("list ok", {
    provider,
    accountsDir: providerConfig.accountsDir,
    count: rows.length,
    accounts: rows,
  });
  console.log(formatAccountsTable(rows, provider));
}

async function printStatus(
  config: AppConfig,
  provider: ProviderId,
  target?: string,
  all = false,
): Promise<void> {
  logInfo("status start", { provider, target: target ?? null, all });
  const providerConfig = getProvider(config, provider);

  if (all) {
    const rows = [];
    let failed = false;
    for (const name of await listAccounts(providerConfig)) {
      try {
        const row =
          provider === "codex"
            ? await readRateLimits(providerConfig, name)
            : await readAuthStatus(providerConfig, name);
        rows.push(row);
        logInfo("status account ok", {
          provider,
          account: name,
          user: "user" in row ? row.user : undefined,
          plan: "plan" in row ? row.plan : undefined,
        });
      } catch (error) {
        failed = true;
        const message = error instanceof Error ? error.message : String(error);
        logException("status account failed", error, { provider, account: name });
        rows.push({ account: name, error: message });
      }
    }
    console.log(formatStatus(rows, provider));
    logInfo("status done", { provider, all: true, count: rows.length, failed });
    if (failed) {
      process.exitCode = 1;
    }
    return;
  }

  if (!target) {
    throw new Error(`missing account name; use sacc ${provider} status <name> or sacc ${provider} status --all`);
  }
  try {
    const row =
      provider === "codex"
        ? await readRateLimits(providerConfig, target)
        : await readAuthStatus(providerConfig, target);
    logInfo("status ok", {
      provider,
      account: target,
      user: row.user,
      plan: row.plan,
      note: row.note ?? null,
    });
    console.log(formatStatus([row], provider));
  } catch (error) {
    logException("status failed", error, { provider, account: target });
    throw error;
  }
}

async function runProvider(
  config: AppConfig,
  provider: ProviderId,
  account: string,
  args: string[],
): Promise<void> {
  logInfo("run provider", { provider, account, args });
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
  logInfo("login provider", { provider, account: name, loginArgs });
  const providerConfig = getProvider(config, provider);
  process.exitCode =
    provider === "codex"
      ? await loginCodex(providerConfig, name)
      : await loginGrok(providerConfig, name, loginArgs);
}

async function renameProvider(
  config: AppConfig,
  provider: ProviderId,
  oldName: string,
  newName: string,
): Promise<void> {
  logInfo("rename provider", { provider, from: oldName, to: newName });
  await renameAccount(getProvider(config, provider), oldName, newName);
}

async function removeProvider(
  config: AppConfig,
  provider: ProviderId,
  name: string,
): Promise<void> {
  logInfo("remove provider", { provider, account: name });
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
    logInfo("remove confirmed", { provider, account: name });
  } else {
    logWarn("remove cancelled", { provider, account: name, typed: answer });
  }
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
      logInfo("pick start", { provider, args });
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
    await renameProvider(config, provider, oldName, newName);
  });

  cmd.command("remove <name>").action(async (name: string) => {
    await removeProvider(config, provider, name);
  });

  cmd
    .argument("[account]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument("[cliArgs...]")
    .action(async (account: string | undefined, cliArgs: string[]) => {
      if (!account) {
        if (process.stdin.isTTY && process.stdout.isTTY) {
          logInfo("menu open via cli", { provider });
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

function createProgram(options: CreateProgramOptions = {}): Command {
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
    logInfo("update start");
    const result = spawnSync("npm", ["install", "-g", "switch-acc-ai@latest"], {
      stdio: "inherit",
      shell: true,
    });
    if (result.error) {
      throw result.error;
    }
    process.exitCode = result.status ?? 1;
    logInfo("update exit", { code: process.exitCode });
  });

  program
    .command("logs")
    .description("print today's log file path")
    .action(async () => {
      await printLogsPath();
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
      logInfo("pick start", { provider: "codex", args, compat: true });
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
    await renameProvider(config, "codex", oldName, newName);
  });
  program.command("remove <name>").action(async (name: string) => {
    // Compat path: same interactive confirm as provider remove, labeled codex.
    await removeProvider(config, "codex", name);
  });

  program
    .argument("[accountOrProvider]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument("[rest...]")
    .action(async (accountOrProvider: string | undefined, rest: string[]) => {
      if (!accountOrProvider) {
        if (process.stdin.isTTY && process.stdout.isTTY) {
          logInfo("menu open via cli", { provider: null });
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
            logInfo("menu open via cli", { provider: accountOrProvider });
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
  initLogger();
  const userArgs = argv.slice(2);
  const config = resolveConfig();
  logInfo("cli start", {
    argv: userArgs,
    sessionId: getSessionId(),
    logFile: getTodayLogPath(),
    config,
    runtime: runtimeSnapshot(),
  });

  const program = createProgram({ config });
  try {
    await program.parseAsync(argv);
    logInfo("cli end", {
      exitCode: process.exitCode ?? 0,
      sessionId: getSessionId(),
      logFile: getTodayLogPath(),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ExitPromptError") {
      logInfo("cli cancelled", {
        reason: "ExitPromptError",
        error: serializeError(error),
      });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("(outputHelp)")) {
      return;
    }
    logException("cli error", error, {
      argv: userArgs,
      sessionId: getSessionId(),
      logFile: getTodayLogPath(),
      runtime: runtimeSnapshot(),
    });
    console.error(formatError(message, errorHintWithLog(message)));
    process.exitCode = 1;
  }
}
