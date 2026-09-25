# AUTH-21 — FE Vue router guards + auth pages (LoginRedirect + Callback + Forbidden + 429)

> **Task ID**: AUTH-21
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-20
> **Estimated effort**: M (~2-3 jam)
> **Plan reference**: Section 11.5 (Route guard), Section 11.2 (Struktur folder + views), Section 11.3 (Aturan — 401/403/429 redirect)

---

## Goal

Implementasi router guards + 4 view pages untuk FE Vue:
1. `router/guards.ts` — `beforeEach` guard: skip public routes, fetch session bila belum, redirect to `/auth/login` bila not authenticated, check `meta.menu` for menu access (redirect ke `/forbidden` bila denied).
2. `views/LoginRedirect.vue` — page yang langsung redirect ke BE `/auth/login` (untuk deep-link ke protected route sebelum login).
3. `views/Callback.vue` — page yang handle post-OAuth redirect (BE sudah set cookie `sid` + redirect ke `/`, FE hanya fetch session).
4. `views/Forbidden.vue` — 403 error page (PrimeVue card dengan message + link ke dashboard).
5. `views/TooManyRequests.vue` — 429 error page (show `Retry-After` countdown bila tersedia).
6. `router/index.ts` update — tambah route baru + `meta.public` + `meta.menu`.

## Scope

**In scope**:
- `apps/frontend-vue/src/router/guards.ts` — `beforeEach` implementation per plan2 section 11.5:
  ```ts
  router.beforeEach(async (to) => {
    if (to.meta.public) return true;
    const auth = useAuthStore();
    if (!auth.user) await auth.fetchSession();
    if (!auth.user) {
      window.location.href = `${import.meta.env.VITE_API_URL}/auth/login`;
      return false;
    }
    if (to.meta.menu && !auth.hasMenu(to.meta.menu as string)) {
      return { name: 'forbidden' };
    }
    return true;
  });
  ```
- `apps/frontend-vue/src/views/LoginRedirect.vue`:
  - Page yang langsung `window.location.href = '${VITE_API_URL}/auth/login'` di `onMounted`.
  - Show "Redirecting to login..." spinner sebelum redirect (UX).
  - Pakai untuk route `/login` (FE) — user click "Login" button → push to `/login` → guard detect → page redirect ke BE.
- `apps/frontend-vue/src/views/Callback.vue`:
  - Page yang handle post-OAuth callback (BE redirect ke `/callback`).
  - Bukan OAuth callback handler — BE sudah handle `/auth/callback` (token exchange + set cookie). FE `/callback` hanya trigger `auth.fetchSession()` lalu redirect ke `next` route (atau `/`).
  - Bila session berhasil → redirect ke `next` atau `/`.
  - Bila session gagal → redirect ke `/login` (yang redirect ke BE `/auth/login`).
- `apps/frontend-vue/src/views/Forbidden.vue`:
  - 403 error page.
  - PrimeVue `Card` dengan:
    - Icon warning.
    - Title "Access Denied".
    - Message "You don't have permission to access this page."
    - Button "Back to Dashboard" → push `/` (kalau user authorized).
    - Button "Logout" → call `auth.logout()`.
  - Show `error.menuCodes` (required menu yang denied) bila tersedia dari route query.
- `apps/frontend-vue/src/views/TooManyRequests.vue`:
  - 429 error page.
  - PrimeVue `Card` dengan:
    - Icon timer.
    - Title "Too Many Requests".
    - Message "You've made too many requests. Please wait and try again."
    - Countdown timer (read `Retry-After` header dari route query, default 60s).
    - Button "Retry" (enabled setelah countdown selesai) → reload original route.
- `apps/frontend-vue/src/router/index.ts` — UPDATE:
  - Add routes:
    - `/login` → `LoginRedirect.vue` (meta: `{ public: true }`).
    - `/callback` → `Callback.vue` (meta: `{ public: true }`).
    - `/forbidden` → `Forbidden.vue` (meta: `{ public: true }`).
    - `/too-many-requests` → `TooManyRequests.vue` (meta: `{ public: true }`).
  - Update existing routes dengan `meta`:
    - `/` (Dashboard) → `meta: { menu: 'dashboard' }`.
    - `/payments` (List) → `meta: { menu: 'payment.read' }`.
    - `/payments/:id` (Detail) → `meta: { menu: 'payment.read' }`.
    - `/payments/create` → `meta: { menu: 'payment.write' }`.
    - `/payments/:id/retry` (button on detail) — `meta: { menu: 'payment.retry' }` (bila route).
    - `/admin/gateway-config` → `meta: { menu: 'payment.admin' }`.
