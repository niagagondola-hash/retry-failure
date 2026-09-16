/**
 * SCENARIO 4 (HERO) — Anti Double-Charge (succeed-but-drop-response)
 * =================================================================
 *
 * ⚠️  HERO SCENARIO — if this fails, plan DoD section 22 fails. MUST pass.
 *
 * Goal:
 *   Verify that Idempotency-Key prevents double-charging when gateway
 *   succeeds but drops the response (simulated network failure).
 *
 * Gateway mode 'succeed-but-drop-response' behavior:
 *   - 1st request with Idempotency-Key=K:
 *       -> Gateway stores K, ACTUALLY CHARGES (real charge #1), drops TCP response
 *       -> Client sees ECONNRESET, retries
 *   - 2nd request with same Key=K:
 *       -> Gateway looks up K, finds cached result
 *       -> REPLAY (no new charge) -> returns 200 {replayed:true, gatewayReference:G1}
 *   - Net: actualCharges=1, requestCount=2, replayCount=1
 *
 * Preconditions:
 *   - PostgreSQL running + migrated
 *   - payment-api :3001 listening
 *   - gateway-mock :3002 listening + idempotency store EMPTY (restart mock if unsure)
 *   - Breaker CLOSED (resetBreaker() in beforeAll)
 *
 * Expected outcome:
 *   - HTTP: 201 Created, payment.status='succeeded', attemptCount >= 2
 *   - attempts[1].replayed === true
 *   - attempts[1].gatewayReference truthy (same as payment.gateway_reference)
 *   - ⭐ Gateway stats: actualChargesCount === 1 (NOT 2 — this is the HERO assertion)
 *   - Gateway stats: requestCount >= 2
 *   - Metrics: gateway_idempotent_replays_total increased by >= 1
 *
 * Flow diagram (rendered in MD):
 *   See docs/tasks/TASK-14a-idempotency.md -> section "3. Visualisasi Alur"
 *
 * Manual verification procedure (5 layers L1-L5):
 *   See docs/tasks/TASK-14a-idempotency.md -> section "5. Verifikasi Manual per Lapis"
 *
 * Run this file only:
 *   pnpm test:e2e:idempotency
 *   # or
 *   pnpm exec jest --config ./tests/e2e/jest-e2e.json --runInBand \
 *     tests/e2e/payments.idempotency.e2e-spec.ts
 */
import { setGatewayMode, getGatewayStats } from './helpers/gateway';
import { createPayment, waitForTerminalStatus } from './helpers/payments';
import { getMetric } from './helpers/metrics';
import { queryAttempts } from './helpers/db';
import { resetBreaker } from './helpers/breaker';
import { resetGatewayToHealthy, ensureDbConnected, closeDb } from './helpers/setup';

describe('Scenario 4 — Anti double-charge HERO (succeed-but-drop-response)', () => {
  const orderId = `E2E-S4-HERO-${Date.now()}`;

  beforeAll(async () => {
    await ensureDbConnected();
    await resetBreaker();
    await setGatewayMode('succeed-but-drop-response');
  });

  afterAll(async () => {
    await resetGatewayToHealthy();
    await closeDb();
  });

  it('HERO: calls>=2, actualCharges=1, replays>=1, status=succeeded', async () => {
    const replaysBefore = await getMetric('gateway_idempotent_replays_total');

    const payment = await createPayment({ orderId, amount: 100000, currency: 'IDR' });
    const { payment: finalPayment, attempts } = await waitForTerminalStatus(payment.id, 90000);

    expect(finalPayment.status).toBe('succeeded');
    expect(finalPayment.attemptCount).toBeGreaterThanOrEqual(2);

    expect(attempts.length).toBeGreaterThanOrEqual(2);
    const replayAttempt = attempts[1];
    expect(replayAttempt.gatewayReference).toBeTruthy();
    expect(replayAttempt.replayed).toBe(true);
    expect(replayAttempt.outcome).toBe('success');

    const stats = await getGatewayStats();
    expect(stats.actualChargesCount).toBe(1);
    expect(stats.requestCount).toBeGreaterThanOrEqual(2);

    const replaysAfter = await getMetric('gateway_idempotent_replays_total');
    expect(replaysAfter - replaysBefore).toBeGreaterThanOrEqual(1);

    const dbAttempts = await queryAttempts(payment.id);
    expect(dbAttempts.length).toBeGreaterThanOrEqual(2);
    expect(dbAttempts[1].replayed).toBe(true);
  }, 120000);
});
