import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigAppModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AppLoggerModule } from './modules/observability/logger.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { HealthModule } from './modules/health/health.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { RetrySchedulerModule } from './modules/retry-scheduler/retry-scheduler.module';

@Module({
  imports: [
    ConfigAppModule,
    AppLoggerModule,
    ObservabilityModule,
    DatabaseModule,
    GatewayModule,
    PaymentsModule,
    HealthModule,
    MetricsModule,
    RetrySchedulerModule,
    ScheduleModule.forRoot(),
  ],
})
export class AppModule {}
