import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { ObservabilityModule } from '../observability/observability.module';

@Module({
  imports: [ObservabilityModule],
  controllers: [MetricsController],
})
export class MetricsModule {}
