/**
 * Cockatiel policy builders (plan section 5.1).
 *
 * Pure factory functions - create fresh policy instances per execution cycle,
 * EXCEPT breaker (singleton via breaker-store.ts).
 *
 * Composition order (plan section 5.1):
 *   CircuitBreaker (outermost) -> Retry -> Timeout -> HTTP call (innermost)
 *
 * Wrapper order memengaruhi semantics - verifikasi via tests (TASK-14 scenario 3).
 */

import {
  retry,
  timeout,
  circuitBreaker,
  handleAll,
  DelegateBackoff,
  ConsecutiveBreaker,
  TimeoutStrategy,
  type RetryPolicy,
  type TimeoutPolicy,
  type CircuitBreakerPolicy,
} from './cockatiel-adapter';
import type { ResilienceConfig } from './types';
import { classifyError, type ClassifiableInput } from '../errors/index';

/**
 * Build retry policy dengan custom backoff yang menghormati Retry-After header.
 *
 * Plan section 6: gateway bisa balas 429 + Retry-After header. Cockatiel
 * ExponentialBackoff default tidak baca header ini. Kita pakai DelegateBackoff
 * yang:
 *   1. Extract error dari context.result (FailureReason)
 *   2. Classify error untuk dapat retryAfterMs
 *   3. Jika retryAfterMs ada -> delay = max(exponential, retryAfterMs)
 *   4. Jika tidak -> delay = exponential (default behavior)
 *
 * Plan section 15: RETRY_MAX_ATTEMPTS, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS,
 * RETRY_JITTER_RATIO. Jitter dari decorrelatedJitterGenerator (Cockatiel default).
 *
 * `handleAll` means retry on any thrown error. Filter retryable-only
 * dilakukan di resilient-adapter.ts (return untuk permanent, throw untuk retryable).
 */
export function buildRetryPolicy(config: ResilienceConfig): RetryPolicy {
  // Custom backoff: DelegateBackoff yang baca retryAfterMs dari error context.
  // Context shape: { attempt, result: { error: unknown } | { value: unknown } }
  // State: { exponential: number } untuk track exponential backoff across retries.
  // Type kept loose (Record<string, unknown>) karena cockatiel v4 exports context
  // with internal FailureReason typing — we narrow at use sites below.
  type BackoffContext = { attempt: number; result?: { error?: unknown } | { value?: unknown } };
  const customBackoff = new DelegateBackoff((context: BackoffContext, state?: { exponential: number }) => {
    // Calculate exponential backoff (mirroring ExponentialBackoff behavior)
    const baseExponential = state?.exponential ?? config.retryBaseDelayMs;
    const nextExponential = Math.min(baseExponential * 2, config.retryMaxDelayMs);

    // Extract error from context.result (FailureReason)
    const result = context?.result as { error?: unknown } | { value?: unknown } | undefined;
    let retryAfterMs: number | undefined;

    if (result && 'error' in result && result.error) {
      const err = result.error as Record<string, unknown> | null;

      // Check if error wraps a ChargeResult (e.g., GatewayChargeError from resilient-adapter.ts).
      // GatewayChargeError has `.result` property containing ChargeResult with retryAfterMs.
      // This is the primary path for Retry-After extraction in this project.
      if (err && typeof err === 'object' && 'result' in err) {
        const chargeResult = err.result as { retryAfterMs?: number } | undefined;
        if (chargeResult && typeof chargeResult.retryAfterMs === 'number') {
          retryAfterMs = chargeResult.retryAfterMs;
        }
      }

      // Fallback: try classifyError for raw AxiosError shape (e.response.status)
      // This handles cases where error is not wrapped in GatewayChargeError.
      if (retryAfterMs === undefined) {
        const input = toClassifiableInput(err);
        const classification = classifyError(input);
        retryAfterMs = classification.retryAfterMs ?? undefined;
      }
    }

    // Delay = max(exponential, retryAfterMs) supaya Retry-After selalu dihormati
    const delay = retryAfterMs !== undefined
      ? Math.max(nextExponential, retryAfterMs)
      : nextExponential;

    return {
      delay,
      state: { exponential: nextExponential },
    };
  });

  return retry(handleAll, {
    maxAttempts: config.retryMaxAttempts,
    backoff: customBackoff,
  });
}

/**
 * Convert unknown error to ClassifiableInput for classifier.
 * Mirrors logic in composition.ts toClassifiableInput.
 */
function toClassifiableInput(err: unknown): ClassifiableInput {
  if (err === null || err === undefined) {
    return { kind: 'network', code: 'UNKNOWN', message: 'unknown error' };
  }

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

  if (typeof e.code === 'string' && typeof e.message === 'string') {
    return {
      kind: 'network',
      code: e.code,
      message: e.message,
    };
  }

  return {
    kind: 'network',
    code: 'UNKNOWN',
    message: String(e.message ?? err),
  };
}

/**
 * Build timeout policy (aggressive strategy).
 *
 * Plan section 15: GATEWAY_TIMEOUT_MS (default 2000ms).
 * Aggressive = throw immediately on timeout (bukan cooperative yang andalkan AbortSignal handling).
 */
export function buildTimeoutPolicy(config: ResilienceConfig): TimeoutPolicy {
  return timeout(config.gatewayTimeoutMs, TimeoutStrategy.Aggressive);
}

/**
 * Build circuit breaker policy dengan ConsecutiveBreaker + halfOpenAfter cooldown.
 *
 * Plan section 5.2: BREAKER_FAILURE_THRESHOLD consecutive failures -> OPEN.
 * After BREAKER_COOLDOWN_MS -> HALF_OPEN (trial call).
 * HALF_OPEN success -> CLOSED. HALF_OPEN failure -> OPEN lagi.
 *
 * Catatan: policy ini biasanya di-cache via breaker-store.ts (singleton per dependency).
 */
export function buildBreakerPolicy(
  config: ResilienceConfig,
  onStateChange?: (newState: 'closed' | 'open' | 'half_open') => void,
): CircuitBreakerPolicy {
  const breaker = new ConsecutiveBreaker(config.breakerFailureThreshold);
  const policy = circuitBreaker(handleAll, {
    breaker,
    halfOpenAfter: config.breakerCooldownMs,
  });

  // Wire state change listeners (TASK-11 metrics)
  // Cockatiel v4 CircuitBreakerPolicy exposes:
  //   - onBreak: fires when CLOSED -> OPEN (failure threshold reached)
  //   - onHalfOpen: fires when OPEN -> HALF_OPEN (cooldown elapsed, trial call permitted)
  //   - onReset: fires when HALF_OPEN -> CLOSED (trial call succeeded)
  // All three are wired so MetricsService.setBreakerState() receives every transition.

  if (onStateChange) {
    policy.onBreak(() => onStateChange('open'));
    policy.onHalfOpen(() => onStateChange('half_open'));
    policy.onReset(() => onStateChange('closed'));
  }

  return policy;
}