- `apps/frontend-vue/src/main.ts` — UPDATE: register `guards.ts` di router (atau import di router/index.ts).
- PrimeVue components install (bila belum): `Card`, `Button`, `ProgressSpinner`.
- Styling — minimal CSS untuk error pages (PrimeVue theme handle).

**Out of scope**:
- OAuth callback URL parsing di FE (BE `/auth/callback` sudah handle, FE `/callback` hanya trigger fetch session).
- Generic error page (500, 503) → di luar scope Plan2.
- Retry logic untuk 429 (auto-retry setelah Retry-After) → manual retry button cukup.
- Persist last route sebelum 401 → opsional, di luar scope (bisa pakai query `?next=`).

## Files to create/modify

- `apps/frontend-vue/src/router/guards.ts` — NEW
- `apps/frontend-vue/src/router/index.ts` — UPDATE: add routes + meta + import guards
- `apps/frontend-vue/src/views/LoginRedirect.vue` — NEW
- `apps/frontend-vue/src/views/Callback.vue` — NEW
- `apps/frontend-vue/src/views/Forbidden.vue` — NEW
- `apps/frontend-vue/src/views/TooManyRequests.vue` — NEW
- `apps/frontend-vue/src/main.ts` — UPDATE: register router + guards
- `apps/frontend-vue/src/components/__tests__/*.spec.ts` — NEW (optional Vitest for views)

## Implementation steps

1. **`router/guards.ts`** — per plan2 section 11.5:
   ```ts
   import { useAuthStore } from '../stores/auth.store';

   export function setupRouterGuards(router: any) {
     router.beforeEach(async (to: any) => {
       // Public routes — skip guard
       if (to.meta.public) return true;

       const auth = useAuthStore();

       // Fetch session bila belum loaded
       if (!auth.user && !auth.loading) {
         await auth.fetchSession();
       }

       // Not authenticated → redirect ke BE /auth/login
       if (!auth.user) {
         window.location.href = `${import.meta.env.VITE_API_URL}/auth/login`;
         return false;
       }

       // Menu access check
       if (to.meta.menu && !auth.hasMenu(to.meta.menu as string)) {
         return { name: 'forbidden', query: { from: to.fullPath, menu: to.meta.menu } };
       }

       return true;
     });
   }
   ```

2. **`router/index.ts`** — full router config:
   ```ts
   import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
   import { setupRouterGuards } from './guards';

   const routes: RouteRecordRaw[] = [
     {
       path: '/login',
       name: 'login',
       component: () => import('../views/LoginRedirect.vue'),
       meta: { public: true },
     },
     {
       path: '/callback',
       name: 'callback',
       component: () => import('../views/Callback.vue'),
       meta: { public: true },
     },
     {
       path: '/forbidden',
       name: 'forbidden',
       component: () => import('../views/Forbidden.vue'),
       meta: { public: true },
     },
     {
       path: '/too-many-requests',
       name: 'too-many-requests',
       component: () => import('../views/TooManyRequests.vue'),
       meta: { public: true },
     },
     {
       path: '/',
       name: 'dashboard',
       component: () => import('../views/Dashboard.vue'),
       meta: { menu: 'dashboard' },
     },
     {
       path: '/payments',
       name: 'payments-list',
       component: () => import('../views/PaymentsList.vue'),
       meta: { menu: 'payment.read' },
     },
     {
       path: '/payments/create',
       name: 'payments-create',
       component: () => import('../views/PaymentForm.vue'),
       meta: { menu: 'payment.write' },
     },
     {
       path: '/payments/:id',
       name: 'payments-detail',
       component: () => import('../views/PaymentDetail.vue'),
       meta: { menu: 'payment.read' },
     },
     {
       path: '/admin/gateway-config',
       name: 'gateway-config',
       component: () => import('../views/GatewayConfig.vue'),
       meta: { menu: 'payment.admin' },
     },
   ];

   const router = createRouter({
     history: createWebHistory(),
     routes,
   });

   setupRouterGuards(router);

   export default router;
   ```

