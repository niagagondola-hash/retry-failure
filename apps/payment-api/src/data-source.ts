/**
 * TypeORM DataSource for CLI usage (migrations).
 * Application runtime uses TypeOrmModule.forRootAsync (TASK-02).
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'retry_failure',
  password: process.env.DB_PASS ?? 'retry_failure',
  database: process.env.DB_NAME ?? 'retry_failure',
  schema: process.env.DB_SCHEMA ?? 'public',
  entities: [__dirname + '/database/entities/*.{ts,js}'],
  migrations: [__dirname + '/database/migrations/*.{ts,js}'],
  synchronize: false,
  logging: process.env.LOG_LEVEL === 'debug' ? 'all' : ['error', 'warn'],
});
