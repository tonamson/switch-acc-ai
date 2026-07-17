import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "switch-acc-ai";
export const DEFAULT_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_FETCH_TIMEOUT_MS = 1500;

export type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
};

type CachePayload = {
  checkedAt: number;
  latestVersion: string;
};

export type UpdateCheckOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  currentVersion?: string;
  packageName?: string;
  intervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  fetchLatest?: (packageName: string, timeoutMs: number) => Promise<string>;
  readCacheFile?: (path: string) => string | null;
  writeCacheFile?: (path: string, body: string) => void;
};

/** Compare dotted versions; returns true when `latest` is strictly greater than `current`. */
export function isVersionNewer(latest: string, current: string): boolean {
  const a = parseVersionParts(latest);
  const b = parseVersionParts(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return false;
}

export function getInstalledVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  if (!pkg.version) {
    throw new Error("package.json is missing version");
  }
  return pkg.version;
}

export function resolveUpdateCachePath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir(),
): string {
  if (env.SACC_UPDATE_CACHE) {
    return env.SACC_UPDATE_CACHE;
  }
  const base = env.SACC_HOME || join(homeDir, ".sacc");
  return join(base, "update-check.json");
}

export function isUpdateCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.SACC_NO_UPDATE_CHECK || "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  // Avoid network noise in CI unless explicitly enabled.
  if (env.CI && raw !== "0" && raw !== "false") return true;
  return false;
}

export async function fetchLatestVersionFromNpm(
  packageName: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<string> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`npm registry responded ${response.status}`);
  }
  const body = (await response.json()) as { version?: string };
  if (!body.version || typeof body.version !== "string") {
    throw new Error("npm registry response missing version");
  }
  return body.version;
}

/**
 * Check npm for a newer package version.
 * Uses a local cache so the registry is hit at most once per interval.
 * Failures are silent (returns null) — update checks must never break the CLI.
 */
export async function checkForUpdate(options: UpdateCheckOptions = {}): Promise<UpdateInfo | null> {
  const env = options.env ?? process.env;
  if (isUpdateCheckDisabled(env)) {
    return null;
  }

  const currentVersion = options.currentVersion ?? getInstalledVersion();
  const packageName = options.packageName ?? PACKAGE_NAME;
  const intervalMs = options.intervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const cachePath = resolveUpdateCachePath(env, options.homeDir ?? homedir());
  const readCacheFile = options.readCacheFile ?? defaultReadCacheFile;
  const writeCacheFile = options.writeCacheFile ?? defaultWriteCacheFile;
  const fetchLatest = options.fetchLatest ?? fetchLatestVersionFromNpm;

  let latestVersion: string | null = null;
  const cached = readCache(cachePath, readCacheFile);
  const fresh = cached && now() - cached.checkedAt < intervalMs;

  if (fresh && cached) {
    latestVersion = cached.latestVersion;
  } else {
    try {
      latestVersion = await fetchLatest(packageName, timeoutMs);
      writeCache(cachePath, { checkedAt: now(), latestVersion }, writeCacheFile);
    } catch {
      // Fall back to a stale cache if network fails.
      if (cached?.latestVersion) {
        latestVersion = cached.latestVersion;
      } else {
        return null;
      }
    }
  }

  if (!latestVersion) {
    return null;
  }

  return {
    currentVersion,
    latestVersion,
    updateAvailable: isVersionNewer(latestVersion, currentVersion),
  };
}

function parseVersionParts(version: string): number[] {
  const cleaned = version.trim().replace(/^v/i, "").split("-")[0] ?? "";
  return cleaned.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

function readCache(
  path: string,
  readCacheFile: (path: string) => string | null,
): CachePayload | null {
  try {
    const raw = readCacheFile(path);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachePayload>;
    if (
      typeof parsed.checkedAt !== "number" ||
      typeof parsed.latestVersion !== "string" ||
      !parsed.latestVersion
    ) {
      return null;
    }
    return { checkedAt: parsed.checkedAt, latestVersion: parsed.latestVersion };
  } catch {
    return null;
  }
}

function writeCache(
  path: string,
  payload: CachePayload,
  writeCacheFile: (path: string, body: string) => void,
): void {
  try {
    writeCacheFile(path, `${JSON.stringify(payload)}\n`);
  } catch {
    // Cache write failures are non-fatal.
  }
}

function defaultReadCacheFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function defaultWriteCacheFile(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, "utf8");
}