3. **`views/LoginRedirect.vue`**:
   ```vue
   <template>
     <div class="login-redirect">
       <ProgressSpinner />
       <p>Redirecting to login...</p>
     </div>
   </template>

   <script setup lang="ts">
   import { onMounted } from 'vue';
   import ProgressSpinner from 'primevue/progressspinner';

   onMounted(() => {
     // Small delay supaya spinner visible (UX)
     setTimeout(() => {
       window.location.href = `${import.meta.env.VITE_API_URL}/auth/login`;
     }, 300);
   });
   </script>

   <style scoped>
   .login-redirect {
     display: flex;
     flex-direction: column;
     align-items: center;
     justify-content: center;
     min-height: 50vh;
     gap: 1rem;
   }
   </style>
   ```

4. **`views/Callback.vue`**:
   ```vue
   <template>
     <div class="callback">
       <ProgressSpinner v-if="loading" />
       <p v-if="loading">Completing login...</p>
       <p v-else-if="error" class="error">{{ error }}</p>
     </div>
   </template>

   <script setup lang="ts">
   import { ref, onMounted } from 'vue';
   import { useRouter, useRoute } from 'vue-router';
   import { useAuthStore } from '../stores/auth.store';
   import ProgressSpinner from 'primevue/progressspinner';

   const router = useRouter();
   const route = useRoute();
   const auth = useAuthStore();
   const loading = ref(true);
   const error = ref<string | null>(null);

   onMounted(async () => {
     try {
       await auth.fetchSession();
       if (!auth.user) {
         error.value = 'Login failed. Session not established.';
         setTimeout(() => router.push('/login'), 2000);
         return;
       }
       const next = (route.query.next as string) || '/';
       router.push(next);
     } catch (err: any) {
       error.value = err.message ?? 'Login failed.';
       setTimeout(() => router.push('/login'), 2000);
     } finally {
       loading.value = false;
     }
   });
   </script>

   <style scoped>
   .callback {
     display: flex;
     flex-direction: column;
     align-items: center;
     justify-content: center;
     min-height: 50vh;
     gap: 1rem;
   }
   .error { color: #dc2626; }
   </style>
   ```

5. **`views/Forbidden.vue`**:
   ```vue
   <template>
     <div class="forbidden-page">
       <Card>
         <template #title>
           <div class="header">
             <i class="pi pi-exclamation-triangle" />
             <span>Access Denied</span>
           </div>
         </template>
         <template #content>
           <p>You don't have permission to access this page.</p>
           <div v-if="menuCodes" class="detail">
             <small>Required permission: <code>{{ menuCodes }}</code></small>
           </div>
           <div v-if="from" class="detail">
             <small>Attempted to access: <code>{{ from }}</code></small>
           </div>
           <div class="actions">
             <Button label="Back to Dashboard" icon="pi pi-home" @click="goDashboard" />
             <Button label="Logout" icon="pi pi-sign-out" severity="secondary" @click="logout" />
           </div>
         </template>
       </Card>
     </div>
   </template>

   <script setup lang="ts">
   import { useRoute, useRouter } from 'vue-router';
   import { useAuthStore } from '../stores/auth.store';
   import Card from 'primevue/card';
   import Button from 'primevue/button';

   const route = useRoute();
   const router = useRouter();
   const auth = useAuthStore();

   const from = route.query.from as string | undefined;
   const menuCodes = route.query.menu as string | undefined;

   function goDashboard() {
     router.push('/');
   }

   async function logout() {
     await auth.logout();
   }
   </script>

   <style scoped>
   .forbidden-page {
     display: flex;
     justify-content: center;
     align-items: center;
     min-height: 70vh;
     padding: 2rem;
   }
   .header {
     display: flex;
     align-items: center;
     gap: 0.5rem;
   }
   .header i { color: #dc2626; }
   .detail { margin-top: 0.5rem; }
   .actions { display: flex; gap: 0.5rem; margin-top: 1rem; }
   </style>
   ```

