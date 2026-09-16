import { Injectable } from '@nestjs/common';
import {
  executeWithResilience,
  getBreakerState,
  type ResilienceConfig,
  type ResilienceOutcome,
  type BreakerState,
} from '@retry-failure/resilience';
import { MetricsService } from '../observability/metrics.service';
import { PaymentGatewayPort, AttemptObservable } from './port';
import type { ChargeRequest, ChargeResult, OnAttemptCallback, GatewayAttemptContext } from './types';

export interface ResilientPaymentGatewayOptions {
  inner: PaymentGatewayPort;
  resilienceConfig: ResilienceConfig;
  dependencyName?: string;
  /**
   * Optional MetricsService for circuit breaker state gauge updates.
   * When provided, breaker state transitions (CLOSED -> OPEN -> HALF_OPEN -> CLOSED)
   * are reflected in the `circuit_breaker_state` Prometheus gauge.
   */
  metrics?: MetricsService;
}

@Injectable()
export class ResilientPaymentGateway implements PaymentGatewayPort, AttemptObservable {
  private readonly inner: PaymentGatewayPort;
  private readonly resilienceConfig: ResilienceConfig;
  private readonly dependencyName: string;
  private readonly metrics?: MetricsService;
  private onAttempt?: OnAttemptCallback;

  constructor(opts: ResilientPaymentGatewayOptions) {
    this.inner = opts.inner;
    this.resilienceConfig = opts.resilienceConfig;
    this.dependencyName = opts.dependencyName ?? 'payment-gateway';
    this.metrics = opts.metrics;
  }

  setOnAttempt(cb: OnAttemptCallback): void {
    this.onAttempt = cb;
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    let attemptNumber = 0;

    const outcome: ResilienceOutcome<ChargeResult> = await executeWithResilience<ChargeResult>({
      dependencyName: this.dependencyName,
      config: this.resilienceConfig,
      fn: async () => {
        attemptNumber += 1;
        const startedAt = new Date();
        const innerResult = await this.inner.charge(req);
        const finishedAt = new Date();

        // For success and retryable_failure: invoke onAttempt with full context.
        // (has gatewayReference, replayed — fields not available in AttemptDetail)
        // breakerState read from singleton store for accurate audit trail.
        if (this.onAttempt) {
          await this.onAttempt({
            paymentId: req.paymentId,
            attemptNumber,
            startedAt,
            finishedAt,
            result: innerResult,
            breakerState: getBreakerState(this.dependencyName),
          } as GatewayAttemptContext);
        }

        if (innerResult.status === 'failed') {
          throw new GatewayChargeError(innerResult);
        }

        return innerResult;
      },
      // Wire breaker state changes to MetricsService gauge.
      // Attached on first getBreaker() call (singleton); stable across calls.
      onStateChange: (newState: BreakerState) => {
        this.metrics?.setBreakerState(newState);
      },
    });

    // Handle circuit_open case: breaker was OPEN, fn body never executed,
    // so onAttempt was NOT called during fn execution.
    // Manually invoke onAttempt here (AWAITED — no race condition) so audit
    // records 1 row with outcome='circuit_open' before payment transitions
    // to scheduled_for_retry.
    //
    // PLAN1 compliance: TASK-08 section "Handle circuit_open case" requires
    // AuditService to write 1 row even when no HTTP call occurred.
    if (outcome.breakerTripped && this.onAttempt) {
      const now = new Date();
      await this.onAttempt({
        paymentId: req.paymentId,
        attemptNumber: 1,
        startedAt: now,
        finishedAt: now,
        result: {
          status: 'failed',
          replayed: false,
          errorCode: 'circuit_open',
          errorMessage: 'circuit breaker open — fast-fail without calling gateway',
        },
        breakerState: 'open',
      } as GatewayAttemptContext);
    }

    return this.mapOutcome(outcome);
  }

  private mapOutcome(outcome: ResilienceOutcome<ChargeResult>): ChargeResult {
    if (outcome.result) {
      return {
        ...outcome.result,
        attempts: outcome.attempts,
      };
    }

    if (outcome.breakerTripped) {
      return {
        status: 'failed',
        replayed: false,
        errorCode: 'circuit_open',
        errorMessage: 'circuit breaker open — fast-fail without calling gateway',
        attempts: outcome.attempts,
      };
    }

    const lastError = outcome.error;
    let innerResult: ChargeResult | undefined;
    if (lastError instanceof GatewayChargeError) {
      innerResult = lastError.result;
    }

    return {
      status: 'failed',
      httpStatus: innerResult?.httpStatus,
      replayed: innerResult?.replayed ?? false,
      errorCode: innerResult?.errorCode ?? 'retry_exhausted',
      errorMessage: innerResult?.errorMessage ?? 'retry exhausted',
      retryAfterMs: innerResult?.retryAfterMs,
      attempts: outcome.attempts,
    };
  }
}

export class GatewayChargeError extends Error {
  constructor(public readonly result: ChargeResult) {
    super(result.errorMessage ?? 'gateway charge failed');
    this.name = 'GatewayChargeError';
  }
}
