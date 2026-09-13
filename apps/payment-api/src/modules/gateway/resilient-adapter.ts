import { Injectable } from '@nestjs/common';
import {
  executeWithResilience,
  type ResilienceConfig,
  type ResilienceOutcome,
} from '@retry-failure/resilience';
import { PaymentGatewayPort, AttemptObservable } from './port';
import type { ChargeRequest, ChargeResult, OnAttemptCallback, GatewayAttemptContext } from './types';

export interface ResilientPaymentGatewayOptions {
  inner: PaymentGatewayPort;
  resilienceConfig: ResilienceConfig;
  dependencyName?: string;
}

@Injectable()
export class ResilientPaymentGateway implements PaymentGatewayPort, AttemptObservable {
  private readonly inner: PaymentGatewayPort;
  private readonly resilienceConfig: ResilienceConfig;
  private readonly dependencyName: string;
  private onAttempt?: OnAttemptCallback;

  constructor(opts: ResilientPaymentGatewayOptions) {
    this.inner = opts.inner;
    this.resilienceConfig = opts.resilienceConfig;
    this.dependencyName = opts.dependencyName ?? 'payment-gateway';
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

        if (this.onAttempt) {
          await this.onAttempt({
            paymentId: req.paymentId,
            attemptNumber,
            startedAt,
            finishedAt,
            result: innerResult,
            breakerState: undefined,
          } as GatewayAttemptContext);
        }

        if (innerResult.status === 'failed') {
          throw new GatewayChargeError(innerResult);
        }

        return innerResult;
      },
    });

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
