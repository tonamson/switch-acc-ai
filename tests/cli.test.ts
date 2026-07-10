import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeAll, describe, expect, it } from "vitest";
import { writeFakeCodex } from "./helpers/fakeCodex.js";

const repoRoot = process.cwd();
const binPath = join(repoRoot, "dist", "bin", "sacc.js");

let root = "";
let env: NodeJS.ProcessEnv;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "sacc-cli-"));
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

describe("sacc cli", () => {
  it("prints help", () => {
    const output = run(["--help"]);
    expect(output).toContain("Usage");
    expect(output).toContain("sacc pick [codex args]");
  });

  it("logs in and lists accounts", () => {
    run(["login", "acc2"]);
    const output = run(["list"]);
    expect(output).toContain("Accounts");
    expect(output).toContain("acc2");
    expect(output).toContain("acc2@example.com");
  });

  it("shows named account status", () => {
    const output = run(["status", "acc2"]);
    expect(output).toContain("Status");
    expect(output).toContain("acc2");
    expect(output).toContain("75% used");
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
    expect(output).toContain("sacc <account> [codex args]");
  });
});
