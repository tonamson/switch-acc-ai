import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

type LogState = {
  logDir: string;
  enabled: boolean;
  /**
   * Minimum level to write.
   * Default is "debug" (everything) so bug reports have full detail.
   * Override with SACC_LOG=info|warn|error|0|false.
   */
  minLevel: LogLevel | "off";
  sessionId: string;
};

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let state: LogState | null = null;
let sequence = 0;

/** Resolve the directory that holds daily sacc log files. */
export function resolveLogDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir(),
): string {
  return env.SACC_LOG_DIR || join(homeDir, ".sacc", "logs");
}

/** Path for a single calendar day: `sacc-YYYY-MM-DD.log`. */
export function dailyLogPath(logDir: string, date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return join(logDir, `sacc-${year}-${month}-${day}.log`);
}

function parseMinLevel(env: NodeJS.ProcessEnv): LogLevel | "off" {
  const raw = (env.SACC_LOG || "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return "off";
  if (raw === "error") return "error";
  if (raw === "warn" || raw === "warning") return "warn";
  if (raw === "info") return "info";
  // default + explicit debug/verbose/true/empty → full detail
  return "debug";
}

function newSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function initLogger(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir(),
): LogState {
  state = {
    logDir: resolveLogDir(env, homeDir),
    enabled: parseMinLevel(env) !== "off",
    minLevel: parseMinLevel(env),
    sessionId: newSessionId(),
  };
  return state;
}

export function getLogDir(): string {
  return state?.logDir ?? resolveLogDir();
}

export function getSessionId(): string {
  return ensureState().sessionId;
}

/** Today's log file path (whether or not it exists yet). */
export function getTodayLogPath(date: Date = new Date()): string {
  return dailyLogPath(getLogDir(), date);
}

function ensureState(): LogState {
  if (!state) {
    return initLogger();
  }
  return state;
}

function isoTimestamp(date: Date = new Date()): string {
  return date.toISOString();
}

/** Safe JSON that keeps Error-like objects and avoids circular blowups. */
export function safeJson(value: unknown, space = 2): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, current) => {
        if (typeof current === "bigint") return current.toString();
        if (current instanceof Error) {
          return serializeError(current);
        }
        if (current && typeof current === "object") {
          if (seen.has(current as object)) return "[Circular]";
          seen.add(current as object);
        }
        return current;
      },
      space,
    );
  } catch (error) {
    return JSON.stringify({
      error: "json_serialize_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Full error dump for debugging (stack, errno code, nested cause). */
export function serializeError(error: unknown): LogContext {
  if (error instanceof Error) {
    const err = error as NodeJS.ErrnoException & { cause?: unknown };
    const out: LogContext = {
      name: err.name,
      message: err.message,
      stack: err.stack ?? null,
    };
    if (err.code !== undefined) out.code = err.code;
    if (err.errno !== undefined) out.errno = err.errno;
    if (err.syscall !== undefined) out.syscall = err.syscall;
    if (err.path !== undefined) out.path = err.path;
    if (err.cause !== undefined) out.cause = serializeError(err.cause);
    return out;
  }
  return { message: String(error) };
}

/** Redact secrets while keeping enough prefix for correlation. */
export function redactSecret(value: string | undefined | null, keep = 8): string | null {
  if (!value) return null;
  if (value.length <= keep) return "***";
  return `${value.slice(0, keep)}…(len=${value.length})`;
}

/** Snapshot of process/terminal/env useful when debugging interactive CLI handoff. */
export function runtimeSnapshot(extraEnv: NodeJS.ProcessEnv = process.env): LogContext {
  return {
    pid: process.pid,
    ppid: process.ppid,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    cwd: process.cwd(),
    execPath: process.execPath,
    title: process.title,
    uptimeSec: Math.round(process.uptime() * 1000) / 1000,
    memory: process.memoryUsage(),
    stdin: {
      isTTY: Boolean(process.stdin.isTTY),
      isRaw: process.stdin.isRaw ?? null,
      readableFlowing: process.stdin.readableFlowing,
      readableEnded: process.stdin.readableEnded,
      destroyed: process.stdin.destroyed,
      isPaused: typeof process.stdin.isPaused === "function" ? process.stdin.isPaused() : null,
    },
    stdout: {
      isTTY: Boolean(process.stdout.isTTY),
      columns: process.stdout.columns ?? null,
      rows: process.stdout.rows ?? null,
    },
    stderr: {
      isTTY: Boolean(process.stderr.isTTY),
    },
    env: {
      HOME: extraEnv.HOME ?? null,
      SHELL: extraEnv.SHELL ?? null,
      TERM: extraEnv.TERM ?? null,
      TERM_PROGRAM: extraEnv.TERM_PROGRAM ?? null,
      COLORTERM: extraEnv.COLORTERM ?? null,
      LANG: extraEnv.LANG ?? null,
      PATH: extraEnv.PATH ?? null,
      SACC_LOG: extraEnv.SACC_LOG ?? null,
      SACC_LOG_DIR: extraEnv.SACC_LOG_DIR ?? null,
      CODEX_HOME: extraEnv.CODEX_HOME ?? null,
      CODEX_ACCOUNTS_DIR: extraEnv.CODEX_ACCOUNTS_DIR ?? null,
      CODEX_SHARED_HOME: extraEnv.CODEX_SHARED_HOME ?? null,
      GROK_HOME: extraEnv.GROK_HOME ?? null,
      GROK_ACCOUNTS_DIR: extraEnv.GROK_ACCOUNTS_DIR ?? null,
      GROK_SHARED_HOME: extraEnv.GROK_SHARED_HOME ?? null,
      GROK_LEADER_SOCKET: extraEnv.GROK_LEADER_SOCKET ?? null,
      GROK_AUTH: extraEnv.GROK_AUTH ? redactSecret(extraEnv.GROK_AUTH) : null,
      GROK_AUTH_PATH: extraEnv.GROK_AUTH_PATH ?? null,
      XAI_API_KEY: extraEnv.XAI_API_KEY ? redactSecret(extraEnv.XAI_API_KEY) : null,
    },
  };
}

function shouldWrite(level: LogLevel, current: LogState): boolean {
  if (!current.enabled || current.minLevel === "off") return false;
  return LEVEL_RANK[level] >= LEVEL_RANK[current.minLevel];
}

/**
 * Multi-line detailed log block (not one-line condensed).
 *
 * Example:
 * ```
 * -------- 2026-07-16T12:00:00.000Z [ERROR] #3 sess=abc login failed --------
 * {
 *   "provider": "grok",
 *   "error": { "message": "...", "stack": "..." }
 * }
 * ```
 */
function formatBlock(
  level: LogLevel,
  message: string,
  context: LogContext | undefined,
  meta: { sessionId: string; seq: number },
  date: Date = new Date(),
): string {
  const header = `-------- ${isoTimestamp(date)} [${level.toUpperCase()}] #${meta.seq} sess=${meta.sessionId} ${message} --------`;
  if (!context || Object.keys(context).length === 0) {
    return `${header}\n`;
  }
  return `${header}\n${safeJson(context)}\n`;
}

/**
 * Append a detailed block to today's daily log. Never throws.
 */
export function writeLog(
  level: LogLevel,
  message: string,
  context?: LogContext,
): void {
  try {
    const current = ensureState();
    if (!shouldWrite(level, current)) return;
    sequence += 1;
    mkdirSync(current.logDir, { recursive: true });
    appendFileSync(
      dailyLogPath(current.logDir),
      formatBlock(level, message, context, {
        sessionId: current.sessionId,
        seq: sequence,
      }),
      "utf8",
    );
  } catch {
    // Swallow — missing home dir / permissions should not crash sacc.
  }
}

export function logDebug(message: string, context?: LogContext): void {
  writeLog("debug", message, context);
}

export function logInfo(message: string, context?: LogContext): void {
  writeLog("info", message, context);
}

export function logWarn(message: string, context?: LogContext): void {
  writeLog("warn", message, context);
}

export function logError(message: string, context?: LogContext): void {
  writeLog("error", message, context);
}

/** Convenience: log an exception with full serializeError dump. */
export function logException(
  message: string,
  error: unknown,
  context?: LogContext,
): void {
  writeLog("error", message, {
    ...context,
    error: serializeError(error),
  });
}

/** Simple stopwatch for step durations in logs. */
export function startTimer(): { elapsedMs: () => number } {
  const started = process.hrtime.bigint();
  return {
    elapsedMs: () => Number(process.hrtime.bigint() - started) / 1_000_000,
  };
}

/** Reset logger state (tests only). */
export function resetLoggerForTests(): void {
  state = null;
  sequence = 0;
}
