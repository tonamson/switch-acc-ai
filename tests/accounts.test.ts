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
import { createRequire } from "node:module";
import {
  ensureProfile,
  isValidAccountName,
  linkSharedProfile,
  listAccounts,
  removeAccount,
  renameAccount,
  repairCodexResumeIndex,
  repairGrokSessions,
  requireProfile,
  watchSharedProfileLinks,
} from "../src/core/accounts.js";
import type { ProviderConfig } from "../src/core/config.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => {
    prepare: (sql: string) => {
      all: (...params: unknown[]) => unknown[];
      get: (...params: unknown[]) => unknown;
      run: (...params: unknown[]) => unknown;
    };
    exec: (sql: string) => void;
    close: () => void;
  };
};

function createMinimalStateDb(
  dbPath: string,
  threads: Array<{ id: string; rollout_path: string }>,
): void {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      model_provider TEXT NOT NULL,
      cwd TEXT NOT NULL,
      title TEXT NOT NULL,
      sandbox_policy TEXT NOT NULL,
      approval_mode TEXT NOT NULL
    );
  `);
  const insert = db.prepare(
    `INSERT INTO threads
      (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy, approval_mode)
     VALUES (?, ?, 1, 1, 'cli', 'openai', '/tmp', 't', 'danger-full-access', 'never')`,
  );
  for (const thread of threads) {
    insert.run(thread.id, thread.rollout_path);
  }
  db.close();
}

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

  it("keeps a removed account hidden if another process recreates its directory", async () => {
    const config = await testConfig();
    const profile = await ensureProfile(config, "acc2");

    await removeAccount(config, "acc2");
    await mkdir(profile, { recursive: true });
    await writeFile(join(profile, "auth.json"), "{}");

    expect(await listAccounts(config)).toEqual([]);
    await expect(requireProfile(config, "acc2")).rejects.toThrow("account not found: acc2");

    await ensureProfile(config, "acc2");
    expect(await listAccounts(config)).toEqual(["acc2"]);
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

  it("links grok shared assets including installed-plugins and rules", async () => {
    const config = await testConfig();
    const profile = await ensureProfile(config, "work");
    await mkdir(config.sharedHome, { recursive: true });
    await mkdir(join(config.sharedHome, "agents"));
    await mkdir(join(config.sharedHome, "skills"));
    await mkdir(join(config.sharedHome, "installed-plugins"));
    await mkdir(join(config.sharedHome, "rules"));
    await writeFile(join(config.sharedHome, "config.toml"), "model = \"shared\"\n");

    await linkSharedProfile(config, profile, "grok");

    expect((await lstat(join(profile, "agents"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(profile, "skills"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(profile, "installed-plugins"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(profile, "rules"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(profile, "rules"))).toBe(join(config.sharedHome, "rules"));
    expect((await lstat(join(profile, "config.toml"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(profile, "config.toml"))).toBe(join(config.sharedHome, "config.toml"));
  });

  it("promotes private grok rules dir into shared then symlinks all profiles", async () => {
    const config = await testConfig();
    const a = await ensureProfile(config, "acc-a");
    const b = await ensureProfile(config, "acc-b");
    await mkdir(config.sharedHome, { recursive: true });
    await mkdir(join(a, "rules"), { recursive: true });
    await writeFile(join(a, "rules", "ponytail.md"), "always-on\n");
    await mkdir(join(b, "rules"), { recursive: true });
    await writeFile(join(b, "rules", "caveman.md"), "terse\n");

    await linkSharedProfile(config, a, "grok");
    await linkSharedProfile(config, b, "grok");

    expect((await lstat(join(a, "rules"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(b, "rules"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(a, "rules"))).toBe(join(config.sharedHome, "rules"));
    expect(await readFile(join(config.sharedHome, "rules", "ponytail.md"), "utf8")).toBe("always-on\n");
    expect(await readFile(join(config.sharedHome, "rules", "caveman.md"), "utf8")).toBe("terse\n");
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

  it("repairs stale codex rollout paths after account rename", async () => {
    const config = await testConfig();
    const profile = await ensureProfile(config, "acc-new");
    await mkdir(config.sharedHome, { recursive: true });
    await mkdir(join(config.sharedHome, "sessions", "2026", "06", "03"), { recursive: true });
    const rel = "2026/06/03/rollout-test.jsonl";
    const sharedRollout = join(config.sharedHome, "sessions", rel);
    await writeFile(sharedRollout, '{"type":"session_meta"}\n');
    await symlink(join(config.sharedHome, "sessions"), join(profile, "sessions"));

    const stalePath = join(config.accountsDir, "acc-old", "sessions", rel);
    createMinimalStateDb(join(profile, "state_5.sqlite"), [
      { id: "thread-1", rollout_path: stalePath },
    ]);

    const result = await repairCodexResumeIndex(profile, config.sharedHome);
    expect(result.rewritten).toBe(1);

    const db = new DatabaseSync(join(profile, "state_5.sqlite"));
    const row = db.prepare("SELECT rollout_path FROM threads WHERE id = ?").get("thread-1") as {
      rollout_path: string;
    };
    db.close();
    expect(row.rollout_path).toBe(join(profile, "sessions", rel));
  });

  it("merges sibling account threads into codex resume index on link", async () => {
    const config = await testConfig();
    const a = await ensureProfile(config, "acc-a");
    const b = await ensureProfile(config, "acc-b");
    await mkdir(config.sharedHome, { recursive: true });
    await mkdir(join(config.sharedHome, "sessions", "2026", "07", "01"), { recursive: true });
    const rel = "2026/07/01/rollout-shared.jsonl";
    await writeFile(join(config.sharedHome, "sessions", rel), "{}\n");
    await symlink(join(config.sharedHome, "sessions"), join(a, "sessions"));
    await symlink(join(config.sharedHome, "sessions"), join(b, "sessions"));

    createMinimalStateDb(join(b, "state_5.sqlite"), [
      { id: "from-b", rollout_path: join(b, "sessions", rel) },
    ]);
    createMinimalStateDb(join(a, "state_5.sqlite"), [
      { id: "from-a", rollout_path: join(a, "sessions", rel) },
    ]);

    await linkSharedProfile(config, a, "codex");

    const db = new DatabaseSync(join(a, "state_5.sqlite"));
    const ids = (
      db.prepare("SELECT id FROM threads ORDER BY id").all() as Array<{ id: string }>
    ).map((row) => row.id);
    db.close();
    expect(ids).toEqual(["from-a", "from-b"]);
  });

  it("repairs grok private sessions into shared tree and symlinks", async () => {
    const config = await testConfig();
    const profile = await ensureProfile(config, "work");
    const cwdKey = "%2Ftmp%2Fproj";
    const sessionId = "019f0000-aaaa-bbbb-cccc-ddddeeeeffff";
    await mkdir(join(profile, "sessions", cwdKey, sessionId), { recursive: true });
    await writeFile(
      join(profile, "sessions", cwdKey, sessionId, "summary.json"),
      JSON.stringify({ info: { id: sessionId, cwd: "/tmp/proj" } }),
    );

    const result = await repairGrokSessions(profile, config.sharedHome);
    expect(result.linked).toBe(true);
    expect(result.mergedSessions).toBeGreaterThan(0);
    expect((await lstat(join(profile, "sessions"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(profile, "sessions"))).toBe(join(config.sharedHome, "sessions"));
    expect(
      await readFile(
        join(config.sharedHome, "sessions", cwdKey, sessionId, "summary.json"),
        "utf8",
      ),
    ).toContain(sessionId);
  });

  it("merges nested grok sessions from sibling private dirs on link", async () => {
    const config = await testConfig();
    const a = await ensureProfile(config, "acc-a");
    const b = await ensureProfile(config, "acc-b");
    const cwdKey = "%2Ftmp%2Fshared-cwd";
    // Same cwd folder on both profiles, different session UUIDs (nested merge required).
    await mkdir(join(a, "sessions", cwdKey, "sess-a"), { recursive: true });
    await writeFile(join(a, "sessions", cwdKey, "sess-a", "summary.json"), '{"id":"sess-a"}\n');
    await mkdir(join(b, "sessions", cwdKey, "sess-b"), { recursive: true });
    await writeFile(join(b, "sessions", cwdKey, "sess-b", "summary.json"), '{"id":"sess-b"}\n');

    await linkSharedProfile(config, a, "grok");

    expect((await lstat(join(a, "sessions"))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(a, "sessions", cwdKey, "sess-a", "summary.json"), "utf8")).toContain(
      "sess-a",
    );
    expect(await readFile(join(a, "sessions", cwdKey, "sess-b", "summary.json"), "utf8")).toContain(
      "sess-b",
    );
    // Sibling private dir should also be re-linked to shared after merge.
    expect((await lstat(join(b, "sessions"))).isSymbolicLink()).toBe(true);
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
