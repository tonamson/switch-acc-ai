import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
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
