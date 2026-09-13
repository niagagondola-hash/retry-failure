/**
 * AppModule — root module for payment-gateway-mock.
 *
 * Imports:
 *   - SharedModule: provides MockState + IdempotencyStore singletons.
 *   - ChargesModule: POST /v1/charges.
 *   - AdminModule: GET/PUT /admin/config, GET /admin/stats.
 *   - MetricsModule: GET /metrics.
 */

import { Module } from '@nestjs/common';
import { SharedModule } from './modules/shared/shared.module';
import { ChargesModule } from './modules/charges/charges.module';
import { AdminModule } from './modules/admin/admin.module';
import { MetricsModule } from './modules/metrics/metrics.module';

@Module({
  imports: [SharedModule, ChargesModule, AdminModule, MetricsModule],
})
export class AppModule {}
