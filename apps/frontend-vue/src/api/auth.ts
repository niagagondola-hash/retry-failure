// Plan reference: PLAN2 Section 11.3 (Aturan), Section 11.4 (Axios interceptor).
// Task: AUTH-20 — FE Vue auth flow.
//
// Thin wrapper over the auth-aware axios instance. Each method maps 1:1 to a
// BFF auth endpoint defined in AUTH-17.

import { apiClient } from './client';
import type { CsrfTokenResponse, SessionResponse } from '../types/auth';

/**
 * Auth API surface consumed by `useAuthStore`.
 *
 * All calls go through the shared axios instance (`./client.ts` `apiClient`)
 * which means:
 *   - `withCredentials: true` is set (cookie-based session).
 *   - CSRF header auto-attached for non-GET methods.
 *   - 401 (except on `/auth/session`) → full-page redirect to BFF login.
 *   - 403 → `router.push('/forbidden')`.
 *   - 429 → `router.push('/too-many-requests')`.
 */
export const authApi = {
  /**
   * Fetch the current session user.
   *
   * Returns `{ user: null }` when the session cookie is absent/expired — the
   * axios interceptor skips the 401 redirect for this path on purpose so the
   * store can populate `user = null` without bouncing the user to the BFF
   * login page during bootstrap.
   */
  async fetchSession(): Promise<SessionResponse> {
    const { data } = await apiClient.get<SessionResponse>('/auth/session');
    return data;
  },

  /**
   * Destroy the BFF session and clear cookies.
   *
   * Sends the CSRF header automatically (POST → interceptor). After this
   * resolves, the caller (`useAuthStore.logout`) clears local state and
   * bounces to the BFF login page so a fresh OAuth/PKCE flow starts.
   */
  async logout(): Promise<void> {
    await apiClient.post('/auth/logout');
  },

  /**
   * Force the BFF to (re-)issue the `XSRF-TOKEN` cookie.
   *
   * Mostly useful when the FE detects a stale CSRF cookie (e.g., after long
   * idle). The cookie is set via `Set-Cookie` by the BFF — the returned
   * `csrfToken` is informational and not strictly needed on the FE side.
   */
  async getCsrfToken(): Promise<CsrfTokenResponse> {
    const { data } = await apiClient.get<CsrfTokenResponse>('/auth/csrf');
    return data;
  },
};
