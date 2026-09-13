/**
 * Error classifier (plan section 5.3).
 *
 * Pure function: tidak ada side effect. Mengembalikan keputusan retryable vs permanent
 * berdasarkan input yang sudah di-normalize caller.
 *
 * Responsibility boundary (plan section 2.1):
 *   - Cockatiel menangani retry execution loop.
 *   - Aplikasi (classifier ini) menangani error classification untuk payment domain.
 */

import { parseRetryAfter } from './retry-after';
import type { ClassifiableInput, ErrorClassification } from './types';

/** Network error codes yang dianggap retryable (transient). */
const RETRYABLE_NETWORK_CODES: Record<string, string> = {
  ECONNREFUSED: 'connection_refused',
  ECONNRESET: 'connection_reset',
  ETIMEDOUT: 'timeout',
  ENOTFOUND: 'dns_failure',
  EAI_AGAIN: 'dns_failure',
};

/**
 * Get case-insensitive header value from a Headers-like record.
 */
function getHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      if (Array.isArray(v)) return v[0];
      return v;
    }
  }
  return undefined;
}

/**
 * Extract `error_code` from gateway response body if shape matches.
 * Gateway contract: `{ error_code: string, message?: string }`.
 */
function extractErrorCode(body: unknown): { errorCode?: string; errorMessage?: string } {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const errorCode =
      typeof b.error_code === 'string' ? b.error_code : typeof b.errorCode === 'string' ? b.errorCode : undefined;
    const errorMessage =
      typeof b.message === 'string' ? b.message : typeof b.error === 'string' ? b.error : undefined;
    return { errorCode, errorMessage };
  }
  return {};
}

/**
 * Classify an error into retryable vs permanent.
 *
 * @param input Normalized error (one of: http | network | timeout).
 * @returns ErrorClassification with `retryable`, `reason`, and contextual fields.
 */
export function classifyError(input: ClassifiableInput): ErrorClassification {
  switch (input.kind) {
    case 'http':
      return classifyHttp(input);
    case 'network':
      return classifyNetwork(input);
    case 'timeout':
      return {
        retryable: true,
        reason: 'timeout',
        errorMessage: input.message,
      };
    default: {
      // Exhaustive check: bila ada kind baru tanpa handler, fail safe sebagai permanent.
      const _exhaustive: never = input;
      void _exhaustive;
      return { retryable: false, reason: 'unknown' };
    }
  }
}

function classifyHttp(input: Extract<ClassifiableInput, { kind: 'http' }>): ErrorClassification {
  const { status, body, headers } = input;

  // 5xx → server error, retryable
  if (status >= 500 && status < 600) {
    return {
      retryable: true,
      reason: 'server_error',
      httpStatus: status,
      ...extractErrorCode(body),
    };
  }

  // 429 → rate limited, retryable + respect Retry-After
  if (status === 429) {
    const retryAfterHeader = getHeader(headers, 'retry-after');
    const retryAfterMs = parseRetryAfter(retryAfterHeader);
    const result: ErrorClassification = {
      retryable: true,
      reason: 'rate_limited',
      httpStatus: status,
      ...extractErrorCode(body),
    };
    if (retryAfterMs !== null) {
      result.retryAfterMs = retryAfterMs;
    }
    return result;
  }

  // 4xx selain 429 → permanent client error
  if (status >= 400 && status < 500) {
    return {
      retryable: false,
      reason: 'client_error',
      httpStatus: status,
      ...extractErrorCode(body),
    };
  }

  // 2xx/3xx → success (caller should ignore — but return non-retryable)
  if (status >= 200 && status < 400) {
    return {
      retryable: false,
      reason: 'success',
      httpStatus: status,
    };
  }

  // Unknown HTTP status
  return {
    retryable: false,
    reason: 'unknown',
    httpStatus: status,
  };
}

function classifyNetwork(input: Extract<ClassifiableInput, { kind: 'network' }>): ErrorClassification {
  const reason = RETRYABLE_NETWORK_CODES[input.code];
  if (reason) {
    return {
      retryable: true,
      reason,
      errorCode: input.code,
      errorMessage: input.message,
    };
  }
  // Unknown network error → safe default: permanent
  return {
    retryable: false,
    reason: 'unknown',
    errorCode: input.code,
    errorMessage: input.message,
  };
}
