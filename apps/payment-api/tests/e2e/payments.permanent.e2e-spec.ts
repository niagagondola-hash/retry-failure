import { setGatewayMode } from './helpers/gateway';
import { createPayment, waitForTerminalStatus } from './helpers/payments';
import { queryAttempts } from './helpers/db';
import { resetGatewayToHealthy, ensureDbConnected, closeDb } from './helpers/setup';

describe('Scenario 2 — Permanent failure (client-error)', () => {
  const orderId = `E2E-S2-${Date.now()}`;

  beforeAll(async () => {
    await ensureDbConnected();
    await setGatewayMode('client-error');
  });

  afterAll(async () => {
    await resetGatewayToHealthy();
    await closeDb();
  });

  it('should fail with invalid_card, no retry (attemptCount=1)', async () => {
    const payment = await createPayment({ orderId, amount: 75000, currency: 'IDR' });
    const { payment: finalPayment, attempts } = await waitForTerminalStatus(payment.id, 15000);

    expect(finalPayment.status).toBe('failed');
    expect(finalPayment.attemptCount).toBe(1);
    expect(finalPayment.failureReason).toContain('invalid_card');

    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('permanent_failure');
    expect(attempts[0].httpStatus).toBe(400);

    const dbAttempts = await queryAttempts(payment.id);
    expect(dbAttempts).toHaveLength(1);
  }, 30000);
});
