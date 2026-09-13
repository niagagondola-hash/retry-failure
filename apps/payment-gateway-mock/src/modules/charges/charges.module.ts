/**
 * ChargesModule — wires ChargesController + ChargesService with shared
 * MockState/IdempotencyStore providers and MetricsService.
 */

import { Module } from '@nestjs/common';
import { ChargesController } from './charges.controller';
import { ChargesService } from './charges.service';
import { SharedModule } from '../shared/shared.module';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [SharedModule, MetricsModule],
  providers: [ChargesService],
  controllers: [ChargesController],
})
export class ChargesModule {}
