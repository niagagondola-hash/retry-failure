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
