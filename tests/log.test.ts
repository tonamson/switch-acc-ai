import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  dailyLogPath,
  getTodayLogPath,
  initLogger,
  logError,
  logInfo,
  redactSecret,
  resetLoggerForTests,
  resolveLogDir,
  serializeError,
  writeLog,
} from "../src/core/log.js";

describe("log", () => {
  let dir: string | undefined;

  afterEach(async () => {
    resetLoggerForTests();
    delete process.env.SACC_LOG_DIR;
    delete process.env.SACC_LOG;
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("resolves default and env log dirs", () => {
    expect(resolveLogDir({}, "/tmp/home")).toBe("/tmp/home/.sacc/logs");
    expect(resolveLogDir({ SACC_LOG_DIR: "/var/sacc-logs" }, "/tmp/home")).toBe("/var/sacc-logs");
  });

  it("builds daily log path as sacc-YYYY-MM-DD.log", () => {
    // Local calendar date (not UTC) — matches dailyLogPath implementation.
    const path = dailyLogPath("/tmp/logs", new Date(2026, 6, 16, 12, 0, 0));
    expect(path).toBe("/tmp/logs/sacc-2026-07-16.log");
  });

  it("writes multi-line detailed blocks with pretty JSON context", async () => {
    dir = await mkdtemp(join(tmpdir(), "sacc-log-"));
    initLogger({ SACC_LOG_DIR: dir });

    logInfo("login start", { provider: "grok", account: "work" });
    logError("cli error", { message: "boom" });

    const content = await readFile(getTodayLogPath(), "utf8");
    expect(content).toContain("[INFO]");
    expect(content).toContain("login start");
    expect(content).toContain('"provider": "grok"');
    expect(content).toContain('"account": "work"');
    expect(content).toContain("[ERROR]");
    expect(content).toContain("cli error");
    expect(content).toContain('"message": "boom"');
    // multi-line pretty block, not a single condensed line
    expect(content).toMatch(/login start --------\n\{/);
  });

  it("can be disabled with SACC_LOG=0", async () => {
    dir = await mkdtemp(join(tmpdir(), "sacc-log-off-"));
    initLogger({ SACC_LOG_DIR: dir, SACC_LOG: "0" });

    writeLog("info", "should not write");

    await expect(readFile(join(dir, "marker"), "utf8")).rejects.toThrow();
    // Directory may or may not exist; the daily file must not.
    await expect(readFile(getTodayLogPath(), "utf8")).rejects.toThrow();
  });

  it("writes debug by default and can raise min level to info", async () => {
    dir = await mkdtemp(join(tmpdir(), "sacc-log-debug-"));
    initLogger({ SACC_LOG_DIR: dir });
    writeLog("debug", "visible by default");
    let content = await readFile(getTodayLogPath(), "utf8");
    expect(content).toContain("[DEBUG] #1");
    expect(content).toContain("visible by default");

    resetLoggerForTests();
    dir = await mkdtemp(join(tmpdir(), "sacc-log-info-only-"));
    initLogger({ SACC_LOG_DIR: dir, SACC_LOG: "info" });
    writeLog("debug", "hidden at info");
    writeLog("info", "shown at info");
    content = await readFile(getTodayLogPath(), "utf8");
    expect(content).not.toContain("hidden at info");
    expect(content).toContain("shown at info");
  });

  it("serializes errors with stack and redacts secrets", () => {
    const err = new Error("explode");
    const dumped = serializeError(err);
    expect(dumped.message).toBe("explode");
    expect(String(dumped.stack)).toContain("explode");
    expect(redactSecret("supersecrettokenvalue")).toMatch(/^supersec…\(len=/);
  });
});
