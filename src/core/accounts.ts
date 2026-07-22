import { constants, watch, type FSWatcher } from "node:fs";
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
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ProviderConfig } from "./config.js";
import { SHARED_ASSETS, SHARED_DIR_ASSETS, type ProviderId } from "./config.js";
import { logDebug, logException, logInfo, logWarn, serializeError } from "./log.js";

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
    if (!isValidAccountName(entry.name)) {
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
 * Move unique children from a private profile dir into shared, then drop private.
 * Shared wins on name conflicts (canonical global).
 */
async function mergeDirIntoShared(from: string, to: string): Promise<number> {
  await mkdir(to, { recursive: true });
  let moved = 0;
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (await pathExistsOrSymlink(dst)) {
      continue;
    }
    await rename(src, dst);
    moved += 1;
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
