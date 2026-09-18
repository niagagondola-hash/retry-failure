/**
 * SCENARIO 5 - Server-Directed Retry (Retry-After header)
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
 *
 * ⚠️ Test strategy (refactored):
 *   This test does NOT wait for terminal status (succeeded/failed).
 *   Reason: terminal status requires MAX_TOTAL_RETRIES scheduler cycles,
 *   which takes 30s+. During that time, circuit breaker may OPEN (after
 *   3 consecutive failures), causing interference.
 *
 *   Instead, test polls payment_attempts table directly via DB query,
 *   waits until 2 attempts are recorded, then asserts:
 *     1. delta(created_at[1] - created_at[0]) >= 2500ms (Retry-After honored)
 *     2. delay_before_next_ms >= 3000 in audit row
 *     3. httpStatus = 429 (rate-limited)
 *
 *   This is sufficient to prove Retry-After is respected. Full terminal
 *   status verification is tested in scenario 7 (exhaustion).
 *
 * Preconditions:
 *   - PostgreSQL running + migrated
 *   - payment-api :3001 listening
 *   - gateway-mock :3002 listening
 *   - Breaker CLOSED (resetBreaker() in beforeAll)
 *   - MAX_TOTAL_RETRIES can be any value (test doesn't wait for exhaustion)
 *
 * Expected outcome:
 *   - At least 2 attempts with httpStatus=429 recorded in DB
 *   - delta created_at between attempt 1 and 2 >= 2500ms (3s with 500ms tolerance)
 *   - At least 1 attempt with delayBeforeNextMs >= 3000
 *
 * Flow diagram (rendered in MD):
 *   See docs/tasks/TASK-14a-retry-after.md -> section "3. Visualisasi Alur"
 *
 * Run this file only:
 *   pnpm test:e2e:retry-after
 */
import { setGatewayMode } from './helpers/gateway';
import { createPayment } from './helpers/payments';
import { queryAttempts } from './helpers/db';
import { resetBreaker } from './helpers/breaker';
import { resetGatewayState, resetGatewayToHealthy, ensureDbConnected, cleanDb, closeDb } from './helpers/setup';

describe('Scenario 5 - Retry-After (rate-limited, retryAfterSeconds=3)', () => {
  const orderId = `E2E-S5-${Date.now()}`;

  beforeAll(async () => {
    await ensureDbConnected();
    await cleanDb();
    await resetGatewayState();
    await resetBreaker();
    await setGatewayMode('rate-limited', { retryAfterSeconds: 3 });
  });

  afterAll(async () => {
    await resetGatewayToHealthy();
    await closeDb();
  });

  it('should respect Retry-After header (delay >= 3000ms between attempts)', async () => {
    const payment = await createPayment({ orderId, amount: 25000, currency: 'IDR' });

    // Poll DB directly until 2 attempts are recorded.
    // This avoids waiting for terminal status (which would take 30s+ and
    // risk circuit breaker interference).
    // Expected timing: attempt 1 at t0, attempt 2 at t0 + ~3000ms (Retry-After).
    // Allow up to 15s for 2 attempts (2nd attempt should appear ~3s after 1st).
    const pollTimeout = 15000;
    const pollStart = Date.now();
    let dbAttempts: Array<Record<string, unknown>> = [];

    while (Date.now() - pollStart < pollTimeout) {
      dbAttempts = await queryAttempts(payment.id);
      if (dbAttempts.length >= 2) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(dbAttempts.length).toBeGreaterThanOrEqual(2);

    // Verify attempts got 429 (rate-limited).
    // Note: pg returns numbers as strings by default in some configs,
    // so we use Number() to coerce before comparison.
    const rateLimitedAttempts = dbAttempts.filter((a) => Number(a.http_status) === 429);
    expect(rateLimitedAttempts.length).toBeGreaterThanOrEqual(1);

    // Verify delay between attempts via DB timestamps
    const t0 = new Date(dbAttempts[0].created_at as string).getTime();
    const t1 = new Date(dbAttempts[1].created_at as string).getTime();
    const delta = t1 - t0;
    expect(delta).toBeGreaterThanOrEqual(2500); // 3s with 500ms tolerance

    // Verify delayBeforeNextMs in audit (first attempt should have 3000ms).
    // Note: pg may return delay_before_next_ms as string with comma (e.g., "3,000").
    // We strip commas before Number() conversion to handle this.
    const withDelay = dbAttempts.filter((a) => {
      if (a.delay_before_next_ms === null || a.delay_before_next_ms === undefined) return false;
      const cleaned = String(a.delay_before_next_ms).replace(/,/g, '');
      const parsed = Number(cleaned);
      return !isNaN(parsed) && parsed >= 3000;
    });
    expect(withDelay.length).toBeGreaterThanOrEqual(1);
  }, 30000); // 30s Jest timeout — enough for 2 attempts (~3s) + buffer
});