6. **`views/TooManyRequests.vue`**:
   ```vue
   <template>
     <div class="too-many-requests-page">
       <Card>
         <template #title>
           <div class="header">
             <i class="pi pi-clock" />
             <span>Too Many Requests</span>
           </div>
         </template>
         <template #content>
           <p>You've made too many requests. Please wait and try again.</p>
           <div class="countdown">
             <small v-if="retryAfterSec > 0">Retry in {{ retryAfterSec }} seconds...</small>
             <small v-else>You can retry now.</small>
           </div>
           <div class="actions">
             <Button
               label="Retry"
               icon="pi pi-refresh"
               :disabled="retryAfterSec > 0"
               @click="retry"
             />
             <Button label="Back to Dashboard" icon="pi pi-home" severity="secondary" @click="goDashboard" />
           </div>
         </template>
       </Card>
     </div>
   </template>

   <script setup lang="ts">
   import { ref, onMounted, onUnmounted } from 'vue';
   import { useRoute, useRouter } from 'vue-router';
   import Card from 'primevue/card';
   import Button from 'primevue/button';

   const route = useRoute();
   const router = useRouter();

   const retryAfterSec = ref<number>(0);
   const from = (route.query.from as string) || '/';
   const retryHeader = parseInt((route.query.retryAfter as string) ?? '60', 10);

   let timer: ReturnType<typeof setInterval>;

   onMounted(() => {
     retryAfterSec.value = isNaN(retryHeader) ? 60 : retryHeader;
     timer = setInterval(() => {
       if (retryAfterSec.value > 0) retryAfterSec.value--;
       else clearInterval(timer);
     }, 1000);
   });

   onUnmounted(() => clearInterval(timer));

   function retry() {
     router.push(from);
   }
   function goDashboard() {
     router.push('/');
   }
   </script>

   <style scoped>
   .too-many-requests-page {
     display: flex;
     justify-content: center;
     align-items: center;
     min-height: 70vh;
     padding: 2rem;
   }
   .header {
     display: flex;
     align-items: center;
     gap: 0.5rem;
   }
   .header i { color: #f59e0b; }
   .countdown { margin: 1rem 0; }
   .actions { display: flex; gap: 0.5rem; }
   </style>
   ```

7. **Update `axios.ts`** (di AUTH-20) supaya pass `Retry-After` header ke router:
   ```ts
   api.interceptors.response.use(
     (response) => response,
     (error: AxiosError) => {
       const status = error.response?.status;
       if (status === 401) {
         // ... existing
       } else if (status === 403) {
         router.push({ name: 'forbidden', query: { from: error.config?.url } });
       } else if (status === 429) {
         const retryAfter = error.response?.headers?.['retry-after'] ?? '60';
         router.push({
           name: 'too-many-requests',
           query: { from: error.config?.url, retryAfter },
         });
       }
       return Promise.reject(error);
     },
   );
   ```

8. **Verify**:
   - Browser: `http://localhost:5173/payments` (not logged in) → guard fetch session → 401 → redirect ke BE `/auth/login` → OAuth flow → callback → FE `/` (dashboard).
   - Browser: `http://localhost:5173/forbidden` (manual) → Forbidden page render.
   - Browser: `http://localhost:5173/too-many-requests` (manual) → TooManyRequests page render + countdown.

## Acceptance criteria

- [ ] `setupRouterGuards(router)` register `beforeEach` di router.
- [ ] Guard logic per plan2 section 11.5:
  - `to.meta.public === true` → allow.
  - `!auth.user` → call `auth.fetchSession()` (bila not loading).
  - Setelah fetch masih `!auth.user` → `window.location.href = '${VITE_API_URL}/auth/login'` → return false.
  - `to.meta.menu` set + `!auth.hasMenu(menu)` → redirect ke `/forbidden` dengan query `{ from, menu }`.
  - Else → allow.
- [ ] 4 new routes added: `/login`, `/callback`, `/forbidden`, `/too-many-requests` (all `meta: { public: true }`).
- [ ] Existing routes have `meta.menu` per plan2 section 6.2:
  - `/` (Dashboard) → `meta.menu = 'dashboard'`.
  - `/payments` → `meta.menu = 'payment.read'`.
  - `/payments/create` → `meta.menu = 'payment.write'`.
  - `/payments/:id` → `meta.menu = 'payment.read'`.
  - `/admin/gateway-config` → `meta.menu = 'payment.admin'`.
- [ ] `LoginRedirect.vue` — `onMounted` redirect to `${VITE_API_URL}/auth/login` after 300ms (UX spinner).
- [ ] `Callback.vue` — `onMounted` call `auth.fetchSession()`, redirect ke `next` query atau `/`. Bila gagal → redirect ke `/login`.
- [ ] `Forbidden.vue` — PrimeVue Card dengan "Access Denied" message + buttons (Dashboard + Logout). Show `menu` + `from` dari route query.
- [ ] `TooManyRequests.vue` — PrimeVue Card dengan "Too Many Requests" message + countdown timer (read `retryAfter` query, default 60s). Button "Retry" disabled sampai countdown selesai.
- [ ] Axios 403 → push ke `/forbidden` dengan query `{ from: error.config.url }`.
- [ ] Axios 429 → push ke `/too-many-requests` dengan query `{ from, retryAfter }` (from `Retry-After` header).
- [ ] `pnpm --filter frontend-vue typecheck` + `lint` lulus.
- [ ] Manual verify: deep-link ke `/payments` (not logged in) → redirect to BE `/auth/login` → callback → back to `/payments`.
- [ ] Manual verify: user tanpa permission `payment.admin` akses `/admin/gateway-config` → redirect to `/forbidden` dengan menu query `payment.admin`.

