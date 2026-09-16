import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ensureProfile } from "../src/core/accounts.js";
import {
  loginAntigravity,
  readAccountLabel,
  readUsageStatus,
  runAntigravity,
} from "../src/core/antigravity.js";
import type { ProviderConfig } from "../src/core/config.js";
import { writeFakeAntigravity } from "./helpers/fakeAntigravity.js";

let oldPath: string | undefined;

async function setup(): Promise<{ config: ProviderConfig; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "sacc-antigravity-"));
  const binDir = join(root, "bin");
  await writeFakeAntigravity(binDir);
  oldPath = process.env.PATH;
  process.env.PATH = `${binDir}:${oldPath || ""}`;
  process.env.ANTIGRAVITY_HOME_LOG = join(root, "home.log");
  process.env.ANTIGRAVITY_ARGS_LOG = join(root, "args.log");
  process.env.SACC_LOG_DIR = join(root, "sacc-logs");
  const config = {
    accountsDir: join(root, "accounts"),
    sharedHome: join(root, "shared"),
  };
  await mkdir(config.sharedHome, { recursive: true });
  return { config, root };
}

afterEach(() => {
  process.env.PATH = oldPath;
  delete process.env.ANTIGRAVITY_HOME_LOG;
  delete process.env.ANTIGRAVITY_ARGS_LOG;
  delete process.env.SACC_LOG_DIR;
});

describe("antigravity integration", () => {
  it("reports not signed in before first run", async () => {
    const { config } = await setup();
    await ensureProfile(config, "empty");

    await expect(readAccountLabel(config, "empty")).resolves.toBe("Not signed in");
  });

  it("reports signed in once the profile has a settings.json", async () => {
    const { config } = await setup();
    const profile = await ensureProfile(config, "work");
    await mkdir(join(profile, ".gemini", "antigravity-cli"), { recursive: true });
    await writeFile(join(profile, ".gemini", "antigravity-cli", "settings.json"), "{}");

    await expect(readAccountLabel(config, "work")).resolves.toBe(
      "Signed in (identity hidden by OS keyring)",
    );
  });

  it("always reports usage as unavailable (no CLI-exposed rate-limit API)", async () => {
    const { config } = await setup();
    await ensureProfile(config, "work");

    const status = await readUsageStatus(config, "work");

    expect(status).toMatchObject({
      account: "work",
      fiveHour: { usedPercent: null },
      weekly: { usedPercent: null },
      monthly: { usedPercent: null },
    });
    expect(status.note).toContain("usage not exposed");
  });

  it("runs agy with a per-profile HOME override and forwarded args", async () => {
    const { config } = await setup();
    const profile = await ensureProfile(config, "work");

    const code = await runAntigravity(config, "work", ["-p", "hello"]);

    expect(code).toBe(0);
    expect((await readFile(process.env.ANTIGRAVITY_HOME_LOG!, "utf8")).trim()).toBe(profile);
    expect((await readFile(process.env.ANTIGRAVITY_ARGS_LOG!, "utf8")).trim()).toBe("-p hello");
  });

  it("login launches agy bare (no login subcommand) under the profile HOME", async () => {
    const { config } = await setup();

    const code = await loginAntigravity(config, "newacc");

    expect(code).toBe(0);
    expect((await readFile(process.env.ANTIGRAVITY_ARGS_LOG!, "utf8")).trim()).toBe("");
    const home = (await readFile(process.env.ANTIGRAVITY_HOME_LOG!, "utf8")).trim();
    expect(home).toContain("newacc");
  });
});
