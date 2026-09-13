/**
 * Breaker store — singleton circuit breaker per dependency name (plan section 5.2).
 *
 * Circuit breaker harus long-lived per-dependency, bukan dibuat baru per request.
 * State OPEN harus bertahan lintas request agar berfungsi.
 *
 * Singleton ini di-cache di module-level Map. Bila NestJS hot reload, state reset
 * (acceptable untuk dev; production butuh external state store — TASK-15 caveats).
 */

import { buildBreakerPolicy } from './policies';
import type { CircuitBreakerPolicy } from 'cockatiel';
import type { ResilienceConfig, BreakerState, OnBreakerStateChangeCallback } from './types';

const breakerCache = new Map<string, CircuitBreakerPolicy>();
const breakerStates = new Map<string, BreakerState>();

/**
 * Get or create singleton circuit breaker for a dependency.
 *
 * @param dependencyName e.g. 'payment-gateway'
 * @param config Resilience config
 * @param onStateChange Optional callback fired on breaker state transition
 */
export function getBreaker(
  dependencyName: string,
  config: ResilienceConfig,
  onStateChange?: OnBreakerStateChangeCallback,
): CircuitBreakerPolicy {
  let breaker = breakerCache.get(dependencyName);
  if (!breaker) {
    breakerStates.set(dependencyName, 'closed');
    breaker = buildBreakerPolicy(config, (newState: BreakerState) => {
      breakerStates.set(dependencyName, newState);
      onStateChange?.(newState);
    });
    breakerCache.set(dependencyName, breaker);
  }
  return breaker;
}

/**
 * Get current breaker state (for metrics + observability).
 */
export function getBreakerState(dependencyName: string): BreakerState {
  return breakerStates.get(dependencyName) ?? 'closed';
}

/**
 * Reset all breaker state — test-only helper. TIDAK dipakai di production code.
 */
export function resetBreakerStore(): void {
  breakerCache.clear();
  breakerStates.clear();
}
