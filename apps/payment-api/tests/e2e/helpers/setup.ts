import axios from 'axios';
import { DataSource } from 'typeorm';
import { buildDbConfig } from '../../../src/database/db-config';
import type { LoggerOptions } from 'typeorm';

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:3002';
const PAYMENT_API_URL = process.env.PAYMENT_API_URL ?? 'http://localhost:3001';

export const gatewayClient = axios.create({ baseURL: GATEWAY_URL, timeout: 10000 });
export const paymentClient = axios.create({ baseURL: PAYMENT_API_URL, timeout: 60000 });

// TASK-14b: Test helpers use buildDbConfig() — same factory as NestJS + CLI.
// DB_TYPE=sqlite -> SQLite file-based (sandbox/test)
// DB_TYPE=postgres (default) -> PostgreSQL (local dev/production)
let dataSource: DataSource | null = null;

export async function getTestDataSource(): Promise<DataSource> {
  if (!dataSource) {
    const dbType = process.env.DB_TYPE ?? 'postgres';
    const logging: LoggerOptions = false;

    dataSource = new DataSource(
      buildDbConfig({
        dbType,
        logging,
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 5432),
        username: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        schema: process.env.DB_SCHEMA,
      }),
    );
    await dataSource.initialize();
  }
  return dataSource;
}

export async function ensureDbConnected(): Promise<void> {
  await getTestDataSource();
}

export async function closeDb(): Promise<void> {
  if (dataSource && dataSource.isInitialized) {
    await dataSource.destroy();
    dataSource = null;
  }
}

export async function resetGateway(): Promise<void> {
  await gatewayClient.put('/admin/config', { mode: 'always-success' });
}

export async function cleanDb(): Promise<void> {
  const ds = await getTestDataSource();
  await ds.query('DELETE FROM payment_attempts');
  await ds.query('DELETE FROM payments');
}

export async function resetGatewayToHealthy(): Promise<void> {
  await gatewayClient.put('/admin/config', { mode: 'always-success' });
}
