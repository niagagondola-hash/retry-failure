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
