/**
 * Cockatiel policy builders (plan section 5.1).
 *
 * Pure factory functions — create fresh policy instances per execution cycle,
 * EXCEPT breaker (singleton via breaker-store.ts).
 *
 * Composition order (plan section 5.1):
 *   CircuitBreaker (outermost) → Retry → Timeout → HTTP call (innermost)
 *
 * Wrapper order memengaruhi semantics — verifikasi via tests (TASK-14 scenario 3).
 */

import {
  retry,
  timeout,
  circuitBreaker,
  handleAll,
  ExponentialBackoff,
  ConsecutiveBreaker,
  TimeoutStrategy,
  type RetryPolicy,
  type TimeoutPolicy,
  type CircuitBreakerPolicy,
} from './cockatiel-adapter';
import type { ResilienceConfig } from './types';

/**
 * Build retry policy dengan ExponentialBackoff + decorrelated jitter.
 *
 * Plan section 15: RETRY_MAX_ATTEMPTS, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS,
 * RETRY_JITTER_RATIO. Jitter dari decorrelatedJitterGenerator (Cockatiel default).
 *
 * `handleAll` means retry on any thrown error. Filter retryable-only
 * dilakukan di composition.ts via onFailure callback (classifier dari TASK-04).
 */
export function buildRetryPolicy(config: ResilienceConfig): RetryPolicy {
  const backoff = new ExponentialBackoff({
    initialDelay: config.retryBaseDelayMs,
    maxDelay: config.retryMaxDelayMs,
    exponent: 2,
    // Cockatiel default: decorrelatedJitterGenerator. Tidak ada option ratio.
    // Jitter di-handle Cockatiel internal (decorrelated jitter adalah best practice per AWS + Polly).
  });
  return retry(handleAll, {
    maxAttempts: config.retryMaxAttempts,
    backoff,
  });
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
 * Plan section 5.2: BREAKER_FAILURE_THRESHOLD consecutive failures → OPEN.
 * After BREAKER_COOLDOWN_MS → HALF_OPEN (trial call).
 * HALF_OPEN success → CLOSED. HALF_OPEN failure → OPEN lagi.
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
  //   - onBreak: fires when CLOSED → OPEN (failure threshold reached)
  //   - onHalfOpen: fires when OPEN → HALF_OPEN (cooldown elapsed, trial call permitted)
  //   - onReset: fires when HALF_OPEN → CLOSED (trial call succeeded)
  // All three are wired so MetricsService.setBreakerState() receives every transition.

  if (onStateChange) {
    policy.onBreak(() => onStateChange('open'));
    policy.onHalfOpen(() => onStateChange('half_open'));
    policy.onReset(() => onStateChange('closed'));
  }

  return policy;
}
