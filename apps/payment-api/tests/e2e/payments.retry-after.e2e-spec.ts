import { setGatewayMode } from './helpers/gateway';
import { createPayment, waitForTerminalStatus } from './helpers/payments';
import { queryAttempts } from './helpers/db';
import { resetBreaker } from './helpers/breaker';
import { resetGatewayToHealthy, ensureDbConnected, closeDb } from './helpers/setup';

describe('Scenario 5 — Retry-After (rate-limited, retryAfterSeconds=3)', () => {
  const orderId = `E2E-S5-${Date.now()}`;

  beforeAll(async () => {
    await ensureDbConnected();
    await resetBreaker();
    await setGatewayMode('rate-limited', { retryAfterSeconds: 3 });
  });

  afterAll(async () => {
    await resetGatewayToHealthy();
    await closeDb();
  });

  it('should respect Retry-After header (delay >= 3000ms between attempts)', async () => {
    const payment = await createPayment({ orderId, amount: 25000, currency: 'IDR' });
    const { payment: finalPayment, attempts } = await waitForTerminalStatus(payment.id, 60000);

    // Verify attempts got 429
    const rateLimitedAttempts = attempts.filter((a) => a.httpStatus === 429);
    expect(rateLimitedAttempts.length).toBeGreaterThanOrEqual(1);

    // Verify delay between attempts via DB timestamps
    const dbAttempts = await queryAttempts(payment.id);
    expect(dbAttempts.length).toBeGreaterThanOrEqual(2);

    if (dbAttempts.length >= 2) {
      const t0 = new Date(dbAttempts[0].created_at as string).getTime();
      const t1 = new Date(dbAttempts[1].created_at as string).getTime();
      const delta = t1 - t0;
      expect(delta).toBeGreaterThanOrEqual(2500); // 3s with 500ms tolerance
    }

    // Verify delayBeforeNextMs in audit
    const withDelay = attempts.filter((a) => a.delayBeforeNextMs !== null && a.delayBeforeNextMs >= 3000);
    expect(withDelay.length).toBeGreaterThanOrEqual(1);
  }, 90000);
});
