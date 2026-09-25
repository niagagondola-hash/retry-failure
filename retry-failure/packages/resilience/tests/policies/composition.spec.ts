import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  executeWithResilience,
  getBreakerState,
  resetBreakerStore,
  type ResilienceConfig,
} from '../../src/policies';

const FAST_CONFIG: ResilienceConfig = {
  retryMaxAttempts: 3,
  retryBaseDelayMs: 50, // fast for tests
  retryMaxDelayMs: 200,
  retryJitterRatio: 0,
  gatewayTimeoutMs: 1000,
  breakerFailureThreshold: 3,
  breakerCooldownMs: 5000,
};

function makeHttpError(status: number, body?: unknown, headers?: Record<string, string>) {
  const err = new Error(`HTTP ${status}`);
  (err as unknown as Record<string, unknown>).response = { status, data: body, headers };
  return err;
}

function makeNetworkError(code: string) {
  const err = new Error(code);
  (err as unknown as Record<string, unknown>).code = code;
  return err;
}

beforeEach(() => {
  resetBreakerStore();
});

describe('executeWithResilience - happy path', () => {
  it('returns result on first attempt success', async () => {
    let calls = 0;
    const outcome = await executeWithResilience({
      dependencyName: 'test-success',
      fn: async () => {
        calls++;
        return { ok: true, call: calls };
      },
      config: FAST_CONFIG,
    });

    expect(outcome.result).toEqual({ ok: true, call: 1 });
    expect(outcome.attempts).toBe(1);
    expect(outcome.exhausted).toBe(false);
    expect(outcome.breakerTripped).toBe(false);
    expect(outcome.breakerState).toBe('closed');
  });

  it('returns result after retryable failures then success (fail-first-n)', async () => {
    let calls = 0;
    const outcome = await executeWithResilience({
      dependencyName: 'test-retry-success',
      fn: async () => {
        calls++;
        if (calls < 3) throw makeHttpError(500, { message: 'server down' });
        return { ok: true, attempt: calls };
      },
      config: FAST_CONFIG,
    });

    expect(outcome.result).toEqual({ ok: true, attempt: 3 });
    expect(outcome.attempts).toBe(3);
    expect(outcome.exhausted).toBe(false);
    expect(outcome.breakerState).toBe('closed');
  });
});

describe('executeWithResilience - retry exhaustion', () => {
  it('returns exhausted=true after maxAttempts failed', async () => {
    const outcome = await executeWithResilience<string>({
      dependencyName: 'test-exhaust',
      fn: async () => {
        throw makeHttpError(500);
      },
      config: FAST_CONFIG,
    });

    expect(outcome.result).toBeUndefined();
    expect(outcome.error).toBeDefined();
    expect(outcome.attempts).toBe(FAST_CONFIG.retryMaxAttempts);
    expect(outcome.exhausted).toBe(true);
    expect(outcome.breakerTripped).toBe(false);
  });

  it('captures httpStatus in attemptDetails', async () => {
    const outcome = await executeWithResilience<string>({
      dependencyName: 'test-detail',
      fn: async () => {
        throw makeHttpError(503, { error_code: 'service_unavailable' });
      },
      config: FAST_CONFIG,
    });

    expect(outcome.attemptDetails).toBeDefined();
    expect(outcome.attemptDetails?.length).toBe(FAST_CONFIG.retryMaxAttempts);
    expect(outcome.attemptDetails?.[0].outcome).toBe('retryable_failure');
    expect(outcome.attemptDetails?.[0].httpStatus).toBe(503);
  });
});

describe('executeWithResilience - Retry-After header', () => {
  it('extracts retryAfterMs from 429 response', async () => {
    const outcome = await executeWithResilience<string>({
      dependencyName: 'test-retry-after',
      fn: async () => {
        throw makeHttpError(429, { message: 'slow down' }, { 'retry-after': '10' });
      },
      config: FAST_CONFIG,
    });

    expect(outcome.retryAfterMs).toBe(10000);
    expect(outcome.attemptDetails?.[0].delayBeforeNextMs).toBe(10000);
  });
});

describe('executeWithResilience - circuit breaker', () => {
  it('opens circuit after threshold consecutive failures', async () => {
    const cfg: ResilienceConfig = {
      ...FAST_CONFIG,
      retryMaxAttempts: 1, // 1 attempt per execution cycle
      breakerFailureThreshold: 3,
    };

    const depName = 'test-breaker';

    // 3 cycles, each 1 attempt -> 3 failures -> breaker opens
    for (let i = 0; i < 3; i++) {
      await executeWithResilience({
        dependencyName: depName,
        fn: async () => {
          throw makeNetworkError('ECONNREFUSED');
        },
        config: cfg,
      });
    }

    expect(getBreakerState(depName)).toBe('open');

    // 4th call - breaker rejects immediately (breakerTripped=true)
    let calls = 0;
    const outcome = await executeWithResilience({
      dependencyName: depName,
      fn: async () => {
        calls++;
        return 'unexpected success';
      },
      config: cfg,
    });

    expect(outcome.breakerTripped).toBe(true);
    expect(outcome.breakerState).toBe('open');
    expect(calls).toBe(0); // fn tidak dipanggil
  });

  it('reuses same breaker for same dependency name (singleton)', async () => {
    const cfg = FAST_CONFIG;
    const depName = 'singleton-test';

    // Trigger 1 failure
    await executeWithResilience({
      dependencyName: depName,
      fn: async () => {
        throw makeHttpError(500);
      },
      config: { ...cfg, retryMaxAttempts: 1 },
    });

    // Another call - same breaker instance, state should be same
    // (not yet open because threshold not reached)
    expect(getBreakerState(depName)).toBe('closed');

    // After more failures -> opens
    await executeWithResilience({
      dependencyName: depName,
      fn: async () => {
        throw makeHttpError(500);
      },
      config: { ...cfg, retryMaxAttempts: 1 },
    });
    await executeWithResilience({
      dependencyName: depName,
      fn: async () => {
        throw makeHttpError(500);
      },
      config: { ...cfg, retryMaxAttempts: 1 },
    });

    expect(getBreakerState(depName)).toBe('open');
  });
});

describe('executeWithResilience - onAttempt callback', () => {
  it('invokes onAttempt for each attempt failure', async () => {
    const attempts: Array<{ attemptNumber: number; outcome: string; httpStatus?: number }> = [];
    await executeWithResilience({
      dependencyName: 'test-callback',
      fn: async () => {
        throw makeHttpError(500);
      },
      config: FAST_CONFIG,
      onAttempt: (detail) => {
        attempts.push({
          attemptNumber: detail.attemptNumber,
          outcome: detail.outcome,
          httpStatus: detail.httpStatus,
        });
      },
    });

    expect(attempts.length).toBe(FAST_CONFIG.retryMaxAttempts);
    expect(attempts[0].outcome).toBe('retryable_failure');
    expect(attempts[0].httpStatus).toBe(500);
  });
});

describe('executeWithResilience - timeout handling', () => {
  it('treats timeout as retryable failure', async () => {
    const outcome = await executeWithResilience({
      dependencyName: 'test-timeout',
      fn: async () => {
        // Simulate timeout by sleeping longer than gatewayTimeoutMs
        await new Promise((r) => setTimeout(r, 200));
        return 'should not reach here';
      },
      config: { ...FAST_CONFIG, gatewayTimeoutMs: 50, retryMaxAttempts: 2 },
    });

    // Timeout should have triggered retry
    expect(outcome.exhausted).toBe(true);
    expect(outcome.attempts).toBe(2);
  }, 10000);
});
