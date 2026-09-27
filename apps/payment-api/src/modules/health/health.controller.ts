import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '@retry-failure/security';

import { HealthService } from './health.service';

/**
 * HealthController — public endpoint for health checks.
 *
 * Marked @Public() because:
 *   - Docker healthcheck + k8s liveness probe need access without auth
 *   - Monitoring systems (Prometheus, uptime checkers) don't have session cookies
 *
 * AUTH-17 AC #18: @Public() on /health endpoint.
 */
@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'DB + gateway health' })
  async check(@Res() res: Response) {
    const result = await this.health.check();
    const status = result.db === 'ok' && result.gateway === 'ok' ? 200 : 503;
    res.status(status).json(result);
  }
}
