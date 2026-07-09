# switch-acc-ai Node CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the existing `cx` Bash CLI into a public npm package named `switch-acc-ai` exposing a single `swa` command with TypeScript modules and a polished command-palette CLI.

**Architecture:** Build a TypeScript CLI with a thin executable entrypoint, focused core modules for config/accounts/Codex integration, and UI modules for themed output and interactive prompts. Preserve the existing Codex account storage format and command behavior while publishing only the `swa` binary.

**Tech Stack:** Node.js 20+, TypeScript, commander, @inquirer/prompts, picocolors, ora, cli-table3, Vitest, npm package `bin`.

## Global Constraints

- Package name: `switch-acc-ai`.
- Command name: `swa`.
- Runtime target: Node.js 20 or newer.
- Public npm distribution: yes.
- Expose only the `swa` command. Do not expose `cx` as a compatibility alias.
- Preserve the existing account-management behavior from `cx`.
- Keep existing Codex profile data compatible.
- Do not rewrite or manage Codex authentication itself; continue delegating OAuth to `codex login`.
- Avoid React Ink and full-screen TUI frameworks in the first port.
- Use moderate CLI dependencies: `commander`, `@inquirer/prompts`, `picocolors`, `ora`, `cli-table3`.
- Respect `NO_COLOR`.
- Use `CODEX_ACCOUNTS_DIR` or `~/.codex-accounts`.
- Use `CODEX_SHARED_HOME` or `~/.codex`.
- Account names allow letters, numbers, dot, underscore, and dash. The names `.` and `..` are invalid.
- Shared assets linked into each profile: `skills`, `plugins`, `sessions`, `config.toml`.
- Before publishing, verify that `switch-acc-ai` is available on npm. If unavailable, stop and ask for a new package name.

---

## File Structure

Create:

- `package.json`: npm metadata, dependency list, scripts, `bin.swa`.
- `tsconfig.json`: TypeScript build config.
- `vitest.config.ts`: test config.
- `src/bin/swa.ts`: executable entrypoint and top-level error boundary.
- `src/cli/commands.ts`: commander setup and command routing.
- `src/core/config.ts`: environment path resolution.
- `src/core/accounts.ts`: account filesystem operations.
- `src/core/codex.ts`: Codex child process and JSON-RPC integration.
- `src/ui/theme.ts`: color and style helpers.
- `src/ui/output.ts`: help/list/status/error rendering.
- `src/ui/menu.ts`: interactive command-palette prompts.
- `tests/helpers/fakeCodex.ts`: fake `codex` binary generator for CLI tests.
- `tests/config.test.ts`: config resolution tests.
- `tests/accounts.test.ts`: account filesystem tests.
- `tests/codex.test.ts`: Codex JSON-RPC and spawn tests.
- `tests/output.test.ts`: output rendering tests.
- `tests/cli.test.ts`: built CLI behavior tests.

Modify:

- `README.md`: document npm usage, `swa` commands, environment variables, migration from `cx`.

Leave alone unless explicitly needed:

- `cx`: existing Bash implementation can remain in the repo during the port.
- `tests/status.sh`, `tests/menu.sh`: existing Bash tests can remain as historical parity references.

---

### Task 1: Project Scaffold And Build

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/bin/swa.ts`
- Create: `tests/cli.test.ts`

**Interfaces:**
- Produces: npm scripts `build`, `test`, `typecheck`, `start`.
- Produces: executable source `src/bin/swa.ts`.
- Produces: built binary path `dist/bin/swa.js`.

- [x] **Step 1: Create failing CLI smoke test**

Create `tests/cli.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const binPath = join(repoRoot, "dist", "bin", "swa.js");

