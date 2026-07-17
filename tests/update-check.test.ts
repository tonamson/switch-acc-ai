import { describe, expect, it } from "vitest";
import {
  checkForUpdate,
  isUpdateCheckDisabled,
  isVersionNewer,
  resolveUpdateCachePath,
} from "../src/core/update-check.js";
import { formatUpdateNotice } from "../src/ui/output.js";

describe("isVersionNewer", () => {
  it("detects newer patch/minor/major", () => {
    expect(isVersionNewer("0.2.5", "0.2.4")).toBe(true);
    expect(isVersionNewer("0.3.0", "0.2.9")).toBe(true);
    expect(isVersionNewer("1.0.0", "0.9.9")).toBe(true);
  });

  it("returns false for equal or older", () => {
    expect(isVersionNewer("0.2.4", "0.2.4")).toBe(false);
    expect(isVersionNewer("0.2.3", "0.2.4")).toBe(false);
    expect(isVersionNewer("0.1.9", "0.2.0")).toBe(false);
  });

  it("ignores leading v and prerelease suffix for core compare", () => {
    expect(isVersionNewer("v0.3.0", "0.2.4")).toBe(true);
    expect(isVersionNewer("0.2.5-beta.1", "0.2.4")).toBe(true);
  });
});

describe("isUpdateCheckDisabled", () => {
  it("honors SACC_NO_UPDATE_CHECK", () => {
    expect(isUpdateCheckDisabled({ SACC_NO_UPDATE_CHECK: "1" })).toBe(true);
    expect(isUpdateCheckDisabled({ SACC_NO_UPDATE_CHECK: "true" })).toBe(true);
    expect(isUpdateCheckDisabled({})).toBe(false);
  });

  it("disables in CI unless explicitly re-enabled", () => {
    expect(isUpdateCheckDisabled({ CI: "true" })).toBe(true);
    expect(isUpdateCheckDisabled({ CI: "true", SACC_NO_UPDATE_CHECK: "0" })).toBe(false);
  });
});

describe("resolveUpdateCachePath", () => {
  it("uses SACC_UPDATE_CACHE override", () => {
    expect(resolveUpdateCachePath({ SACC_UPDATE_CACHE: "/tmp/sacc-update.json" }, "/home/u")).toBe(
      "/tmp/sacc-update.json",
    );
  });

  it("defaults under ~/.sacc", () => {
    expect(resolveUpdateCachePath({}, "/home/u")).toBe("/home/u/.sacc/update-check.json");
  });
});

describe("checkForUpdate", () => {
  it("returns null when disabled", async () => {
    const result = await checkForUpdate({
      env: { SACC_NO_UPDATE_CHECK: "1" },
      currentVersion: "0.2.4",
      fetchLatest: async () => "9.9.9",
    });
    expect(result).toBeNull();
  });

  it("reports update when latest is newer", async () => {
    const result = await checkForUpdate({
      env: {},
      homeDir: "/tmp/sacc-home",
      currentVersion: "0.2.4",
      intervalMs: 0,
      fetchLatest: async () => "0.3.0",
      readCacheFile: () => null,
      writeCacheFile: () => {},
    });
    expect(result).toEqual({
      currentVersion: "0.2.4",
      latestVersion: "0.3.0",
      updateAvailable: true,
    });
  });

  it("uses fresh cache without fetching", async () => {
    let fetched = 0;
    const result = await checkForUpdate({
      env: {},
      currentVersion: "0.2.4",
      intervalMs: 60_000,
      now: () => 10_000,
      fetchLatest: async () => {
        fetched += 1;
        return "9.9.9";
      },
      readCacheFile: () =>
        JSON.stringify({ checkedAt: 9_000, latestVersion: "0.2.5" }),
      writeCacheFile: () => {},
    });
    expect(fetched).toBe(0);
    expect(result?.updateAvailable).toBe(true);
    expect(result?.latestVersion).toBe("0.2.5");
  });

  it("falls back to stale cache when fetch fails", async () => {
    const result = await checkForUpdate({
      env: {},
      currentVersion: "0.2.4",
      intervalMs: 0,
      now: () => 100_000,
      fetchLatest: async () => {
        throw new Error("network down");
      },
      readCacheFile: () =>
        JSON.stringify({ checkedAt: 1, latestVersion: "0.2.9" }),
      writeCacheFile: () => {},
    });
    expect(result).toEqual({
      currentVersion: "0.2.4",
      latestVersion: "0.2.9",
      updateAvailable: true,
    });
  });

  it("returns null when fetch fails and cache is empty", async () => {
    const result = await checkForUpdate({
      env: {},
      currentVersion: "0.2.4",
      intervalMs: 0,
      fetchLatest: async () => {
        throw new Error("network down");
      },
      readCacheFile: () => null,
      writeCacheFile: () => {},
    });
    expect(result).toBeNull();
  });

  it("writes cache after a successful fetch", async () => {
    let written: string | null = null;
    await checkForUpdate({
      env: {},
      currentVersion: "0.2.4",
      intervalMs: 0,
      now: () => 42,
      fetchLatest: async () => "0.2.4",
      readCacheFile: () => null,
      writeCacheFile: (_path, body) => {
        written = body;
      },
    });
    expect(written).toContain('"checkedAt":42');
    expect(written).toContain('"latestVersion":"0.2.4"');
  });
});

describe("formatUpdateNotice", () => {
  it("suggests sacc update", () => {
    process.env.NO_COLOR = "1";
    const output = formatUpdateNotice({
      currentVersion: "0.2.4",
      latestVersion: "0.3.0",
      updateAvailable: true,
    });
    expect(output).toContain("update available");
    expect(output).toContain("0.2.4");
    expect(output).toContain("0.3.0");
    expect(output).toContain("sacc update");
  });
});
