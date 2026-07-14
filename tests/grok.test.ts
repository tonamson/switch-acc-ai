import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ensureProfile } from "../src/core/accounts.js";
import type { ProviderConfig } from "../src/core/config.js";
import {
  fetchBillingUsage,
  loginGrok,
  readAccountLabel,
  readAuthStatus,
  runGrok,
} from "../src/core/grok.js";
import { writeFakeGrok } from "./helpers/fakeGrok.js";

let oldPath: string | undefined;

async function setup(): Promise<{ config: ProviderConfig; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "sacc-grok-"));
  const binDir = join(root, "bin");
  await writeFakeGrok(binDir);
  oldPath = process.env.PATH;
  process.env.PATH = `${binDir}:${oldPath || ""}`;
  process.env.GROK_ACCOUNT_LOG = join(root, "account.log");
  process.env.GROK_ARGS_LOG = join(root, "args.log");
  process.env.GROK_LOGIN_LOG = join(root, "login.log");
  process.env.GROK_LOGIN_ARGS_LOG = join(root, "login-args.log");
  const config = {
    accountsDir: join(root, "accounts"),
    sharedHome: join(root, "shared"),
  };
  await mkdir(config.sharedHome, { recursive: true });
  return { config, root };
}

function mockBillingFetch(body: unknown, status = 200): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

afterEach(() => {
  process.env.PATH = oldPath;
  delete process.env.GROK_ACCOUNT_LOG;
  delete process.env.GROK_ARGS_LOG;
  delete process.env.GROK_LOGIN_LOG;
  delete process.env.GROK_LOGIN_ARGS_LOG;
});

describe("grok integration", () => {
  it("reads account labels from auth.json", async () => {
    const { config } = await setup();
    const profile = await ensureProfile(config, "work");
    await writeFile(
      join(profile, "auth.json"),
      JSON.stringify({
        "https://auth.x.ai::id": {
          email: "work@example.com",
          auth_mode: "oidc",
        },
      }),
    );

    await expect(readAccountLabel(config, "work")).resolves.toBe("work@example.com");
  });

  it("returns not signed in when auth.json is missing", async () => {
    const { config } = await setup();
    await ensureProfile(config, "empty");

    await expect(readAccountLabel(config, "empty")).resolves.toBe("Not signed in");
  });

  it("parses billing usage from proxy response", async () => {
    const billing = await fetchBillingUsage("token", {
      fetchImpl: mockBillingFetch({
        config: {
          monthlyLimit: { val: 15000 },
          used: { val: 1500 },
          onDemandCap: { val: 0 },
          billingPeriodStart: "2026-07-01T00:00:00+00:00",
          billingPeriodEnd: "2026-08-01T00:00:00+00:00",
        },
      }),
    });

    expect(billing).toMatchObject({
      used: 1500,
      monthlyLimit: 15000,
      remaining: 13500,
      onDemandCap: 0,
    });
  });

  it("reads auth status with monthly usage", async () => {
    const { config } = await setup();
    const profile = await ensureProfile(config, "work");
    await writeFile(
      join(profile, "auth.json"),
      JSON.stringify({
        "https://auth.x.ai::id": {
          key: "test-token",
          email: "work@example.com",
          user_id: "user-1",
          team_id: "team-9",
          auth_mode: "oidc",
          expires_at: "2099-06-01T00:00:00.000Z",
        },
      }),
    );

    const status = await readAuthStatus(config, "work", {
      fetchImpl: mockBillingFetch({
        config: {
          monthlyLimit: { val: 15000 },
          used: { val: 471 },
          onDemandCap: { val: 0 },
          billingPeriodEnd: "2026-08-01T00:00:00+00:00",
        },
      }),
    });

    expect(status).toMatchObject({
      account: "work",
      user: "work@example.com",
      plan: "oidc",
      fiveHour: { usedPercent: null, remaining: null, reset: null },
      weekly: { usedPercent: null, remaining: null, reset: null },
      monthly: {
        usedPercent: "3.1% used",
        remaining: "14529 left (471/15000)",
        reset: "resets 2026-08-01 UTC",
      },
      credits: "14529",
    });
  });

  it("keeps identity when billing fails and marks windows absent", async () => {
    const { config } = await setup();
    const profile = await ensureProfile(config, "work");
    await writeFile(
      join(profile, "auth.json"),
      JSON.stringify({
        "https://auth.x.ai::id": {
          key: "test-token",
          email: "work@example.com",
          auth_mode: "oidc",
        },
      }),
    );

    const status = await readAuthStatus(config, "work", {
      fetchImpl: mockBillingFetch({ error: "nope" }, 401),
    });

    expect(status.user).toBe("work@example.com");
    expect(status.fiveHour.usedPercent).toBeNull();
    expect(status.weekly.usedPercent).toBeNull();
    expect(status.monthly.usedPercent).toBeNull();
    expect(status.note).toContain("usage error");
  });

  it("runs Grok with GROK_HOME and forwarded args", async () => {
    const { config } = await setup();
    const profile = await ensureProfile(config, "work");

    const code = await runGrok(config, "work", ["-p", "hello"]);

    expect(code).toBe(0);
    expect((await readFile(process.env.GROK_ACCOUNT_LOG!, "utf8")).trim()).toBe(profile);
    expect((await readFile(process.env.GROK_ARGS_LOG!, "utf8")).trim()).toBe("-p hello");
  });

  it("delegates login to grok login", async () => {
    const { config } = await setup();

    const code = await loginGrok(config, "newacc", ["--oauth"]);

    expect(code).toBe(0);
    expect((await readFile(process.env.GROK_LOGIN_LOG!, "utf8")).trim()).toContain("newacc");
    expect((await readFile(process.env.GROK_LOGIN_ARGS_LOG!, "utf8")).trim()).toBe("login --oauth");
  });
});
