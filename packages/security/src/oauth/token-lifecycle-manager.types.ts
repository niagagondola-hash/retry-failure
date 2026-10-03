/**
 * Token Lifecycle Manager types — error + constants (AUTH-09b).
 *
 * Plan reference: PLAN2 Section 5.3 (Token Strategy), Section 5.4 (refresh rotation),
 * Section 8.2 (lazy sync), AUTH-09b task spec.
 */

/**
 * Buffer: refresh token 30 seconds before it actually expires.
 *
 * Prevents race condition where pre-check says "valid" but token expires
 * during the network round-trip to auth server (clock skew + latency).
 */
export const REFRESH_BUFFER_MS = 30_000;

/**
 * Error thrown when token refresh fails.
 *
 * Codes:
 *   - `refresh_failed` — generic refresh failure (network error, auth server down)
 *   - `refresh_token_expired` — refresh token itself is expired or revoked
 *   - `retry_401` — token still invalid after refresh + retry (1x)
 *
 * Caller responsibilities:
 *   - LazySyncMiddleware: log warning + use stale cache (non-blocking)
 *   - AuthService.switchRole: throw → controller return 401
 *   - SessionGuard: force re-login (delete session + 401)
 *   - FE Vue: redirect to landing page + show "Session expired" notification
 */
export class TokenRefreshError extends Error {
  constructor(
    message: string,
    public readonly code: 'refresh_failed' | 'refresh_token_expired' | 'retry_401',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TokenRefreshError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
