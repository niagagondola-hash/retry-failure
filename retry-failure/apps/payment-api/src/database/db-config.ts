import type { DataSourceOptions, LoggerOptions } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';

export type DbConfigInput = {
  dbType: string;
  logging: LoggerOptions;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  schema?: string;
  sqliteStorage?: string;
};

export type DbConfigFactory = (input: DbConfigInput) => DataSourceOptions;

// Daftar entitas terpusat
const entitiesList = [Payment, PaymentAttempt];

const SQLITE_CONFIG: DbConfigFactory = (input) => ({
  type: 'better-sqlite3',
  database: input.sqliteStorage ?? './test.db',
  entities: entitiesList,
  synchronize: true,
  dropSchema: process.env.NODE_ENV === 'test',
  logging: input.logging,
}) as DataSourceOptions;

const POSTGRES_CONFIG: DbConfigFactory = (input) => ({
  type: 'postgres',
  host: input.host ?? 'localhost',
  port: input.port ?? 5432,
  username: input.username ?? 'retry_failure',
  password: input.password ?? 'retry_failure',
  database: input.database ?? 'retry_failure',
  schema: input.schema ?? 'public',
  synchronize: false,
  entities: entitiesList,
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  migrationsRun: false,
  logging: input.logging,
}) as DataSourceOptions;

export const dbConfigMap = new Map<string, DbConfigFactory>([
  ['postgres', POSTGRES_CONFIG],
  ['sqlite', SQLITE_CONFIG],
]);

export function buildDbConfig(input: DbConfigInput): DataSourceOptions {
  const factory = dbConfigMap.get(input.dbType) ?? POSTGRES_CONFIG;
  return factory(input);
}