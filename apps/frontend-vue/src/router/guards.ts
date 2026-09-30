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
    // bootstrap also calls `fetchSession()`, so we may arrive here while
    // `auth.loading === true` (in-flight XHR). In that case we must WAIT
    // for the in-flight fetchSession to complete before checking `auth.user`
    // — otherwise we'd redirect to the BFF login even though the session
    // is about to be loaded, causing an infinite redirect loop.
    if (!auth.user && !auth.loading) {
      console.debug('[guard] no user loaded, fetchSession start for path:', to.path);
      await auth.fetchSession();
    } else if (!auth.user && auth.loading) {
      console.debug('[guard] fetchSession in-flight (main.ts bootstrap), waiting for completion');
      // Wait for the in-flight fetchSession to complete by polling
      // `auth.loading`. Pinia reactive updates will flip `loading` to false
      // when the XHR resolves. Using a polling loop (vs `watch`) keeps
      // this file dependency-free — no Vue `watch` import needed.
      const startTime = Date.now();
      const BOOTSTRAP_TIMEOUT_MS = 10_000; // 10s — XHR should complete in <2s
      while (auth.loading && Date.now() - startTime < BOOTSTRAP_TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (auth.loading) {
        console.warn('[guard] fetchSession still loading after 10s timeout, proceed with null user');
      } else {
        console.debug('[guard] in-flight fetchSession completed, user loaded:', auth.user !== null);
      }
    }

    if (!auth.user) {
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
