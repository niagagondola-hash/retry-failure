/**
 * SCENARIO 5 — Server-Directed Retry (Retry-After header)
 * =======================================================
 *
 * Goal:
 *   Verify that Cockatiel respects the HTTP `Retry-After` header returned
 *   by a 429 Too Many Requests response. Delay between attempts must be
 *   >= retryAfterSeconds × 1000ms (with 500ms tolerance), NOT the default
 *   Cockatiel backoff.
 *
 * Gateway mode 'rate-limited' with retryAfterSeconds=3:
 *   - Every charge request returns 429 with header `Retry-After: 3`
 *   - Cockatiel must override default backoff and wait 3000ms before next attempt
 *   - Mode does NOT auto-recover — payment will eventually exhaust retries & fail
 *
 * Note: This test does NOT assert terminal status (succeeded/failed).
 * It only verifies TIMING — the delay between attempts.
 *
 * Preconditions:
 *   - PostgreSQL running + migrated
 *   - payment-api :3001 listening
 *   - gateway-mock :3002 listening
 *   - Breaker CLOSED (resetBreaker() in beforeAll)
 *
 * Expected outcome:
 *   - At least 1 attempt with httpStatus=429
 *   - DB: delta(created_at[1] - created_at[0]) >= 2500ms (3s with 500ms tolerance)
 *   - At least 1 attempt with delayBeforeNextMs >= 3000
 *
 * Flow diagram (rendered in MD):
 *   See docs/tasks/TASK-14a-retry-after.md -> section "3. Visualisasi Alur"
 *
 * Manual verification procedure (5 layers L1-L5):
 *   See docs/tasks/TASK-14a-retry-after.md -> section "5. Verifikasi Manual per Lapis"
 *
 * Run this file only:
 *   pnpm test:e2e:retry-after
 *   # or
 *   pnpm exec jest --config ./tests/e2e/jest-e2e.json --runInBand \
 *     tests/e2e/payments.retry-after.e2e-spec.ts
 */
import { setGatewayMode } from './helpers/gateway';
import { createPayment, waitForTerminalStatus } from './helpers/payments';
import { queryAttempts } from './helpers/db';
import { resetBreaker } from './helpers/breaker';
import { resetGatewayToHealthy, ensureDbConnected, closeDb } from './helpers/setup';

describe('Scenario 5 — Retry-After (rate-limited, retryAfterSeconds=3)', () => {
  const orderId = `E2E-S5-${Date.now()}`;

  beforeAll(async () => {
    await ensureDbConnected();
    await resetBreaker();
    await setGatewayMode('rate-limited', { retryAfterSeconds: 3 });
  });

  afterAll(async () => {
    await resetGatewayToHealthy();
    await closeDb();
  });

  it('should respect Retry-After header (delay >= 3000ms between attempts)', async () => {
    const payment = await createPayment({ orderId, amount: 25000, currency: 'IDR' });
    const { payment: finalPayment, attempts } = await waitForTerminalStatus(payment.id, 60000);

    // Verify attempts got 429
    const rateLimitedAttempts = attempts.filter((a) => a.httpStatus === 429);
    expect(rateLimitedAttempts.length).toBeGreaterThanOrEqual(1);

    // Verify delay between attempts via DB timestamps
    const dbAttempts = await queryAttempts(payment.id);
    expect(dbAttempts.length).toBeGreaterThanOrEqual(2);

    if (dbAttempts.length >= 2) {
      const t0 = new Date(dbAttempts[0].created_at as string).getTime();
      const t1 = new Date(dbAttempts[1].created_at as string).getTime();
      const delta = t1 - t0;
      expect(delta).toBeGreaterThanOrEqual(2500); // 3s with 500ms tolerance
    }

    // Verify delayBeforeNextMs in audit
    const withDelay = attempts.filter((a) => a.delayBeforeNextMs !== null && a.delayBeforeNextMs >= 3000);
    expect(withDelay.length).toBeGreaterThanOrEqual(1);
  }, 90000);
});
