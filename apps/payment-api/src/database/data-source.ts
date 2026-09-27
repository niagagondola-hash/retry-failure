/**
 * TypeORM DataSource for CLI usage (migrations).
 *
 * Application runtime uses TypeOrmModule.forRootAsync (see database.module.ts).
 *
 * TASK-14b: Dual driver support via buildDbConfig() (see db-config.ts).
 *   - DB_TYPE=postgres (default): PostgreSQL with migrations
 *   - DB_TYPE=sqlite: SQLite with synchronize=true (skip migrations, auto-create)
 *
 * Env loading: via loadEnv() helper yang adaptive (monorepo root OR
 * standalone OR OS env vars). Lihat `config/env-loader.ts` untuk details.
 *
 * db:migrate script (`tsx --env-file=../../.env ...`) juga handle env loading
 * via tsx flag — loadEnv() redundant tapi aman (dotenv tidak override existing).
 *
 * Usage:
 *   pnpm db:migrate            -> tsx typeorm migration:run -d src/database/data-source.ts
 *   pnpm db:migrate:revert     -> tsx typeorm migration:revert -d src/database/data-source.ts
 *   pnpm db:migration:generate -> tsx typeorm migration:generate -d src/database/data-source.ts
 */
import { DataSource, type LoggerOptions } from 'typeorm';
import { buildDbConfig } from './db-config';
import { loadEnv } from '../config/env-loader';

// Load env (adaptive — monorepo root OR per-app OR OS env vars)
loadEnv();

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
