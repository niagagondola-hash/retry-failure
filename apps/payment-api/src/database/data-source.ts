/**
 * TypeORM DataSource for CLI usage (migrations).
 *
 * Application runtime uses TypeOrmModule.forRootAsync (see database.module.ts).
 *
 * TASK-14b: Dual driver support via buildDbConfig() (see db-config.ts).
 *   - DB_TYPE=postgres (default): PostgreSQL with migrations
 *   - DB_TYPE=sqlite: SQLite with synchronize=true (skip migrations, auto-create)
 *
 * NOTE: CLI tidak punya akses ke NestJS ConfigService, jadi baca process.env
 * langsung. Env sudah di-load via `dotenv/config` import di bawah.
 * Factory config (buildDbConfig) tetap sama dengan NestJS runtime —
 * tidak ada duplikasi logic.
 *
 * Usage:
 *   pnpm db:migrate            -> tsx typeorm migration:run -d src/database/data-source.ts
 *   pnpm db:migrate:revert     -> tsx typeorm migration:revert -d src/database/data-source.ts
 *   pnpm db:migration:generate -> tsx typeorm migration:generate -d src/database/data-source.ts
 */
import 'dotenv/config';
import { DataSource, type LoggerOptions } from 'typeorm';
import { buildDbConfig } from './db-config';

const dbType = process.env.DB_TYPE ?? 'postgres';
const logging: LoggerOptions =
  process.env.LOG_LEVEL === 'debug' ? 'all' : ['error', 'warn'];

export default new DataSource(
  buildDbConfig({
    dbType,
    logging,
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    schema: process.env.DB_SCHEMA,
    sqliteStorage: process.env.DB_SQLITE_PATH,
  }),
);
