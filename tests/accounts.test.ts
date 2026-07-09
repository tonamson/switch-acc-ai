import { mkdtemp, mkdir, symlink, writeFile, lstat } from "node:fs/promises";
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

  it("returns null for a broken current symlink", async () => {
    const config = await testConfig();
    await mkdir(config.accountsDir, { recursive: true });
    await symlink(join(config.accountsDir, "missing"), config.currentFile);

    expect(await readCurrentAccount(config)).toBeNull();
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

  it("renames over a broken destination symlink", async () => {
    const config = await testConfig();
    await ensureProfile(config, "acc2");
    await mkdir(config.accountsDir, { recursive: true });
    await symlink(join(config.accountsDir, "missing"), join(config.accountsDir, "main"));

    await renameAccount(config, "acc2", "main");

    expect(await listAccounts(config)).toEqual(["main"]);
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

  it("links broken shared symlinks into the profile", async () => {
    const config = await testConfig();
    const profile = await ensureProfile(config, "acc2");
    await mkdir(config.sharedHome, { recursive: true });
    await symlink(join(config.sharedHome, "missing-skills"), join(config.sharedHome, "skills"));

    await linkSharedProfile(config, profile);

    expect((await lstat(join(profile, "skills"))).isSymbolicLink()).toBe(true);
  });

  it("skips broken symlinks already present in the profile", async () => {
    const config = await testConfig();
    const profile = await ensureProfile(config, "acc2");
    await mkdir(config.sharedHome, { recursive: true });
    await symlink(join(config.sharedHome, "missing-skills"), join(config.sharedHome, "skills"));
    await symlink(join(config.sharedHome, "missing-skills"), join(profile, "skills"));

    await linkSharedProfile(config, profile);

    expect((await lstat(join(profile, "skills"))).isSymbolicLink()).toBe(true);
  });
});