## Useful commands

```bash
# Install PrimeVue components (bila belum)
cd /home/z/my-project/retry-failure && pnpm --filter frontend-vue add primevue @primevue/themes primeicons

# Typecheck + lint
cd /home/z/my-project/retry-failure && pnpm --filter frontend-vue typecheck
cd /home/z/my-project/retry-failure && pnpm --filter frontend-vue lint

# Run FE Vue dev (Vite)
cd /home/z/my-project/retry-failure && pnpm --filter payment-api start:dev &
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock start:dev &
cd /home/z/my-project/retry-failure && pnpm --filter frontend-vue dev

# Manual test scenarios:
# 1. Open http://localhost:5173/payments (not logged in)
#    Expected: redirect to BE /auth/login → OAuth flow → back to /payments (or /)
# 2. Login as budi_santoso (HRD only — permissionCodes=['dashboard','payment.read','payment.write'])
# 3. Navigate to /admin/gateway-config
#    Expected: redirect to /forbidden?from=/admin/gateway-config&menu=payment.admin
# 4. Click "Logout" → redirect to /auth/login (BE)
# 5. Trigger 429: spam refresh button 11+ times in 1 min → expect redirect to /too-many-requests
# 6. Click "Retry" after countdown → return to original route

# Inspect Vue router state in browser DevTools:
# Vue DevTools > Router > Routes
# Verify meta.public + meta.menu per route.

# Run unit tests (bila ditulis)
cd /home/z/my-project/retry-failure && pnpm --filter frontend-vue test -- --run
```

## Notes

- **Plan2 section 11.5 route guard** — exact code dari plan:
  ```ts
  router.beforeEach(async (to) => {
    if (to.meta.public) return true;
    const auth = useAuthStore();
    if (!auth.user) await auth.fetchSession();
    if (!auth.user) {
      window.location.href = '/auth/login';
      return false;
    }
    if (to.meta.menu && !auth.hasMenu(to.meta.menu)) {
      return { name: 'forbidden' };
    }
    return true;
  });
  ```
- **`window.location.href = '/auth/login'`** di plan asumsi FE + BE same-origin (via proxy). Bila beda origin → `${VITE_API_URL}/auth/login`. Disarankan pakai proxy (AUTH-20 Vite config) supaya same-origin.
- **`/login` (FE) vs `/auth/login` (BE)**:
  - FE `/login` route → render `LoginRedirect.vue` yang redirect ke BE `/auth/login`.
  - Karena guard akan redirect window to BE untuk route non-public bila not auth, `LoginRedirect.vue` jarang dipakai. Tapi berguna untuk "Login" button di header (UX — user click button → navigate to `/login` → page render spinner → window redirect).
- **`/callback` (FE) vs `/auth/callback` (BE)**:
  - BE `/auth/callback` handle OAuth code exchange + set cookie `sid` + redirect 302 ke `/callback` (FE).
  - FE `/callback` hanya trigger `auth.fetchSession()` lalu redirect ke `next` route.
  - `next` route bisa di-set via state cookie (`oauth_next`) di BE `/auth/login` — bila user deep-link ke `/payments` sebelum login, BE remember `next=/payments` di cookie → redirect ke `/callback?next=/payments` setelah OAuth.
- **401 handler di axios** (AUTH-20) sudah redirect ke BE `/auth/login`. Guard `beforeEach` juga handle 401 (bila user tidak ter-auth). Tidak konflik — keduanya redirect ke tempat sama.
- **429 retry-after**: throttler v5 set `Retry-After` header di response 429 (seconds). FE axios interceptor baca + pass ke route query. `TooManyRequests.vue` countdown dari angka itu.
- **`from` query** supaya user bisa kembali ke route original setelah login/callback. Bila `from` kosong → fallback ke `/`.
- **PrimeVue theme** — pakai `Aura` preset (default). Component `Card`, `Button`, `ProgressSpinner` sudah tersedia.
- Setelah task ini selesai, FE Vue auth flow lengkap. Selanjutnya: AUTH-22 (menu component), AUTH-23 (Docker), AUTH-24-26 (tests).
