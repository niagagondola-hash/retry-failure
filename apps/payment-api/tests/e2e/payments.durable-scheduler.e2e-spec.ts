/**
 * SCENARIO 6 — Durable Retry via @nestjs/schedule Scheduler
 * =========================================================
 *
 * Goal:
 *   Verify that the RetryScheduler (cron `@nestjs/schedule`) picks up
 *   payments with status='scheduled_for_retry' and re-executes them with
 *   a NEW trace ID (different cycle from initial inline retry).
 *
 * Four phases:
 *   Phase 1: set gateway to 'server-error' → createPayment
 *            → inline Cockatiel retry exhausts (3 attempts, all 500)
 *            → payment becomes 'scheduled_for_retry', totalRetryCount=0
 *   Phase 2: switch gateway to 'always-success' (no restart of payment-api)
 *   Phase 3: sleep SCHEDULER_INTERVAL_MS + 2000ms → wait for cron tick
 *   Phase 4: scheduler picks payment → executePayment(source='scheduler')
 *            → 4th attempt succeeds → status='succeeded', totalRetryCount=1
 *
 * Preconditions:
 *   - PostgreSQL running + migrated
 *   - payment-api :3001 listening
 *     + SCHEDULER_INTERVAL_MS=5000 set in env
 *     + SCHEDULER_BASE_DELAY_MS=2000 (or low) set in env (default 30000 too slow)
 *   - gateway-mock :3002 listening
 *   - Breaker CLOSED (resetBreaker() in beforeAll)
 *   - DB clean of other 'scheduled_for_retry' payments (else scheduler picks them too)
 *
 * Expected outcome:
 *   - Phase 1: status='scheduled_for_retry', totalRetryCount=0, nextRetryAt NOT NULL
 *   - Phase 4: status='succeeded', totalRetryCount=1
 *   - DB: trace_id differs between inline cycle (T1, attempts #1-3)
 *         and scheduler cycle (T2, attempt #4) — at least 2 unique trace IDs
 *
 * Distinction from Scenario 1 (transient):
 *   - S1: all attempts share ONE trace_id (inline retry succeeded)
 *   - S6: 2 different trace_ids (inline exhausted → scheduler picked up)
 *
 * Flow diagram (rendered in MD):
 *   See docs/tasks/TASK-14a-durable-scheduler.md → section "3. Visualisasi Alur"
 *
 * Manual verification procedure (5 layers L1-L5):
 *   See docs/tasks/TASK-14a-durable-scheduler.md → section "5. Verifikasi Manual per Lapis"
 *
 * Run this file only:
 *   pnpm test:e2e:durable-scheduler
 *   # or
 *   pnpm exec jest --config ./tests/e2e/jest-e2e.json --runInBand \
 *     tests/e2e/payments.durable-scheduler.e2e-spec.ts
 */
import { setGatewayMode } from './helpers/gateway';
import { createPayment, waitForScheduledForRetry, waitForTerminalStatus } from './helpers/payments';
import { queryAttempts } from './helpers/db';
import { resetBreaker } from './helpers/breaker';
import { resetGatewayToHealthy, ensureDbConnected, closeDb } from './helpers/setup';

describe('Scenario 6 — Durable scheduler retry (server-error → always-success)', () => {
  const orderId = `E2E-S6-${Date.now()}`;
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

  it('scheduled_for_retry → scheduler picks → succeeded (totalRetryCount=1)', async () => {
    // Phase 1: initial cycle → scheduled_for_retry
    const payment = await createPayment({ orderId, amount: 60000, currency: 'IDR' });
    const scheduled = await waitForScheduledForRetry(payment.id, 30000);
    expect(scheduled.status).toBe('scheduled_for_retry');
    expect(scheduled.totalRetryCount).toBe(0);
    expect(scheduled.nextRetryAt).not.toBeNull();

    // Phase 2: switch gateway to always-success
    await setGatewayMode('always-success');

    // Phase 3: wait for scheduler cycle
    await new Promise((r) => setTimeout(r, SCHEDULER_INTERVAL_MS + 2000));

    // Phase 4: poll until terminal
    const { payment: finalPayment } = await waitForTerminalStatus(payment.id, 30000);
    expect(finalPayment.status).toBe('succeeded');
    expect(finalPayment.totalRetryCount).toBe(1);

    // Assert trace IDs differ between cycles
    const attempts = await queryAttempts(payment.id);
    const traceIds = new Set(attempts.map((a) => a.trace_id));
    expect(traceIds.size).toBeGreaterThanOrEqual(2);
  }, 90000);
});
