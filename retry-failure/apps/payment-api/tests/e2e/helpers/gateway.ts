import { gatewayClient } from './setup';

export type GatewayMode =
  | 'always-success' | 'fail-first-n' | 'server-error' | 'always-timeout'
  | 'client-error' | 'random' | 'succeed-but-drop-response' | 'rate-limited';

export async function setGatewayMode(mode: GatewayMode, params: Record<string, unknown> = {}): Promise<void> {
  await gatewayClient.put('/admin/config', { mode, ...params });
}

export async function getGatewayStats(): Promise<Record<string, number>> {
  const { data } = await gatewayClient.get('/admin/stats');
  return data;
}

/**
 * Reset gateway mock state: counters + idempotency store.
 * Config (mode) is NOT reset — use setGatewayMode separately.
 * Call this in beforeAll AFTER cleanDb() to ensure fresh state.
 */
export async function resetGatewayState(): Promise<void> {
  await gatewayClient.post('/admin/reset');
}

/**
 * Reset gateway to healthy state: mode='always-success'.
 * Call this in afterAll to prevent state carry-over to next test file.
 */
export async function resetGatewayToHealthy(): Promise<void> {
  await setGatewayMode('always-success');
}
