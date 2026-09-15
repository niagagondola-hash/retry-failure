/**
 * SCENARIO 3 — Circuit Breaker (always-timeout, threshold=3)
 * ==========================================================
 *
 * Goal:
 *   Verify that Cockatiel circuit breaker opens after threshold failures,
 *   and the 4th payment short-circuits with outcome='circuit_open' WITHOUT
 *   calling the gateway (fast-fail).
 *
 * Two sub-tests (run in order with --runInBand):
 *   1. "3 payments → all scheduled_for_retry + breaker OPEN"
 *      - Each payment: 3 inline attempts, all timeout → scheduled_for_retry
 *      - After 9 cumulative timeouts, breaker state=1 (OPEN)
 *   2. "4th payment → circuit_open in first attempt"
 *      - Breaker already OPEN → 1st attempt short-circuits
 *      - attemptCount=1, outcome='circuit_open'
 *      - NO gateway call (verify via gateway /admin/stats: requestCount only +9, not +12)
 *
 * Preconditions:
 *   - PostgreSQL running + migrated
 *   - payment-api :3001 listening
 *   - gateway-mock :3002 listening
 *   - Breaker CLOSED initially (resetBreaker() in beforeAll, needs ~11s cooldown)
 *   - Gateway mode set to 'always-timeout' with timeoutMs=5000
 *
 * Expected outcome:
 *   - Sub-test 1: 3 payments × 3 attempts = 9 gateway timeouts, breaker→OPEN
 *   - Sub-test 2: payment 4 has attemptCount=1, outcome='circuit_open'
 *   - Metrics: circuit_breaker_state{service='payment-gateway'}=1 (OPEN)
 *   - Gateway stats: requestCount increased by 9 (NOT 12) for 4 payments
 *
 * Flow diagram (rendered in MD):
 *   See docs/tasks/TASK-14a-circuit-breaker.md → section "3. Visualisasi Alur"
 *
 * Manual verification procedure (5 layers L1-L5):
 *   See docs/tasks/TASK-14a-circuit-breaker.md → section "5. Verifikasi Manual per Lapis"
 *
 * Run this file only:
 *   pnpm test:e2e:circuit-breaker
 *   # or
 *   pnpm exec jest --config ./tests/e2e/jest-e2e.json --runInBand \
 *     tests/e2e/payments.circuit-breaker.e2e-spec.ts
 *
 * Run only sub-test 2:
 *   pnpm exec jest --config ./tests/e2e/jest-e2e.json --runInBand \
 *     --testNamePattern="4th payment" \
 *     tests/e2e/payments.circuit-breaker.e2e-spec.ts
 */
import { setGatewayMode } from './helpers/gateway';
import { createPayment, waitForScheduledForRetry } from './helpers/payments';
import { getMetric } from './helpers/metrics';
import { resetBreaker } from './helpers/breaker';
import { queryAttempts } from './helpers/db';
import { resetGatewayToHealthy, ensureDbConnected, closeDb } from './helpers/setup';

describe('Scenario 3 — Circuit breaker (always-timeout, threshold=3)', () => {
  beforeAll(async () => {
    await ensureDbConnected();
    await resetBreaker();
    await setGatewayMode('always-timeout', { timeoutMs: 5000 });
  });

  afterAll(async () => {
    await resetGatewayToHealthy();
    await resetBreaker();
    await closeDb();
  });

  it('3 payments → all scheduled_for_retry + breaker OPEN', async () => {
    for (let i = 1; i <= 3; i++) {
      const payment = await createPayment({ orderId: `E2E-S3-${i}-${Date.now()}`, amount: 10000, currency: 'IDR' });
      const finalPayment = await waitForScheduledForRetry(payment.id, 30000);
      expect(finalPayment.status).toBe('scheduled_for_retry');
      expect(finalPayment.attemptCount).toBe(3);
    }

    const breakerState = await getMetric('circuit_breaker_state', { service: 'payment-gateway' });
    expect(breakerState).toBe(1);
  }, 120000);

  it('4th payment → circuit_open in first attempt', async () => {
    const payment = await createPayment({ orderId: `E2E-S3-4-${Date.now()}`, amount: 10000, currency: 'IDR' });
    const finalPayment = await waitForScheduledForRetry(payment.id, 30000);
    expect(finalPayment.status).toBe('scheduled_for_retry');
    expect(finalPayment.attemptCount).toBe(1);

    const attempts = await queryAttempts(payment.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('circuit_open');
  }, 60000);
});
