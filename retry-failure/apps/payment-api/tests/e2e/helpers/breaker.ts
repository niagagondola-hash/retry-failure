import { resetGatewayToHealthy } from './gateway';
import { createPayment, waitForTerminalStatus } from './payments';
import { getMetric } from './metrics';

export async function resetBreaker(): Promise<void> {
  await resetGatewayToHealthy();
  await new Promise((r) => setTimeout(r, 11000));
  const payment = await createPayment({ orderId: `BREAKER-RESET-${Date.now()}`, amount: 1000, currency: 'IDR' });
  await waitForTerminalStatus(payment.id, 30000);
  const state = await getMetric('circuit_breaker_state', { service: 'payment-gateway' });
  if (state !== 0) throw new Error(`Breaker not CLOSED after reset: state=${state}`);
}
