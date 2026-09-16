import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ResilientPaymentGateway } from '../../../src/modules/gateway/resilient-adapter';
import type { PaymentGatewayPort } from '../../../src/modules/gateway/port';
import type { ChargeRequest, ChargeResult } from '../../../src/modules/gateway/types';
import { resetBreakerStore, type ResilienceConfig } from '@retry-failure/resilience';

const FAST_CONFIG: ResilienceConfig = {
  retryMaxAttempts: 3,
  retryBaseDelayMs: 50,
  retryMaxDelayMs: 200,
  retryJitterRatio: 0,
  gatewayTimeoutMs: 5000,
  breakerFailureThreshold: 5,
  breakerCooldownMs: 10000,
};

const SAMPLE_REQ: ChargeRequest = {
  paymentId: 'pay-001',
  orderId: 'ORD-001',
  amount: '100.00',
  currency: 'IDR',
};

function makeSucceededResult(): ChargeResult {
  return {
    status: 'succeeded' as const,
    httpStatus: 200,
    gatewayReference: 'gw-ref-123',
    replayed: false,
  };
}

function makeFailedResult(
  httpStatus?: number,
  errorCode?: string,
  errorMessage?: string,
): ChargeResult {
  return {
    status: 'failed' as const,
    httpStatus,
    replayed: false,
    errorCode,
    errorMessage,
  };
}

beforeEach(() => {
  resetBreakerStore();
});

describe('ResilientPaymentGateway — success path', () => {
  it('returns succeeded result on first attempt', async () => {
    const inner: PaymentGatewayPort = {
      charge: jest.fn(async () => makeSucceededResult()),
    };
    const gw = new ResilientPaymentGateway({
      inner,
      resilienceConfig: FAST_CONFIG,
      dependencyName: 'test-gw-success',
    });

    const result = await gw.charge(SAMPLE_REQ);
    expect(result.status).toBe('succeeded');
    expect(result.gatewayReference).toBe('gw-ref-123');
    expect(result.attempts).toBe(1);
    expect(inner.charge).toHaveBeenCalledTimes(1);
  });

  it('returns succeeded after retryable failures (fail-first-n)', async () => {
    let calls = 0;
    const inner: PaymentGatewayPort = {
      charge: jest.fn(async () => {
        calls++;
        if (calls < 3) return makeFailedResult(500, 'server_error', 'server down');
        return makeSucceededResult();
      }),
    };
    const gw = new ResilientPaymentGateway({
      inner,
      resilienceConfig: FAST_CONFIG,
      dependencyName: 'test-gw-retry',
    });

    const result = await gw.charge(SAMPLE_REQ);
    expect(result.status).toBe('succeeded');
    expect(result.attempts).toBe(3);
    expect(inner.charge).toHaveBeenCalledTimes(3);
  });
});

describe('ResilientPaymentGateway — retry exhaustion', () => {
  it('returns failed with retry_exhausted after maxAttempts', async () => {
    const inner: PaymentGatewayPort = {
      charge: jest.fn(async () => makeFailedResult(500, 'server_error', 'always fail')),
    };
    const gw = new ResilientPaymentGateway({
      inner,
      resilienceConfig: FAST_CONFIG,
      dependencyName: 'test-gw-exhaust',
    });

    const result = await gw.charge(SAMPLE_REQ);
    expect(result.status).toBe('failed');
    expect(result.attempts).toBe(FAST_CONFIG.retryMaxAttempts);
    expect(inner.charge).toHaveBeenCalledTimes(FAST_CONFIG.retryMaxAttempts);
  });

  it('preserves errorCode + httpStatus from last attempt', async () => {
    const inner: PaymentGatewayPort = {
      charge: jest.fn(async () => makeFailedResult(503, 'service_unavailable', 'gateway down')),
    };
    const gw = new ResilientPaymentGateway({
      inner,
      resilienceConfig: FAST_CONFIG,
      dependencyName: 'test-gw-preserve',
    });

    const result = await gw.charge(SAMPLE_REQ);
    expect(result.httpStatus).toBe(503);
    expect(result.errorCode).toBe('service_unavailable');
    expect(result.errorMessage).toBe('gateway down');
  });
});

describe('ResilientPaymentGateway — onAttempt callback', () => {
  it('invokes onAttempt for each attempt (success + failures)', async () => {
    let calls = 0;
    const inner: PaymentGatewayPort = {
      charge: jest.fn(async () => {
        calls++;
        if (calls < 3) return makeFailedResult(500);
        return makeSucceededResult();
      }),
    };
    const gw = new ResilientPaymentGateway({
      inner,
      resilienceConfig: FAST_CONFIG,
      dependencyName: 'test-gw-callback',
    });

    const attempts: Array<{ attemptNumber: number; status: string }> = [];
    gw.setOnAttempt((ctx) => {
      attempts.push({
        attemptNumber: ctx.attemptNumber,
        status: ctx.result.status,
      });
    });

    await gw.charge(SAMPLE_REQ);
    expect(attempts.length).toBe(3);
    expect(attempts[0]).toEqual({ attemptNumber: 1, status: 'failed' });
    expect(attempts[1]).toEqual({ attemptNumber: 2, status: 'failed' });
    expect(attempts[2]).toEqual({ attemptNumber: 3, status: 'succeeded' });
  });

  it('passes paymentId in attempt context', async () => {
    const inner: PaymentGatewayPort = {
      charge: jest.fn(async () => makeSucceededResult()),
    };
    const gw = new ResilientPaymentGateway({
      inner,
      resilienceConfig: FAST_CONFIG,
      dependencyName: 'test-gw-paymentId',
    });

    let capturedPaymentId: string | undefined;
    gw.setOnAttempt((ctx) => {
      capturedPaymentId = ctx.paymentId;
    });

    await gw.charge(SAMPLE_REQ);
    expect(capturedPaymentId).toBe('pay-001');
  });
});

describe('ResilientPaymentGateway — circuit breaker', () => {
  it('returns circuit_open errorCode when breaker is open', async () => {
    const cfg: ResilienceConfig = {
      ...FAST_CONFIG,
      retryMaxAttempts: 1,
      breakerFailureThreshold: 2,
    };
    const depName = 'test-gw-breaker';

    // 2 execution cycles × 1 attempt each = 2 failures -> breaker opens
    const inner: PaymentGatewayPort = {
      charge: jest.fn(async () => makeFailedResult(500)),
    };
    const gw = new ResilientPaymentGateway({
      inner,
      resilienceConfig: cfg,
      dependencyName: depName,
    });

    // First 2 calls exhaust retries + open breaker
    await gw.charge(SAMPLE_REQ);
    await gw.charge(SAMPLE_REQ);

    // 3rd call — breaker rejects immediately
    inner.charge = jest.fn(async () => makeSucceededResult());
    const result = await gw.charge(SAMPLE_REQ);
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('circuit_open');
    expect(inner.charge).toHaveBeenCalledTimes(0); // inner not called
  });
});

describe('ResilientPaymentGateway — replayed flag passthrough', () => {
  it('passes replayed=true from inner on success', async () => {
    const inner: PaymentGatewayPort = {
      charge: jest.fn(async () => ({
        status: 'succeeded' as const,
        httpStatus: 200,
        gatewayReference: 'existing-ref',
        replayed: true,
      })),
    };
    const gw = new ResilientPaymentGateway({
      inner,
      resilienceConfig: FAST_CONFIG,
      dependencyName: 'test-gw-replay',
    });

    const result = await gw.charge(SAMPLE_REQ);
    expect(result.replayed).toBe(true);
    expect(result.gatewayReference).toBe('existing-ref');
  });
});