describe("swa binary", () => {
  it("builds the executable binary", () => {
    expect(existsSync(binPath)).toBe(true);
  });

  it("prints help with the package command name", () => {
    const output = execFileSync(process.execPath, [binPath, "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });

    expect(output).toContain("Usage:");
    expect(output).toContain("swa");
    expect(output).toContain("Codex account switcher");
  });
});
```

- [x] **Step 2: Create npm scaffold**

Create `package.json`:

```json
{
  "name": "switch-acc-ai",
  "version": "0.1.0",
  "description": "Switch Codex accounts and run Codex with isolated CODEX_HOME profiles.",
  "type": "module",
  "bin": {
    "swa": "dist/bin/swa.js"
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "start": "node dist/bin/swa.js"
  },
  "dependencies": {
    "@inquirer/prompts": "^7.0.0",
    "cli-table3": "^0.6.5",
    "commander": "^12.1.0",
    "ora": "^8.1.0",
    "picocolors": "^1.1.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  },
  "license": "MIT"
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"]
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
```

- [x] **Step 3: Create minimal executable entrypoint**

Create `src/bin/swa.ts`:

```ts
#!/usr/bin/env node

console.log("Codex account switcher");
```

- [x] **Step 4: Install dependencies**

Run:

```bash
npm install
```

Expected: `package-lock.json` is created and dependencies install successfully.

- [x] **Step 5: Run test to verify expected failure**

Run:

```bash
npm run build
npm test -- tests/cli.test.ts
```

Expected: test fails because `--help` is not implemented by the minimal entrypoint.

- [x] **Step 6: Add commander help shell**

Replace `src/bin/swa.ts` with:

```ts
#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("swa")
  .description("Codex account switcher")
  .helpOption("-h, --help", "show help");

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`swa: ${message}`);
  process.exitCode = 1;
});
```

- [x] **Step 7: Run scaffold verification**

Run:

```bash
npm run build
npm test -- tests/cli.test.ts
npm run typecheck
```

Expected: all commands pass.

- [x] **Step 8: Commit scaffold**

Run:

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/bin/swa.ts tests/cli.test.ts
git commit -m "feat: scaffold switch-acc-ai cli"
```

---

### Task 2: Config And Account Filesystem Core

**Files:**
- Create: `src/core/config.ts`
- Create: `src/core/accounts.ts`
- Create: `tests/config.test.ts`
- Create: `tests/accounts.test.ts`

**Interfaces:**
- Produces: `type AppConfig = { accountsDir: string; currentFile: string; sharedHome: string }`.
- Produces: `resolveConfig(env?: NodeJS.ProcessEnv, homeDir?: string): AppConfig`.
- Produces: `isValidAccountName(name: string): boolean`.
- Produces: `profileDir(config: AppConfig, name: string): string`.
- Produces: `ensureValidAccountName(name: string): void`.
- Produces: `readCurrentAccount(config: AppConfig): Promise<string | null>`.
- Produces: `writeCurrentAccount(config: AppConfig, name: string): Promise<void>`.
- Produces: `listAccounts(config: AppConfig): Promise<string[]>`.
- Produces: `ensureProfile(config: AppConfig, name: string): Promise<string>`.
- Produces: `requireProfile(config: AppConfig, name: string): Promise<string>`.
- Produces: `renameAccount(config: AppConfig, oldName: string, newName: string): Promise<void>`.
- Produces: `removeAccount(config: AppConfig, name: string): Promise<void>`.
- Produces: `linkSharedProfile(config: AppConfig, profilePath: string): Promise<void>`.

- [x] **Step 1: Write config tests**

Create `tests/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/core/config.js";

describe("resolveConfig", () => {
  it("uses default account and shared home paths", () => {
    const config = resolveConfig({}, "/tmp/example-home");

    expect(config.accountsDir).toBe("/tmp/example-home/.codex-accounts");
    expect(config.currentFile).toBe("/tmp/example-home/.codex-accounts/.current");
    expect(config.sharedHome).toBe("/tmp/example-home/.codex");
  });

  it("uses environment overrides", () => {
    const config = resolveConfig(
      {
        CODEX_ACCOUNTS_DIR: "/tmp/accounts",
        CODEX_SHARED_HOME: "/tmp/shared-codex",
      },
      "/tmp/example-home",
    );

    expect(config.accountsDir).toBe("/tmp/accounts");
    expect(config.currentFile).toBe("/tmp/accounts/.current");
    expect(config.sharedHome).toBe("/tmp/shared-codex");
  });
});
```

- [x] **Step 2: Write account tests**

Create `tests/accounts.test.ts`:

```ts
import { mkdtemp, mkdir, readFile, symlink, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  ensureProfile,
  isValidAccountName,
  linkSharedProfile,
  listAccounts,
  readCurrentAccount,
  removeAccount,
  renameAccount,
  requireProfile,
  writeCurrentAccount,
} from "../src/core/accounts.js";
import type { AppConfig } from "../src/core/config.js";

async function testConfig(): Promise<AppConfig> {
  const root = await mkdtemp(join(tmpdir(), "swa-accounts-"));
  return {
    accountsDir: join(root, "accounts"),
    currentFile: join(root, "accounts", ".current"),
    sharedHome: join(root, "shared"),
  };
}

describe("account name validation", () => {
  it("accepts letters numbers dots underscores and dashes", () => {
    expect(isValidAccountName("acc1")).toBe(true);
    expect(isValidAccountName("main.profile_2")).toBe(true);
    expect(isValidAccountName("work-prod")).toBe(true);
  });

  it("rejects unsafe names", () => {
    expect(isValidAccountName("")).toBe(false);
    expect(isValidAccountName(".")).toBe(false);
    expect(isValidAccountName("..")).toBe(false);
    expect(isValidAccountName("../acc")).toBe(false);
    expect(isValidAccountName("has space")).toBe(false);
  });
});

describe("account filesystem operations", () => {
  it("creates profiles and lists only profile directories", async () => {
    const config = await testConfig();
    await ensureProfile(config, "acc2");
    await ensureProfile(config, "acc1");
    await writeFile(config.currentFile, "acc2\n");

    expect(await listAccounts(config)).toEqual(["acc1", "acc2"]);
  });

  it("reads and writes current account", async () => {
    const config = await testConfig();
    expect(await readCurrentAccount(config)).toBeNull();
    await writeCurrentAccount(config, "acc2");
    expect(await readCurrentAccount(config)).toBe("acc2");
  });

  it("requires an existing profile", async () => {
    const config = await testConfig();
    await expect(requireProfile(config, "missing")).rejects.toThrow("account not found: missing");
  });

  it("renames current account and updates .current", async () => {
    const config = await testConfig();
    await ensureProfile(config, "acc2");
    await writeCurrentAccount(config, "acc2");

    await renameAccount(config, "acc2", "main");

    expect(await listAccounts(config)).toEqual(["main"]);
    expect(await readCurrentAccount(config)).toBe("main");
  });

  it("removes current account and clears .current", async () => {
    const config = await testConfig();
    await ensureProfile(config, "acc2");
    await writeCurrentAccount(config, "acc2");

    await removeAccount(config, "acc2");

    expect(await listAccounts(config)).toEqual([]);
    expect(await readCurrentAccount(config)).toBeNull();
  });

  it("links shared profile assets when missing", async () => {
    const config = await testConfig();
    const profile = await ensureProfile(config, "acc2");
    await mkdir(config.sharedHome, { recursive: true });
    await mkdir(join(config.sharedHome, "skills"));
    await writeFile(join(config.sharedHome, "config.toml"), "model = \"gpt-5\"\n");

    await linkSharedProfile(config, profile);

    expect((await lstat(join(profile, "skills"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(profile, "config.toml"))).isSymbolicLink()).toBe(true);
  });
});
```

- [x] **Step 3: Run tests to verify failure**

Run:

```bash
npm test -- tests/config.test.ts tests/accounts.test.ts
```

Expected: FAIL because `src/core/config.ts` and `src/core/accounts.ts` do not exist.

- [x] **Step 4: Implement config module**

Create `src/core/config.ts`:

```ts
import { join } from "node:path";
import { homedir } from "node:os";

export type AppConfig = {
  accountsDir: string;
  currentFile: string;
  sharedHome: string;
};

export function resolveConfig(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir(),
): AppConfig {
  const accountsDir = env.CODEX_ACCOUNTS_DIR || join(homeDir, ".codex-accounts");
  const sharedHome = env.CODEX_SHARED_HOME || join(homeDir, ".codex");

  return {
    accountsDir,
    currentFile: join(accountsDir, ".current"),
    sharedHome,
  };
}
```

- [x] **Step 5: Implement account module**

Create `src/core/accounts.ts`:

```ts
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import type { AppConfig } from "./config.js";

const sharedAssetNames = ["skills", "plugins", "sessions", "config.toml"] as const;

export function isValidAccountName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && name !== "." && name !== "..";
}

export function ensureValidAccountName(name: string): void {
  if (!isValidAccountName(name)) {
    throw new Error(`invalid account name: ${name}`);
  }
}

export function profileDir(config: AppConfig, name: string): string {
  ensureValidAccountName(name);
  return join(config.accountsDir, name);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readCurrentAccount(config: AppConfig): Promise<string | null> {
  if (!(await pathExists(config.currentFile))) {
    return null;
  }
  const value = (await readFile(config.currentFile, "utf8")).trim();
  return value.length > 0 ? value : null;
}

export async function writeCurrentAccount(config: AppConfig, name: string): Promise<void> {
  ensureValidAccountName(name);
  await mkdir(config.accountsDir, { recursive: true });
  await writeFile(config.currentFile, `${name}\n`);
}

export async function listAccounts(config: AppConfig): Promise<string[]> {
  if (!(await pathExists(config.accountsDir))) {
    return [];
  }
  const entries = await readdir(config.accountsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(isValidAccountName)
    .sort((a, b) => a.localeCompare(b));
}

export async function ensureProfile(config: AppConfig, name: string): Promise<string> {
  const dir = profileDir(config, name);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function requireProfile(config: AppConfig, name: string): Promise<string> {
  const dir = profileDir(config, name);
  try {
    const stat = await lstat(dir);
    if (stat.isDirectory()) {
      return dir;
    }
  } catch {
    throw new Error(`account not found: ${name}`);
  }
  throw new Error(`account not found: ${name}`);
}

export async function renameAccount(config: AppConfig, oldName: string, newName: string): Promise<void> {
  const oldDir = await requireProfile(config, oldName);
  const newDir = profileDir(config, newName);
  if (await pathExists(newDir)) {
    throw new Error(`account already exists: ${newName}`);
  }
  await mkdir(config.accountsDir, { recursive: true });
  await rename(oldDir, newDir);
  if ((await readCurrentAccount(config)) === oldName) {
    await writeCurrentAccount(config, newName);
  }
}

export async function removeAccount(config: AppConfig, name: string): Promise<void> {
  const dir = await requireProfile(config, name);
  await rm(dir, { recursive: true, force: true });
  if ((await readCurrentAccount(config)) === name) {
    await rm(config.currentFile, { force: true });
  }
}

export async function linkSharedProfile(config: AppConfig, profilePath: string): Promise<void> {
  for (const assetName of sharedAssetNames) {
    const source = join(config.sharedHome, assetName);
    const target = join(profilePath, basename(assetName));
    if (!(await pathExists(source)) || (await pathExists(target))) {
      continue;
    }
    await symlink(source, target);
  }
}
```

- [x] **Step 6: Run account verification**

Run:

```bash
npm test -- tests/config.test.ts tests/accounts.test.ts
npm run typecheck
```

Expected: all commands pass.

- [x] **Step 7: Commit config and accounts**

Run:

```bash
git add src/core/config.ts src/core/accounts.ts tests/config.test.ts tests/accounts.test.ts
git commit -m "feat: add account storage core"
```

---

### Task 3: Codex Process And JSON-RPC Integration

**Files:**
- Create: `src/core/codex.ts`
- Create: `tests/helpers/fakeCodex.ts`
- Create: `tests/codex.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `requireProfile`, `ensureProfile`, `linkSharedProfile`.
- Produces: `type CodexAccount = { user: string; plan: string }`.
- Produces: `type RateWindow = { usedPercent: string; resetLabel: string }`.
- Produces: `type RateLimitStatus = { account: string; current: boolean; user: string; plan: string; primary: RateWindow; secondary: RateWindow; resetCredits: string; reached?: string }`.
- Produces: `readAccountLabel(config: AppConfig, name: string): Promise<string>`.
- Produces: `readRateLimits(config: AppConfig, name: string): Promise<RateLimitStatus>`.
- Produces: `runCodex(config: AppConfig, name: string, args: string[]): Promise<number>`.
- Produces: `loginCodex(config: AppConfig, name: string): Promise<number>`.

- [x] **Step 1: Write fake Codex helper**

Create `tests/helpers/fakeCodex.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeFakeCodex(binDir: string): Promise<string> {
  await mkdir(binDir, { recursive: true });
  const fakePath = join(binDir, "codex");
  await writeFile(
    fakePath,
    `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "app-server" && "\${2:-}" == "--stdio" ]]; then
  while IFS= read -r line; do
    case "$line" in
      *'"id":1'*)
        printf '{"id":1,"result":{"codexHome":"%s"}}\\n' "\${CODEX_HOME:-}"
        ;;
      *'"account/read"'*)
        account="$(basename "\${CODEX_HOME:-unknown}")"
        printf '{"id":2,"result":{"account":{"email":"%s@example.com","planType":"plus"}}}\\n' "$account"
        ;;
      *'"account/rateLimits/read"'*)
        account="$(basename "\${CODEX_HOME:-unknown}")"
        case "$account" in
          acc1) primary=25; secondary=50 ;;
          acc2) primary=75; secondary=90 ;;
          *) primary=1; secondary=2 ;;
        esac
        printf '{"id":3,"result":{"rateLimits":{"primary":{"usedPercent":%s,"resetsAt":1893456000},"secondary":{"usedPercent":%s,"resetsAt":1893974400},"planType":"plus"},"rateLimitResetCredits":{"availableCount":1}}}\\n' "$primary" "$secondary"
        ;;
    esac
  done
  exit 0
fi

if [[ "\${1:-}" == "login" ]]; then
  printf '%s\\n' "\${CODEX_HOME:-}" > "\${CODEX_LOGIN_LOG:?}"
  exit 0
fi

printf '%s\\n' "\${CODEX_HOME:-}" > "\${CODEX_ACCOUNT_LOG:?}"
printf '%s\\n' "$*" > "\${CODEX_ARGS_LOG:?}"
`,
    { mode: 0o755 },
  );
  return fakePath;
}
```

- [x] **Step 2: Write Codex integration tests**

Create `tests/codex.test.ts`:

```ts
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureProfile, writeCurrentAccount } from "../src/core/accounts.js";
import type { AppConfig } from "../src/core/config.js";
import { loginCodex, readAccountLabel, readRateLimits, runCodex } from "../src/core/codex.js";
import { writeFakeCodex } from "./helpers/fakeCodex.js";

