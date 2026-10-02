// Plan reference: PLAN2 Section 11.3 (Aturan), Section 11.4 (Axios interceptor).
// Task: AUTH-20 — FE Vue auth flow.
//
// Single responsibility: hold the authenticated user state + expose permission
// helpers used by UI guards (AUTH-21) and menu rendering (AUTH-22).

import { defineStore } from 'pinia';
import { authApi } from '../api/auth';
import type { AuthUser } from '../types/auth';

/** Wildcard permission code — grants every menu/route check. */
const WILDCARD_PERMISSION = '*';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    loading: false,
    error: null,
  }),

  getters: {
    /** True when a non-null user is present (does NOT validate the BE session). */
    isAuthenticated: (state): boolean => state.user !== null,

    /** Shortcut for `user?.isSuperAdmin ?? false` — bypasses all permission checks. */
    isSuperAdmin: (state): boolean => state.user?.isSuperAdmin ?? false,
  },

  actions: {
    /**
     * Check whether the current user is allowed to see a menu/route identified
     * by `code`. Returns true when ANY of these holds:
     *   1. `user.isSuperAdmin` — superadmins bypass all checks.
     *   2. `user.permissionCodes` includes the wildcard `'*'`.
     *   3. `user.permissionCodes` includes `code` verbatim.
     *
     * Returns false when no user is loaded (the SPA should redirect to login
     * before reaching a `hasMenu` check, but defensive false is safer than throw).
     */
    hasMenu(code: string): boolean {
      if (!this.user) return false;
      if (this.user.isSuperAdmin) return true;
      if (this.user.permissionCodes.includes(WILDCARD_PERMISSION)) return true;
      return this.user.permissionCodes.includes(code);
    },

    /**
     * OR-style permission check across multiple codes. Useful for routes that
     * accept any of several permission codes (e.g., `payments.write` OR `payments.admin`).
     */
    hasAnyMenu(codes: string[]): boolean {
      return codes.some((code) => this.hasMenu(code));
    },

    /**
     * Bootstrap the store from `GET /auth/session`.
     *
     * On 401 the axios interceptor is configured to skip the redirect for this
     * path (see `api/client.ts` `apiClient` interceptor) so we land here, set `user = null`, and let the
     * SPA render its public shell. On any other error we record `error` so the
     * UI can show a retry affordance.
     */
    async fetchSession(): Promise<void> {
      console.debug('[auth] fetchSession start');
      this.loading = true;
      this.error = null;
      try {
        const { user } = await authApi.fetchSession();
        this.user = user;
        if (user) {
          console.info('[auth] session loaded:', user.username, '(userId:', user.userId + ')');
        } else {
          console.debug('[auth] no session, user = null');
        }
      } catch (err: unknown) {
        const status = extractStatus(err);
        if (status !== 401) {
          this.error = extractMessage(err, 'Failed to fetch session');
          console.error('[auth] fetchSession error (status:', status + '):', this.error);
        }
        this.user = null;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Log out via RP-initiated logout (OIDC Session Management 1.0 — AUTH-09a).
     *
     * Flow:
     *   1. Call BFF POST /auth/logout → BFF revokes refresh token + generates
     *      endSessionUrl (auth-mock /oauth/logout?id_token_hint=...&post_logout_redirect_uri=...&state=...).
     *   2. Clear local state (user=null).
     *   3. Browser redirect to endSessionUrl → auth-mock deletes auth_sid session
     *      + clears cookie + redirects to FE landing page.
     *
     * If BFF logout fails, clear local state + redirect to landing page anyway
     * (best-effort) — user is effectively logged out from FE perspective.
     */
    async logout(): Promise<void> {
      try {
        const { endSessionUrl } = await authApi.logout();
        this.clear();
        // Browser redirect to auth-mock /oauth/logout — auth-mock will
        // delete auth_sid session + clear cookie + redirect to FE landing.
        window.location.href = endSessionUrl;
      } catch (err: unknown) {
        console.error('[auth] logout failed:', extractMessage(err, 'unknown error'));
        // Best-effort: clear local state + redirect to landing page
        this.clear();
        window.location.href = '/';
      }
    },

    /** Reset all state — used after logout and in unit tests. */
    clear(): void {
      this.user = null;
      this.loading = false;
      this.error = null;
    },
  },
});

/** Extract `error.response.status` from an axios-shaped error, or `undefined`. */
function extractStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'response' in err) {
    const response = (err as { response?: { status?: number } }).response;
    return response?.status;
  }
  return undefined;
}

/** Best-effort error message extraction — falls back to `fallback`. */
function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return fallback;
}
