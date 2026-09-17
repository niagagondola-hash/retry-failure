/**
 * MetricsService - wraps prom-client Registry + 3 counters.
 *
 * Counters (plan section 8.4 + TASK-03 spec):
 *   payment_gateway_mock_requests_total{outcome,http_status}
 *   payment_gateway_mock_replays_total
 *   payment_gateway_mock_actual_charges_total
 *
 * The ChargesService increments these alongside MockState counters so that
 * /metrics and /admin/stats stay consistent.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Registry,
} from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private readonly registry: Registry;

  private readonly requestsCounter: Counter<'outcome' | 'http_status'>;
  private readonly replaysCounter: Counter<string>;
  private readonly actualChargesCounter: Counter<string>;

  constructor() {
    this.registry = new Registry();

    collectDefaultMetrics({ register: this.registry });

    this.requestsCounter = new Counter({
      name: 'payment_gateway_mock_requests_total',
      help: 'Total charge requests received by the gateway mock.',
      labelNames: ['outcome', 'http_status'] as const,
      registers: [this.registry],
    });

    this.replaysCounter = new Counter({
      name: 'payment_gateway_mock_replays_total',
      help: 'Total idempotent replays served from the in-memory store.',
      registers: [this.registry],
    });

    this.actualChargesCounter = new Counter({
      name: 'payment_gateway_mock_actual_charges_total',
      help: 'Total distinct charges actually captured (excludes replays).',
      registers: [this.registry],
    });

    this.logger.log('prom-client registry initialized (3 custom counters + defaults)');
  }

  incrementRequests(outcome: 'success' | 'failure', httpStatus: number): void {
    this.requestsCounter.inc({
      outcome,
      http_status: String(httpStatus),
    });
  }

  incrementReplays(): void {
    this.replaysCounter.inc();
  }

  incrementActualCharges(): void {
    this.actualChargesCounter.inc();
  }

  async metrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
