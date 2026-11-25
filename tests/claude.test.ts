import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureProfile } from "../src/core/accounts.js";
import type { ProviderConfig } from "../src/core/config.js";
import { readAccountLabel, readAuthStatus } from "../src/core/claude.js";

async function setup(): Promise<ProviderConfig> {
  const root = await mkdtemp(join(tmpdir(), "sacc-claude-"));
  process.env.SACC_LOG_DIR = join(root, "sacc-logs");
  const config = { accountsDir: join(root, "accounts"), sharedHome: join(root, "shared") };
  await mkdir(config.sharedHome, { recursive: true });
  return config;
}

async function creds(profile: string, token: string, expiresAt = Date.now() + 3_600_000) {
  await writeFile(
    join(profile, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: token, expiresAt, subscriptionType: "max" } }),
  );
}

const body = {
  five_hour: { utilization: 12, resets_at: "2026-11-25T18:00:00Z" },
  seven_day: { utilization: 40, resets_at: "2026-11-30T00:00:00Z" },
};

function fakeFetch(seen: Array<{ url: string; headers: Record<string, string> }>, status = 200, json: unknown = body): typeof fetch {
  return (async (url: string, init?: { headers?: Record<string, string> }) => {
    seen.push({ url: String(url), headers: init?.headers ?? {} });
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
}

describe("claude usage", () => {
  let config: ProviderConfig;
  beforeEach(async () => {
    config = await setup();
  });

  it("maps five_hour and seven_day windows with oauth headers", async () => {
    const p = await ensureProfile(config, "a");
    await creds(p, "tok-a");
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const s = await readAuthStatus(config, "a", { fetchImpl: fakeFetch(seen), readKeychain: async () => null });
    expect(s.fiveHour.usedPercent).toBe("12% used");
    expect(s.weekly.usedPercent).toBe("40% used");
    expect(s.monthly.usedPercent).toBeNull();
    expect(s.plan).toBe("max");
    expect(seen[0].headers.Authorization).toBe("Bearer tok-a");
    expect(seen[0].headers["anthropic-beta"]).toBe("oauth-2025-04-20");
  });

  it("reports not signed in without credentials", async () => {
    await ensureProfile(config, "a");
    const s = await readAuthStatus(config, "a", { fetchImpl: fakeFetch([]), readKeychain: async () => null });
    expect(s.note).toBe("not signed in");
  });

  it("reports expired token without calling the API", async () => {
    const p = await ensureProfile(config, "a");
    await creds(p, "old", Date.now() - 1000);
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const s = await readAuthStatus(config, "a", { fetchImpl: fakeFetch(seen), readKeychain: async () => null });
    expect(s.note).toContain("token expired");
    expect(seen).toHaveLength(0);
  });

  it("turns http errors into a note", async () => {
    const p = await ensureProfile(config, "a");
    await creds(p, "tok");
    const s = await readAuthStatus(config, "a", { fetchImpl: fakeFetch([], 500, {}), readKeychain: async () => null });
    expect(s.note).toMatch(/^usage error:/);
    expect(s.fiveHour.usedPercent).toBeNull();
  });

  it("falls back to keychain token", async () => {
    await ensureProfile(config, "a");
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const kc = JSON.stringify({ claudeAiOauth: { accessToken: "kc-tok", expiresAt: Date.now() + 1e6 } });
    await readAuthStatus(config, "a", { fetchImpl: fakeFetch(seen), readKeychain: async () => kc });
    expect(seen[0].headers.Authorization).toBe("Bearer kc-tok");
  });

  it("uses a different token per profile", async () => {
    const a = await ensureProfile(config, "a");
    const b = await ensureProfile(config, "b");
    await creds(a, "tok-a");
    await creds(b, "tok-b");
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const opts = { fetchImpl: fakeFetch(seen), readKeychain: async () => null };
    await readAuthStatus(config, "a", opts);
    await readAuthStatus(config, "b", opts);
    expect(seen.map((x) => x.headers.Authorization)).toEqual(["Bearer tok-a", "Bearer tok-b"]);
  });

  it("reads label from .claude.json", async () => {
    const p = await ensureProfile(config, "a");
    expect(await readAccountLabel(config, "a")).toBe("Not signed in");
    await writeFile(join(p, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "a@x.com" } }));
    expect(await readAccountLabel(config, "a")).toBe("a@x.com");
  });
});
