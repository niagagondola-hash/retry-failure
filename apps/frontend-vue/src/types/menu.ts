// Plan reference: PLAN2 Section 6.1 (Menu code), Section 11.2 (Struktur folder —
// components/AppMenu.vue + types/menu.ts), Section 11.3 (Aturan).
// Task: AUTH-22 — FE Vue menu component (dynamic menu from permissionCodes).

/**
 * Single source of truth for the static menu configuration plus the
 * `MenuItem` shape consumed by `useMenuStore` and `AppMenu.vue`.
 *
 * The store owns filtering (`visibleMenus`) and PrimeVue shape conversion
 * (`menuModel`); the component owns rendering + click handling. Permission
 * checks reuse `useAuthStore().hasMenu(code)` (AUTH-20) — no duplication.
 */

/**
 * A single menu entry rendered in the top bar.
 *
 * `code` matches the permissionCodes returned by `GET /auth/session` (BE
 * contract per AUTH-17). The auth store's `hasMenu(code)` is the single
 * authority on whether a code is granted (superadmin bypass + `*` wildcard
 * are handled there).
 */
export interface MenuItem {
  /** Permission code — must match a `permissionCodes` entry (or `*` / superadmin). */
  code: string;
  /** Display label (Indonesian, per plan2 §6.1). */
  label: string;
  /** Vue Router path navigated to on click. */
  to: string;
  /** PrimeIcons class (e.g. `'pi pi-home'`). */
  icon?: string;
  /** Sort order — ascending. Lower comes first. */
  order: number;
  /** Optional nested menu (future enhancement — not used in plan2). */
  children?: MenuItem[];
}

/**
 * Static menu config per plan2 section 6.1.
 *
 * Order matches the spec (1..5). `payment.retry` has no dedicated route —
 * clicking it falls through to `/payments` (the list page hosts the retry
 * button on each row). See plan2 §6.2 (Mapping endpoint → menu).
 */
export const MENU_ITEMS: MenuItem[] = [
  {
    code: 'dashboard',
    label: 'Dashboard',
    to: '/dashboard',
    icon: 'pi pi-home',
    order: 1,
  },
  {
    code: 'payment.read',
    label: 'Lihat Payment',
    to: '/payments',
    icon: 'pi pi-list',
    order: 2,
  },
  {
    code: 'payment.write',
    label: 'Buat Payment',
    to: '/payments/create',
    icon: 'pi pi-plus',
    order: 3,
  },
  {
    code: 'payment.retry',
    label: 'Retry Payment',
    // No dedicated route — the retry action lives on the payment detail page.
    // The list page is the closest landing surface so the user can pick a row.
    to: '/payments',
    icon: 'pi pi-refresh',
    order: 4,
  },
  {
    code: 'payment.admin',
    label: 'Admin Payment',
    to: '/admin/gateway-config',
    icon: 'pi pi-cog',
    order: 5,
  },
];
