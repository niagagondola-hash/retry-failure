/**
 * SCENARIO 4 (HERO) - Anti Double-Charge (succeed-but-drop-response)
 * =================================================================
 *
 * ⚠️  HERO SCENARIO - if this fails, plan DoD section 22 fails. MUST pass.
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
 * ⚠️ IMPORTANT - cleanDb() in beforeAll:
 *   Gateway mock `actualChargesCount` is a CUMULATIVE counter from gateway-mock start.
 *   If DB still has payments from previous tests (S3/S6/S7) with status=scheduled_for_retry,
 *   scheduler will pick them up during this test -> each success = +1 actualCharges.
 *   This would cause assertion `actualChargesCount delta === 1` to fail.
 *   Solution: cleanDb() before resetBreaker() to wipe all old payments.
 *
 * ⚠️ IMPORTANT - delta-based assertion:
 *   `actualChargesCount` is cumulative (no reset endpoint in gateway mock).
 *   Test uses delta-based assertion: snapshot baseline AFTER resetBreaker (which
 *   creates 1 success payment for breaker reset), BEFORE createPayment(S4).
 *   Delta should be exactly 1 (only S4 payment's first attempt charges).
 *
 * Expected outcome:
 *   - HTTP: 201 Created, payment.status='succeeded', attemptCount >= 2
 *   - attempts[1].replayed === true
 *   - attempts[1].gatewayReference truthy (same as payment.gateway_reference)
 *   - ⭐ Gateway stats: actualChargesCount delta === 1 (HERO assertion - no double charge)
 *   - Gateway stats: requestCount delta >= 2 (at least 1 charge + 1 replay)
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
import { resetGatewayState, resetGatewayToHealthy, ensureDbConnected, cleanDb, closeDb } from './helpers/setup';

describe('Scenario 4 - Anti double-charge HERO (succeed-but-drop-response)', () => {
  const orderId = `E2E-S4-HERO-${Date.now()}`;

  beforeAll(async () => {
    await ensureDbConnected();
    // Clean DB FIRST - wipe all payments from previous tests (S3/S6/S7).
    // Without this, scheduler picks up old scheduled_for_retry payments during
    // this test -> +1 actualCharges per old payment that succeeds -> assertion fails.
    await cleanDb();
    await resetGatewayState();
    await resetBreaker();
    await setGatewayMode('succeed-but-drop-response');
  });

  afterAll(async () => {
    await resetGatewayToHealthy();
    await closeDb();
  });

  it('HERO: calls>=2, actualCharges=1, replays>=1, status=succeeded', async () => {
    const replaysBefore = await getMetric('gateway_idempotent_replays_total');

    // Snapshot gateway stats AFTER resetBreaker (which created 1 success payment
    // for breaker reset -> actualChargesCount already +1 from that).
    // We use delta-based assertion because actualChargesCount is cumulative
    // from gateway-mock start (no reset endpoint).
    const statsBaseline = await getGatewayStats();
    const actualChargesBefore = statsBaseline.actualChargesCount;
    const requestCountBefore = statsBaseline.requestCount;

    const payment = await createPayment({ orderId, amount: 100000, currency: 'IDR' });
    const { payment: finalPayment, attempts } = await waitForTerminalStatus(payment.id, 90000);

    expect(finalPayment.status).toBe('succeeded');
    expect(finalPayment.attemptCount).toBeGreaterThanOrEqual(2);

    expect(attempts.length).toBeGreaterThanOrEqual(2);
    const replayAttempt = attempts[1];
    expect(replayAttempt.gatewayReference).toBeTruthy();
    expect(replayAttempt.replayed).toBe(true);
    expect(replayAttempt.outcome).toBe('success');

    // ⭐ HERO assertion: delta-based actualChargesCount
    // Only S4 payment's first attempt should charge gateway.
    // Attempt 2 (replay) does NOT charge (idempotency key cached).
    // Delta = 1 proves anti double-charge works.
    const statsAfter = await getGatewayStats();
    const actualChargesDelta = statsAfter.actualChargesCount - actualChargesBefore;
    expect(actualChargesDelta).toBe(1);

    // requestCount delta >= 2: at least 1 charge request + 1 replay request
    const requestCountDelta = statsAfter.requestCount - requestCountBefore;
    expect(requestCountDelta).toBeGreaterThanOrEqual(2);

    const replaysAfter = await getMetric('gateway_idempotent_replays_total');
    expect(replaysAfter - replaysBefore).toBeGreaterThanOrEqual(1);

    const dbAttempts = await queryAttempts(payment.id);
    expect(dbAttempts.length).toBeGreaterThanOrEqual(2);
    // Note: SQLite stores boolean as integer (1/0), PostgreSQL as boolean (true/false).
    // Use truthy check for cross-driver compatibility.
    expect(Boolean(dbAttempts[1].replayed)).toBe(true);
  }, 120000);
});
