import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RetrySchedulerService } from './retry-scheduler.service';

@ApiTags('scheduler')
@Controller('scheduler-health')
export class RetrySchedulerController {
  constructor(private readonly scheduler: RetrySchedulerService) {}

  @Get()
  @ApiOperation({ summary: 'Scheduler operational stats' })
  async getStats() {
    return this.scheduler.getStats();
  }
}
