import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigAppModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AppLoggerModule } from './modules/observability/logger.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { HealthModule } from './modules/health/health.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { RetrySchedulerModule } from './modules/retry-scheduler/retry-scheduler.module';

/**
 * Global rate-limit TTL (ms) — default 60s = 1 minute per plan2 §12.5.
 * Configurable via `THROTTLE_TTL` env (in milliseconds).
 */
const DEFAULT_THROTTLE_TTL_MS = 60_000;

/** Global rate-limit per-IP request count — default 100 per plan2 §12.5. */
const DEFAULT_THROTTLE_LIMIT = 100;

/**
 * Build throttler config from env (plan2 §16 + §12.5).
 *
 * Reads:
 *   - `THROTTLE_TTL`     — TTL in ms (default 60000)
 *   - `THROTTLE_LIMIT`   — request count limit (default 100)
 *   - `THROTTLER_DISABLED` — `"true"` → skip throttler (dev)
 *   - `AUTH_MODE=disabled`  → skip throttler (skipIf checked per-request)
 *
 * `skipIf` is checked at request time (not config time), so toggling env
 * without restart still works for tests.
 */
function buildThrottlerConfig() {
  const ttl = Number(process.env.THROTTLE_TTL) || DEFAULT_THROTTLE_TTL_MS;
  const limit =
    Number(process.env.THROTTLE_LIMIT) || DEFAULT_THROTTLE_LIMIT;
  return {
    throttlers: [{ ttl, limit }],
    skipIf: () =>
      process.env.AUTH_MODE === 'disabled' ||
      process.env.THROTTLER_DISABLED === 'true',
  };
}

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: () => buildThrottlerConfig(),
    }),
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
  providers: [
    // Global throttler guard — applies the default 100 req/min/IP limit
    // to every route. Per-endpoint overrides via `@Throttle({...})` decorator
    // will be added in AUTH-17 on `/auth/login` + `/auth/callback` (10/min/IP).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
