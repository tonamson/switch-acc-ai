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
import type { AppConfig } from "./config.js";

const sharedAssetNames = ["skills", "plugins", "sessions", "config.toml"] as const;

export function isValidAccountName(name: string): boolean {
  return name.trim() !== "" && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\0");
}

export function ensureValidAccountName(name: string): void {
  if (!isValidAccountName(name)) {
    throw new Error(`invalid account name: ${name}`);
  }
}

export function profileDir(config: AppConfig, name: string): string {
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

export async function listAccounts(config: AppConfig): Promise<string[]> {
  if (!(await pathExists(config.accountsDir))) {
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
  return accounts.sort((a, b) => a.localeCompare(b));
}

export async function ensureProfile(config: AppConfig, name: string): Promise<string> {
  const dir = profileDir(config, name);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function requireProfile(config: AppConfig, name: string): Promise<string> {
  const dir = profileDir(config, name);
  try {
    const fileStat = await stat(dir);
    if (fileStat.isDirectory()) {
      return dir;
    }
  } catch {
    throw new Error(`account not found: ${name}`);
  }
  throw new Error(`account not found: ${name}`);
}

export async function renameAccount(config: AppConfig, oldName: string, newName: string): Promise<void> {
  const oldDir = await requireProfile(config, oldName);
  const newDir = profileDir(config, newName);
  if (await pathExists(newDir)) {
    throw new Error(`account already exists: ${newName}`);
  }
  try {
    const stat = await lstat(newDir);
    if (stat.isSymbolicLink()) {
      await rm(newDir, { force: true });
    }
  } catch {
    // newDir does not exist, which is the normal path.
  }
  await mkdir(config.accountsDir, { recursive: true });
  await rename(oldDir, newDir);
}

export async function removeAccount(config: AppConfig, name: string): Promise<void> {
  const dir = await requireProfile(config, name);
  await rm(dir, { recursive: true, force: true });
}

export async function linkSharedProfile(config: AppConfig, profilePath: string): Promise<void> {
  for (const assetName of sharedAssetNames) {
    const source = join(config.sharedHome, assetName);
    const target = join(profilePath, basename(assetName));
    if (!(await pathExistsOrSymlink(source))) {
      continue;
    }

    try {
      if ((await lstat(target)).isSymbolicLink() && (await readlink(target)) === source) {
        continue;
      }
      await rm(target, { recursive: true, force: true });
    } catch {
      // Target does not exist, which is the normal path.
    }
    await symlink(source, target);
  }
}
