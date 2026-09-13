import { Module } from '@nestjs/common';
import { HttpModule, HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { HttpPaymentGateway } from './http-adapter';
import {
  ResilientPaymentGateway,
  type ResilientPaymentGatewayOptions,
} from './resilient-adapter';
import { PAYMENT_GATEWAY_PORT } from './port';
import {
  DEFAULT_RESILIENCE_CONFIG,
  type ResilienceConfig,
} from '@retry-failure/resilience';

@Module({
  imports: [HttpModule],
  providers: [
    {
      provide: HttpPaymentGateway,
      inject: [HttpService, ConfigService],
      useFactory: (http: HttpService, config: ConfigService) =>
        new HttpPaymentGateway(http, config),
    },
    {
      provide: ResilientPaymentGateway,
      inject: [HttpPaymentGateway, ConfigService],
      useFactory: (
        inner: HttpPaymentGateway,
        config: ConfigService,
      ): ResilientPaymentGateway => {
        const resilienceConfig: ResilienceConfig = {
          ...DEFAULT_RESILIENCE_CONFIG,
          retryMaxAttempts: config.get<number>('RETRY_MAX_ATTEMPTS') ?? DEFAULT_RESILIENCE_CONFIG.retryMaxAttempts,
          retryBaseDelayMs: config.get<number>('RETRY_BASE_DELAY_MS') ?? DEFAULT_RESILIENCE_CONFIG.retryBaseDelayMs,
          retryMaxDelayMs: config.get<number>('RETRY_MAX_DELAY_MS') ?? DEFAULT_RESILIENCE_CONFIG.retryMaxDelayMs,
          retryJitterRatio: config.get<number>('RETRY_JITTER_RATIO') ?? DEFAULT_RESILIENCE_CONFIG.retryJitterRatio,
          gatewayTimeoutMs: config.get<number>('GATEWAY_TIMEOUT_MS') ?? DEFAULT_RESILIENCE_CONFIG.gatewayTimeoutMs,
          breakerFailureThreshold: config.get<number>('BREAKER_FAILURE_THRESHOLD') ?? DEFAULT_RESILIENCE_CONFIG.breakerFailureThreshold,
          breakerCooldownMs: config.get<number>('BREAKER_COOLDOWN_MS') ?? DEFAULT_RESILIENCE_CONFIG.breakerCooldownMs,
        };
        const opts: ResilientPaymentGatewayOptions = {
          inner,
          resilienceConfig,
          dependencyName: 'payment-gateway',
        };
        return new ResilientPaymentGateway(opts);
      },
    },
    {
      provide: PAYMENT_GATEWAY_PORT,
      useExisting: ResilientPaymentGateway,
    },
  ],
  exports: [PAYMENT_GATEWAY_PORT],
})
export class GatewayModule {}
