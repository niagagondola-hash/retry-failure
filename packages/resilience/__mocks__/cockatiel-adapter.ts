/**
 * Manual mock untuk cockatiel-adapter (yang wrap ESM-only cockatiel v4).
 *
 * Mock ini menyediakan implementasi minimal yang cukup untuk test composition.ts.
 * Bukan replacement untuk integration test - untuk itu pakai tsx runtime
 * (lihat SANDBOX_NOTES.md "Sanity check").
 */

type FailureReason = { error: unknown } | { value: unknown };

interface IFailureEvent {
  duration: number;
  handled: boolean;
  reason: FailureReason;
}

interface ISuccessEvent {
  duration: number;
}

interface IDisposable {
  dispose(): void;
}

class MockEvent<T> {
  private listeners: ((e: T) => void)[] = [];
  on(cb: (e: T) => void): IDisposable {
    this.listeners.push(cb);
    return { dispose: () => {} };
  }
  emit(e: T): void {
    for (const l of this.listeners) l(e);
  }
}

const TIMEOUT_STRATEGY = {
  Aggressive: 'aggressive',
  Cooperative: 'optimistic',
} as const;

class MockRetryPolicy {
  private maxAttempts: number;
  onFailureCb?: (e: IFailureEvent) => void;
  onSuccessCb?: (e: ISuccessEvent) => void;
  onRetry: MockEvent<unknown> = new MockEvent();
  onGiveUp: MockEvent<unknown> = new MockEvent();

  constructor(opts: { maxAttempts: number; backoff: unknown }) {
    this.maxAttempts = opts.maxAttempts;
  }
  onFailure(cb: (e: IFailureEvent) => void): IDisposable {
    this.onFailureCb = cb;
    return { dispose: () => {} };
  }
  onSuccess(cb: (e: ISuccessEvent) => void): IDisposable {
    this.onSuccessCb = cb;
    return { dispose: () => {} };
  }
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let lastErr: unknown;
    const start = Date.now();
    while (attempt < this.maxAttempts) {
      try {
        const result = await fn();
        this.onSuccessCb?.({ duration: Date.now() - start });
        return result;
      } catch (err) {
        attempt++;
        lastErr = err;
        const reason: FailureReason = { error: err };
        this.onFailureCb?.({
          duration: Date.now() - start,
          handled: attempt < this.maxAttempts,
          reason,
        });
      }
    }
    throw lastErr;
  }
}

class MockTimeoutPolicy {
  private duration: number;
  onTimeout: MockEvent<void> = new MockEvent();
  constructor(duration: number, _strategy: unknown) {
    this.duration = duration;
  }
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.onTimeout.emit(undefined);
        reject(new Error(`timeout after ${this.duration}ms`));
      }, this.duration);
      fn().then(
        (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }
}

class MockConsecutiveBreaker {
  private threshold: number;
  private consecutiveFailures = 0;
  state = 0;
  constructor(threshold: number) {
    this.threshold = threshold;
  }
  success(): void {
    this.consecutiveFailures = 0;
    this.state = 0;
  }
  failure(): boolean {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.threshold) {
      this.state = 1;
      return true;
    }
    return false;
  }
}

class BrokenCircuitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrokenCircuitError';
  }
}

function isBrokenCircuitError(e: unknown): e is BrokenCircuitError {
  return e instanceof BrokenCircuitError;
}

class MockCircuitBreakerPolicy {
  private breaker: MockConsecutiveBreaker;
  private halfOpenAfter: number;
  private openedAt: number | null = null;
  private breakEvent: MockEvent<unknown> = new MockEvent();
  private halfOpenEvent: MockEvent<unknown> = new MockEvent();
  private resetEvent: MockEvent<unknown> = new MockEvent();

  constructor(opts: { breaker: MockConsecutiveBreaker; halfOpenAfter: number }) {
    this.breaker = opts.breaker;
    this.halfOpenAfter = opts.halfOpenAfter;
  }
  // Cockatiel API: .onBreak(cb) returns IDisposable - callable as method
  onBreak(cb: (e: unknown) => void): IDisposable {
    return this.breakEvent.on(cb);
  }
  onHalfOpen(cb: (e: unknown) => void): IDisposable {
    return this.halfOpenEvent.on(cb);
  }
  onReset(cb: (e: unknown) => void): IDisposable {
    return this.resetEvent.on(cb);
  }
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.openedAt !== null) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.halfOpenAfter) {
        this.breaker.state = 2;
        this.halfOpenEvent.emit(undefined);
      } else {
        throw new BrokenCircuitError('circuit breaker is open');
      }
    }
    try {
      const result = await fn();
      this.breaker.success();
      this.openedAt = null;
      return result;
    } catch (err) {
      const opened = this.breaker.failure();
      if (opened) {
        this.openedAt = Date.now();
        this.breakEvent.emit(undefined);
      }
      throw err;
    }
  }
  isolate(): IDisposable {
    return { dispose: () => {} };
  }
}

class ExponentialBackoff {
  constructor(_opts?: unknown) {}
}

const handleAll = Symbol('handleAll');

function retry(_policy: unknown, opts: { maxAttempts: number; backoff: unknown }): MockRetryPolicy {
  return new MockRetryPolicy(opts);
}

function timeout(duration: number, strategy: unknown): MockTimeoutPolicy {
  return new MockTimeoutPolicy(duration, strategy);
}

function circuitBreaker(
  _policy: unknown,
  opts: { breaker: MockConsecutiveBreaker; halfOpenAfter: number },
): MockCircuitBreakerPolicy {
  return new MockCircuitBreakerPolicy(opts);
}

function wrap<A, B, C>(a: A, b: B, c: C): A & B & C {
  const composite = {
    async execute<T>(fn: () => Promise<T>): Promise<T> {
      const aPolicy = a as unknown as { execute?: <T>(fn: () => Promise<T>) => Promise<T> };
      const bPolicy = b as unknown as { execute?: <T>(fn: () => Promise<T>) => Promise<T> };
      const cPolicy = c as unknown as { execute?: <T>(fn: () => Promise<T>) => Promise<T> };

      if (aPolicy.execute && bPolicy.execute && cPolicy.execute) {
        return aPolicy.execute(() => bPolicy.execute!(() => cPolicy.execute!(fn)));
      }
      if (aPolicy.execute && bPolicy.execute) {
        return aPolicy.execute(() => bPolicy.execute!(fn));
      }
      if (aPolicy.execute) {
        return aPolicy.execute(fn);
      }
      return fn();
    },
  };
  return composite as A & B & C;
}

export {
  retry,
  timeout,
  circuitBreaker,
  handleAll,
  wrap,
  ExponentialBackoff,
  MockConsecutiveBreaker as ConsecutiveBreaker,
  TIMEOUT_STRATEGY as TimeoutStrategy,
  BrokenCircuitError,
  isBrokenCircuitError,
};
