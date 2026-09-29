/**
 * LoggerModule - nestjs-pino setup with pino-pretty for dev + file logging.
 *
 * Plan reference: PLAN1 §115 (Logging: nestjs-pino / pino), PLAN2 §128 (Logging:
 * nestjs-pino, pino — structured logging), Section 13 (Observability).
 *
 * Multistream via pino `transport.targets` (native pino API, compatible with
 * pino-http + nestjs-pino v4):
 *   1. stdout — pino-pretty (dev) or raw JSON (prod)
 *   2. file  — apps/logs/payment-api-yyyyMMdd-HHmmss.log (always, for debugging)
 *
 * Filename format per user request: `nama-service-yyyyMMdd-HHmmss.log`
 * One file per service start (timestamp = boot time, not per log line).
 *
 * Note: `pinoHttp.streams` (plural) does NOT work in nestjs-pino v4 —
 * must use `transport.targets` (pino native multistream API).
 */

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import { getTraceIdSync } from './trace-context';

/**
 * Folder for log files — `apps/logs/` (sibling with service folders).
 *
 * Path calculation: at runtime this file is compiled to
 *   apps/payment-api/dist/modules/observability/logger.module.js
 * so `../../../../` brings us to `apps/payment-api/` parent (the monorepo
 * `apps/` folder), then `logs/` resolves to `apps/logs/`. Using a path
 * relative to the service folder root keeps the resolution stable regardless
 * of whether the file is run from `src/` (dev) or `dist/` (prod).
 */
const LOGS_DIR = resolve(__dirname, '../../../../logs');

/** Service name prefix for log filename. */
const SERVICE_NAME = 'payment-api';

/**
 * Build log filename: `nama-service-yyyyMMdd-HHmmss.log`.
 *
 * Timestamp = service boot time (this function is called once per process
 * start, so all logs from this session share the same file).
 */
function buildLogFilename(): string {
  const now = new Date();
  const pad = (n: number): string => n.toString().padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${SERVICE_NAME}-${date}-${time}.log`;
}

/**
 * Resolve + create the log file path. Side effect: ensures `apps/logs/`
 * folder exists (recursive mkdir). Called once at module factory time.
 *
 * Returns the absolute file path — pino `pino/file` transport handles the
 * actual write stream internally (we don't need to manage WriteStream here).
 */
function resolveLogFilePath(): { logDir: string; logFilePath: string } {
  mkdirSync(LOGS_DIR, { recursive: true });
  const logFilePath = join(LOGS_DIR, buildLogFilename());
  return { logDir: LOGS_DIR, logFilePath };
}

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const { logDir, logFilePath } = resolveLogFilePath();
        const isProd = cfg.get<string>('NODE_ENV') === 'production';
        const level = cfg.get<string>('LOG_LEVEL') ?? 'info';

        // Bootstrap log so user knows where logs go.
        console.log(
          `[LoggerModule] logs dir: ${logDir} | file: ${logFilePath} | level: ${level} (multistream: stdout + file)`,
        );

        // Build pino multistream transport targets.
        //
        // `pino/file` is a built-in pino transport (no extra deps). It manages
        // its own write stream + handles async flushing on process exit.
        //
        // `pino-pretty` is the dev-only pretty printer (colorized, human-readable).
        //
        // In production we use pino's default JSON formatter to stdout (no
        // transport target needed for stdout in prod — pino defaults to JSON).
        const targets: Array<{
          target: string;
          level: string;
          options: Record<string, unknown>;
        }> = [];

        if (!isProd) {
          // Dev: pretty stdout (colorized, human-readable)
          targets.push({
            target: 'pino-pretty',
            level,
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname,req,res,responseTime',
            },
          });
        }

        // Always: file destination (raw JSON for structured log analysis)
        targets.push({
          target: 'pino/file',
          level,
          options: {
            destination: logFilePath,
            mkdir: true,
          },
        });

        return {
          pinoHttp: {
            level,
            mixin: () => {
              const traceId = getTraceIdSync();
              return traceId ? { traceId } : {};
            },
            autoLogging: {
              ignore: (req: { url?: string }) =>
                req.url === '/metrics' || req.url === '/health',
            },
            // Native pino multistream API — works with pino-http + nestjs-pino v4.
            transport: {
              targets,
            },
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class AppLoggerModule {}
