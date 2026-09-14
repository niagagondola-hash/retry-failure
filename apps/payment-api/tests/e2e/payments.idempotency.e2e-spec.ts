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
