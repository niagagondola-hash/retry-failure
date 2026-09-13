import { Injectable } from '@nestjs/common';
import { Registry, Counter } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry: Registry;
  readonly httpRequestsTotal: Counter<string>;

  constructor() {
    this.registry = new Registry();
    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests',
      registers: [this.registry],
      labelNames: ['route', 'method', 'status'],
    });
  }

  async metrics(): Promise<string> {
    return this.registry.metrics();
  }
}
