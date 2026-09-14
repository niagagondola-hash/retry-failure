import axios from 'axios';
import { Client } from 'pg';

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:3002';
const PAYMENT_API_URL = process.env.PAYMENT_API_URL ?? 'http://localhost:3001';
const DB_HOST = process.env.DB_HOST ?? 'localhost';
const DB_PORT = Number(process.env.DB_PORT ?? 5432);
const DB_USER = process.env.DB_USER ?? 'retry_failure';
const DB_PASS = process.env.DB_PASS ?? 'retry_failure';
const DB_NAME = process.env.DB_NAME ?? 'retry_failure';

export const gatewayClient = axios.create({ baseURL: GATEWAY_URL, timeout: 10000 });
export const paymentClient = axios.create({ baseURL: PAYMENT_API_URL, timeout: 60000 });

export const pgClient = new Client({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
});

let connected = false;

export async function ensureDbConnected(): Promise<void> {
  if (!connected) {
    await pgClient.connect();
    connected = true;
  }
}

export async function closeDb(): Promise<void> {
  if (connected) {
    await pgClient.end();
    connected = false;
  }
}

export async function resetGateway(): Promise<void> {
  await gatewayClient.put('/admin/config', { mode: 'always-success' });
}

export async function cleanDb(): Promise<void> {
  await ensureDbConnected();
  await pgClient.query('DELETE FROM payment_attempts');
  await pgClient.query('DELETE FROM payments');
}

export async function resetGatewayToHealthy(): Promise<void> {
  await gatewayClient.put('/admin/config', { mode: 'always-success' });
}
