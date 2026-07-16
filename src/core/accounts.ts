import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { basename, join } from "node:path";
import type { ProviderConfig } from "./config.js";
import { SHARED_ASSETS, type ProviderId } from "./config.js";
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

export async function linkSharedProfile(
  config: ProviderConfig,
  profilePath: string,
  provider: ProviderId = "codex",
): Promise<void> {
  const details: Array<Record<string, unknown>> = [];
  const linked: string[] = [];
  const skipped: string[] = [];
  for (const assetName of SHARED_ASSETS[provider]) {
    const source = join(config.sharedHome, assetName);
    const target = join(profilePath, basename(assetName));
    if (!(await pathExistsOrSymlink(source))) {
      skipped.push(assetName);
      details.push({ asset: assetName, action: "skip_missing_source", source, target });
      continue;
    }

    try {
      if ((await lstat(target)).isSymbolicLink() && (await readlink(target)) === source) {
        linked.push(assetName);
        details.push({ asset: assetName, action: "already_linked", source, target });
        continue;
      }
      await rm(target, { recursive: true, force: true });
      details.push({ asset: assetName, action: "replaced_existing_target", source, target });
    } catch {
      details.push({ asset: assetName, action: "create_new_link", source, target });
    }
    await symlink(source, target);
    linked.push(assetName);
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