let oldPath: string | undefined;

async function setup(): Promise<{ config: AppConfig; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "swa-codex-"));
  const binDir = join(root, "bin");
  await writeFakeCodex(binDir);
  oldPath = process.env.PATH;
  process.env.PATH = `${binDir}:${oldPath || ""}`;
  process.env.CODEX_ACCOUNT_LOG = join(root, "account.log");
  process.env.CODEX_ARGS_LOG = join(root, "args.log");
  process.env.CODEX_LOGIN_LOG = join(root, "login.log");
  const config = {
    accountsDir: join(root, "accounts"),
    currentFile: join(root, "accounts", ".current"),
    sharedHome: join(root, "shared"),
  };
  await mkdir(config.sharedHome, { recursive: true });
  return { config, root };
}

afterEach(() => {
  process.env.PATH = oldPath;
  delete process.env.CODEX_ACCOUNT_LOG;
  delete process.env.CODEX_ARGS_LOG;
  delete process.env.CODEX_LOGIN_LOG;
});

describe("codex integration", () => {
  it("reads account labels from app-server", async () => {
    const { config } = await setup();
    await ensureProfile(config, "acc2");

    await expect(readAccountLabel(config, "acc2")).resolves.toBe("acc2@example.com");
  });

  it("reads rate limits and marks current account", async () => {
    const { config } = await setup();
    await ensureProfile(config, "acc2");
    await writeCurrentAccount(config, "acc2");

    const status = await readRateLimits(config, "acc2");

    expect(status).toMatchObject({
      account: "acc2",
      current: true,
      user: "acc2@example.com",
      plan: "plus",
      primary: { usedPercent: "75% used" },
      secondary: { usedPercent: "90% used" },
      resetCredits: "1",
    });
  });

  it("runs Codex with CODEX_HOME and forwarded args", async () => {
    const { config } = await setup();
    const profile = await ensureProfile(config, "acc2");

    const code = await runCodex(config, "acc2", ["--model", "test-model"]);

    expect(code).toBe(0);
    expect((await readFile(process.env.CODEX_ACCOUNT_LOG!, "utf8")).trim()).toBe(profile);
    expect((await readFile(process.env.CODEX_ARGS_LOG!, "utf8")).trim()).toBe("--model test-model");
  });

  it("delegates login to codex login", async () => {
    const { config } = await setup();

    const code = await loginCodex(config, "newacc");

    expect(code).toBe(0);
    expect((await readFile(process.env.CODEX_LOGIN_LOG!, "utf8")).trim()).toContain("newacc");
  });
});
```

- [x] **Step 3: Run Codex tests to verify failure**

Run:

```bash
npm test -- tests/codex.test.ts
```

Expected: FAIL because `src/core/codex.ts` does not exist.

- [x] **Step 4: Implement Codex integration**

Create `src/core/codex.ts`:

```ts
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { ensureProfile, linkSharedProfile, readCurrentAccount, requireProfile } from "./accounts.js";
import type { AppConfig } from "./config.js";

