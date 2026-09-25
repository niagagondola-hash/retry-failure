import { gatewayClient } from './client';

export interface GatewayConfig {
  mode: string;
  n: number;
  probability: number;
  retryAfterSeconds: number;
  timeoutMs: number;
}

export interface GatewayStats {
  requestCount: number;
  successCount: number;
  failureCount: number;
  replayCount: number;
  actualChargesCount: number;
  idempotencyStoreSize?: number;
}

export async function getGatewayConfig(): Promise<GatewayConfig> {
  const { data } = await gatewayClient.get<GatewayConfig>('/admin/config');
  return data;
}

export async function updateGatewayConfig(config: Partial<GatewayConfig>): Promise<GatewayConfig> {
  const { data } = await gatewayClient.put<GatewayConfig>('/admin/config', config);
  return data;
}

export async function getGatewayStats(): Promise<GatewayStats> {
  const { data } = await gatewayClient.get<GatewayStats>('/admin/stats');
  return data;
}
