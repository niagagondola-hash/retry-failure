# AUTH-22 — FE Vue menu component (dynamic menu from permissionCodes)

> **Task ID**: AUTH-22
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-20
> **Estimated effort**: S (~1-1.5 jam)
> **Plan reference**: Section 11.2 (Struktur folder — components/AppMenu.vue), Section 6.1 (Menu code), Section 6.2 (Mapping endpoint → menu), Section 11.3 (Aturan)

---

## Goal

Implementasi dynamic menu component (`AppMenu.vue`) di FE Vue yang render menu items berdasarkan `auth.permissionCodes`. Menu item hanya muncul bila user punya menu code yang sesuai. Plus Pinia `menu.store.ts` untuk config menu + filter by permission.

## Scope

**In scope**:
- `apps/frontend-vue/src/stores/menu.store.ts` — menu config:
  - Static menu config (array of menu items):
    ```ts
    interface MenuItem {
      code: string;          // 'dashboard' | 'payment.read' | 'payment.write' | 'payment.retry' | 'payment.admin'
      label: string;         // 'Dashboard' | 'Lihat Payment' | 'Buat Payment' | ...
      to: string;            // route path: '/' | '/payments' | ...
      icon?: string;         // PrimeIcons: 'pi pi-home' | 'pi pi-list' | ...
      order: number;         // sort order
      children?: MenuItem[]; // nested menu (optional, for future)
    }
    ```
  - Menu items per plan2 section 6.1:
    - `dashboard` → '/' → 'pi pi-home' → order 1.
    - `payment.read` → '/payments' → 'pi pi-list' → order 2.
    - `payment.write` → '/payments/create' → 'pi pi-plus' → order 3.
    - `payment.retry` → (no direct route — button on detail page) → order 4.
    - `payment.admin` → '/admin/gateway-config' → 'pi pi-cog' → order 5.
  - Getter `visibleMenus` — filter menu by `auth.hasMenu(code)`:
    - `superadmin` → semua menu visible.
    - User dengan `permissionCodes=['dashboard','payment.read']` → hanya Dashboard + Lihat Payment.
  - Action `refresh()` — re-evaluate filter (called bila `auth.fetchSession()` sukses).
- `apps/frontend-vue/src/components/AppMenu.vue` — PrimeVue MenuModel implementation:
  - Render `<Menu>` atau `<Menubar>` dari PrimeVue dengan model dari `menuStore.visibleMenus`.
  - Each menu item:
    - `label` (display text).
    - `icon` (PrimeIcons).
    - `to` (Vue Router path — auto-active saat route match).
  - Click → navigate via `router.push(to)`.
  - Watch `auth.user` — bila berubah (e.g., after fetchSession), re-render menu.
  - Show "Login" button bila `!auth.isAuthenticated`.
  - Show username + "Logout" button bila `auth.isAuthenticated`.
- Wire ke `App.vue` layout — render `<AppMenu />` di header (atau sidebar).
- Edge cases:
  - `payment.retry` tidak punya route sendiri — tetap muncul di menu sebagai label "Retry Payment" tapi redirect ke `/payments` (atau disabled — show only as info).
  - Nested menu (future — `children`) — skip untuk sekarang.
  - Empty menu (user tidak punya permission apapun selain dashboard) — show dashboard only + logout.
- Unit test (opsional, Vitest):
  - `menu.store.spec.ts` — `visibleMenus` filter logic.
  - `AppMenu.spec.ts` — render snapshot (shallow).

**Out of scope**:
- Nested menu (parent + children) — future enhancement, skip di Plan2.
- Menu customization per user (user favorites) — di luar scope.
- Mobile drawer menu (responsive) — bisa pakai PrimeVue `<Drawer>`, tapi layout di luar scope.
- Localization (i18n) — skip, hardcode Indonesian labels.
- Permission-based menu item styling (e.g., red icon for admin-only) — skip.

## Files to create/modify

- `apps/frontend-vue/src/stores/menu.store.ts` — NEW (Pinia store)
- `apps/frontend-vue/src/components/AppMenu.vue` — NEW (PrimeVue MenuModel)
- `apps/frontend-vue/src/types/menu.ts` — NEW (MenuItem interface)
- `apps/frontend-vue/src/App.vue` — UPDATE: import + render `<AppMenu />` di layout
- `apps/frontend-vue/src/stores/__tests__/menu.store.spec.ts` — NEW (Vitest)

## Implementation steps