export type RateWindow = {
  usedPercent: string;
  resetLabel: string;
};

export type RateLimitStatus = {
  account: string;
  current: boolean;
  user: string;
  plan: string;
  primary: RateWindow;
  secondary: RateWindow;
  resetCredits: string;
  reached?: string;
};

type JsonRpcMessage = {
  id?: number;
  result?: Record<string, unknown>;
  error?: unknown;
};

function codexEnv(profilePath: string): NodeJS.ProcessEnv {
  return { ...process.env, CODEX_HOME: profilePath };
}

function usedPercent(window: Record<string, unknown> | undefined): string {
  const value = window?.usedPercent;
  return typeof value === "number" ? `${value}% used` : "unknown";
}

function resetLabel(window: Record<string, unknown> | undefined): string {
  const value = window?.resetsAt;
  if (typeof value !== "number") {
    return "unknown reset";
  }
  return `resets ${new Date(value * 1000).toLocaleString()}`;
}

function getRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

async function appServerExchange(profilePath: string, includeLimits: boolean): Promise<Map<number, JsonRpcMessage>> {
  const child = spawn("codex", ["app-server", "--stdio"], {
    env: codexEnv(profilePath),
    stdio: ["pipe", "pipe", "pipe"],
  });

  const responses = new Map<number, JsonRpcMessage>();
  const rl = createInterface({ input: child.stdout });
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, 15_000);

  const reader = (async () => {
    for await (const line of rl) {
      try {
        const message = JSON.parse(line) as JsonRpcMessage;
        if (typeof message.id === "number") {
          responses.set(message.id, message);
        }
        if (responses.has(includeLimits ? 3 : 2)) {
          child.stdin.end();
          break;
        }
      } catch {
        continue;
      }
    }
  })();

  child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"swa","version":"dev"},"capabilities":{"experimentalApi":true}}}\n');
  child.stdin.write('{"jsonrpc":"2.0","id":2,"method":"account/read","params":{"refreshToken":false}}\n');
  if (includeLimits) {
    child.stdin.write('{"jsonrpc":"2.0","id":3,"method":"account/rateLimits/read","params":null}\n');
  }

  await Promise.race([reader, once(child, "exit")]);
  clearTimeout(timeout);
  child.kill("SIGTERM");

  if (!responses.has(includeLimits ? 3 : 2)) {
    throw new Error("no response from codex app-server");
  }
  return responses;
}

