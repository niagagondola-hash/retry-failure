/**
 * SCENARIO 1 - Transient Failure (fail-first-n=2)
 * ===============================================
 *
 * Goal:
 *   Verify that Cockatiel retry policy auto-recovers from transient 5xx errors.
 *   Gateway mock returns 500 for first 2 calls, 200 on 3rd -> payment succeeds
 *   after exactly 3 attempts, with a consistent trace ID (single inline cycle,
 *   scheduler NOT involved).
 *
 * Preconditions:
 *   - PostgreSQL running + migrated
 *   - payment-api :3001 listening
 *   - gateway-mock :3002 listening
 *   - DB clean (beforeAll calls cleanDb())
 *   - Gateway mode set to 'fail-first-n' with n=2 in beforeAll
 *
 * Expected outcome:
 *   - HTTP: 201 Created, payment.status='succeeded', attemptCount=3
 *   - DB payment_attempts: 3 rows
 *       [0] { outcome:'retryable_failure', httpStatus:500 }
 *       [1] { outcome:'retryable_failure', httpStatus:500 }
 *       [2] { outcome:'success',           httpStatus:200 }
 *   - All 3 rows share SAME trace_id (inline cycle, no scheduler involvement)
 *   - Metrics: retry_attempts_total{outcome='failure'} delta >= 2
 *
 * Flow diagram (rendered in MD):
 *   See docs/tasks/TASK-14a-transient.md -> section "3. Visualisasi Alur"
 *
 * Manual verification procedure (5 layers L1-L5):
 *   See docs/tasks/TASK-14a-transient.md -> section "5. Verifikasi Manual per Lapis"
 *
 * Run this file only:
 *   pnpm test:e2e:transient
 *   # or
 *   pnpm exec jest --config ./tests/e2e/jest-e2e.json --runInBand \
 *     tests/e2e/payments.transient.e2e-spec.ts
 */
import { setGatewayMode } from './helpers/gateway';
import { createPayment, waitForTerminalStatus } from './helpers/payments';
import { getMetric } from './helpers/metrics';
import { queryAttempts } from './helpers/db';
import { resetGatewayState, resetGatewayToHealthy, ensureDbConnected, cleanDb, closeDb } from './helpers/setup';

describe('Scenario 1 - Transient failure (fail-first-n=2)', () => {
  const orderId = `E2E-S1-${Date.now()}`;

  beforeAll(async () => {
    await ensureDbConnected();
    await cleanDb();
    await resetGatewayState();
    await setGatewayMode('fail-first-n', { n: 2 });
  });

  afterAll(async () => {
    await resetGatewayToHealthy();
    await closeDb();
  });

  it('should succeed after 3 attempts (2 retryable_failure + 1 success)', async () => {
    const retryFailBefore = await getMetric('retry_attempts_total', { outcome: 'failure' });
    const succeededBefore = await getMetric('payments_current_status', { status: 'succeeded' });

    const payment = await createPayment({ orderId, amount: 50000, currency: 'IDR' });
    const { payment: finalPayment, attempts } = await waitForTerminalStatus(payment.id, 30000);

    expect(finalPayment.status).toBe('succeeded');
    expect(finalPayment.attemptCount).toBe(3);

    expect(attempts).toHaveLength(3);
    expect(attempts[0].outcome).toBe('retryable_failure');
    expect(attempts[0].httpStatus).toBe(500);
    expect(attempts[1].outcome).toBe('retryable_failure');
    expect(attempts[1].httpStatus).toBe(500);
    expect(attempts[2].outcome).toBe('success');
    expect(attempts[2].httpStatus).toBe(200);

    const traceIds = new Set(attempts.map((a) => a.traceId));
    expect(traceIds.size).toBe(1);

    const dbAttempts = await queryAttempts(payment.id);
    expect(dbAttempts).toHaveLength(3);

    const retryFailAfter = await getMetric('retry_attempts_total', { outcome: 'failure' });
    const succeededAfter = await getMetric('payments_current_status', { status: 'succeeded' });
    expect(retryFailAfter - retryFailBefore).toBeGreaterThanOrEqual(2);
    expect(succeededAfter - succeededBefore).toBeGreaterThanOrEqual(1);
  }, 60000);
});
