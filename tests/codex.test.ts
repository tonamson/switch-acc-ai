import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ensureProfile } from "../src/core/accounts.js";
import type { ProviderConfig } from "../src/core/config.js";
import { loginCodex, readAccountLabel, readRateLimits, runCodex } from "../src/core/codex.js";
import { writeFakeCodex } from "./helpers/fakeCodex.js";

let oldPath: string | undefined;

async function setup(): Promise<{ config: ProviderConfig; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "sacc-codex-"));
  const binDir = join(root, "bin");
  await writeFakeCodex(binDir);
  oldPath = process.env.PATH;
  process.env.PATH = `${binDir}:${oldPath || ""}`;
  process.env.CODEX_ACCOUNT_LOG = join(root, "account.log");
  process.env.CODEX_ARGS_LOG = join(root, "args.log");
  process.env.CODEX_LOGIN_LOG = join(root, "login.log");
  const config = {
    accountsDir: join(root, "accounts"),
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
  delete process.env.CODEX_APP_SERVER_EXIT_LOG;
});

describe("codex integration", () => {
  it("reads account labels from app-server", async () => {
    const { config } = await setup();
    await ensureProfile(config, "acc2");

    await expect(readAccountLabel(config, "acc2")).resolves.toBe("acc2@example.com");
  });

  it("reads rate limits", async () => {
    const { config } = await setup();
    await ensureProfile(config, "acc2");

    const status = await readRateLimits(config, "acc2");

    expect(status).toMatchObject({
      account: "acc2",
      user: "acc2@example.com",
      plan: "plus",
      fiveHour: { usedPercent: "75% used", remaining: "25% left" },
      weekly: { usedPercent: "90% used", remaining: "10% left" },
      monthly: { usedPercent: null, remaining: null, reset: null },
      credits: "1",
    });
    expect(status.fiveHour.reset).toMatch(
      /^resets \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \S+$/,
    );
  });

  it("prefers keyed rate limits and closes app-server via stdin", async () => {
    const { config, root } = await setup();
    process.env.CODEX_APP_SERVER_EXIT_LOG = join(root, "app-server-exit.log");
    await ensureProfile(config, "keyed");

    const status = await readRateLimits(config, "keyed");

    expect(status).toMatchObject({
      account: "keyed",
      user: "keyed@example.com",
      plan: "plus",
      fiveHour: { usedPercent: "61% used", remaining: "39% left" },
      weekly: { usedPercent: "22% used", remaining: "78% left" },
      monthly: { usedPercent: null, remaining: null, reset: null },
      credits: "7",
    });
    expect((await readFile(process.env.CODEX_APP_SERVER_EXIT_LOG, "utf8")).trim()).toBe("stdin-closed");
  });

  it("falls back to legacy credit balance when availableCount is missing", async () => {
    const { config } = await setup();
    await ensureProfile(config, "legacy");

    const status = await readRateLimits(config, "legacy");

    expect(status).toMatchObject({
      account: "legacy",
      fiveHour: { usedPercent: "44% used", remaining: "56% left" },
      weekly: { usedPercent: "11% used", remaining: "89% left" },
      monthly: { usedPercent: null, remaining: null, reset: null },
      credits: "3",
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
