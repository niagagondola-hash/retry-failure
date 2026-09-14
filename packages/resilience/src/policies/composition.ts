/**
 * Resilience composition (plan section 5.1).
 *
 * Composition order (outermost → innermost):
 *   CircuitBreaker (singleton) → Retry → Timeout → fn (HTTP call)
 *
 * Behavior:
 *   - Bila breaker OPEN → reject call immediately, return breakerTripped=true
 *   - Bila breaker CLOSED/HALF_OPEN → execute retry+timeout wrapped fn
 *   - Retry: maxAttempts × exponential backoff with decorrelated jitter
 *   - Timeout: per-attempt, aggressive (throw on timeout)
 *   - Bila retry exhausted → return exhausted=true + last error
 *   - Bila success → return result + attempt count
 *
 * Integration with TASK-04 (classifier):
 *   - classifyError dipanggil di onFailure callback untuk determine retryable
 *   - Retry policy pakai handleAll (retry on any error), tapi classifier
 *     dipanggil untuk audit + server-directed delay.
 *   - Permanen error (4xx selain 429) — Cockatiel akan retry semua error karena
 *     handleAll. Bila ingin skip retry untuk permanent error, caller harus
 *     throw error yang sudah di-mark permanent.
 *
 * Untuk demo ini, kita pakai approach simpler:
 *   - handleAll (retry semua)
 *   - Caller (TASK-06 HttpPaymentGateway) normalize error sebelum throw
 *     dengan menyertakan info retryable di error object.
 *   - Composition invoke classifier di onFailure untuk audit.
 */

import { wrap, isBrokenCircuitError } from './cockatiel-adapter';
import { buildRetryPolicy, buildTimeoutPolicy } from './policies';
import { getBreaker, getBreakerState } from './breaker-store';
import type {
  ResilienceConfig,
  ResilienceOutcome,
  AttemptDetail,
  OnAttemptCallback,
} from './types';
import { classifyError, type ClassifiableInput } from '../errors/index';

export interface ExecuteOptions<T> {
  /** Logical name of dependency (e.g. 'payment-gateway'). */
  dependencyName: string;
  /** Function to execute (HTTP call). */
  fn: () => Promise<T>;
  /** Resilience config from env. */
  config: ResilienceConfig;
  /** Optional callback invoked on each attempt failure (for audit + metrics). */
  onAttempt?: OnAttemptCallback;
}

/**
 * Execute fn dengan resilience policy composition.
 *
 * Returns ResilienceOutcome yang berisi result/error + metadata untuk audit.
 */
export async function executeWithResilience<T>(opts: ExecuteOptions<T>): Promise<ResilienceOutcome<T>> {
  const { dependencyName, fn, config, onAttempt } = opts;

  // Get singleton breaker
  const breakerPolicy = getBreaker(dependencyName, config);
  const retryPolicy = buildRetryPolicy(config);
  const timeoutPolicy = buildTimeoutPolicy(config);

  // Composition: breaker (outer) → retry → timeout (inner)
  const policy = wrap(breakerPolicy, retryPolicy, timeoutPolicy);

  // Track attempts for audit
  const attemptDetails: AttemptDetail[] = [];
  let attemptNumber = 0;

  // Wire retry onFailure to capture attempt details
  retryPolicy.onFailure(({ reason, duration }) => {
    attemptNumber += 1;
    const detail = buildAttemptDetail(attemptNumber, reason, duration, getBreakerState(dependencyName));
    attemptDetails.push(detail);
    onAttempt?.(detail);
  });

  // Wire retry onSuccess to capture successful attempt
  retryPolicy.onSuccess(({ duration }) => {
    attemptNumber += 1;
    const detail: AttemptDetail = {
      attemptNumber,
      outcome: 'success',
      durationMs: duration,
      breakerState: getBreakerState(dependencyName),
    };
    attemptDetails.push(detail);
    onAttempt?.(detail);
  });

  try {
    const result = await policy.execute(fn);
    return {
      result,
      attempts: attemptNumber,
      breakerState: getBreakerState(dependencyName),
      exhausted: false,
      breakerTripped: false,
      attemptDetails,
    };
  } catch (err) {
    // Determine error category
    const breakerTripped = isBrokenCircuitError(err);

    if (breakerTripped) {
      // Breaker was open — record circuit_open attempt
      attemptNumber += 1;
      const detail: AttemptDetail = {
        attemptNumber,
        outcome: 'circuit_open',
        errorMessage: 'circuit breaker open',
        durationMs: 0,
        breakerState: 'open',
      };
      attemptDetails.push(detail);
      onAttempt?.(detail);

      return {
        error: err,
        attempts: attemptNumber,
        breakerState: 'open',
        exhausted: false,
        breakerTripped: true,
        attemptDetails,
      };
    }

    // Classify the error for retryAfterMs extraction
    const classification = classifyError(toClassifiableInput(err));

    // Check if exhausted (retry policy exhausted all attempts)
    // Cockatiel throws the last error after retry exhaustion — no explicit "exhausted" exception
    const exhausted = attemptNumber >= config.retryMaxAttempts;

    return {
      error: err,
      attempts: attemptNumber,
      breakerState: getBreakerState(dependencyName),
      exhausted,
      breakerTripped: false,
      retryAfterMs: classification.retryAfterMs,
      attemptDetails,
    };
  }
}

/**
 * Convert unknown error to ClassifiableInput for classifier.
 *
 * Cockatiel FailureReason shape: { error: unknown } | { value: T }.
 * Kita extract error dan normalize ke ClassifiableInput.
 */
function toClassifiableInput(err: unknown): ClassifiableInput {
  if (err === null || err === undefined) {
    return { kind: 'network', code: 'UNKNOWN', message: 'unknown error' };
  }

  // Axios error shape: { response: { status, data, headers }, code, message }
  const e = err as Record<string, unknown>;
  const response = e.response as { status?: number; data?: unknown; headers?: Record<string, string | string[] | undefined> } | undefined;

  if (response?.status) {
    return {
      kind: 'http',
      status: response.status,
      body: response.data,
      headers: response.headers,
    };
  }

  // Network error (ECONNREFUSED, ETIMEDOUT, dll.)
  if (typeof e.code === 'string' && typeof e.message === 'string') {
    return {
      kind: 'network',
      code: e.code,
      message: e.message,
    };
  }

  // Generic error
  return {
    kind: 'network',
    code: 'UNKNOWN',
    message: String(e.message ?? err),
  };
}

/**
 * Build AttemptDetail from Cockatiel FailureReason.
 */
function buildAttemptDetail(
  attemptNumber: number,
  reason: { error: unknown } | { value: unknown },
  durationMs: number,
  breakerState: 'closed' | 'open' | 'half_open',
): AttemptDetail {
  const err = 'error' in reason ? reason.error : reason.value;
  const classification = classifyError(toClassifiableInput(err));

  return {
    attemptNumber,
    outcome: classification.retryable ? 'retryable_failure' : 'permanent_failure',
    httpStatus: classification.httpStatus,
    errorCode: classification.errorCode,
    errorMessage: classification.errorMessage,
    delayBeforeNextMs: classification.retryAfterMs,
    breakerState,
    durationMs,
  };
}
