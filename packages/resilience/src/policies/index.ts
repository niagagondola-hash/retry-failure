/**
 * Barrel export for policies subpackage.
 */
export { buildRetryPolicy, buildTimeoutPolicy, buildBreakerPolicy } from './policies';
export { getBreaker, getBreakerState, resetBreakerStore } from './breaker-store';
export { executeWithResilience } from './composition';
export type {
  ResilienceConfig,
  ResilienceOutcome,
  BreakerState,
  AttemptDetail,
  OnAttemptCallback,
  OnBreakerStateChangeCallback,
} from './types';
export type { ExecuteOptions } from './composition';
