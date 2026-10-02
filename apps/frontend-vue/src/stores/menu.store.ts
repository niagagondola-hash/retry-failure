// Plan reference: PLAN2 Section 6.1 (Menu code), Section 6.2 (Mapping endpoint →
// menu), Section 11.2 (Struktur folder — stores/menu.store.ts), Section 11.3.
// Task: AUTH-22 — FE Vue menu component.

/**
 * Single responsibility: own the static menu config + filter it by the current
 * user's permissions. Permission checks delegate to `useAuthStore().hasMenu`
 * (AUTH-20) — no duplication of the wildcard / superadmin bypass logic.
 *
 * The store also exposes a PrimeVue-shaped `menuModel` (with `command` +
 * active-route `class`) so `AppMenu.vue` can bind it directly to `<Menubar>`.
 * The active-route check reads `router.currentRoute.value.path` — a Vue ref,
 * so the computed re-evaluates automatically when navigation occurs.
 */

import { computed } from 'vue';
import { defineStore } from 'pinia';
import { useRouter } from 'vue-router';
import type { MenuItem as PrimeVueMenuItem } from 'primevue/menuitem';
import { MENU_ITEMS, type MenuItem } from '../types/menu';
import { useAuthStore } from './auth.store';

/** CSS class applied to the menu entry matching the current route. */
const ACTIVE_MENU_CLASS = 'menu-item-active';

/** Home path — exact match only (avoid every `/payments` matching `/`). */
const HOME_PATH = '/dashboard';

export const useMenuStore = defineStore('menu', () => {
  const auth = useAuthStore();
  // `useRouter()` is safe in a Pinia setup store: setup stores are Vue
  // composables that run inside a component's setup context on first use,
  // so the router inject resolves correctly. (In unit tests you'd mock it,
  // but vitest is not installed in this workspace — see worklog AUTH-22.)
  const router = useRouter();

  /**
   * Filter `MENU_ITEMS` by the current user's permissions then sort by
   * `order`. Re-evaluates automatically when `auth.user` changes (e.g.,
   * after `fetchSession()` resolves or `logout()` clears state).
   *
   * Returns an empty array when the user is unauthenticated — the component
   * still renders the brand + login button in that case (no crash).
   */
  const visibleMenus = computed<MenuItem[]>(() =>
    MENU_ITEMS.filter((item) => auth.hasMenu(item.code)).sort(
      (left, right) => left.order - right.order,
    ),
  );

  /**
   * Convert `visibleMenus` to the PrimeVue `MenuItem` shape consumed by
   * `<Menubar>`. Each entry has:
   *   - `label` + `icon` — display.
   *   - `to` — Vue Router path (informational; PrimeVue's router integration
   *     is via `command` below).
   *   - `command` — closure that calls `router.push(to)` on click.
   *   - `class` — `'menu-item-active'` when the entry matches the current
   *     route, empty string otherwise. Reactive on `router.currentRoute`.
   */
  const menuModel = computed<PrimeVueMenuItem[]>(() =>
    visibleMenus.value.map((item) => ({
      label: item.label,
      icon: item.icon,
      to: item.to,
      command: () => {
        router.push(item.to);
      },
      class: isActiveRoute(item.to) ? ACTIVE_MENU_CLASS : '',
    })),
  );

  /**
   * Decide whether `path` should be highlighted as active.
   *
   * The home path (`/`) is matched exactly so it doesn't shadow every
   * `/payments`/`/admin` route. All other paths use prefix match so that
   * nested routes (e.g., `/payments/123`) highlight their parent menu entry.
   */
  function isActiveRoute(path: string): boolean {
    const currentPath = router.currentRoute.value.path;
    if (path === HOME_PATH) return currentPath === HOME_PATH;
    return currentPath.startsWith(path);
  }

  return { visibleMenus, menuModel, isActiveRoute };
});
