import { select } from "@inquirer/prompts";
import { listAccounts, removeAccount, renameAccount } from "../core/accounts.js";
import { loginCodex, runCodex } from "../core/codex.js";
import { getProvider, type AppConfig, type ProviderId } from "../core/config.js";
import { loginGrok, runGrok } from "../core/grok.js";
import { logException, logInfo } from "../core/log.js";

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
  const providerConfig = getProvider(config, provider);
  logInfo("pick choose account", {
    provider,
    args: forwardedArgs,
    accountsDir: providerConfig.accountsDir,
    sharedHome: providerConfig.sharedHome,
  });
  try {
    const name = await chooseAccount(config, provider);
    logInfo("pick selected", {
      provider,
      account: name,
      args: forwardedArgs,
      accountsDir: providerConfig.accountsDir,
    });
    process.exitCode = await runAccount(config, provider, name, forwardedArgs);
  } catch (error) {
    logException("pick failed", error, { provider, args: forwardedArgs });
    throw error;
  }
}

export async function openMainMenu(
  config: AppConfig,
  initialProvider?: ProviderId,
  forwardedArgs: string[] = [],
): Promise<void> {
  // Remember the last provider so rename/login/remove return to that workspace
  // instead of bouncing back to the top-level provider picker.
  let activeProvider: ProviderId | undefined = initialProvider;
  logInfo("menu open", {
    provider: activeProvider ?? null,
    forwardedArgs,
    config: {
      codex: config.codex,
      grok: config.grok,
    },
  });

  while (true) {
    console.clear();
    const { runInkApp } = await import("./tui/index.js");
    const action = await runInkApp(config, activeProvider ?? null);
    logInfo("menu action", {
      activeProvider: activeProvider ?? null,
      action:
        typeof action === "string"
          ? { type: action }
          : action,
    });

    if (typeof action !== "string" && action.type === "run") {
      logInfo("menu run", {
        provider: action.provider,
        account: action.account,
        args: forwardedArgs,
      });
      process.exitCode = await runAccount(config, action.provider, action.account, forwardedArgs);
      return;
    }
    if (typeof action !== "string" && action.type === "login") {
      activeProvider = action.provider;
      try {
        logInfo("menu login", {
          provider: action.provider,
          account: action.name,
        });
        const code = await loginAccount(config, action.provider, action.name);
        process.exitCode = code;
        logInfo("menu login finished", {
          provider: action.provider,
          account: action.name,
          code,
        });
        if (process.stdout.isTTY) {
          if (code === 0) {
            process.stdout.write(`\nLogin finished for "${action.name}". Returning to menu…\n`);
          } else {
            process.stdout.write(
              `\nLogin exited with code ${code}. Returning to menu…\n`,
            );
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logException("menu login failed", error, {
          provider: action.provider,
          account: action.name,
        });
        if (process.stdout.isTTY) {
          process.stdout.write(`\nLogin failed: ${message}\n`);
        }
        process.exitCode = 1;
      }
      // Brief pause so the user can read the login CLI output before the TUI redraws.
      await new Promise((resolve) => setTimeout(resolve, 600));
      continue;
    }
    if (typeof action !== "string" && action.type === "rename") {
      activeProvider = action.provider;
      // Core renameAccount logs success/failure; keep provider on the menu trail.
      logInfo("menu rename", {
        provider: action.provider,
        from: action.account,
        to: action.newName,
        providerConfig: getProvider(config, action.provider),
      });
      await renameAccount(getProvider(config, action.provider), action.account, action.newName);
      continue;
    }
    if (typeof action !== "string" && action.type === "remove") {
      activeProvider = action.provider;
      logInfo("menu remove", {
        provider: action.provider,
        account: action.account,
        providerConfig: getProvider(config, action.provider),
      });
      await removeAccount(getProvider(config, action.provider), action.account);
      continue;
    }
    if (action === "exit") {
      logInfo("menu exit", { activeProvider: activeProvider ?? null });
      return;
    }
  }
}
