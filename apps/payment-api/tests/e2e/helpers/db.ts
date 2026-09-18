import { getTestDataSource } from './setup';

// TASK-14b: Parameter placeholder compatibility.
// PostgreSQL: $1, $2, ...
// SQLite: ?
// We detect DB_TYPE at module load time and use the appropriate placeholder.
const PH = process.env.DB_TYPE === 'sqlite' ? '?' : '$1';

export async function queryAttempts(paymentId: string): Promise<Array<Record<string, unknown>>> {
  const ds = await getTestDataSource();
  const rows = await ds.query(
    `SELECT attempt_number, outcome, http_status, trace_id, gateway_reference, replayed, duration_ms, delay_before_next_ms, created_at
     FROM payment_attempts WHERE payment_id = ${PH} ORDER BY attempt_number ASC`,
    [paymentId]
  );
  return rows as Array<Record<string, unknown>>;
}

export async function queryPayment(paymentId: string): Promise<Record<string, unknown> | null> {
  const ds = await getTestDataSource();
  const rows = await ds.query(
    `SELECT id, order_id, amount, currency, status, attempt_count, total_retry_count, next_retry_at, failure_reason, created_at, updated_at
     FROM payments WHERE id = ${PH}`,
    [paymentId]
  );
  return (rows as Array<Record<string, unknown>>)[0] ?? null;
}
