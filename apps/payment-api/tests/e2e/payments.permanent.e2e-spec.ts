/**
 * SCENARIO 2 — Permanent Failure (client-error)
 * ==============================================
 *
 * Goal:
 *   Verify that 4xx client errors are NOT retried. Gateway mock returns 400
 *   with errorCode:'invalid_card' -> Cockatiel must fast-fail immediately,
 *   payment ends in 'failed' state after exactly 1 attempt.
 *
 * Preconditions:
 *   - PostgreSQL running + migrated
 *   - payment-api :3001 listening
 *   - gateway-mock :3002 listening
 *   - Gateway mode set to 'client-error' in beforeAll
 *
 * Expected outcome:
 *   - HTTP: 201 Created, payment.status='failed', attemptCount=1
 *   - failureReason contains 'invalid_card'
 *   - DB payment_attempts: 1 row
 *       [0] { outcome:'permanent_failure', httpStatus:400 }
 *   - Metrics: retry_attempts_total MUST NOT increase (no retry happened)
 *
 * Flow diagram (rendered in MD):
 *   See docs/tasks/TASK-14a-permanent.md -> section "3. Visualisasi Alur"
 *
 * Manual verification procedure (5 layers L1-L5):
 *   See docs/tasks/TASK-14a-permanent.md -> section "5. Verifikasi Manual per Lapis"
 *
 * Inverse of Scenario 1:
 *   If S1 (transient) passes but S2 (permanent) fails (or vice versa),
 *   the bug is almost certainly in error classification (4xx vs 5xx)
 *   in packages/resilience/src/errors/.
 *
 * Run this file only:
 *   pnpm test:e2e:permanent
 *   # or
 *   pnpm exec jest --config ./tests/e2e/jest-e2e.json --runInBand \
 *     tests/e2e/payments.permanent.e2e-spec.ts
 */
import { setGatewayMode } from './helpers/gateway';
import { createPayment, waitForTerminalStatus } from './helpers/payments';
import { queryAttempts } from './helpers/db';
import { resetGatewayToHealthy, ensureDbConnected, closeDb } from './helpers/setup';

describe('Scenario 2 — Permanent failure (client-error)', () => {
  const orderId = `E2E-S2-${Date.now()}`;

  beforeAll(async () => {
    await ensureDbConnected();
    await setGatewayMode('client-error');
  });

  afterAll(async () => {
    await resetGatewayToHealthy();
    await closeDb();
  });

  it('should fail with invalid_card, no retry (attemptCount=1)', async () => {
    const payment = await createPayment({ orderId, amount: 75000, currency: 'IDR' });
    const { payment: finalPayment, attempts } = await waitForTerminalStatus(payment.id, 15000);

    expect(finalPayment.status).toBe('failed');
    expect(finalPayment.attemptCount).toBe(1);
    expect(finalPayment.failureReason).toContain('invalid_card');

    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('permanent_failure');
    expect(attempts[0].httpStatus).toBe(400);

    const dbAttempts = await queryAttempts(payment.id);
    expect(dbAttempts).toHaveLength(1);
  }, 30000);
});
