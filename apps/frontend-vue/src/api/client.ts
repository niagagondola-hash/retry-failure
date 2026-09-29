// Plan reference: PLAN2 Section 11.3 (Aturan), Section 11.4 (Axios interceptor),
// Section 12.3 (CSRF). Task: AUTH-20 — FE Vue auth flow; updated in AUTH-21
// to forward `from` + `retryAfter` query params when pushing 403/429 routes.
//
// Single responsibility: configure the SHARED axios instances used by every
// FE→BE call. There is exactly one auth-aware instance (`apiClient`) for the
// BFF (payment-api) and one raw instance (`gatewayClient`) for the mock
// gateway admin endpoint. Previously a duplicate `axios.ts` existed — it has
// been merged here to satisfy DRY (CODING_STANDARDS.md §3.2).

import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import router from '../router';

/**
 * Base URL of the BFF (payment-api). Defaults to localhost:3001 (Plan2 default).
 *
 * In dev, set `VITE_PAYMENT_API_URL=` (empty) to fall back to same-origin +
 * Vite proxy (see `vite.config.ts`). When set to an absolute origin, requests
 * go directly to the BE and rely on CORS credentials (AUTH-17).
 */
const API_URL: string = import.meta.env.VITE_PAYMENT_API_URL ?? 'http://localhost:3001';

/**
 * @deprecated Use `VITE_PAYMENT_API_URL` (the canonical env var consumed by
 * `apiClient`). Kept only for backward-compat with older `.env` files; reads
 * the same value under the legacy name. Will be removed in AUTH-22 cleanup.
 */
const LEGACY_API_URL: string | undefined = import.meta.env.VITE_API_URL;
const RESOLVED_API_URL: string = API_URL ?? LEGACY_API_URL ?? 'http://localhost:3001';

/** Cookie name issued by AUTH-15 CsrfMiddleware (HttpOnly=false, readable by JS). */
const CSRF_COOKIE_NAME = 'XSRF-TOKEN';

/** Header name expected by AUTH-15 CsrfMiddleware for double-submit validation. */
const CSRF_HEADER_NAME = 'X-CSRF-Token';

/**
 * Bootstrap session endpoint. 401 from this path is silently swallowed by the
 * response interceptor — the auth store sets `user = null` instead of triggering
 * a login redirect (we are *checking* the session, not consuming a protected
 * resource).
 */
const SESSION_PATH = '/auth/session';

/**
 * Login path on the BFF. 401 responses from any other path redirect here via
 * full-page navigation so the BFF can start the OAuth/PKCE flow.
 */
const LOGIN_PATH = '/auth/login';

/** HTTP methods exempt from CSRF validation per AUTH-15 (RFC 7231 §4.2.1 safe methods). */
const CSRF_EXEMPT_METHODS = new Set(['get', 'head', 'options']);

/** Default countdown (seconds) shown on the 429 page when no `Retry-After` header is present. */
const DEFAULT_RETRY_AFTER_SEC = 60;

/** Fallback route for the `from` query when the failing request has no URL. */
const FROM_FALLBACK = '/';

/**
 * Auth-aware axios instance for ALL BFF (payment-api) calls.
 *
 * Auth features (PLAN2 §11.4 / §12.3):
 *   - `withCredentials: true` — cookie-based session (sid + XSRF-TOKEN).
 *   - Request interceptor auto-attaches `X-CSRF-Token` for non-safe methods.
 *   - Response interceptor handles 401 (redirect to BFF login, except for
 *     `/auth/session`), 403 (`/forbidden`), and 429 (`/too-many-requests`).
 *
 * 30s timeout accommodates demo scenarios with multiple retries + Retry-After
 * delays (e.g., Demo E rate-limited: 4 attempts × 3s Retry-After = ~12s).
 */
