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
    const finalPayment = await waitForFailed(payment.id, 180000);

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
  }, 240000);
});
