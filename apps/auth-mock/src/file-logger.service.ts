/**
 * FileLoggerService — custom NestJS LoggerService that writes to both
 * stdout AND a file in `apps/logs/`.
 *
 * Plan reference: PLAN2 Section 13 (Observability) + AUTH_FLOW_SEQUENCE.md.
 * Task: file-based logging for happy path debugging.
 *
 * Filename format per user request: `nama-service-yyyyMMdd-HHmmss.log`
 * One file per service start (timestamp = boot time, not per log line).
 *
 * No new dependencies — uses only `node:fs` + `node:util`. Drop-in
 * replacement for NestJS default console Logger via `app.useLogger()`.
 *
 * Log line format (file + stdout):
 *   [ISO timestamp] [LEVEL] [Context] message {optionalParams}
 *
 * Levels supported: debug, verbose, log, warn, error.
 * To enable debug logs in file: set `LOG_LEVEL=debug` env var.
 */

import { mkdirSync, createWriteStream, WriteStream } from 'node:fs';
import { join, resolve } from 'node:path';

import { LoggerService, LogLevel } from '@nestjs/common';

/**
 * Folder for log files — `apps/logs/` (sibling with service folders).
 *
 * Path calculation: at runtime this file is compiled to
 *   apps/auth-mock/dist/file-logger.service.js
 * so `../../` brings us to `apps/auth-mock/`, then `../logs` resolves to
 * `apps/logs/`. Using `../logs` (not `logs`) keeps the path stable regardless
 * of whether the file is run from `src/` (dev) or `dist/` (prod).
 */
const LOGS_DIR = resolve(__dirname, '../../logs');

/** Service name prefix for log filename. */
const SERVICE_NAME = 'auth-mock';

/**
 * Build log filename: `nama-service-yyyyMMdd-HHmmss.log`.
 *
 * Timestamp = service boot time (module evaluated once at import, so all
 * logs from this process share the same file).
 */
