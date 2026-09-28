/**
 * Cross-database type helpers for packages/security entities.
 *
 * Self-contained — does NOT import from apps/payment-api (architecture:
 * shared library must not depend on consumer app).
 *
 * PostgreSQL: 'timestamp' (native, with precision via migration SQL)
 * SQLite: 'datetime' (SQLite doesn't support 'timestamp')
 *
 * Timing: loadEnv() in otel.ts (main.ts line 1) sets process.env.DB_TYPE
 * BEFORE entity decorators evaluate (main.ts line 2: import AppModule).
 * So getTimestampColumnType() returns correct type at decorator time.
 */
import type { ColumnType } from 'typeorm';

export function getUuidColumnType(): ColumnType {
  return process.env.DB_TYPE === 'sqlite' ? 'varchar' : 'uuid';
}

export function getTimestampColumnType(): ColumnType {
  return process.env.DB_TYPE === 'sqlite' ? 'datetime' : 'timestamp';
}
