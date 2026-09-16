/**
 * Mode handler — pure function mapping (mode, ctx) -> ModeResult.
 *
 * Stateful bookkeeping (fail-first-n counter) is delegated to MockState so
 * callers retain explicit control over when/how counters mutate.
 */

import { randomUUID } from 'node:crypto';
import type { FailureMode, MockState } from '../state/mock-state';

export interface ModeContext {
  idempotencyKey: string;
  state: MockState;
}

export interface ModeResult {
  /** HTTP status code to return. */
  status: number;
  /** JSON body for the HTTP response. */
  body: unknown;
  /** Optional HTTP headers (e.g. Retry-After). */
  headers?: Record<string, string>;
  /**
   * If true, the charge has been captured (saved to idempotency store) but
   * the response will be dropped — caller should hang long enough for the
   * client to time out, then throw/abort.
   */
  shouldDropResponse?: boolean;
  /**
   * If set, caller should `await sleep(delayMs)` before responding. Used by
   * `always-timeout` to exceed client GATEWAY_TIMEOUT_MS=2000.
   */
  delayMs?: number;
  /**
   * True when the charge was actually captured and should be saved to the
   * idempotency store by the caller (and `actualChargesCount` incremented).
   */
  chargeCaptured?: boolean;
}

interface ChargeSuccessBody {
  status: 'succeeded';
  gateway_reference: string;
  replayed: boolean;
}

function successBody(replayed: boolean): ChargeSuccessBody {
  return {
    status: 'succeeded',
    gateway_reference: randomUUID(),
    replayed,
  };
}

function newGatewayReference(): string {
  return randomUUID();
}

/**
 * Apply a failure mode to the current request.
 *
 * Does NOT mutate MockState counters (requestCount/successCount/etc.) — that's
 * the caller's responsibility (so replay vs. fresh-charge semantics stay
 * clean). Does mutate `failFirstNCounter` because it's mode-local state.
 */
export function applyMode(mode: FailureMode, ctx: ModeContext): ModeResult {
  const { state, idempotencyKey } = ctx;
  const { config } = state;

  switch (mode) {
    case 'always-success': {
      return {
        status: 200,
        body: successBody(false),
        chargeCaptured: true,
      };
    }

    case 'fail-first-n': {
      const current = state.failFirstNCounter.get(idempotencyKey) ?? 0;
      const next = current + 1;
      state.failFirstNCounter.set(idempotencyKey, next);

      // First N attempts fail; attempt N+1 succeeds.
      if (current < config.n) {
        return {
          status: 500,
          body: {
            status: 'failed',
            error_code: 'upstream_error',
            message: `fail-first-n: attempt ${next} of ${config.n} (simulated)`,
            attempt: next,
            required: config.n,
          },
        };
      }
      return {
        status: 200,
        body: successBody(false),
        chargeCaptured: true,
      };
    }

    case 'server-error': {
      return {
        status: 500,
        body: {
          status: 'failed',
          error_code: 'upstream_error',
          message: 'Internal gateway error (simulated)',
        },
      };
    }

    case 'always-timeout': {
      // Sleep first; client (GATEWAY_TIMEOUT_MS=2000) will time out before
      // our 503 lands. delayMs is honoured by the charges service.
      return {
        status: 503,
        body: {
          status: 'failed',
          error_code: 'gateway_timeout',
          message: 'Gateway did not respond in time (simulated)',
        },
        delayMs: config.timeoutMs,
      };
    }

    case 'client-error': {
      return {
        status: 400,
        body: {
          status: 'failed',
          error_code: 'invalid_card',
          message: 'Card number invalid',
        },
      };
    }

    case 'random': {
      const ok = Math.random() < config.probability;
      if (ok) {
        return {
          status: 200,
          body: successBody(false),
          chargeCaptured: true,
        };
      }
      return {
        status: 500,
        body: {
          status: 'failed',
          error_code: 'random_failure',
          message: 'Probabilistic failure (simulated)',
        },
      };
    }

    case 'succeed-but-drop-response': {
      // Charge is captured immediately (caller saves to store + increments
      // actualChargesCount), but the response will never reach the client.
      // Caller hangs ~10s then throws ServiceUnavailableException so the
      // socket is closed without a 200. Next call with same key -> replay.
      return {
        status: 200,
        body: successBody(false),
        chargeCaptured: true,
        shouldDropResponse: true,
      };
    }

    case 'rate-limited': {
      return {
        status: 429,
        body: {
          status: 'failed',
          error_code: 'rate_limited',
          message: 'Too many requests (simulated)',
        },
        headers: { 'Retry-After': String(config.retryAfterSeconds) },
      };
    }

    default: {
      // Exhaustiveness check — TypeScript guarantees we covered all modes.
      // If a new mode is added to the union without a case here, compile fails.
      const _exhaustive: never = mode;
      void _exhaustive;
      return {
        status: 500,
        body: {
          status: 'failed',
          error_code: 'unknown_mode',
          message: `Unknown mode: ${String(mode)}`,
        },
      };
    }
  }
}

/** Convenience helper exported for callers/tests. */
export function makeGatewayReference(): string {
  return newGatewayReference();
}
