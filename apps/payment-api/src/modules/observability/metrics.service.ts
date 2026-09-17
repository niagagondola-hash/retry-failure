/**
 * MetricsService - 7 Prometheus metrics (plan section 13.2).
 *
 * Anti-pattern: NO high-cardinality labels (payment_id, order_id, trace_id,
 * raw error_message). Those are log fields only.
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { Registry, collectDefaultMetrics, Counter, Gauge, Histogram } from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry: Registry;

  readonly gatewayRequestsTotal: Counter<string>;
  readonly retryAttemptsTotal: Counter<string>;
  readonly circuitBreakerState: Gauge<string>;
  readonly paymentsCurrentStatus: Gauge<string>;
  readonly gatewayRequestDurationSeconds: Histogram<string>;
  readonly paymentProcessingDurationSeconds: Histogram<string>;
  readonly gatewayIdempotentReplaysTotal: Counter<string>;

  constructor() {
    this.registry = new Registry();

    this.gatewayRequestsTotal = new Counter({
      name: 'payment_gateway_requests_total',
      help: 'Total HTTP requests to payment gateway, by outcome + HTTP status.',
      labelNames: ['outcome', 'http_status'],
      registers: [this.registry],
    });

    this.retryAttemptsTotal = new Counter({
      name: 'retry_attempts_total',
      help: 'Cockatiel retry attempts, by outcome + payment status.',
      labelNames: ['outcome', 'payment_status'],
      registers: [this.registry],
    });

    this.circuitBreakerState = new Gauge({
      name: 'circuit_breaker_state',
      help: 'Circuit breaker state: 0=CLOSED, 1=OPEN, 2=HALF_OPEN.',
      labelNames: ['service'],
      registers: [this.registry],
    });

    this.paymentsCurrentStatus = new Gauge({
      name: 'payments_current_status',
      help: 'Active payments count by status.',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.gatewayRequestDurationSeconds = new Histogram({
      name: 'payment_gateway_request_duration_seconds',
      help: 'Duration of HTTP call to gateway (single attempt).',
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    this.paymentProcessingDurationSeconds = new Histogram({
      name: 'payment_processing_duration_seconds',
      help: 'Duration of total payment processing cycle (incl. retries).',
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
      registers: [this.registry],
    });

    this.gatewayIdempotentReplaysTotal = new Counter({
      name: 'gateway_idempotent_replays_total',
      help: 'Total idempotent replays detected (response.replayed === true).',
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    collectDefaultMetrics({ register: this.registry });
    this.circuitBreakerState.set({ service: 'payment-gateway' }, 0);
  }

  incGatewayRequest(outcome: 'success' | 'failure', httpStatus: string | number): void {
    this.gatewayRequestsTotal.inc({ outcome, http_status: String(httpStatus) });
  }

  observeGatewayDuration(durationMs: number): void {
    this.gatewayRequestDurationSeconds.observe(durationMs / 1000);
  }

  incReplay(): void {
    this.gatewayIdempotentReplaysTotal.inc();
  }

  incRetryAttempt(outcome: 'success' | 'failure', paymentStatus: string): void {
    this.retryAttemptsTotal.inc({ outcome, payment_status: paymentStatus });
  }

  setBreakerState(state: 'closed' | 'open' | 'half_open'): void {
    this.circuitBreakerState.set(
      { service: 'payment-gateway' },
      state === 'closed' ? 0 : state === 'open' ? 1 : 2,
    );
  }

  incPaymentStatus(status: string): void {
    this.paymentsCurrentStatus.inc({ status });
  }

  decPaymentStatus(status: string): void {
    this.paymentsCurrentStatus.dec({ status });
  }

  observeProcessingDuration(durationMs: number): void {
    this.paymentProcessingDurationSeconds.observe(durationMs / 1000);
  }

  async metrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
