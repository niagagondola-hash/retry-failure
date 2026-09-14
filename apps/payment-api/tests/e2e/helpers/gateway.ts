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

export async function resetGatewayToHealthy(): Promise<void> {
  await setGatewayMode('always-success');
}