function buildLogFilename(): string {
  const now = new Date();
  const pad = (n: number): string => n.toString().padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${SERVICE_NAME}-${date}-${time}.log`;
}

// Ensure logs dir exists + open append-mode write stream ONCE per process.
mkdirSync(LOGS_DIR, { recursive: true });
const LOG_FILE_PATH = join(LOGS_DIR, buildLogFilename());
const fileStream: WriteStream = createWriteStream(LOG_FILE_PATH, { flags: 'a' });

// Bootstrap log so user knows where logs go. Uses `console.warn` because
// the auth-mock ESLint config (`no-console: ['error', { allow: ['warn', 'error'] }]`)
// forbids `console.log` — `warn` is allowed and goes to stderr too.
console.warn(`[FileLoggerService] logs dir: ${LOGS_DIR}`);
console.warn(`[FileLoggerService] file: ${LOG_FILE_PATH}`);

/**
 * Parse `LOG_LEVEL` env var to determine which levels are enabled.
 * Default: 'log' (which includes log, warn, error — NOT debug/verbose).
 * Set `LOG_LEVEL=debug` to capture everything.
 */
function resolveEnabledLevels(): Set<LogLevel> {
  const env = (process.env.LOG_LEVEL ?? 'log').toLowerCase();
  switch (env) {
    case 'debug':
      return new Set(['debug', 'verbose', 'log', 'warn', 'error']);
    case 'verbose':
      return new Set(['verbose', 'log', 'warn', 'error']);
    case 'log':
      return new Set(['log', 'warn', 'error']);
    case 'warn':
      return new Set(['warn', 'error']);
    case 'error':
      return new Set(['error']);
    default:
      return new Set(['log', 'warn', 'error']);
  }
}

const ENABLED_LEVELS = resolveEnabledLevels();

/**
 * Format a log line: `[ISO] [LEVEL] [Context] message {params}`.
 *
 * `optionalParams` may include the context (last param if string) —
 * matches NestJS Logger calling convention.
 */
function formatLine(
  level: string,
  message: unknown,
  context: string | undefined,
  optionalParams: unknown[],
): string {
  const timestamp = new Date().toISOString();
  const ctx = context ?? 'App';
  const paramsStr =
    optionalParams.length > 0
      ? ' ' +
        optionalParams
          .map((p) => (typeof p === 'object' ? safeJsonStringify(p) : String(p)))
          .join(' ')
      : '';
  const messageStr = typeof message === 'string' ? message : safeJsonStringify(message);
  return `[${timestamp}] [${level}] [${ctx}] ${messageStr}${paramsStr}\n`;
}

/** Safe JSON stringify — avoids throwing on circular references. */
function safeJsonStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

/**
 * Extract context from `optionalParams` per NestJS Logger convention:
 * last param if it's a string → context, removed from params list.
 *
 * If no context provided, falls back to `defaultContext`.
 */
function extractContext(
  optionalParams: unknown[],
  defaultContext?: string,
): { context: string | undefined; remaining: unknown[] } {
  if (optionalParams.length === 0) {
    return { context: defaultContext, remaining: [] };
  }
  const last = optionalParams[optionalParams.length - 1];
  if (typeof last === 'string') {
    return { context: last, remaining: optionalParams.slice(0, -1) };
  }
  return { context: defaultContext, remaining: optionalParams };
}

/**
 * Write a single log line to both stdout (colorized by level) and file.
 *
 * Errors go to stderr; everything else to stdout. File stream receives the
 * same formatted line regardless of level.
 */
function writeLine(level: LogLevel, line: string): void {
  if (!ENABLED_LEVELS.has(level)) return;
  const target = level === 'error' ? process.stderr : process.stdout;
  target.write(line);
  fileStream.write(line);
}

/**
 * Custom LoggerService implementation.
 *
 * Methods mirror NestJS `LoggerService` interface:
 *   - log(message, context?)      → info level
 *   - error(message, context?)    → error level (stderr + file)
 *   - warn(message, context?)    → warn level
 *   - debug(message, context?)    → debug level (LOG_LEVEL=debug to enable)
 *   - verbose(message, context?)   → verbose level (LOG_LEVEL=verbose or lower)
 *
 * Usage in main.ts:
 *   ```ts
 *   app.useLogger(new FileLoggerService());
 *   ```
 */
export class FileLoggerService implements LoggerService {
  /**
   * Optional default context — applied when the caller doesn't pass an
   * explicit context (e.g. `Logger.log('msg')` without a second arg).
   */
  private readonly defaultContext?: string;

  constructor(defaultContext?: string) {
    this.defaultContext = defaultContext;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    const { context, remaining } = extractContext(optionalParams, this.defaultContext);
    writeLine('log', formatLine('LOG', message, context, remaining));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    const { context, remaining } = extractContext(optionalParams, this.defaultContext);
    writeLine('error', formatLine('ERROR', message, context, remaining));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    const { context, remaining } = extractContext(optionalParams, this.defaultContext);
    writeLine('warn', formatLine('WARN', message, context, remaining));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    const { context, remaining } = extractContext(optionalParams, this.defaultContext);
    writeLine('debug', formatLine('DEBUG', message, context, remaining));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    const { context, remaining } = extractContext(optionalParams, this.defaultContext);
    writeLine('verbose', formatLine('VERBOSE', message, context, remaining));
  }

  /**
   * Whether this logger should log at the given level.
   *
   * NestJS Logger class calls `isLevelEnabled?.()` before invoking `debug()`
   * or `verbose()`. If we omit this method, NestJS uses its internal default
   * (which may filter out `debug` even when `LOG_LEVEL=debug` is set on
   * the env). Returning `true` here lets our `ENABLED_LEVELS` set in
   * `writeLine` make the final decision.
   */
  isLevelEnabled(level: LogLevel): boolean {
    return ENABLED_LEVELS.has(level);
  }
}
