// Plan reference: PLAN2 Section 11.5 (Route guard).
// Task: AUTH-21 — FE Vue router guards + auth pages.
//
// Single responsibility: register the global `beforeEach` navigation guard
// that (1) lets public routes through, (2) bootstraps the auth session on
// first protected navigation, (3) bounces unauthenticated users to the BFF
// login page (full-page redirect so the BFF can run the OAuth/PKCE flow),
// and (4) enforces per-route menu permission via `useAuthStore.hasMenu`.

import type { Router } from 'vue-router';
import { useAuthStore } from '../stores/auth.store';

// Per-route metadata consumed by this guard (module augmentation).
// `public` skips session bootstrap + login redirect (auth-flow pages).
// `menu` is the permission code checked via `useAuthStore.hasMenu(code)`.
declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean;
    menu?: string;
  }
}

/** BFF login URL — full-page redirect target when the session is missing. */
const BFF_LOGIN_HREF: string = `${import.meta.env.VITE_API_URL ?? 'http://localhost:3001'}/auth/login`;

/**
 * Register the global `beforeEach` navigation guard implementing plan2 §11.5.
 *
 * Steps (short-circuits on first failure):
 *   1. `to.meta.public === true` → allow (login/callback/forbidden/429 pages).
 *   2. If no user yet AND a fetch isn't already in flight → `await auth.fetchSession()`.
 *      The `loading` guard prevents duplicate parallel fetches when multiple
 *      protected navigations queue before the first bootstrap resolves.
 *   3. Still no user after fetch → full-page redirect to BFF `/auth/login`
 *      (cookie-based session means the SPA cannot log the user in itself).
 *   4. `to.meta.menu` set + `!auth.hasMenu(menu)` → redirect to `/forbidden`
 *      carrying `from` + `menu` query params so the page can explain the
 *      denial. Superadmins + wildcard permission bypass this check (see
 *      `useAuthStore.hasMenu`).
 *   5. Otherwise → allow.
 *
 * @param router - Vue Router instance to attach the guard to.
 */
export function setupRouterGuards(router: Router): void {
  router.beforeEach(async (to) => {
    if (to.meta.public === true) {
      console.debug('[guard] public route, skip auth check:', to.path);
      return true;
    }

    const auth = useAuthStore();

    // Bootstrap session on first protected navigation. The `main.ts`
    // bootstrap also calls `fetchSession()`, but in dev (HMR) or on deep
    // links the store may be empty when this guard runs.
    if (!auth.isAuthenticated) {
      console.debug('[guard] no user loaded, fetchSession start for path:', to.path);
      await auth.fetchSession();
    }

    if (!auth.isAuthenticated) {
      // Cookie session missing — the SPA cannot log the user in itself.
      // Full-page navigation lets the BFF start the OAuth/PKCE flow.
      console.warn('[guard] still no user after fetchSession, redirect to BFF login:', BFF_LOGIN_HREF);
      window.location.href = BFF_LOGIN_HREF;
      return false;
    }

    const requiredMenu = to.meta.menu;
    if (typeof requiredMenu === 'string' && requiredMenu.length > 0 && !auth.hasMenu(requiredMenu)) {
      console.warn('[guard] permission denied for menu:', requiredMenu, 'path:', to.path);
      return {
        name: 'forbidden',
        query: { from: to.fullPath, menu: requiredMenu },
      };
    }

    console.debug('[guard] access granted, path:', to.path, 'menu:', requiredMenu ?? '(none)');
    return true;
  });
}
