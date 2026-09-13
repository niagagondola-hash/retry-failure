/**
 * TypeORM DataSource for CLI usage (migrations).
 *
 * Application runtime uses TypeOrmModule.forRootAsync (see database.module.ts).
 *
 * Usage:
 *   pnpm db:migrate            → tsx typeorm migration:run -d src/database/data-source.ts
 *   pnpm db:migrate:revert     → tsx typeorm migration:revert -d src/database/data-source.ts
 *   pnpm db:migration:generate → tsx typeorm migration:generate -d src/database/data-source.ts
 *
 * NOTE: `dotenv/config` di-import untuk load .env sebelum baca process.env.
 * NOTE: tsx (bukan ts-node) dipakai karena lebih reliable dengan TypeScript decorator.
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
