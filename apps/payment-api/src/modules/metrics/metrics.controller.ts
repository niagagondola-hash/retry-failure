import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@retry-failure/security';

import { MetricsService } from '../observability/metrics.service';

/**
 * MetricsController — public endpoint for Prometheus metrics scrape.
 *
 * Marked @Public() because:
 *   - Prometheus scraper needs access without auth (scrape config doesn't have session)
 *   - Standard Prometheus convention: /metrics is public
 *
 * AUTH-17 AC #18: @Public() on /metrics endpoint.
 */
@ApiTags('metrics')
@Controller('metrics')
@Public()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Prometheus metrics endpoint (7 metrics + process metrics)' })
  async metrics(): Promise<string> {
    return this.metricsService.metrics();
  }
}
