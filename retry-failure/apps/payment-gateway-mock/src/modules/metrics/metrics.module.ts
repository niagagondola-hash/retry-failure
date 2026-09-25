/**
 * MetricsModule - provides MetricsService + MetricsController.
 *
 * MetricsService is exported so ChargesModule can call increment*() methods.
 */

import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  providers: [MetricsService],
  controllers: [MetricsController],
  exports: [MetricsService],
})
export class MetricsModule {}
