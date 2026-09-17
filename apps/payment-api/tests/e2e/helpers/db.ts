import { pgClient, ensureDbConnected } from './setup';

export async function queryAttempts(paymentId: string): Promise<Array<Record<string, unknown>>> {
  await ensureDbConnected();
  const { rows } = await pgClient.query(
    `SELECT attempt_number, outcome, http_status, trace_id, gateway_reference, replayed, duration_ms, delay_before_next_ms, created_at
     FROM payment_attempts WHERE payment_id = $1 ORDER BY attempt_number ASC`,
    [paymentId]
  );
  return rows;
}

export async function queryPayment(paymentId: string): Promise<Record<string, unknown> | null> {
  await ensureDbConnected();
  const { rows } = await pgClient.query(
    `SELECT id, order_id, amount, currency, status, attempt_count, total_retry_count, next_retry_at, failure_reason, created_at, updated_at
     FROM payments WHERE id = $1`,
    [paymentId]
  );
  return rows[0] ?? null;
}