export async function readAccountLabel(config: AppConfig, name: string): Promise<string> {
  const profilePath = await requireProfile(config, name);
  const responses = await appServerExchange(profilePath, false);
  const message = responses.get(2);
  if (message?.error) {
    throw new Error(`${name}: ${JSON.stringify(message.error)}`);
  }
  const result = getRecord(message?.result);
  const account = getRecord(result.account);
  return String(account.email || account.username || account.accountId || name);
}

export async function readRateLimits(config: AppConfig, name: string): Promise<RateLimitStatus> {
  const profilePath = await requireProfile(config, name);
  const responses = await appServerExchange(profilePath, true);
  const accountMessage = responses.get(2);
  const limitsMessage = responses.get(3);
  if (accountMessage?.error) {
    throw new Error(`${name}: ${JSON.stringify(accountMessage.error)}`);
  }
  if (limitsMessage?.error) {
    throw new Error(`${name}: ${JSON.stringify(limitsMessage.error)}`);
  }

  const accountResult = getRecord(accountMessage?.result);
  const account = getRecord(accountResult.account);
  const limitResult = getRecord(limitsMessage?.result);
  const rateLimits = getRecord(limitResult.rateLimits);
  const primary = getRecord(rateLimits.primary);
  const secondary = getRecord(rateLimits.secondary);
  const credits = getRecord(limitResult.rateLimitResetCredits);
  const current = await readCurrentAccount(config);

  return {
    account: name,
    current: current === name,
    user: String(account.email || account.username || account.accountId || "unknown"),
    plan: String(account.planType || rateLimits.planType || "unknown"),
    primary: { usedPercent: usedPercent(primary), resetLabel: resetLabel(primary) },
    secondary: { usedPercent: usedPercent(secondary), resetLabel: resetLabel(secondary) },
    resetCredits: String(credits.availableCount ?? "unknown"),
    reached: typeof rateLimits.rateLimitReachedType === "string" ? rateLimits.rateLimitReachedType : undefined,
  };
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

export async function runCodex(config: AppConfig, name: string, args: string[]): Promise<number> {
  const profilePath = await requireProfile(config, name);
  await linkSharedProfile(config, profilePath);
  const child = spawn("codex", args, {
    env: codexEnv(profilePath),
    stdio: "inherit",
  });
  return waitForExit(child);
}

export async function loginCodex(config: AppConfig, name: string): Promise<number> {
  const profilePath = await ensureProfile(config, name);
  await linkSharedProfile(config, profilePath);
  const child = spawn("codex", ["login"], {
    env: codexEnv(profilePath),
    stdio: "inherit",
  });
  return waitForExit(child);
}
```

- [x] **Step 5: Run Codex verification**

Run:

```bash
npm test -- tests/codex.test.ts
npm run typecheck
```

Expected: all commands pass.

- [x] **Step 6: Commit Codex integration**

Run:

```bash
git add src/core/codex.ts tests/helpers/fakeCodex.ts tests/codex.test.ts
git commit -m "feat: add codex process integration"
```

---

### Task 4: Themed Output Rendering

**Files:**
- Create: `src/ui/theme.ts`
- Create: `src/ui/output.ts`
- Create: `tests/output.test.ts`

**Interfaces:**
- Consumes: `RateLimitStatus`.
- Produces: `theme.enabled: boolean`.
- Produces: `formatError(message: string, hint?: string): string`.
- Produces: `formatAccountsTable(rows: AccountListRow[]): string`.
- Produces: `formatStatus(statuses: StatusRenderRow[]): string`.
- Produces: `formatHelp(): string`.
- Produces: `type AccountListRow = { marker: "*" | "-"; profile: string; identity: string }`.
- Produces: `type StatusRenderRow = RateLimitStatus | { account: string; error: string }`.

- [x] **Step 1: Write output tests**

Create `tests/output.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatAccountsTable, formatError, formatHelp, formatStatus } from "../src/ui/output.js";

