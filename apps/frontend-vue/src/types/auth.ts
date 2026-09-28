// Plan reference: PLAN2 Section 11.3 (Aturan) + Section 11.4 (Axios interceptor)
// Task: AUTH-20 — FE Vue auth flow.

/**
 * Authenticated user shape returned by `GET /auth/session`.
 *
 * Mirrors the BE `SessionResponse.user` contract defined in AUTH-17.
 * The FE never receives tokens — only this user descriptor (cookie-based session).
 */
export interface AuthUser {
  userId: string;
  username: string;
  roleId: string;
  isSuperAdmin: boolean;
  permissionCodes: string[];
}

/**
 * Response shape of `GET /auth/session`.
 *
 * `user` is `null` when the session cookie is absent / expired / invalid.
 * The FE treats `null` as "unauthenticated" and lets the axios interceptor
 * trigger the BFF login redirect.
 */
export interface SessionResponse {
  user: AuthUser | null;
}

/**
 * Response shape of `GET /auth/csrf`.
 *
 * BE sets the `XSRF-TOKEN` cookie via `Set-Cookie` (HttpOnly=false) so the
 * FE can read it via `document.cookie` and inject the `X-CSRF-Token` header
 * on subsequent non-GET requests (double-submit pattern, plan2 §12.3).
 */
export interface CsrfTokenResponse {
  csrfToken: string;
}
