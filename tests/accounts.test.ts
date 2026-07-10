import { mkdtemp, mkdir, symlink, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  ensureProfile,
  isValidAccountName,
  linkSharedProfile,
  listAccounts,
  removeAccount,
  renameAccount,
  requireProfile,
} from "../src/core/accounts.js";
import type { AppConfig } from "../src/core/config.js";

async function testConfig(): Promise<AppConfig> {
  const root = await mkdtemp(join(tmpdir(), "sacc-accounts-"));
  return {
    accountsDir: join(root, "accounts"),
    sharedHome: join(root, "shared"),
  };
}

describe("account name validation", () => {
  it("accepts non-empty account names", () => {
    expect(isValidAccountName("acc1")).toBe(true);
    expect(isValidAccountName("main.profile_2")).toBe(true);
    expect(isValidAccountName("work-prod")).toBe(true);
    expect(isValidAccountName("flutter.steals6z+roru1l39qx20ws47d@icloud.com")).toBe(true);
  });

  it("rejects unsafe names", () => {
    expect(isValidAccountName("")).toBe(false);
    expect(isValidAccountName("   ")).toBe(false);
    expect(isValidAccountName(".")).toBe(false);
    expect(isValidAccountName("..")).toBe(false);
    expect(isValidAccountName("../acc")).toBe(false);
  });
});

describe("account filesystem operations", () => {
  it("creates profiles and lists only profile directories", async () => {
    const config = await testConfig();
    await ensureProfile(config, "acc2");
    await ensureProfile(config, "acc1");

    expect(await listAccounts(config)).toEqual(["acc1", "acc2"]);
  });

  it("requires an existing profile", async () => {
    const config = await testConfig();
    await expect(requireProfile(config, "missing")).rejects.toThrow("account not found: missing");
  });

  it("renames an account", async () => {
    const config = await testConfig();
    await ensureProfile(config, "acc2");

    await renameAccount(config, "acc2", "main");

    expect(await listAccounts(config)).toEqual(["main"]);
  });

  it("handles symlinked account directories", async () => {
    const config = await testConfig();
    const realProfile = join(config.sharedHome, "real-acc");
    await mkdir(realProfile, { recursive: true });
    await mkdir(config.accountsDir, { recursive: true });
    await symlink(realProfile, join(config.accountsDir, "acc2"));

    expect(await listAccounts(config)).toEqual(["acc2"]);
    expect(await requireProfile(config, "acc2")).toBe(join(config.accountsDir, "acc2"));

    await renameAccount(config, "acc2", "main");
    expect(await listAccounts(config)).toEqual(["main"]);

    await removeAccount(config, "main");
    expect(await listAccounts(config)).toEqual([]);
  });

  it("renames over a broken destination symlink", async () => {
    const config = await testConfig();
    await ensureProfile(config, "acc2");
    await mkdir(config.accountsDir, { recursive: true });
    await symlink(join(config.accountsDir, "missing"), join(config.accountsDir, "main"));

    await renameAccount(config, "acc2", "main");

    expect(await listAccounts(config)).toEqual(["main"]);
  });

  it("removes an account", async () => {
    const config = await testConfig();
    await ensureProfile(config, "acc2");

    await removeAccount(config, "acc2");

    expect(await listAccounts(config)).toEqual([]);
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

  it("replaces local shared assets with symlinks", async () => {
    const config = await testConfig();
    const profile = await ensureProfile(config, "acc2");
    await mkdir(config.sharedHome, { recursive: true });
    await mkdir(join(config.sharedHome, "skills"));
    await writeFile(join(config.sharedHome, "config.toml"), "model = \"gpt-5\"\n");
    await mkdir(join(profile, "skills"));
    await writeFile(join(profile, "config.toml"), "model = \"gpt-4\"\n");

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