1. **`types/menu.ts`**:
   ```ts
   export interface MenuItem {
     code: string;          // 'dashboard' | 'payment.read' | ...
     label: string;         // 'Dashboard' | 'Lihat Payment' | ...
     to: string;            // route path
     icon?: string;         // PrimeIcons class
     order: number;
     children?: MenuItem[];
   }

   // Static menu config (per plan2 section 6.1)
   export const MENU_ITEMS: MenuItem[] = [
     { code: 'dashboard',     label: 'Dashboard',         to: '/',                       icon: 'pi pi-home',     order: 1 },
     { code: 'payment.read',   label: 'Lihat Payment',     to: '/payments',               icon: 'pi pi-list',     order: 2 },
     { code: 'payment.write',  label: 'Buat Payment',      to: '/payments/create',        icon: 'pi pi-plus',     order: 3 },
     { code: 'payment.retry',  label: 'Retry Payment',     to: '/payments',               icon: 'pi pi-refresh',  order: 4 }, // No direct route, redirect to list
     { code: 'payment.admin',  label: 'Admin Payment',     to: '/admin/gateway-config',   icon: 'pi pi-cog',      order: 5 },
   ];
   ```

2. **`stores/menu.store.ts`** — Pinia store:
   ```ts
   import { defineStore } from 'pinia';
   import { computed } from 'vue';
   import { MENU_ITEMS, MenuItem } from '../types/menu';
   import { useAuthStore } from './auth.store';

   export const useMenuStore = defineStore('menu', () => {
     const auth = useAuthStore();

     // Filter menu items by user permission
     const visibleMenus = computed<MenuItem[]>(() => {
       const items = MENU_ITEMS
         .filter(item => auth.hasMenu(item.code))
         .sort((a, b) => a.order - b.order);
       return items;
     });

     // PrimeVue MenuModel format (for PrimeVue <Menu> component)
     const menuModel = computed(() => {
       return visibleMenus.value.map(item => ({
         label: item.label,
         icon: item.icon,
         to: item.to,
         // Auto-active state via Vue Router integration
       }));
     });

     return { visibleMenus, menuModel };
   });
   ```

3. **`components/AppMenu.vue`** — PrimeVue MenuModel implementation:
   ```vue
   <template>
     <div class="app-menu">
       <Menubar :model="menuItems">
         <template #start>
           <span class="brand">Payment System</span>
         </template>
         <template #end>
           <div v-if="auth.isAuthenticated" class="user-section">
             <span class="username">{{ auth.user?.username }}</span>
             <Button
               icon="pi pi-sign-out"
               label="Logout"
               severity="secondary"
               text
               @click="handleLogout"
             />
           </div>
           <Button
             v-else
             icon="pi pi-sign-in"
             label="Login"
             @click="handleLogin"
           />
         </template>
       </Menubar>
     </div>
   </template>

   <script setup lang="ts">
   import { computed } from 'vue';
   import { useRouter } from 'vue-router';
   import Menubar from 'primevue/menubar';
   import Button from 'primevue/button';
   import { useAuthStore } from '../stores/auth.store';
   import { useMenuStore } from '../stores/menu.store';

   const router = useRouter();
   const auth = useAuthStore();
   const menu = useMenuStore();

   const menuItems = computed(() => {
     return menu.visibleMenus.map(item => ({
       label: item.label,
       icon: item.icon,
       command: () => router.push(item.to),
       // Highlight active route
       class: isActive(item.to) ? 'menu-item-active' : '',
     }));
   });

   function isActive(path: string): boolean {
     const currentPath = router.currentRoute.value.path;
     if (path === '/') return currentPath === '/';
     return currentPath.startsWith(path);
   }

   function handleLogin() {
     router.push('/login');
   }

   async function handleLogout() {
     await auth.logout();
   }
   </script>

   <style scoped>
   .app-menu {
     border-bottom: 1px solid #e5e7eb;
     padding: 0 1rem;
   }
   .brand {
     font-weight: bold;
     font-size: 1.1rem;
     margin-right: 1rem;
   }
   .user-section {
     display: flex;
     align-items: center;
     gap: 0.5rem;
   }
   .username {
     font-weight: 500;
   }
   :deep(.menu-item-active) {
     background-color: #eff6ff;
     color: #2563eb;
   }
   </style>
   ```

4. **`App.vue`** — UPDATE to render `<AppMenu />`:
   ```vue
   <template>
     <AppMenu />
     <main class="main-content">
       <RouterView />
     </main>
   </template>

   <script setup lang="ts">
   import { RouterView } from 'vue-router';
   import AppMenu from './components/AppMenu.vue';
   </script>

   <style scoped>
   .main-content {
     padding: 1rem;
     max-width: 1200px;
     margin: 0 auto;
   }
   </style>
   ```

5. **Unit test `menu.store.spec.ts`**:
   - Test cases:
     - `visibleMenus` with `auth.user = null` → empty array.
     - `visibleMenus` with `auth.user.permissionCodes = ['dashboard', 'payment.read']` → 2 items: Dashboard + Lihat Payment.
     - `visibleMenus` with `auth.user.isSuperAdmin = true` → 5 items (all).
     - `visibleMenus` with `auth.user.permissionCodes = ['*']` → 5 items (wildcard).
     - `menuModel` format matches PrimeVue MenuModel (`{ label, icon, to }`).
     - Verify sort by `order` field.

## Acceptance criteria

