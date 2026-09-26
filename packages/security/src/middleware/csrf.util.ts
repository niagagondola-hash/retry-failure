/**
 * CSRF helpers — token generation + constant-time comparison (AUTH-15).
 *
 * Plan reference: PLAN2 Section 12.3 (CSRF — double-submit cookie),
 * OWASP CSRF Prevention Cheat Sheet.
 *
 * - `generateCsrfToken()` — 32 random bytes → base64url (~43 chars, URL-safe).
 *   Reused by `CsrfMiddleware` for the `XSRF-TOKEN` cookie value.
 * - `safeEqual(a, b)` — `crypto.timingSafeEqual` wrapper that returns `false`
 *   (instead of throwing) when lengths differ. Constant-time when lengths match.
 * - `CSRF_EXEMPT_METHODS` / `CSRF_EXEMPT_PATHS` — safe-method + path allowlist
 *   per plan2 §12.3 (`GET`, `HEAD`, `OPTIONS`, `/auth/callback`).
 *
 * DRY: cookie parsing itself lives in `oauth/cookie.util.ts` (`parseSessionCookie`
 * — accepts a `name` parameter, so `parseSessionCookie(req, 'XSRF-TOKEN')`
 * covers the XSRF-TOKEN cookie without duplicating the parse loop).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Default XSRF-TOKEN cookie TTL in seconds — 8 hours, matches session cookie (plan2 §12.1). */
export const CSRF_COOKIE_TTL_SEC = 28800;

/** Safe HTTP methods per RFC 7231 §4.2.1 — exempt from CSRF validation. */
export const CSRF_EXEMPT_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'OPTIONS',
]);

/**
 * Default exempt paths per plan2 §12.3.
 *
 * `/auth/callback` is exempt because the browser redirect from the auth
 * service cannot inject an `X-CSRF-Token` header on a 302 redirect target.
 * State binding (PKCE `state` parameter) already protects the callback.
 */
export const CSRF_DEFAULT_EXEMPT_PATHS: ReadonlySet<string> = new Set([
  '/auth/callback',
]);

/**
 * Generate a random CSRF token (32 bytes → base64url, ~43 chars, URL-safe).
 *
 * Uses `node:crypto.randomBytes` (CSPRNG). Suitable for double-submit cookie
 * values — the token is opaque to the server (no signing required).
 *
 * @returns base64url-encoded random token (~43 chars)
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Constant-time string comparison via `crypto.timingSafeEqual`.
 *
 * Returns `false` (instead of throwing) when the input lengths differ —
 * `timingSafeEqual` would throw `RangeError` on length mismatch. Length-leak
 * is acceptable for CSRF double-submit because the cookie is public (sent
 * on every safe request) and the header length is observable by the client.
 *
 * @param a - First string (typically the cookie value)
 * @param b - Second string (typically the `X-CSRF-Token` header value)
 * @returns `true` if strings are byte-equal, `false` otherwise
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Parse `CSRF_EXEMPT_PATHS` env (comma-separated) into a `Set`.
 *
 * Used by `CsrfMiddleware` constructor to override the default exempt paths.
 * Empty / unset env falls back to `CSRF_DEFAULT_EXEMPT_PATHS`.
 *
 * @param envRaw - Raw env string (e.g. "/auth/callback,/webhook/stripe")
 * @returns `Set<string>` of paths to exempt from CSRF validation
 */
export function parseExemptPaths(envRaw: string | undefined): Set<string> {
  if (!envRaw) return new Set(CSRF_DEFAULT_EXEMPT_PATHS);
  const paths = envRaw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return new Set(paths);
}