describe("output formatting", () => {
  it("formats help with swa command sections", () => {
    const output = formatHelp();

    expect(output).toContain("SWA");
    expect(output).toContain("Run");
    expect(output).toContain("swa pick [codex args]");
    expect(output).toContain("Accounts");
    expect(output).toContain("Status");
  });

  it("formats account table", () => {
    const output = formatAccountsTable([
      { marker: "-", profile: "acc1", identity: "acc1@example.com" },
      { marker: "*", profile: "acc2", identity: "acc2@example.com" },
    ]);

    expect(output).toContain("Accounts");
    expect(output).toContain("acc1");
    expect(output).toContain("acc2@example.com");
    expect(output).toContain("*");
  });

  it("formats status rows and account errors", () => {
    const output = formatStatus([
      {
        account: "acc2",
        current: true,
        user: "acc2@example.com",
        plan: "plus",
        primary: { usedPercent: "75% used", resetLabel: "resets later" },
        secondary: { usedPercent: "90% used", resetLabel: "resets later" },
        resetCredits: "1",
      },
      { account: "broken", error: "no response from codex app-server" },
    ]);

    expect(output).toContain("Status");
    expect(output).toContain("acc2 current");
    expect(output).toContain("75% used");
    expect(output).toContain("broken");
    expect(output).toContain("no response from codex app-server");
  });

  it("formats actionable errors", () => {
    const output = formatError("account not found: acc3", "Run swa list to see profiles.");

    expect(output).toContain("error");
    expect(output).toContain("account not found: acc3");
    expect(output).toContain("Run swa list to see profiles.");
  });
});
```

- [x] **Step 2: Run output tests to verify failure**

Run:

```bash
npm test -- tests/output.test.ts
```

Expected: FAIL because UI modules do not exist.

- [x] **Step 3: Implement theme module**

Create `src/ui/theme.ts`:

```ts
import pc from "picocolors";

export const colorEnabled = !process.env.NO_COLOR;

export function brand(value: string): string {
  return colorEnabled ? pc.cyan(pc.bold(value)) : value;
}

export function heading(value: string): string {
  return colorEnabled ? pc.bold(value) : value;
}

export function muted(value: string): string {
  return colorEnabled ? pc.gray(value) : value;
}

export function danger(value: string): string {
  return colorEnabled ? pc.red(value) : value;
}

export function warning(value: string): string {
  return colorEnabled ? pc.yellow(value) : value;
}
```

- [x] **Step 4: Implement output module**

Create `src/ui/output.ts`:

```ts
import Table from "cli-table3";
import type { RateLimitStatus } from "../core/codex.js";
import { brand, danger, heading, muted, warning } from "./theme.js";

export type AccountListRow = {
  marker: "*" | "-";
  profile: string;
  identity: string;
};

export type StatusRenderRow = RateLimitStatus | { account: string; error: string };

export function formatHelp(): string {
  return [
    `${brand("SWA")}  ${muted("Codex account switcher")}`,
    "",
    heading("Run"),
    "  swa                         open menu",
    "  swa <account> [codex args]   run Codex with account",
    "  swa run [codex args]         run current account",
    "  swa pick [codex args]        choose account then run",
    "  swa resume <id> [args]       resume current account",
    "",
    heading("Accounts"),
    "  swa login <name>             login Codex OAuth into a profile",
    "  swa use <name>               set current account",
    "  swa current                  print current account",
    "  swa list                     list accounts",
    "  swa rename <old> <new>       rename an account",
    "  swa remove <name>            delete an account profile",
    "",
    heading("Status"),
    "  swa status                   show current account limits",
    "  swa status <name>            show one account limits",
    "  swa status --all             show limits for all accounts",
  ].join("\n");
}

export function formatAccountsTable(rows: AccountListRow[]): string {
  const table = new Table({
    head: [muted("use"), muted("profile"), muted("identity")],
    style: { head: [], border: [] },
    chars: { mid: "", "left-mid": "", "mid-mid": "", "right-mid": "" },
  });
  for (const row of rows) {
    table.push([row.marker, row.profile, row.identity]);
  }
  return `${heading("Accounts")}\n${table.toString()}`;
}

export function formatStatus(rows: StatusRenderRow[]): string {
  const blocks = rows.map((row) => {
    if ("error" in row) {
      return [`${warning(row.account)}`, `  error         ${row.error}`].join("\n");
    }
    const suffix = row.current ? " current" : "";
    const lines = [
      `${heading(row.account)}${muted(suffix)}`,
      `  user          ${row.user}`,
      `  plan          ${row.plan}`,
      `  5h limit      ${row.primary.usedPercent} (${row.primary.resetLabel})`,
      `  weekly limit  ${row.secondary.usedPercent} (${row.secondary.resetLabel})`,
      `  reset credits ${row.resetCredits}`,
    ];
    if (row.reached) {
      lines.push(`  limit reached ${row.reached}`);
    }
    return lines.join("\n");
  });
  return `${heading("Status")}\n${blocks.join("\n\n")}`;
}

export function formatError(message: string, hint?: string): string {
  const lines = [`${danger("error")}  ${message}`];
  if (hint) {
    lines.push(`${muted("hint")}   ${hint}`);
  }
  return lines.join("\n");
}
```

- [x] **Step 5: Run output verification**

Run:

```bash
npm test -- tests/output.test.ts
npm run typecheck
```

Expected: all commands pass.

- [x] **Step 6: Commit UI output**

Run:

```bash
git add src/ui/theme.ts src/ui/output.ts tests/output.test.ts
git commit -m "feat: add cli output rendering"
```

---

### Task 5: Command Routing And Non-Interactive Behavior

**Files:**
- Modify: `src/bin/swa.ts`
- Create: `src/cli/commands.ts`
- Modify: `tests/cli.test.ts`

**Interfaces:**
- Consumes: all core and UI interfaces from Tasks 2-4.
- Produces: `createProgram(options?: CreateProgramOptions): Command`.
- Produces: `type CreateProgramOptions = { config?: AppConfig }`.

- [x] **Step 1: Replace CLI tests with command behavior coverage**

Replace `tests/cli.test.ts` with:

```ts
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeAll, describe, expect, it } from "vitest";
import { writeFakeCodex } from "./helpers/fakeCodex.js";

const repoRoot = process.cwd();
const binPath = join(repoRoot, "dist", "bin", "swa.js");

