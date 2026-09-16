/**
 * SCENARIO 7 — Total Retry Exhaustion (MAX_TOTAL_RETRIES=5)
 * ========================================================
 *
 * Goal:
 *   Verify that when totalRetryCount reaches MAX_TOTAL_RETRIES, the payment
 *   transitions to 'failed' terminal state with nextRetryAt=NULL, and the
 *   scheduler does NOT pick it up again (no infinite retry loop).
 *
 * Gateway mode 'server-error' returns 500 for every charge request.
 * Cockatiel inline retry (3 attempts per cycle) exhausts -> payment scheduled
 * for retry -> scheduler picks -> 3 more attempts -> repeat until
 * totalRetryCount >= MAX_TOTAL_RETRIES (5) -> terminal 'failed'.
 *
 * Preconditions:
 *   - PostgreSQL running + migrated
 *   - payment-api :3001 listening
 *     + MAX_TOTAL_RETRIES=5 (default)
 *     + SCHEDULER_INTERVAL_MS=5000
 *     + SCHEDULER_BASE_DELAY_MS=2000 (LOW — default 30000 makes test timeout)
 *   - gateway-mock :3002 listening
 *   - Breaker CLOSED (resetBreaker() in beforeAll)
 *   - DB clean of other 'scheduled_for_retry' payments
 *
 * Expected outcome:
 *   - status='failed'
 *   - totalRetryCount >= MAX_TOTAL_RETRIES (5)
 *   - failureReason matches /max_total_retries_exceeded|total_retry_exhausted/
 *   - nextRetryAt === null (terminal, no more retries)
 *   - DB payment_attempts.length >= 6 (1 initial + 5 scheduler cycles × N attempts)
 *   - ⭐ After sleeping SCHEDULER_INTERVAL_MS+2000ms: attempts count NOT increased
 *     (scheduler stops picking this payment — proves no infinite loop)
 *
 * Flow diagram (rendered in MD):
 *   See docs/tasks/TASK-14a-exhaustion.md -> section "3. Visualisasi Alur"
 *
 * Manual verification procedure (5 layers L1-L5):
 *   See docs/tasks/TASK-14a-exhaustion.md -> section "5. Verifikasi Manual per Lapis"
 *
 * Run this file only (this is the LONGEST test — up to 240s):
 *   pnpm test:e2e:exhaustion
 *   # or
 *   pnpm exec jest --config ./tests/e2e/jest-e2e.json --runInBand \
 *     tests/e2e/payments.exhaustion.e2e-spec.ts
 *
 * Note on breaker interaction:
 *   Gateway returns 500 for every request -> after 3 failures, breaker may OPEN
 *   and subsequent attempts get 'circuit_open' instead of 'retryable_failure'.
 *   Test does NOT assert per-attempt outcome (only total count), so this is OK.
 *   For cleaner test, set CIRCUIT_BREAKER_THRESHOLD=100 in env to disable breaker.
 */
import { setGatewayMode } from './helpers/gateway';
import { createPayment, getPayment, waitForFailed } from './helpers/payments';
import { queryAttempts } from './helpers/db';
import { resetBreaker } from './helpers/breaker';
import { resetGatewayToHealthy, ensureDbConnected, closeDb } from './helpers/setup';

describe('Scenario 7 — Total retry exhaustion (MAX_TOTAL_RETRIES=5)', () => {
  const orderId = `E2E-S7-${Date.now()}`;
  const MAX_TOTAL_RETRIES = parseInt(process.env.MAX_TOTAL_RETRIES ?? '5', 10);
  const SCHEDULER_INTERVAL_MS = parseInt(process.env.SCHEDULER_INTERVAL_MS ?? '5000', 10);

  beforeAll(async () => {
    await ensureDbConnected();
    await resetBreaker();
    await setGatewayMode('server-error');
  });

  afterAll(async () => {
    await resetGatewayToHealthy();
    await closeDb();
  });

  it('payment eventually failed after totalRetryCount >= MAX_TOTAL_RETRIES', async () => {
    const payment = await createPayment({ orderId, amount: 30000, currency: 'IDR' });
    // waitForFailed default 240s — enough for 6 scheduler cycles with SCHEDULER_BASE_DELAY_MS=2000
    // (6 × 2s delay + 6 × ~3s execution = ~30s) OR with default 30s delay (6 × 30s = 180s+).
    const finalPayment = await waitForFailed(payment.id, 240000);

    expect(finalPayment.status).toBe('failed');
    expect(finalPayment.totalRetryCount).toBeGreaterThanOrEqual(MAX_TOTAL_RETRIES);
    expect(finalPayment.failureReason).toMatch(/max_total_retries_exceeded|total_retry_exhausted/);
    expect(finalPayment.nextRetryAt).toBeNull();

    const attempts = await queryAttempts(payment.id);
    expect(attempts.length).toBeGreaterThanOrEqual(6);

    // Wait one more scheduler cycle and verify no new attempts
    const attemptsBefore = attempts.length;
    await new Promise((r) => setTimeout(r, SCHEDULER_INTERVAL_MS + 2000));
    const attemptsAfter = await queryAttempts(payment.id);
    expect(attemptsAfter.length).toBe(attemptsBefore);
  }, 300000);  // 5 min Jest timeout — safety margin for waitForFailed 240s + sleep 7s
});
