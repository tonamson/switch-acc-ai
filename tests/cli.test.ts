import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeAll, describe, expect, it } from "vitest";
import { writeFakeCodex } from "./helpers/fakeCodex.js";
import { writeFakeGrok } from "./helpers/fakeGrok.js";

const repoRoot = process.cwd();
const binPath = join(repoRoot, "dist", "bin", "sacc.js");

let root = "";
let env: NodeJS.ProcessEnv;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "sacc-cli-"));
  const binDir = join(root, "bin");
  await writeFakeCodex(binDir);
  await writeFakeGrok(binDir);
  await writeFile(
    join(binDir, "npm"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" > "$NPM_ARGS_LOG"
`,
    { mode: 0o755 },
  );
  env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH || ""}`,
    CODEX_ACCOUNTS_DIR: join(root, "accounts"),
    CODEX_SHARED_HOME: join(root, "shared"),
    GROK_ACCOUNTS_DIR: join(root, "grok-accounts"),
    GROK_SHARED_HOME: join(root, "grok-shared"),
    CODEX_ACCOUNT_LOG: join(root, "account.log"),
    CODEX_ARGS_LOG: join(root, "args.log"),
    CODEX_LOGIN_LOG: join(root, "login.log"),
    GROK_ACCOUNT_LOG: join(root, "grok-account.log"),
    GROK_ARGS_LOG: join(root, "grok-args.log"),
    GROK_LOGIN_LOG: join(root, "grok-login.log"),
    GROK_LOGIN_ARGS_LOG: join(root, "grok-login-args.log"),
    NPM_ARGS_LOG: join(root, "npm.log"),
    NO_COLOR: "1",
  };
  await mkdir(env.CODEX_SHARED_HOME!, { recursive: true });
  await mkdir(env.GROK_SHARED_HOME!, { recursive: true });
});

function run(args: string[], input?: string): string {
  return execFileSync(process.execPath, [binPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    input,
  });
}

describe("sacc cli", () => {
  it("prints help", () => {
    const output = run(["--help"]);
    expect(output).toContain("Usage");
    expect(output).toContain("sacc pick [args]");
    expect(output).toContain("sacc grok login <name>");
    expect(output).toContain("sacc update");
  });

  it("logs in and lists codex accounts", () => {
    run(["login", "acc2"]);
    const output = run(["list"]);
    expect(output).toContain("codex accounts");
    expect(output).toContain("acc2");
    expect(output).toContain("acc2@example.com");
  });

  it("shows named account status", () => {
    const output = run(["status", "acc2"]);
    expect(output).toContain("codex status");
    expect(output).toContain("acc2");
    expect(output).toContain("75% used");
    expect(output).toContain("25% left");
    expect(output).toMatch(/monthly\s+-/);
  });

  it("runs account command and forwards args", async () => {
    run(["acc2", "--model", "test-model"]);
    expect((await readFile(env.CODEX_ARGS_LOG!, "utf8")).trim()).toBe("--model test-model");
  });

  it("forwards resume args through an explicit account", async () => {
    run(["acc2", "--resume", "session-123", "--model", "test-model"]);
    expect((await readFile(env.CODEX_ARGS_LOG!, "utf8")).trim()).toBe(
      "--resume session-123 --model test-model",
    );
  });

  it("prints help instead of opening menu when stdin is not interactive", () => {
    const output = run([]);
    expect(output).toContain("Usage");
    expect(output).toContain("sacc <account> [args]");
  });

  it("updates the global package from npm", async () => {
    run(["update"]);
    expect((await readFile(env.NPM_ARGS_LOG!, "utf8")).trim()).toBe(
      "install -g switch-acc-ai@latest",
    );
  });

  it("logs in and lists grok accounts", async () => {
    run(["grok", "login", "work"]);
    const output = run(["grok", "list"]);
    expect(output).toContain("grok accounts");
    expect(output).toContain("work");
    expect(output).toContain("work@example.com");
    expect((await readFile(env.GROK_LOGIN_LOG!, "utf8")).trim()).toContain("work");
  });

  it("shows grok auth status", async () => {
    // Fake login writes auth without a live token; inject billing via mocked network in unit tests.
    // CLI path still shows signed-in identity and usage fields (unknown without network token).
    const authPath = join(env.GROK_ACCOUNTS_DIR!, "work", "auth.json");
    await writeFile(
      authPath,
      JSON.stringify({
        "https://auth.x.ai::id": {
          key: "cli-test-token",
          email: "work@example.com",
          auth_mode: "oidc",
          expires_at: "2099-01-01T00:00:00.000Z",
        },
      }),
    );
    // Without network mock, billing may fail; still expect identity + signed-in row.
    const output = run(["grok", "status", "work"]);
    expect(output).toContain("grok status");
    expect(output).toContain("work");
    expect(output).toContain("work@example.com");
    // Unified layout always shows 5h / weekly / monthly (missing → "-")
    expect(output).toMatch(/5h\s+-/);
    expect(output).toMatch(/weekly\s+-/);
    expect(output).toContain("monthly");
  });

  it("runs grok account with GROK_HOME and forwarded args", async () => {
    run(["grok", "work", "-p", "hello"]);
    expect((await readFile(env.GROK_ARGS_LOG!, "utf8")).trim()).toBe("-p hello");
    expect((await readFile(env.GROK_ACCOUNT_LOG!, "utf8")).trim()).toContain("work");
  });

  it("supports explicit codex provider commands", () => {
    run(["codex", "login", "acc3"]);
    const output = run(["codex", "list"]);
    expect(output).toContain("acc3");
  });
});
