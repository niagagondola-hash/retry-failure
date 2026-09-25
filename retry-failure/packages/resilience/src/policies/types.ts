/**
 * Resilience policy types (plan section 5).
 *
 * Pure type definitions - no runtime code. Consumed by policies.ts + composition.ts.
 */

/**
 * Default config values (plan section 15).
 * Dipakai oleh gateway.module.ts (TASK-06) bila env tidak set.
 */
export const DEFAULT_RESILIENCE_CONFIG: ResilienceConfig = {
  retryMaxAttempts: 3,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 8000,
  retryJitterRatio: 0.1,
  gatewayTimeoutMs: 2000,
  breakerFailureThreshold: 3,
  breakerCooldownMs: 10000,
};

/**
 * Configuration for Cockatiel policy composition.
 * Sourced from env (plan section 15).
 */
export interface ResilienceConfig {
  /** Cockatiel retry max attempts per execution cycle. */
  retryMaxAttempts: number;
  /** Cockatiel ExponentialBackoff initial delay (ms). */
  retryBaseDelayMs: number;
  /** Cockatiel ExponentialBackoff max delay (ms). */
  retryMaxDelayMs: number;
  /** Cockatiel ExponentialBackoff jitter ratio (0..1). */
  retryJitterRatio: number;

  /** Cockatiel timeout duration per attempt (ms). */
  gatewayTimeoutMs: number;

  /** ConsecutiveBreaker threshold (consecutive failures to open). */
  breakerFailureThreshold: number;
  /** CircuitBreaker halfOpenAfter cooldown (ms). */
  breakerCooldownMs: number;
}

/**
 * State of the circuit breaker for a dependency (plan section 5.2).
 * Mirrors Cockatiel's CircuitState enum but as string for audit trail.
 */
export type BreakerState = 'closed' | 'open' | 'half_open';

/**
 * Result of executeWithResilience - what the application layer sees.
 */
export interface ResilienceOutcome<T> {
  /** Successful result, bila ada. */
  result?: T;
  /** Last error, bila gagal. */
  error?: unknown;
  /** Number of attempts made (1 = first attempt, 3 = retried 2x). */
  attempts: number;
  /** Breaker state at end of execution cycle. */
  breakerState: BreakerState;
  /** True bila retry policy exhausted (max attempts reached). */
  exhausted: boolean;
  /** True bila circuit breaker was open at start (call rejected). */
  breakerTripped: boolean;
  /** Server-directed retry-after delay (ms) bila ada di response terakhir. */
  retryAfterMs?: number;
  /** Per-attempt details for audit trail (TASK-08). */
  attemptDetails?: AttemptDetail[];
}

/**
 * Per-attempt info for audit trail (plan section 11.2).
 * Populated by executeWithResilience via onFailure callback.
 */
export interface AttemptDetail {
  attemptNumber: number;
  /** Outcome classification - maps to AttemptOutcome enum di apps/payment-api. */
  outcome: 'success' | 'retryable_failure' | 'permanent_failure' | 'timeout' | 'circuit_open';
  /** HTTP status from gateway (null bila network error). */
  httpStatus?: number;
  /** Error code from gateway body or network err.code. */
  errorCode?: string;
  /** Error message from gateway body or err.message. */
  errorMessage?: string;
  /** Delay (ms) before next attempt (server-directed or backoff). */
  delayBeforeNextMs?: number;
  /** Breaker state at time of attempt. */
  breakerState: BreakerState;
  /** Execution duration (ms). */
  durationMs: number;
}

/**
 * Callback invoked on each attempt failure (for audit + metrics).
 * Wired from composition.ts -> caller (TASK-07 PaymentsService -> TASK-08 AuditService).
 */
export type OnAttemptCallback = (detail: AttemptDetail) => void;

/**
 * Callback invoked when breaker state changes (for metrics).
 */
export type OnBreakerStateChangeCallback = (newState: BreakerState) => void;
