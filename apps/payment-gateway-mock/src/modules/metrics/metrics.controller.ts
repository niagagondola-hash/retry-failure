/**
 * MetricsController - GET /metrics (Prometheus text format).
 *
 * Content-Type is set explicitly to `text/plain; version=0.0.4` because
 * the prom-client Registry default is `text/plain; version=0.0.4; charset=utf-8`.
 */

import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(): Promise<string> {
    return this.metricsService.metrics();
  }
}