- [ ] `MENU_ITEMS` static config berisi 5 items per plan2 section 6.1: `dashboard`, `payment.read`, `payment.write`, `payment.retry`, `payment.admin`.
- [ ] `useMenuStore` Pinia store dengan `visibleMenus` computed getter — filter by `auth.hasMenu(item.code)`.
- [ ] `menuModel` getter convert ke PrimeVue MenuModel format (`{ label, icon, to, command, class }`).
- [ ] `AppMenu.vue` render `<Menubar>` dari PrimeVue dengan menu items + user section.
- [ ] Menu items sort by `order` field (1-5).
- [ ] Menu item hanya visible bila `auth.hasMenu(item.code)` true (super admin atau wildcard `*` bypass).
- [ ] Click menu item → `router.push(item.to)`.
- [ ] Active route highlight (CSS class `menu-item-active`).
- [ ] User section: bila `auth.isAuthenticated` → show username + Logout button. Else → show Login button.
- [ ] Login button → `router.push('/login')` (FE LoginRedirect → BE).
- [ ] Logout button → `auth.logout()` (redirect ke BE `/auth/login`).
- [ ] `App.vue` render `<AppMenu />` di top + `<RouterView />` di main.
- [ ] `payment.retry` menu visible tapi redirect ke `/payments` (no direct route — info only).
- [ ] Empty menu (user hanya punya `dashboard`) → Dashboard + Login/Logout only.
- [ ] Unit test `menu.store.spec.ts` lulus.
- [ ] `pnpm --filter frontend-vue typecheck` + `lint` lulus.

## Useful commands

```bash
# Install PrimeVue Menubar component (bila belum)
cd /home/z/my-project/retry-failure && pnpm --filter frontend-vue add primevue @primevue/themes primeicons

# Typecheck + lint
cd /home/z/my-project/retry-failure && pnpm --filter frontend-vue typecheck
cd /home/z/my-project/retry-failure && pnpm --filter frontend-vue lint

# Run tests
cd /home/z/my-project/retry-failure && pnpm --filter frontend-vue test -- --run

# Dev mode
cd /home/z/my-project/retry-failure && pnpm --filter payment-api start:dev &
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock start:dev &
cd /home/z/my-project/retry-failure && pnpm --filter frontend-vue dev

# Manual verify:
# 1. Login as budi_santoso (HRD: permissionCodes=['dashboard','payment.read','payment.write'])
#    Expected menu: Dashboard, Lihat Payment, Buat Payment (3 items)
#    Missing: Retry Payment, Admin Payment
# 2. Switch role to Finance (permissionCodes=['dashboard','payment.read','payment.retry'])
#    Expected menu: Dashboard, Lihat Payment, Retry Payment (3 items)
#    Missing: Buat Payment, Admin Payment
# 3. Login as superadmin (isSuperAdmin=true)
#    Expected menu: all 5 items

# Inspect in Vue DevTools:
# - Pinia > auth store > user.permissionCodes
# - Pinia > menu store > visibleMenus (should match filtered list)
```

## Notes

- **Plan2 section 6.1 menu codes** (5 codes):
  | Code | Name | Order |
  |---|---|---|
  | `dashboard` | Dashboard | 1 |
  | `payment.read` | Lihat Payment | 2 |
  | `payment.write` | Buat Payment | 3 |
  | `payment.retry` | Retry Payment | 4 |
  | `payment.admin` | Admin Payment | 5 |
- **Filter logic**: `auth.hasMenu(code)` = `isSuperAdmin || permissionCodes.includes('*') || permissionCodes.includes(code)`. Sudah ada di AUTH-20.
- **PrimeVue `<Menubar>`** vs `<Menu>`:
  - `<Menubar>` horizontal — cocok untuk top header.
  - `<Menu>` vertical — cocok untuk sidebar.
  - Pilih `<Menubar>` (header layout) — UX lebih familiar.
- **Active route highlight**: cek `router.currentRoute.value.path` vs item `to`. Bila match → CSS class `menu-item-active`.
- **`payment.retry` no direct route**: di plan2 section 6.2, retry adalah `POST /payments/:id/retry` (action button di Payment Detail page). Tapi menu item tetap ada (info-only). Bila user click → redirect ke `/payments` (list). User pilih payment → click retry button.
- **Empty menu edge case**: user baru tanpa role apapun (hanya `dashboard`) → menu hanya Dashboard. Tetap bisa logout. Tidak crash.
- **Login button**: pakai `router.push('/login')` supaya `LoginRedirect.vue` render spinner + redirect ke BE. UX lebih baik dibanding langsung `window.location.href` (FE terasa seamless).
- **PrimeVue MenuModel**: format `{ label, icon, command, items, class, visible }`. `command` adalah callback saat click. Bisa pakai `to` (Vue Router integration) atau `command` (manual `router.push`).
- Setelah task ini selesai, FE Vue auth flow + menu lengkap. Selanjutnya: AUTH-23 (Docker), AUTH-24-26 (tests), AUTH-27 (contract), AUTH-28 (docs).
