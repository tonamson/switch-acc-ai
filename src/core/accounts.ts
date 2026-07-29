import { constants, existsSync, watch, type FSWatcher } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import type { ProviderConfig } from "./config.js";
import { SHARED_ASSETS, SHARED_DIR_ASSETS, type ProviderId } from "./config.js";
import { logDebug, logException, logInfo, logWarn, serializeError } from "./log.js";

// Vitest/Vite rewrites `import "node:sqlite"` to bare `sqlite` and fails.
// createRequire keeps the Node built-in load path intact.
const require = createRequire(import.meta.url);
type DatabaseSyncInstance = {
  prepare: (sql: string) => {
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
    run: (...params: unknown[]) => unknown;
  };
  exec: (sql: string) => void;
  close: () => void;
};
type DatabaseSyncCtor = new (path: string) => DatabaseSyncInstance;
function getDatabaseSync(): DatabaseSyncCtor {
  return (require("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
}

export function isValidAccountName(name: string): boolean {
  return name.trim() !== "" && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\0");
}

function ensureValidAccountName(name: string): void {
  if (!isValidAccountName(name)) {
    throw new Error(`invalid account name: ${name}`);
  }
}

function profileDir(config: ProviderConfig, name: string): string {
  ensureValidAccountName(name);
  return join(config.accountsDir, name);
}

function removedMarker(config: ProviderConfig, name: string): string {
  ensureValidAccountName(name);
  return join(config.accountsDir, ".removed", name);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function pathExistsOrSymlink(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export async function listAccounts(config: ProviderConfig): Promise<string[]> {
  if (!(await pathExists(config.accountsDir))) {
    // debug: TUI refreshes this often; CLI list/status log at info themselves.
    logDebug("list accounts", { accountsDir: config.accountsDir, count: 0, accounts: [] });
    return [];
  }
  const entries = await readdir(config.accountsDir, { withFileTypes: true });
  const accounts = [];
  for (const entry of entries) {
    if (
      entry.name === ".removed" ||
      !isValidAccountName(entry.name) ||
      (await pathExists(removedMarker(config, entry.name)))
    ) {
      continue;
    }
    try {
      if ((await stat(join(config.accountsDir, entry.name))).isDirectory()) {
        accounts.push(entry.name);
      }
    } catch {
      // Broken symlinks are not usable profiles.
    }
  }
  const sorted = accounts.sort((a, b) => a.localeCompare(b));
  logDebug("list accounts", {
    accountsDir: config.accountsDir,
    count: sorted.length,
    accounts: sorted,
  });
  return sorted;
}

export async function ensureProfile(config: ProviderConfig, name: string): Promise<string> {
  const dir = profileDir(config, name);
  const marker = removedMarker(config, name);
  if (await pathExists(marker)) {
    await rm(dir, { recursive: true, force: true });
    await rm(marker, { force: true });
  }
  const existed = await pathExists(dir);
  await mkdir(dir, { recursive: true });
  logInfo("ensure profile", {
    account: name,
    profilePath: dir,
    accountsDir: config.accountsDir,
    created: !existed,
    existedBefore: existed,
  });
  return dir;
}

export async function requireProfile(config: ProviderConfig, name: string): Promise<string> {
  const dir = profileDir(config, name);
  if (await pathExists(removedMarker(config, name))) {
    throw new Error(`account not found: ${name}`);
  }
  try {
    const fileStat = await stat(dir);
    if (fileStat.isDirectory()) {
      logDebug("require profile ok", {
        account: name,
        profilePath: dir,
        accountsDir: config.accountsDir,
      });
      return dir;
    }
  } catch (error) {
    logException("require profile failed", error, {
      account: name,
      profilePath: dir,
      accountsDir: config.accountsDir,
      reason: "not found",
    });
    throw new Error(`account not found: ${name}`);
  }
  logWarn("require profile failed", {
    account: name,
    profilePath: dir,
    accountsDir: config.accountsDir,
    reason: "not a directory",
  });
  throw new Error(`account not found: ${name}`);
}

export async function renameAccount(
  config: ProviderConfig,
  oldName: string,
  newName: string,
): Promise<void> {
  logInfo("rename start", {
    from: oldName,
    to: newName,
    accountsDir: config.accountsDir,
    sharedHome: config.sharedHome,
  });
  try {
    const oldDir = await requireProfile(config, oldName);
    const newDir = profileDir(config, newName);
    if (await pathExists(newDir)) {
      throw new Error(`account already exists: ${newName}`);
    }
    try {
      const fileStat = await lstat(newDir);
      if (fileStat.isSymbolicLink()) {
        logDebug("rename removing stale symlink at target", { newDir });
        await rm(newDir, { force: true });
      }
    } catch (error) {
      logDebug("rename target does not exist yet", {
        newDir,
        error: serializeError(error),
      });
    }
    await mkdir(config.accountsDir, { recursive: true });
    await rename(oldDir, newDir);
    logInfo("rename ok", {
      from: oldName,
      to: newName,
      fromPath: oldDir,
      toPath: newDir,
      accountsDir: config.accountsDir,
    });
  } catch (error) {
    logException("rename failed", error, {
      from: oldName,
      to: newName,
      accountsDir: config.accountsDir,
    });
    throw error;
  }
}

export async function removeAccount(config: ProviderConfig, name: string): Promise<void> {
  logInfo("remove start", {
    account: name,
    accountsDir: config.accountsDir,
    sharedHome: config.sharedHome,
  });
  try {
    const dir = await requireProfile(config, name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(config.accountsDir, ".removed"), { recursive: true });
    await writeFile(removedMarker(config, name), "");
    logInfo("remove ok", {
      account: name,
      profilePath: dir,
      accountsDir: config.accountsDir,
    });
  } catch (error) {
    logException("remove failed", error, {
      account: name,
      accountsDir: config.accountsDir,
    });
    throw error;
  }
}

/**
 * Move unique children from a private profile dir into shared.
 * Shared wins on file name conflicts. When both sides have a real directory
 * with the same name, recurse so nested session trees (Grok cwd/uuid, Codex
 * year/month/day rollouts) are not dropped.
 */
async function mergeDirIntoShared(from: string, to: string): Promise<number> {
  await mkdir(to, { recursive: true });
  let moved = 0;
  let entries;
  try {
    entries = await readdir(from, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (!(await pathExistsOrSymlink(dst))) {
      await rename(src, dst);
      moved += 1;
      continue;
    }
    try {
      const srcStat = await lstat(src);
      const dstStat = await lstat(dst);
      if (
        srcStat.isDirectory() &&
        !srcStat.isSymbolicLink() &&
        dstStat.isDirectory() &&
        !dstStat.isSymbolicLink()
      ) {
        moved += await mergeDirIntoShared(src, dst);
      }
      // else: shared already has this name — keep shared
    } catch {
      // skip one entry
    }
  }
  return moved;
}

/**
 * Make sure sharedHome has the asset so every profile can symlink to one global copy.
 * - Missing shared dir → create empty, or promote/merge from a private profile copy.
 * - Missing shared file → promote private file if present.
 */
async function ensureSharedSource(
  source: string,
  target: string,
  assetName: string,
): Promise<"ready" | "skip"> {
  const name = basename(assetName);
  const isDirAsset = SHARED_DIR_ASSETS.has(name);

  if (await pathExistsOrSymlink(source)) {
    // Shared exists. If profile still has a private real dir, fold unique items in.
    try {
      const targetStat = await lstat(target);
      if (targetStat.isDirectory() && !targetStat.isSymbolicLink()) {
        const moved = await mergeDirIntoShared(target, source);
        if (moved > 0) {
          logInfo("merged private shared-dir into global", {
            asset: assetName,
            source,
            target,
            moved,
          });
        }
      } else if (targetStat.isFile() && !targetStat.isSymbolicLink()) {
        // File promote handled later in ensureSharedAssetLink (mtime).
      }
    } catch {
      // target missing — fine
    }
    return "ready";
  }

  // Shared missing — promote private copy if any.
  try {
    const targetStat = await lstat(target);
    if (targetStat.isSymbolicLink()) {
      // Broken or wrong link; fall through to create empty dir if needed.
    } else if (targetStat.isDirectory()) {
      await mkdir(dirname(source), { recursive: true });
      await rename(target, source);
      logInfo("promoted private dir to shared home", { asset: assetName, source, target });
      return "ready";
    } else if (targetStat.isFile()) {
      await mkdir(dirname(source), { recursive: true });
      await rename(target, source);
      logInfo("promoted private file to shared home", { asset: assetName, source, target });
      return "ready";
    }
  } catch {
    // no private copy
  }

  if (isDirAsset) {
    await mkdir(source, { recursive: true });
    logDebug("created empty shared dir", { asset: assetName, source });
    return "ready";
  }

  // Optional files (AGENTS.md, etc.) — nothing to link until they exist on shared.
  return "skip";
}

/**
 * CLIs (especially Grok) often save config via atomic write: write temp + rename
 * over the destination. That replaces our symlink with a regular file and leaves
 * the profile on a private copy. When that happens, promote the newer file back
 * into shared home, then re-create the symlink so all accounts stay on global.
 */
async function ensureSharedAssetLink(
  source: string,
  target: string,
  assetName: string,
): Promise<{ action: string }> {
  try {
    const targetStat = await lstat(target);
    if (targetStat.isSymbolicLink() && (await readlink(target)) === source) {
      return { action: "already_linked" };
    }

    let action = "replaced_existing_target";

    // Promote regular files (config.toml) that Grok rewrote over our symlink.
    if (targetStat.isFile()) {
      try {
        const sourceStat = await stat(source);
        if (sourceStat.isFile() && targetStat.mtimeMs >= sourceStat.mtimeMs) {
          await copyFile(target, source);
          action = "promoted_and_relinked";
          logInfo("promoted broken shared asset to global", {
            asset: assetName,
            source,
            target,
            targetMtimeMs: targetStat.mtimeMs,
            sourceMtimeMs: sourceStat.mtimeMs,
          });
        }
      } catch (error) {
        logDebug("promote shared asset skipped", {
          asset: assetName,
          source,
          target,
          error: serializeError(error),
        });
      }
    } else if (targetStat.isDirectory() && !targetStat.isSymbolicLink()) {
      const moved = await mergeDirIntoShared(target, source);
      if (moved > 0) {
        action = "merged_and_relinked";
      }
    }

    await rm(target, { recursive: true, force: true });
    await symlink(source, target);
    return { action };
  } catch {
    await symlink(source, target);
    return { action: "create_new_link" };
  }
}

/**
 * Codex resume (picker / `codex resume`) indexes threads in `state_5.sqlite`.
 * Session rollouts live under `sessions/` (shared across profiles via symlink),
 * but the SQLite index stays private per CODEX_HOME — and stores absolute paths.
 *
 * After account rename/switch, those paths often still point at a deleted profile
 * (e.g. `~/.codex-accounts/acc2/sessions/...`) even though the rollout file
 * remains reachable via the current profile's `sessions` symlink. Repair:
 * 1) seed/merge rows from shared `~/.codex/state_5.sqlite` when useful
 * 2) rewrite `rollout_path` to the current profile's sessions tree when the file exists there
 *
 * Do NOT symlink state_5.sqlite — SQLite WAL next to a symlink is unsafe.
 */
function sessionsRelativePath(rolloutPath: string): string | null {
  const normalized = rolloutPath.replace(/\\/g, "/");
  const marker = "/sessions/";
  const idx = normalized.lastIndexOf(marker);
  if (idx === -1) {
    return null;
  }
  const rel = normalized.slice(idx + marker.length);
  return rel.length > 0 ? rel : null;
}

function openStateDb(dbPath: string): DatabaseSyncInstance | null {
  try {
    const DatabaseSync = getDatabaseSync();
    return new DatabaseSync(dbPath);
  } catch (error) {
    logDebug("open state db failed", { dbPath, error: serializeError(error) });
    return null;
  }
}

function listThreadColumns(db: DatabaseSyncInstance): string[] {
  const rows = db.prepare("PRAGMA table_info(threads)").all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function mergeThreadsFromDb(fromPath: string, toPath: string): number {
  const toDb = openStateDb(toPath);
  if (!toDb) {
    return 0;
  }
  try {
    const fromDb = openStateDb(fromPath);
    if (!fromDb) {
      return 0;
    }
    let fromCols: string[];
    try {
      fromCols = listThreadColumns(fromDb);
      if (fromCols.length === 0) {
        return 0;
      }
    } finally {
      fromDb.close();
    }

    const toCols = listThreadColumns(toDb);
    if (toCols.length === 0) {
      return 0;
    }
    const common = toCols.filter((col) => fromCols.includes(col));
    if (!common.includes("id") || !common.includes("rollout_path")) {
      return 0;
    }
    const colList = common.map((col) => `"${col.replace(/"/g, '""')}"`).join(", ");
    const escapedFrom = fromPath.replace(/'/g, "''");
    toDb.exec(`ATTACH DATABASE '${escapedFrom}' AS src`);
    try {
      const before = (
        toDb.prepare("SELECT COUNT(*) AS c FROM threads").get() as { c: number }
      ).c;
      toDb.exec(
        `INSERT OR IGNORE INTO threads (${colList}) SELECT ${colList} FROM src.threads`,
      );
      const after = (
        toDb.prepare("SELECT COUNT(*) AS c FROM threads").get() as { c: number }
      ).c;
      return Math.max(0, after - before);
    } finally {
      try {
        toDb.exec("DETACH DATABASE src");
      } catch {
        // ignore detach errors
      }
    }
  } catch (error) {
    logWarn("merge threads failed", {
      fromPath,
      toPath,
      error: serializeError(error),
    });
    return 0;
  } finally {
    toDb.close();
  }
}

function rewriteThreadRolloutPaths(profilePath: string): number {
  const dbPath = join(profilePath, "state_5.sqlite");
  if (!existsSync(dbPath)) {
    return 0;
  }
  const sessionsRoot = join(profilePath, "sessions");
  const db = openStateDb(dbPath);
  if (!db) {
    return 0;
  }
  let fixed = 0;
  try {
    const rows = db
      .prepare("SELECT id, rollout_path FROM threads")
      .all() as Array<{ id: string; rollout_path: string }>;
    const update = db.prepare("UPDATE threads SET rollout_path = ? WHERE id = ?");
    for (const row of rows) {
      const rel = sessionsRelativePath(row.rollout_path);
      if (!rel) {
        continue;
      }
      const candidate = join(sessionsRoot, rel);
      if (candidate === row.rollout_path || !existsSync(candidate)) {
        continue;
      }
      update.run(candidate, row.id);
      fixed += 1;
    }
  } catch (error) {
    logWarn("rewrite rollout paths failed", {
      profilePath,
      error: serializeError(error),
    });
    return fixed;
  } finally {
    db.close();
  }
  return fixed;
}

export async function repairCodexResumeIndex(
  profilePath: string,
  sharedHome: string,
  options: { siblingStatePaths?: string[] } = {},
): Promise<{ seeded: boolean; merged: number; rewritten: number }> {
  const profileState = join(profilePath, "state_5.sqlite");
  const sharedState = join(sharedHome, "state_5.sqlite");
  let seeded = false;
  let merged = 0;

  // Never keep a profile state DB as a symlink into shared (WAL hazard).
  if (await pathExistsOrSymlink(profileState)) {
    try {
      if ((await lstat(profileState)).isSymbolicLink()) {
        const linkTarget = await readlink(profileState);
        logWarn("profile state_5.sqlite is a symlink; replacing with a real copy", {
          profileState,
          linkTarget,
        });
        await rm(profileState, { force: true });
        if (await pathExistsOrSymlink(sharedState)) {
          await copyFile(sharedState, profileState);
          seeded = true;
        }
      }
    } catch {
      // ignore
    }
  }

  const sharedExists = await pathExistsOrSymlink(sharedState);
  const siblingSources = options.siblingStatePaths ?? [];

  if (!(await pathExistsOrSymlink(profileState))) {
    const seedFrom = sharedExists
      ? sharedState
      : siblingSources.find((path) => existsSync(path));
    if (seedFrom) {
      await copyFile(seedFrom, profileState);
      seeded = true;
      logInfo("seeded codex state_5.sqlite", { profileState, seedFrom });
    }
  }

  // Pull thread index rows from shared home + other profiles (sessions are shared).
  const mergeSources = [
    ...(sharedExists ? [sharedState] : []),
    ...siblingSources,
  ];
  if (await pathExistsOrSymlink(profileState)) {
    for (const source of mergeSources) {
      try {
        if (!existsSync(source)) {
          continue;
        }
        const pStat = await stat(profileState);
        const sStat = await stat(source);
        if (pStat.ino === sStat.ino && pStat.dev === sStat.dev) {
          continue;
        }
        const n = mergeThreadsFromDb(source, profileState);
        if (n > 0) {
          merged += n;
          logInfo("merged state threads into profile", {
            profileState,
            source,
            merged: n,
          });
        }
      } catch (error) {
        logDebug("state merge skipped", { source, error: serializeError(error) });
      }
    }
  }

  const rewritten = rewriteThreadRolloutPaths(profilePath);
  if (rewritten > 0) {
    logInfo("rewrote stale codex rollout paths", { profilePath, rewritten });
  }
  return { seeded, merged, rewritten };
}

async function isPrivateRealDir(path: string): Promise<boolean> {
  try {
    const st = await lstat(path);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Grok resume/list scans `sessions/<url-encoded-cwd>/<session-id>/` on disk.
 * No Codex-style SQLite index — repair is filesystem only:
 * 1) fold private session trees into global `sharedHome/sessions` (nested merge)
 * 2) fold leftover private trees from sibling profiles
 * 3) force profile `sessions` → symlink to shared
 */
export async function repairGrokSessions(
  profilePath: string,
  sharedHome: string,
  options: { siblingSessionPaths?: string[] } = {},
): Promise<{ mergedSessions: number; linked: boolean; action: string }> {
  const sharedSessions = join(sharedHome, "sessions");
  const profileSessions = join(profilePath, "sessions");
  await mkdir(sharedHome, { recursive: true });
  await mkdir(sharedSessions, { recursive: true });

  let mergedSessions = 0;
  let action = "already_linked";

  try {
    const st = await lstat(profileSessions);
    if (st.isSymbolicLink()) {
      const target = await readlink(profileSessions);
      if (target !== sharedSessions) {
        await rm(profileSessions, { force: true });
        action = "replaced_wrong_link";
      }
    } else if (st.isDirectory()) {
      mergedSessions += await mergeDirIntoShared(profileSessions, sharedSessions);
      await rm(profileSessions, { recursive: true, force: true });
      action = mergedSessions > 0 ? "merged_private_and_linked" : "replaced_private_dir";
    } else {
      await rm(profileSessions, { force: true });
      action = "replaced_non_dir";
    }
  } catch {
    action = "create_link";
  }

  for (const sibling of options.siblingSessionPaths ?? []) {
    if (sibling === profileSessions || sibling === sharedSessions) {
      continue;
    }
    if (!(await isPrivateRealDir(sibling))) {
      continue;
    }
    const n = await mergeDirIntoShared(sibling, sharedSessions);
    if (n > 0) {
      mergedSessions += n;
      logInfo("merged sibling private grok sessions into shared", {
        sibling,
        sharedSessions,
        moved: n,
      });
      try {
        await rm(sibling, { recursive: true, force: true });
        await symlink(sharedSessions, sibling);
      } catch (error) {
        logDebug("sibling sessions re-link skipped", {
          sibling,
          error: serializeError(error),
        });
      }
    }
  }

  try {
    const st = await lstat(profileSessions);
    if (!(st.isSymbolicLink() && (await readlink(profileSessions)) === sharedSessions)) {
      await rm(profileSessions, { recursive: true, force: true });
      await symlink(sharedSessions, profileSessions);
      if (action === "already_linked") {
        action = "relinked";
      }
    }
  } catch {
    await symlink(sharedSessions, profileSessions);
    if (action === "already_linked") {
      action = "create_link";
    }
  }

  if (mergedSessions > 0 || action !== "already_linked") {
    logInfo("repaired grok sessions tree", {
      profilePath,
      sharedSessions,
      mergedSessions,
      action,
    });
  }
  return {
    mergedSessions,
    linked: true,
    action,
  };
}

async function listSiblingAccountPaths(
  accountsDir: string,
  profilePath: string,
  leaf: string,
): Promise<string[]> {
  const out: string[] = [];
  try {
    const entries = await readdir(accountsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }
      if (entry.name.startsWith(".")) {
        continue;
      }
      const candidate = join(accountsDir, entry.name, leaf);
      if (candidate === join(profilePath, leaf)) {
        continue;
      }
      if (await pathExistsOrSymlink(candidate)) {
        out.push(candidate);
      }
    }
  } catch {
    // accountsDir may be missing in unit tests
  }
  return out;
}

export async function linkSharedProfile(
  config: ProviderConfig,
  profilePath: string,
  provider: ProviderId = "codex",
): Promise<void> {
  await mkdir(config.sharedHome, { recursive: true });
  const details: Array<Record<string, unknown>> = [];
  const linked: string[] = [];
  const skipped: string[] = [];
  for (const assetName of SHARED_ASSETS[provider]) {
    const source = join(config.sharedHome, assetName);
    const target = join(profilePath, basename(assetName));

    const sourceState = await ensureSharedSource(source, target, assetName);
    if (sourceState === "skip") {
      skipped.push(assetName);
      details.push({ asset: assetName, action: "skip_missing_source", source, target });
      continue;
    }

    const { action } = await ensureSharedAssetLink(source, target, assetName);
    linked.push(assetName);
    details.push({ asset: assetName, action, source, target });
  }
  logInfo("link shared profile", {
    provider,
    profilePath,
    sharedHome: config.sharedHome,
    expectedAssets: [...SHARED_ASSETS[provider]],
    linked,
    skipped,
    details,
  });
  if (skipped.length === SHARED_ASSETS[provider].length) {
    logWarn("link shared profile: no shared assets found", {
      provider,
      sharedHome: config.sharedHome,
      expectedAssets: [...SHARED_ASSETS[provider]],
    });
  }

  // Provider-specific resume repair — structures differ (see config SHARED_ASSETS docs).
  if (provider === "codex") {
    try {
      const siblingStatePaths = await listSiblingAccountPaths(
        config.accountsDir,
        profilePath,
        "state_5.sqlite",
      );
      const repair = await repairCodexResumeIndex(profilePath, config.sharedHome, {
        siblingStatePaths,
      });
      details.push({ asset: "state_5.sqlite", kind: "resume_index_repair", ...repair });
    } catch (error) {
      logWarn("codex resume index repair failed", {
        profilePath,
        error: serializeError(error),
      });
    }
  } else if (provider === "grok") {
    try {
      const siblingSessionPaths = await listSiblingAccountPaths(
        config.accountsDir,
        profilePath,
        "sessions",
      );
      const repair = await repairGrokSessions(profilePath, config.sharedHome, {
        siblingSessionPaths,
      });
      details.push({ asset: "sessions", kind: "grok_sessions_repair", ...repair });
    } catch (error) {
      logWarn("grok sessions repair failed", {
        profilePath,
        error: serializeError(error),
      });
    }
  }
}

export type SharedLinkGuard = {
  /** Stop watching and run a final re-link (promotes any late writes). */
  stop: () => Promise<void>;
};

async function sharedAssetLinkBroken(
  config: ProviderConfig,
  profilePath: string,
  provider: ProviderId,
): Promise<boolean> {
  for (const assetName of SHARED_ASSETS[provider]) {
    const source = join(config.sharedHome, assetName);
    const target = join(profilePath, basename(assetName));
    if (!(await pathExistsOrSymlink(source))) {
      continue;
    }
    try {
      const targetStat = await lstat(target);
      if (!targetStat.isSymbolicLink() || (await readlink(target)) !== source) {
        return true;
      }
    } catch {
      // Missing target while source exists → needs link.
      return true;
    }
  }
  return false;
}

/**
 * While a provider CLI is running, re-link shared assets if the process breaks
 * our symlinks (atomic config writes). Uses fs.watch + a poll fallback because
 * FSEvents on macOS is unreliable for temp dirs / rapid renames.
 */
export function watchSharedProfileLinks(
  config: ProviderConfig,
  profilePath: string,
  provider: ProviderId,
  options: { pollIntervalMs?: number; debounceMs?: number } = {},
): SharedLinkGuard {
  const watchedNames = new Set(SHARED_ASSETS[provider].map((name) => basename(name)));
  const debounceMs = options.debounceMs ?? 300;
  const pollIntervalMs = options.pollIntervalMs ?? 1500;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let relinkInFlight: Promise<void> | null = null;
  let watcher: FSWatcher | null = null;

  const relink = (): Promise<void> => {
    if (relinkInFlight) {
      return relinkInFlight;
    }
    relinkInFlight = linkSharedProfile(config, profilePath, provider)
      .catch((error) => {
        logWarn("shared link guard re-link failed", {
          provider,
          profilePath,
          error: serializeError(error),
        });
      })
      .finally(() => {
        relinkInFlight = null;
      });
    return relinkInFlight;
  };

  const scheduleRelink = (reason: string, filename: string | null): void => {
    if (stopped) return;
    const name = filename == null ? null : String(filename);
    // null filename is common on macOS; treat as "maybe relevant".
    if (name !== null && !watchedNames.has(name) && !name.endsWith(".toml")) {
      return;
    }
    logDebug("shared link guard event", { provider, profilePath, reason, filename: name });
    if (debounce) {
      clearTimeout(debounce);
    }
    // Wait for atomic write (temp + rename) to finish before repairing.
    debounce = setTimeout(() => {
      debounce = null;
      void relink();
    }, debounceMs);
  };

  try {
    watcher = watch(profilePath, (eventType, filename) => {
      scheduleRelink(eventType, filename);
    });
    watcher.on("error", (error) => {
      logWarn("shared link guard watcher error", {
        provider,
        profilePath,
        error: serializeError(error),
      });
    });
  } catch (error) {
    logWarn("shared link guard could not start watcher", {
      provider,
      profilePath,
      error: serializeError(error),
    });
  }

  // Poll fallback: catches breaks when fs.watch misses rename events.
  pollTimer = setInterval(() => {
    if (stopped) return;
    void sharedAssetLinkBroken(config, profilePath, provider).then((broken) => {
      if (broken && !stopped) {
        logDebug("shared link guard poll detected break", { provider, profilePath });
        void relink();
      }
    });
  }, pollIntervalMs);
  // Don't keep the process alive solely for the poll timer.
  pollTimer.unref?.();

  logInfo("shared link guard start", {
    provider,
    profilePath,
    sharedHome: config.sharedHome,
    watched: [...watchedNames],
    pollIntervalMs,
    debounceMs,
    watcherStarted: watcher !== null,
  });

  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (debounce) {
        clearTimeout(debounce);
        debounce = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      await relink();
      logInfo("shared link guard stop", { provider, profilePath });
    },
  };
}
