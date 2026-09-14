import { setGatewayMode } from './helpers/gateway';
import { createPayment, waitForTerminalStatus } from './helpers/payments';
import { getMetric } from './helpers/metrics';
import { queryAttempts } from './helpers/db';
import { resetGatewayToHealthy, ensureDbConnected, cleanDb, closeDb } from './helpers/setup';

describe('Scenario 1 — Transient failure (fail-first-n=2)', () => {
  const orderId = `E2E-S1-${Date.now()}`;

  beforeAll(async () => {
    await ensureDbConnected();
    await cleanDb();
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
