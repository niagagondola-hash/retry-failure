import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigAppModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { HealthModule } from './modules/health/health.module';
import { MetricsModule } from './modules/metrics/metrics.module';

@Module({
  imports: [
    ConfigAppModule,
    DatabaseModule,
    GatewayModule,
    PaymentsModule,
    HealthModule,
    MetricsModule,
    ScheduleModule.forRoot(),
  ],
})
export class AppModule {}