let root = "";
let env: NodeJS.ProcessEnv;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "swa-cli-"));
  const binDir = join(root, "bin");
  await writeFakeCodex(binDir);
  env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH || ""}`,
    CODEX_ACCOUNTS_DIR: join(root, "accounts"),
    CODEX_SHARED_HOME: join(root, "shared"),
    CODEX_ACCOUNT_LOG: join(root, "account.log"),
    CODEX_ARGS_LOG: join(root, "args.log"),
    CODEX_LOGIN_LOG: join(root, "login.log"),
    NO_COLOR: "1",
  };
  await mkdir(env.CODEX_SHARED_HOME!, { recursive: true });
});

function run(args: string[], input?: string): string {
  return execFileSync(process.execPath, [binPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    input,
  });
}

describe("swa cli", () => {
  it("prints help", () => {
    const output = run(["--help"]);
    expect(output).toContain("SWA");
    expect(output).toContain("swa pick [codex args]");
  });

  it("logs in and lists accounts", async () => {
    run(["login", "acc2"]);
    const output = run(["list"]);
    expect(output).toContain("Accounts");
    expect(output).toContain("acc2");
    expect(output).toContain("acc2@example.com");
  });

  it("sets and prints current account", () => {
    run(["use", "acc2"]);
    expect(run(["current"]).trim()).toBe("acc2");
  });

  it("shows current status", () => {
    const output = run(["status"]);
    expect(output).toContain("Status");
    expect(output).toContain("acc2 current");
    expect(output).toContain("75% used");
  });

  it("runs account command and forwards args", async () => {
    run(["acc2", "--model", "test-model"]);
    expect((await readFile(env.CODEX_ARGS_LOG!, "utf8")).trim()).toBe("--model test-model");
  });

  it("runs resume shortcut", async () => {
    run(["resume", "session-123", "--model", "test-model"]);
    expect((await readFile(env.CODEX_ARGS_LOG!, "utf8")).trim()).toBe("--resume session-123 --model test-model");
  });
});
```

- [x] **Step 2: Run CLI tests to verify failure**

Run:

```bash
npm run build
npm test -- tests/cli.test.ts
```

Expected: FAIL because command routing is not implemented.

- [x] **Step 3: Implement command routing**

Create `src/cli/commands.ts`:

```ts
import { Command } from "commander";
import {
  ensureProfile,
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
      marker: name === current ? "*" as const : "-" as const,
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
    .addHelpText("beforeAll", formatHelp())
    .showHelpAfterError(false)
    .exitOverride();

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

  program.command("status [name]").option("--all", "show all accounts").action(async (name: string | undefined, command: { all?: boolean }) => {
    await printStatus(config, name, Boolean(command.all));
  });

  program.command("run").allowUnknownOption(true).allowExcessArguments(true).argument("[args...]", "codex args").action(async (args: string[]) => {
    process.exitCode = await runCodex(config, await currentOrThrow(config), args);
  });

  program.command("resume <id> [args...]").allowUnknownOption(true).allowExcessArguments(true).action(async (id: string, args: string[]) => {
    process.exitCode = await runCodex(config, await currentOrThrow(config), ["--resume", id, ...args]);
  });

  program.command("pick").allowUnknownOption(true).allowExcessArguments(true).argument("[args...]", "codex args").action(async (args: string[]) => {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      const { pickAndRunAccount } = await import("../ui/menu.js");
      await pickAndRunAccount(config, args);
      return;
    }
    throw new Error("swa pick requires an interactive terminal; use swa <account> [codex args] in scripts");
  });

  program.command("rename <oldName> <newName>").action(async (oldName: string, newName: string) => {
    await renameAccount(config, oldName, newName);
  });

  program.command("remove <name>").action(async (name: string) => {
    const { input } = await import("@inquirer/prompts");
    const answer = await input({ message: `Delete account profile "${name}"? Type ${name} to confirm` });
    if (answer !== name) {
      return;
    }
    await removeAccount(config, name);
  });

  program.argument("[account]").allowUnknownOption(true).allowExcessArguments(true).argument("[codexArgs...]").action(async (account: string | undefined, codexArgs: string[]) => {
    if (!account) {
      console.log(formatHelp());
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
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("(outputHelp)")) {
      return;
    }
    console.error(formatError(message, hintForError(message)));
    process.exitCode = 1;
  }
}
```

Replace `src/bin/swa.ts` with:

```ts
#!/usr/bin/env node

import { runProgram } from "../cli/commands.js";

await runProgram();
```

- [x] **Step 4: Run CLI verification**

Run:

```bash
npm run build
npm test -- tests/cli.test.ts
npm run typecheck
```

Expected: all commands pass. If commander default help duplicates the custom help, adjust `createProgram()` to use `program.configureHelp()` or a custom `--help` action while keeping tests green.

- [x] **Step 5: Commit non-interactive CLI**

Run:

```bash
git add src/bin/swa.ts src/cli/commands.ts tests/cli.test.ts
git commit -m "feat: add swa command routing"
```

---

### Task 6: Interactive Command Palette

**Files:**
- Create: `src/ui/menu.ts`
- Modify: `src/cli/commands.ts`
- Modify: `tests/cli.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, account/core functions, Codex functions.
- Produces: `openMainMenu(config: AppConfig, forwardedArgs?: string[]): Promise<void>`.
- Produces: `pickAndRunAccount(config: AppConfig, forwardedArgs?: string[]): Promise<void>`.

- [x] **Step 1: Add non-TTY menu test**

Append to `tests/cli.test.ts`:

```ts
  it("prints help instead of opening menu when stdin is not interactive", () => {
    const output = run([]);
    expect(output).toContain("SWA");
    expect(output).toContain("swa <account> [codex args]");
  });
```

- [x] **Step 2: Run menu test**

Run:

```bash
npm run build
npm test -- tests/cli.test.ts
```

Expected: PASS with current non-interactive behavior. This locks in safe behavior for tests and pipes.

- [x] **Step 3: Implement interactive menu module**

Create `src/ui/menu.ts`:

```ts
import { select, input } from "@inquirer/prompts";
import type { AppConfig } from "../core/config.js";
import {
  ensureProfile,
  listAccounts,
  readCurrentAccount,
  removeAccount,
  renameAccount,
  writeCurrentAccount,
} from "../core/accounts.js";
import { loginCodex, readRateLimits, runCodex } from "../core/codex.js";
import { formatStatus } from "./output.js";

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

