import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import type { AppConfig } from "./config.js";

const sharedAssetNames = ["skills", "plugins", "sessions", "config.toml"] as const;

export function isValidAccountName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && name !== "." && name !== "..";
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

export async function readCurrentAccount(config: AppConfig): Promise<string | null> {
  if (!(await pathExists(config.currentFile))) {
    return null;
  }
  const value = (await readFile(config.currentFile, "utf8")).trim();
  return value.length > 0 ? value : null;
}

export async function writeCurrentAccount(config: AppConfig, name: string): Promise<void> {
  ensureValidAccountName(name);
  await mkdir(config.accountsDir, { recursive: true });
  await writeFile(config.currentFile, `${name}\n`);
}

export async function listAccounts(config: AppConfig): Promise<string[]> {
  if (!(await pathExists(config.accountsDir))) {
    return [];
  }
  const entries = await readdir(config.accountsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(isValidAccountName)
    .sort((a, b) => a.localeCompare(b));
}

export async function ensureProfile(config: AppConfig, name: string): Promise<string> {
  const dir = profileDir(config, name);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function requireProfile(config: AppConfig, name: string): Promise<string> {
  const dir = profileDir(config, name);
  try {
    const stat = await lstat(dir);
    if (stat.isDirectory()) {
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
  await mkdir(config.accountsDir, { recursive: true });
  await rename(oldDir, newDir);
  if ((await readCurrentAccount(config)) === oldName) {
    await writeCurrentAccount(config, newName);
  }
}

export async function removeAccount(config: AppConfig, name: string): Promise<void> {
  const dir = await requireProfile(config, name);
  await rm(dir, { recursive: true, force: true });
  if ((await readCurrentAccount(config)) === name) {
    await rm(config.currentFile, { force: true });
  }
}

export async function linkSharedProfile(config: AppConfig, profilePath: string): Promise<void> {
  for (const assetName of sharedAssetNames) {
    const source = join(config.sharedHome, assetName);
    const target = join(profilePath, basename(assetName));
    if (!(await pathExists(source)) || (await pathExists(target))) {
      continue;
    }
    await symlink(source, target);
  }
}
