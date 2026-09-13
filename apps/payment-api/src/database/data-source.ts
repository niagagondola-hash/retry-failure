/**
 * TypeORM DataSource for CLI usage (migrations).
 *
 * Application runtime uses TypeOrmModule.forRootAsync (see database.module.ts).
 *
 * Usage:
 *   pnpm db:migrate            → typeorm migration:run -- -d src/data-source.ts
 *   pnpm db:migrate:revert     → typeorm migration:revert -- -d src/data-source.ts
 *   pnpm db:migration:generate → typeorm migration:generate -- -d src/data-source.ts
 *
 * NOTE: This file imports `dotenv/config` to load .env before reading process.env.
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'retry_failure',
  password: process.env.DB_PASS ?? 'retry_failure',
  database: process.env.DB_NAME ?? 'retry_failure',
  schema: process.env.DB_SCHEMA ?? 'public',
  entities: [Payment, PaymentAttempt],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
  logging: process.env.LOG_LEVEL === 'debug' ? 'all' : ['error', 'warn'],
});