export async function pickAndRunAccount(config: AppConfig, forwardedArgs: string[] = []): Promise<void> {
  const name = await chooseAccount(config);
  await writeCurrentAccount(config, name);
  process.exitCode = await runCodex(config, name, forwardedArgs);
}

export async function openMainMenu(config: AppConfig, forwardedArgs: string[] = []): Promise<void> {
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

  if (action === "exit") {
    return;
  }
  if (action === "run") {
    await pickAndRunAccount(config, forwardedArgs);
    return;
  }
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
    console.log((await listAccounts(config)).join("\n"));
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
    const answer = await input({ message: `Delete account profile "${name}"? Type ${name} to confirm` });
    if (answer === name) {
      await removeAccount(config, name);
    }
  }
}
```

- [x] **Step 4: Wire menu only for real interactive terminal**

Modify the no-argument action in `src/cli/commands.ts`:

```ts
import { openMainMenu } from "../ui/menu.js";
```

Then change the no-account branch:

```ts
    if (!account) {
      if (process.stdin.isTTY && process.stdout.isTTY) {
        await openMainMenu(config);
      } else {
        console.log(formatHelp());
      }
      return;
    }
```

- [x] **Step 5: Run menu verification**

Run:

```bash
npm run build
npm test -- tests/cli.test.ts
npm run typecheck
```

Expected: all commands pass.

- [x] **Step 6: Commit menu**

Run:

```bash
git add src/ui/menu.ts src/cli/commands.ts tests/cli.test.ts
git commit -m "feat: add interactive command palette"
```

---

### Task 7: README Migration And Publish Checks

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Create: `tests/package.test.ts`

**Interfaces:**
- Consumes: completed CLI package.
- Produces: documented npm usage and publish guard tests.

- [x] **Step 1: Write package metadata test**

Create `tests/package.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("package metadata", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    name: string;
    bin: Record<string, string>;
    engines: Record<string, string>;
  };

  it("publishes switch-acc-ai with only the swa binary", () => {
    expect(pkg.name).toBe("switch-acc-ai");
    expect(pkg.bin).toEqual({ swa: "dist/bin/swa.js" });
  });

  it("requires Node 20 or newer", () => {
    expect(pkg.engines.node).toBe(">=20");
  });
});
```

- [x] **Step 2: Update README**

Replace README command examples so the npm package is primary. Include this content structure:

```md
# switch-acc-ai

`switch-acc-ai` provides the `swa` command for running Codex with isolated `CODEX_HOME` account profiles.

## Install

```bash
npx switch-acc-ai
npm install -g switch-acc-ai
swa status
```

## Account Storage

Profiles are stored in `~/.codex-accounts/<name>` by default. The current account is stored in `~/.codex-accounts/.current`.

`CODEX_ACCOUNTS_DIR` changes the profile root. `CODEX_SHARED_HOME` changes the shared Codex home used for linking `skills`, `plugins`, `sessions`, and `config.toml`.

## Commands

```bash
swa
swa login main
swa use main
swa current
swa list
swa status
swa status --all
swa pick --model gpt-5
swa main --model gpt-5
swa resume <session-id>
swa rename main backup
swa remove backup
```

## Migration From cx

The old Bash command was `cx`. The npm package exposes only `swa`.

```bash
cx status        # old
swa status       # new
```
```

Keep any useful existing Vietnamese explanation if desired, but all examples must use `swa`.

- [x] **Step 3: Run package and docs checks**

Run:

```bash
npm test -- tests/package.test.ts
npm run build
npm run typecheck
npm pack --dry-run
```

Expected: tests/typecheck/build pass and `npm pack --dry-run` includes `dist`, `README.md`, and package metadata.

- [x] **Step 4: Check package name availability before publish**

Run:

```bash
npm view switch-acc-ai name
```

Expected if available: npm exits non-zero with a 404-style not found response. If it returns `switch-acc-ai`, stop and ask the user for a different package name.

- [x] **Step 5: Commit README and package checks**

Run:

```bash
git add README.md package.json tests/package.test.ts
git commit -m "docs: document swa npm usage"
```

---

### Task 8: Final Verification

**Files:**
- Modify only if verification exposes a defect in files created by earlier tasks.

**Interfaces:**
- Consumes: complete package implementation.
- Produces: verified build, tests, and local executable behavior.

- [x] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: all Vitest suites pass.

- [x] **Step 2: Run typecheck and build**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands pass.

- [x] **Step 3: Run local binary help**

Run:

```bash
node dist/bin/swa.js --help
```

Expected: output contains `SWA`, `Codex account switcher`, and `swa status --all`.

- [x] **Step 4: Run local package smoke command**

Run:

```bash
npm exec -- swa --help
```

Expected: output contains `SWA` and exits 0.

- [x] **Step 5: Confirm worktree state**

Run:

```bash
git status --short
```

Expected: only intentional changes remain. Pre-existing dirty files `cx` and `tests/status.sh` may still appear if they were not part of this implementation.

- [x] **Step 6: Commit any verification fixes**

If Step 1-5 required fixes, commit them:

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src tests README.md
git commit -m "fix: stabilize swa package verification"
```

If no fixes were required, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: package name, command name, Node 20, TypeScript, npm `bin`, storage compatibility, Codex spawn/app-server integration, UI direction, error handling, tests, README migration, and package-name verification are covered by Tasks 1-8.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: `AppConfig`, account functions, Codex status types, UI render types, `createProgram`, and `openMainMenu` are defined before later tasks consume them.
