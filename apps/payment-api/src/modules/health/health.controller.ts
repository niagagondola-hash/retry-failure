import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
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
