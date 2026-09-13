/**
 * Error classification types (plan section 5.3).
 *
 * Pure type definitions — no runtime code. Consumed by classifier.ts.
 */

export interface ErrorClassification {
  /** True bila error layak di-retry (transient). False bila permanent. */
  retryable: boolean;
  /** Machine-readable reason: 'server_error' | 'rate_limited' | 'timeout' | 'connection_refused' | 'connection_reset' | 'dns_failure' | 'client_error' | 'success' | 'unknown' */
  reason: string;
  /** Server-directed delay (ms) dari header `Retry-After` bila ada. */
  retryAfterMs?: number;
  /** Error code dari gateway body (`error_code` field) atau network `err.code`. */
  errorCode?: string;
  /** Human-readable error message. */
  errorMessage?: string;
  /** HTTP status code dari gateway response. */
  httpStatus?: number;
}

/**
 * Union of error shapes the classifier accepts.
 * Caller (HTTP adapter / Cockatiel wrapper) harus normalize error ke salah satu kind ini.
 */
export type ClassifiableInput =
  | {
      kind: 'http';
      status: number;
      body?: unknown;
      headers?: Record<string, string | string[] | undefined>;
    }
  | {
      kind: 'network';
      code: string;
      message: string;
    }
  | {
      kind: 'timeout';
      message: string;
    };
