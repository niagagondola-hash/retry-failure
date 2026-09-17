/**
 * Cockatiel adapter - wraps cockatiel ESM imports behind a CJS-compatible interface.
 *
 * Reason: cockatiel v4 is ESM-only ({"type":"module"}). Jest 29 CommonJS cannot
 * load ESM modules directly. This file is the SINGLE place that imports cockatiel.
 * Tests can mock this module via jest.config moduleNameMapper.
 *
 * Application code imports from '../cockatiel-adapter' instead of 'cockatiel' directly.
 */

import {
  retry,
  timeout,
  circuitBreaker,
  handleAll,
  wrap,
  ExponentialBackoff,
  ConsecutiveBreaker,
  TimeoutStrategy,
  isBrokenCircuitError,
  type RetryPolicy,
  type TimeoutPolicy,
  type CircuitBreakerPolicy,
  type Policy,
} from 'cockatiel';

export {
  retry,
  timeout,
  circuitBreaker,
  handleAll,
  wrap,
  ExponentialBackoff,
  ConsecutiveBreaker,
  TimeoutStrategy,
  isBrokenCircuitError,
};
export type { RetryPolicy, TimeoutPolicy, CircuitBreakerPolicy, Policy };
