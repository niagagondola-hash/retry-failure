import { apiClient } from './client';

export interface ParsedMetrics {
  gatewayRequestsTotal: Record<string, number>;
  retryAttemptsTotal: Record<string, number>;
  circuitBreakerState: number;
  paymentsCurrentStatus: Record<string, number>;
  gatewayRequestDurationSeconds: { buckets: Record<string, number>; count: number; sum: number };
  paymentProcessingDurationSeconds: { buckets: Record<string, number>; count: number; sum: number };
  gatewayIdempotentReplaysTotal: number;
}

export async function fetchMetricsRaw(): Promise<string> {
  const { data } = await apiClient.get<string>('/metrics', {
    headers: { Accept: 'text/plain' },
    transformResponse: [(d) => d],
  });
  return data;
}

export async function fetchMetrics(): Promise<ParsedMetrics> {
  const raw = await fetchMetricsRaw();
  return parsePrometheusText(raw);
}

export function parsePrometheusText(text: string): ParsedMetrics {
  const lines = text.split('\n').filter((l) => l && !l.startsWith('#'));
  const result: ParsedMetrics = {
    gatewayRequestsTotal: {},
    retryAttemptsTotal: {},
    circuitBreakerState: 0,
    paymentsCurrentStatus: {},
    gatewayRequestDurationSeconds: { buckets: {}, count: 0, sum: 0 },
    paymentProcessingDurationSeconds: { buckets: {}, count: 0, sum: 0 },
    gatewayIdempotentReplaysTotal: 0,
  };

  for (const line of lines) {
    const match = line.match(/^(\w+)(\{([^}]*)\})?\s+([\d.eE+-]+)$/);
    if (!match) continue;
    const [, name, , labels, value] = match;
    const num = parseFloat(value);

    if (name === 'payment_gateway_requests_total' && labels) {
      result.gatewayRequestsTotal[labels] = num;
    } else if (name === 'retry_attempts_total' && labels) {
      result.retryAttemptsTotal[labels] = num;
    } else if (name === 'circuit_breaker_state' && labels?.includes('payment-gateway')) {
      result.circuitBreakerState = num;
    } else if (name === 'payments_current_status' && labels) {
      const statusMatch = labels.match(/status="(\w+)"/);
      if (statusMatch) result.paymentsCurrentStatus[statusMatch[1]] = num;
    } else if (name === 'gateway_idempotent_replays_total') {
      result.gatewayIdempotentReplaysTotal = num;
    } else if (name.startsWith('payment_gateway_request_duration_seconds_bucket')) {
      const leMatch = labels?.match(/le="([\d.]+)"/);
      if (leMatch) result.gatewayRequestDurationSeconds.buckets[leMatch[1]] = num;
    } else if (name.startsWith('payment_processing_duration_seconds_bucket')) {
      const leMatch = labels?.match(/le="([\d.]+)"/);
      if (leMatch) result.paymentProcessingDurationSeconds.buckets[leMatch[1]] = num;
    }
  }

  return result;
}