export const apiClient = axios.create({
  baseURL: RESOLVED_API_URL,
  withCredentials: true,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// --- Request interceptor: attach CSRF header for non-safe methods ---
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const method = (config.method ?? 'get').toLowerCase();
  console.debug('[api] request:', method.toUpperCase(), config.url);
  if (!CSRF_EXEMPT_METHODS.has(method)) {
    const csrf = getCookie(CSRF_COOKIE_NAME);
    if (csrf) {
      // AxiosHeaders supports bracket assignment; keeps the double-submit cookie
      // pattern (plan2 §12.3) in sync with the `XSRF-TOKEN` cookie value.
      config.headers[CSRF_HEADER_NAME] = csrf;
      console.debug('[api] CSRF header attached for:', method.toUpperCase(), config.url);
    }
  }
  return config;
});

// --- Response interceptor: handle 401 / 403 / 429 uniformly ---
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const status = error.response?.status;
    const requestUrl = error.config?.url ?? FROM_FALLBACK;

    if (status === 401) {
      // Skip redirect for the bootstrap session probe — the auth store handles
      // the "not logged in yet" case by setting user = null.
      if (!requestUrl.includes(SESSION_PATH)) {
        console.warn('[api] 401 received, redirect to BFF login:', requestUrl);
        redirectToLogin();
      } else {
        console.debug('[api] 401 on /auth/session (bootstrap, no redirect)');
      }
    } else if (status === 403) {
      // Forward `from` so the Forbidden page can show which route was blocked.
      void router.push({ name: 'forbidden', query: { from: requestUrl } });
    } else if (status === 429) {
      // Throttler v5 sets `Retry-After` (seconds) — pass it through so the
      // TooManyRequests page can drive its countdown UI.
      const retryAfterHeader = error.response?.headers?.['retry-after'];
      const retryAfter = parseRetryAfter(retryAfterHeader);
      void router.push({
        name: 'too-many-requests',
        query: { from: requestUrl, retryAfter: String(retryAfter) },
      });
    } else {
      // Preserve the legacy error log for non-auth failures (useful in dev
      // when debugging payment/gateway calls that don't fall under 401/403/429).
      console.error(
        '[API Error]',
        error.config?.method?.toUpperCase(),
        error.config?.url,
        status,
        error.message,
      );
    }
    return Promise.reject(error);
  },
);

/**
 * Raw axios instance for the mock gateway admin endpoint (port 3002).
 *
 * Deliberately NOT auth-aware: the mock gateway admin API is a dev-only control
 * surface that doesn't sit behind the BFF auth layer. If you need auth here in
 * the future, prefer composing the same interceptors instead of duplicating
 * them (CODING_STANDARDS.md §3.2 DRY).
 */
export const gatewayClient = axios.create({
  baseURL: import.meta.env.VITE_GATEWAY_MOCK_URL ?? 'http://localhost:3002',
  timeout: 5000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Full-page redirect to the BFF login endpoint so the BFF can start the
 * OAuth/PKCE flow. Uses `window.location` (not `router.push`) on purpose —
 * the login UI lives on the BFF/auth-mock side, not inside this SPA.
 */
function redirectToLogin(): void {
  if (window.location.pathname === LOGIN_PATH) return;
  window.location.href = `${RESOLVED_API_URL}${LOGIN_PATH}`;
}

/**
 * Read a cookie value from `document.cookie`.
 *
 * Returns the URL-decoded value or `null` when missing. Only non-HttpOnly
 * cookies are visible to JS — `XSRF-TOKEN` is intentionally `HttpOnly=false`
 * (AUTH-15) while the session cookie `sid` stays HttpOnly=true (anti-XSS).
 *
 * Exported for unit tests; not part of the public auth API surface.
 */
export function getCookie(name: string): string | null {
  const raw = document.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v ?? '');
  }
  return null;
}

/**
 * Parse the `Retry-After` HTTP header (RFC 7231 §7.1.3) into a positive
 * integer number of seconds.
 *
 * The header may be either a delta-seconds integer OR an HTTP-date. We only
 * support the integer form (which is what NestJS `@nestjs/throttler` v5
 * emits). Invalid / missing / negative values fall back to the default
 * countdown so the 429 page always has a sane value to display.
 *
 * Exported for unit tests; not part of the public auth API surface.
 */
export function parseRetryAfter(value: string | string[] | undefined): number {
  if (typeof value !== 'string' || value.length === 0) {
    return DEFAULT_RETRY_AFTER_SEC;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return DEFAULT_RETRY_AFTER_SEC;
  }
  return parsed;
}
