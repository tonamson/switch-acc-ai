import {
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  rename,
  symlink,
  utimes,
  writeFile,
  lstat,
} from "node:fs/promises";
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
  watchSharedProfileLinks,
} from "../src/core/accounts.js";
import type { ProviderConfig } from "../src/core/config.js";

async function testConfig(): Promise<ProviderConfig> {
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

  it("links grok shared assets including installed-plugins", async () => {
    const config = await testConfig();
    const profile = await ensureProfile(config, "work");
    await mkdir(config.sharedHome, { recursive: true });
    await mkdir(join(config.sharedHome, "agents"));
    await mkdir(join(config.sharedHome, "skills"));
    await mkdir(join(config.sharedHome, "installed-plugins"));
    await writeFile(join(config.sharedHome, "config.toml"), "model = \"shared\"\n");

    await linkSharedProfile(config, profile, "grok");

    expect((await lstat(join(profile, "agents"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(profile, "skills"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(profile, "installed-plugins"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(profile, "config.toml"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(profile, "config.toml"))).toBe(join(config.sharedHome, "config.toml"));
  });

  it("promotes private grok install dirs into shared then symlinks all profiles", async () => {
    const config = await testConfig();
    const a = await ensureProfile(config, "acc-a");
    const b = await ensureProfile(config, "acc-b");
    await mkdir(config.sharedHome, { recursive: true });
    // Private install only on account A — should become global ~/.grok equivalent.
    await mkdir(join(a, "installed-plugins", "figma"), { recursive: true });
    await writeFile(join(a, "installed-plugins", "figma", "plugin.json"), "{}\n");
    await writeFile(join(a, "config.toml"), "plugins = [\"figma\"]\n");

    await linkSharedProfile(config, a, "grok");
    await linkSharedProfile(config, b, "grok");

    expect((await lstat(join(a, "installed-plugins"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(b, "installed-plugins"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(a, "installed-plugins"))).toBe(join(config.sharedHome, "installed-plugins"));
    expect(await readlink(join(b, "config.toml"))).toBe(join(config.sharedHome, "config.toml"));
    expect(await readFile(join(config.sharedHome, "installed-plugins", "figma", "plugin.json"), "utf8")).toBe(
      "{}\n",
    );
    expect(await readFile(join(config.sharedHome, "config.toml"), "utf8")).toBe('plugins = ["figma"]\n');
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

  it("promotes a newer private config.toml into shared then re-symlinks", async () => {
    const config = await testConfig();
    const profile = await ensureProfile(config, "work");
    await mkdir(config.sharedHome, { recursive: true });
    const sharedConfig = join(config.sharedHome, "config.toml");
    const privateConfig = join(profile, "config.toml");
    await writeFile(sharedConfig, "model = \"old-global\"\n");
    // Simulate Grok atomic-write: replace symlink with a newer private file.
    await writeFile(privateConfig, "model = \"from-grok-write\"\n");
    const past = new Date(Date.now() - 60_000);
    const now = new Date();
    await utimes(sharedConfig, past, past);
    await utimes(privateConfig, now, now);

    await linkSharedProfile(config, profile, "grok");

    expect((await lstat(privateConfig)).isSymbolicLink()).toBe(true);
    expect(await readlink(privateConfig)).toBe(sharedConfig);
    expect(await readFile(sharedConfig, "utf8")).toBe("model = \"from-grok-write\"\n");
  });

  it("keeps older private config from clobbering a newer shared config", async () => {
    const config = await testConfig();
    const profile = await ensureProfile(config, "stale");
    await mkdir(config.sharedHome, { recursive: true });
    const sharedConfig = join(config.sharedHome, "config.toml");
    const privateConfig = join(profile, "config.toml");
    await writeFile(sharedConfig, "model = \"good-global\"\n");
    await writeFile(privateConfig, "model = \"stale-private\"\n");
    const past = new Date(Date.now() - 60_000);
    const now = new Date();
    await utimes(privateConfig, past, past);
    await utimes(sharedConfig, now, now);

    await linkSharedProfile(config, profile, "grok");

    expect((await lstat(privateConfig)).isSymbolicLink()).toBe(true);
    expect(await readFile(sharedConfig, "utf8")).toBe("model = \"good-global\"\n");
  });

  it("watch guard re-links when config.toml is replaced with a regular file", async () => {
    const config = await testConfig();
    const profile = await ensureProfile(config, "guarded");
    await mkdir(config.sharedHome, { recursive: true });
    const sharedConfig = join(config.sharedHome, "config.toml");
    const privateConfig = join(profile, "config.toml");
    await writeFile(sharedConfig, "model = \"shared\"\n");
    await linkSharedProfile(config, profile, "grok");
    expect((await lstat(privateConfig)).isSymbolicLink()).toBe(true);

    const guard = watchSharedProfileLinks(config, profile, "grok", {
      pollIntervalMs: 100,
      debounceMs: 50,
    });
    try {
      // Atomic-write style (what Grok does): write temp + rename over the symlink.
      // rename replaces the symlink with a regular file; open/write would follow it.
      const tmp = join(profile, "config.toml.tmp");
      await writeFile(tmp, "model = \"broken-private\"\n");
      await rename(tmp, privateConfig);
      expect((await lstat(privateConfig)).isSymbolicLink()).toBe(false);

      // Wait for poll/debounce + relink.
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if ((await lstat(privateConfig)).isSymbolicLink()) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect((await lstat(privateConfig)).isSymbolicLink()).toBe(true);
      expect(await readlink(privateConfig)).toBe(sharedConfig);
      expect(await readFile(sharedConfig, "utf8")).toBe("model = \"broken-private\"\n");
    } finally {
      await guard.stop();
    }
  });
});
