# AUTH-20 — FE Vue auth flow (axios interceptor + auth store + session fetch + CSRF)

> **Task ID**: AUTH-20
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-17
> **Estimated effort**: M (~2-3 jam)
> **Plan reference**: Section 11.3 (Aturan), Section 11.4 (Axios interceptor), Section 11.2 (Struktur folder), Section 12.3 (CSRF), Section 12.1 (Cookie sesi)

---

## Goal

Implementasi frontend Vue auth flow:
1. Axios instance dengan `withCredentials: true` + CSRF header interceptor (baca cookie `XSRF-TOKEN`, set header `X-CSRF-Token` untuk non-GET request).
2. Axios response interceptor: `401` → redirect ke `/auth/login`, `403` → push ke `/forbidden`, `429` → push ke `/too-many-requests`.
3. Pinia auth store (`stores/auth.store.ts`): state `user` (nullable), action `fetchSession()` + `logout()`, getter `hasMenu(code)`.
4. Auth API helpers (`api/auth.ts`): `fetchSession()`, `logout()`, `getCsrfToken()`.

## Scope

**In scope**:
- `apps/frontend-vue/src/api/axios.ts` — Axios instance config + interceptors:
  - `baseURL` dari `import.meta.env.VITE_API_URL` (default `http://localhost:3001`).
  - `withCredentials: true` (wajib untuk cookie-based session).
  - Request interceptor: baca cookie `XSRF-TOKEN` via `getCookie('XSRF-TOKEN')`, set header `X-CSRF-Token` untuk non-GET method (`POST`, `PUT`, `PATCH`, `DELETE`).
  - Response interceptor:
    - `2xx` → return response.
    - `401` → `window.location.href = '/auth/login'` (full page redirect ke BE — BFF akan start OAuth flow).
    - `403` → `router.push('/forbidden')`.
    - `429` → `router.push('/too-many-requests')`.
    - Other 4xx/5xx → `Promise.reject(err)` (let caller handle).
  - Helper `getCookie(name)` — parse `document.cookie` (HttpOnly cookie tidak terbaca, tapi `XSRF-TOKEN` sengaja `HttpOnly=false` supaya FE bisa baca).
- `apps/frontend-vue/src/api/auth.ts` — auth API helpers:
  - `fetchSession()` → `GET /auth/session` → return `{ user: AuthUser | null }`.
  - `logout()` → `POST /auth/logout` dengan CSRF header → return void.
  - `getCsrfToken()` → `GET /auth/csrf` → set cookie `XSRF-TOKEN` (auto via Set-Cookie) + return `{ csrfToken: string }`.
- `apps/frontend-vue/src/stores/auth.store.ts` — Pinia store:
  - State: `user: AuthUser | null`, `loading: boolean`, `error: string | null`.
  - Getters: `isAuthenticated` (= `user !== null`), `isSuperAdmin` (= `user?.isSuperAdmin ?? false`), `hasMenu(code)` (= `isSuperAdmin || user.permissionCodes.includes('*') || user.permissionCodes.includes(code)`).
  - Actions:
    - `fetchSession()` → call `authApi.fetchSession()` → set `user` (atau `null` bila 401).
    - `logout()` → call `authApi.logout()` → reset `user = null` → window redirect to `/auth/login`.
    - `clear()` → reset state untuk testing.
- `apps/frontend-vue/src/types/auth.ts` — TypeScript types:
  - `AuthUser` interface: `userId: string`, `username: string`, `roleId: string`, `isSuperAdmin: boolean`, `permissionCodes: string[]`.
  - `SessionResponse` interface: `{ user: AuthUser | null }`.
- `apps/frontend-vue/src/main.ts` — initialize:
  - Bootstrap: di app startup, call `auth.fetchSession()` (silent — jika 401, just set `user = null`).
  - `pinia` + `router` + `axios` registered di app.
- Vite proxy config (`apps/frontend-vue/vite.config.ts`) — UPDATE bila perlu:
  - Bila FE + BE same origin (via Vite proxy) → `withCredentials: true` cukup, no CORS issues.
  - Bila FE + BE beda origin → CORS di BE (already in AUTH-17) + `SameSite=None` cookie.
  - Vite proxy config:
    ```ts
    server: {
      proxy: {
        '/auth': { target: 'http://localhost:3001', changeOrigin: true, credentials: true },
        '/api': { target: 'http://localhost:3001', changeOrigin: true, credentials: true },
      },
    }
    ```
- Env vars:
  - `VITE_API_URL=http://localhost:3001` (default).
- Unit test (opsional, Vitest):
  - `axios.spec.ts` — verify CSRF header set on POST, not set on GET.
  - `auth.store.spec.ts` — `fetchSession` happy path + 401 (user = null) + `logout` reset state + `hasMenu` logic.

**Out of scope**:
- Router guards + auth pages (LoginRedirect, Callback, Forbidden, TooManyRequests) → AUTH-21.
- Menu component (`AppMenu.vue`) → AUTH-22.
- Login UI form (di auth-mock EJS, bukan FE Vue).
- Token refresh logic (BE handles via lazy sync + session refresh) — FE hanya lihat cookie `sid`.
- WebSocket auth (untuk realtime notifications) → di luar scope Plan2.

## Files to create/modify

- `apps/frontend-vue/src/api/axios.ts` — NEW (Axios instance + interceptors)
- `apps/frontend-vue/src/api/auth.ts` — NEW (auth API helpers)
- `apps/frontend-vue/src/stores/auth.store.ts` — NEW (Pinia store)
- `apps/frontend-vue/src/types/auth.ts` — NEW (TypeScript types)
- `apps/frontend-vue/src/main.ts` — UPDATE (init auth.fetchSession on startup)
- `apps/frontend-vue/vite.config.ts` — UPDATE (proxy config)
- `apps/frontend-vue/.env.example` — UPDATE (VITE_API_URL)
- `apps/frontend-vue/package.json` — UPDATE (deps: `axios`, `pinia`, `vue-router` — check existing)
- `apps/frontend-vue/src/api/__tests__/axios.spec.ts` — NEW (Vitest)
- `apps/frontend-vue/src/stores/__tests__/auth.store.spec.ts` — NEW (Vitest)

## Implementation steps

1. **`types/auth.ts`**:
   ```ts
   export interface AuthUser {
     userId: string;
     username: string;
     roleId: string;
     isSuperAdmin: boolean;
     permissionCodes: string[];
   }

   export interface SessionResponse {
     user: AuthUser | null;
   }
   ```

2. **`api/axios.ts`** — Axios instance + interceptors (per plan2 section 11.4):
   ```ts
   import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
   import router from '../router';

   const api = axios.create({
     baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3001',
     withCredentials: true, // wajib untuk cookie-based session
     timeout: 30_000,
     headers: { 'Content-Type': 'application/json' },
   });

   // Request interceptor: attach CSRF header untuk non-GET methods
   api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
     const method = (config.method ?? 'get').toLowerCase();
     if (method !== 'get' && method !== 'head' && method !== 'options') {
       const csrf = getCookie('XSRF-TOKEN');
       if (csrf) {
         config.headers['X-CSRF-Token'] = csrf;
       }
     }
     return config;
   });

   // Response interceptor: handle 401/403/429
   api.interceptors.response.use(
     (response) => response,
     (error: AxiosError) => {
       const status = error.response?.status;
       if (status === 401) {
         // Redirect ke BE /auth/login — BFF akan start OAuth flow
         if (window.location.pathname !== '/auth/login') {
           window.location.href = `${import.meta.env.VITE_API_URL}/auth/login`;
         }
       } else if (status === 403) {
         router.push('/forbidden');
       } else if (status === 429) {
         router.push('/too-many-requests');
       }
       return Promise.reject(error);
     },
   );

   function getCookie(name: string): string | null {
     const raw = document.cookie;
     if (!raw) return null;
     for (const part of raw.split(';')) {
       const [k, v] = part.trim().split('=');
       if (k === name) return decodeURIComponent(v ?? '');
     }
     return null;
   }

   export default api;
   ```

3. **`api/auth.ts`** — auth API helpers:
   ```ts
   import api from './axios';
   import type { SessionResponse } from '../types/auth';

   export const authApi = {
     async fetchSession(): Promise<SessionResponse> {
       const { data } = await api.get<SessionResponse>('/auth/session');
       return data;
     },

     async logout(): Promise<void> {
       await api.post('/auth/logout');
     },

     async getCsrfToken(): Promise<{ csrfToken: string }> {
       const { data } = await api.get<{ csrfToken: string }>('/auth/csrf');
       return data;
     },
   };
   ```

4. **`stores/auth.store.ts`** — Pinia store:
   ```ts
   import { defineStore } from 'pinia';
   import { authApi } from '../api/auth';
   import type { AuthUser } from '../types/auth';

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
       isAuthenticated: (state) => state.user !== null,
       isSuperAdmin: (state) => state.user?.isSuperAdmin ?? false,
     },

     actions: {
       hasMenu(code: string): boolean {
         if (!this.user) return false;
         if (this.user.isSuperAdmin) return true;
         if (this.user.permissionCodes.includes('*')) return true;
         return this.user.permissionCodes.includes(code);
       },

       hasAnyMenu(codes: string[]): boolean {
         return codes.some(code => this.hasMenu(code));
       },

       async fetchSession(): Promise<void> {
         this.loading = true;
         this.error = null;
         try {
           const { user } = await authApi.fetchSession();
           this.user = user;
         } catch (err: any) {
           // 401 handled by axios interceptor (redirect ke /auth/login)
           if (err.response?.status !== 401) {
             this.error = err.message ?? 'Failed to fetch session';
           }
           this.user = null;
         } finally {
           this.loading = false;
         }
       },

       async logout(): Promise<void> {
         try {
           await authApi.logout();
         } catch (err: any) {
           // Logout gagal (e.g., session already expired) — tetap clear state + redirect
           console.warn('Logout API failed:', err.message);
         } finally {
           this.clear();
           // Redirect ke BE /auth/login — BFF start OAuth flow lagi
           window.location.href = `${import.meta.env.VITE_API_URL}/auth/login`;
         }
       },

       clear(): void {
         this.user = null;
         this.loading = false;
         this.error = null;
       },
     },
   });
   ```

5. **`main.ts`** — bootstrap with fetchSession:
   ```ts
   import { createApp } from 'vue';
   import { createPinia } from 'pinia';
   import App from './App.vue';
   import router from './router';
   import PrimeVue from 'primevue/config';
   import Aura from '@primevue/themes/aura';
   import { useAuthStore } from './stores/auth.store';
   import './assets/main.css';

   const app = createApp(App);
   const pinia = createPinia();

   app.use(pinia);
   app.use(router);
   app.use(PrimeVue, { ripple: true, theme: { preset: Aura } });

   // Bootstrap: fetch session on app load
   const auth = useAuthStore(pinia);
   auth.fetchSession().finally(() => {
     app.mount('#app');
   });
   ```

6. **`vite.config.ts`** — UPDATE proxy config:
   ```ts
   import { defineConfig } from 'vite';
   import vue from '@vitejs/plugin-vue';

   export default defineConfig({
     plugins: [vue()],
     server: {
       port: 5173,
       proxy: {
         // Proxy /auth + /api ke payment-api — supaya cookie same-origin
         '/auth': {
           target: 'http://localhost:3001',
           changeOrigin: true,
           // credentials handled by browser automatically (same-origin via proxy)
         },
         '/api': {
           target: 'http://localhost:3001',
           changeOrigin: true,
         },
         '/payments': {
           target: 'http://localhost:3001',
           changeOrigin: true,
         },
         '/health': {
           target: 'http://localhost:3001',
           changeOrigin: true,
         },
       },
     },
   });
   ```

7. **`.env.example`** (frontend-vue):
   ```env
   VITE_API_URL=http://localhost:3001
   ```

8. **Unit test `axios.spec.ts`** (Vitest):
   - Test cases:
     - GET request → no `X-CSRF-Token` header.
     - POST request + cookie `XSRF-TOKEN=abc` → header `X-CSRF-Token: abc` set.
     - POST request + no cookie → no header (CSRF middleware akan reject di BE).
     - PUT/PATCH/DELETE → header set (sama dengan POST).
     - Response 200 → resolve.
     - Response 401 → `window.location.href` set ke `/auth/login`.
     - Response 403 → `router.push('/forbidden')` called.
     - Response 429 → `router.push('/too-many-requests')` called.
     - Response 500 → `Promise.reject(err)` (caller handle).

9. **Unit test `auth.store.spec.ts`** (Vitest):
   - Test cases:
     - `fetchSession` happy path: `authApi.fetchSession` return `{ user: {...} }` → `state.user` set, `loading` false.
     - `fetchSession` 401: catch → `state.user = null`, `error = null` (interceptor handles redirect).
     - `fetchSession` network error: catch → `state.user = null`, `state.error = 'Failed to fetch session'`.
     - `logout` happy path: `authApi.logout` resolve → `state.user = null` + `window.location.href` set.
     - `logout` API fails: tetap clear state + redirect.
     - `hasMenu('payment.write')` + `user.permissionCodes=['payment.read', 'payment.write']` → true.
     - `hasMenu('payment.admin')` + same user → false.
     - `hasMenu('payment.admin')` + `isSuperAdmin=true` → true (bypass).
     - `hasMenu('payment.admin')` + `permissionCodes=['*']` → true (wildcard).
     - `hasAnyMenu(['payment.write', 'payment.admin'])` + `permissionCodes=['payment.admin']` → true (OR logic).

## Acceptance criteria

- [ ] Axios instance dibuat dengan `baseURL: import.meta.env.VITE_API_URL` + `withCredentials: true`.
- [ ] Request interceptor set `X-CSRF-Token` header untuk non-GET method (`POST`, `PUT`, `PATCH`, `DELETE`), baca dari cookie `XSRF-TOKEN`.
- [ ] Response interceptor handle:
  - `401` → `window.location.href = '${VITE_API_URL}/auth/login'` (full page redirect ke BE).
  - `403` → `router.push('/forbidden')`.
  - `429` → `router.push('/too-many-requests')`.
  - Other → `Promise.reject(err)`.
- [ ] `getCookie(name)` helper parse `document.cookie` (URL-decoded).
- [ ] `authApi.fetchSession()` → `GET /auth/session` → return `{ user: AuthUser | null }`.
- [ ] `authApi.logout()` → `POST /auth/logout` dengan CSRF header.
- [ ] `authApi.getCsrfToken()` → `GET /auth/csrf` → set cookie `XSRF-TOKEN` via Set-Cookie.
- [ ] Pinia `useAuthStore`:
  - State: `user: AuthUser | null`, `loading: boolean`, `error: string | null`.
  - Getters: `isAuthenticated`, `isSuperAdmin`.
  - Actions: `hasMenu(code)`, `hasAnyMenu(codes[])`, `fetchSession()`, `logout()`, `clear()`.
- [ ] `hasMenu(code)` logic: `isSuperAdmin` OR `permissionCodes.includes('*')` OR `permissionCodes.includes(code)`.
- [ ] `fetchSession()` set `user` dari API response, atau `null` bila 401 (axios interceptor handle redirect).
- [ ] `logout()` call `authApi.logout()` + clear state + redirect to `${VITE_API_URL}/auth/login`.
- [ ] `main.ts` bootstrap: `auth.fetchSession().finally(() => app.mount('#app'))`.
- [ ] Vite proxy `/auth`, `/api`, `/payments`, `/health` ke `http://localhost:3001`.
- [ ] `VITE_API_URL` env var (default `http://localhost:3001`).
- [ ] Unit test `axios.spec.ts` + `auth.store.spec.ts` lulus.
- [ ] `pnpm --filter frontend-vue typecheck` + `lint` lulus.

## Useful commands

```bash
# Install deps (axios + pinia likely already installed from Plan1 setup)
cd  && pnpm --filter frontend-vue add axios pinia vue-router
cd  && pnpm --filter frontend-vue add -D vitest @vitest/ui jsdom @testing-library/vue

# Typecheck + lint
cd  && pnpm --filter frontend-vue typecheck
cd  && pnpm --filter frontend-vue lint

# Run tests
cd  && pnpm --filter frontend-vue test -- --run

# Dev mode (Vite + payment-api)
cd  && pnpm --filter payment-api start:dev &
cd  && pnpm --filter frontend-vue dev  # port 5173

# Manual test in browser
# 1. Open http://localhost:5173
# 2. Should auto-fetch /auth/session (401 → redirect to /auth/login on payment-api)
# 3. After login at auth-mock + callback, redirect back to http://localhost:5173/
# 4. Verify state: auth.user populated, menu shows based on permissionCodes.

# Inspect cookie in browser DevTools:
# - Application > Cookies > localhost:5173
# - Should see: sid (HttpOnly), XSRF-TOKEN (HttpOnly=false)

# Test CSRF header injection (browser console):
# const api = await import('/src/api/axios.ts')
# await api.post('/payments', { amount: 100 })
# Check Network tab: Request Headers should have X-CSRF-Token: <cookie value>

# Test logout flow:
# 1. Login + callback → user populated
# 2. Click "Logout" button → auth.logout() called
# 3. POST /auth/logout → 200 OK
# 4. window.location.href = 'http://localhost:3001/auth/login' → OAuth flow restart
```

## Notes

- **Plan2 section 11.3 aturan**:
  - **Tidak menyimpan token.** Cookie `sid` (HttpOnly) + `XSRF-TOKEN` (FE bisa baca) di browser, token tidak pernah ke JS.
  - **Semua request `withCredentials: true`.** Wajib supaya browser kirim cookie.
  - **Login: redirect ke `/auth/login` (BE payment).** Tidak render login form di FE Vue — login UI di auth-mock (atau auth asli).
  - **Setelah callback: `GET /auth/session`.** FE fetch untuk populate user store.
  - **Logout: `POST /auth/logout`, redirect ke login.**
  - **401 → `/auth/login`.** Tidak retry — langsung redirect (token expired = session expired = re-login).
  - **403 → `/forbidden`.** Halaman khusus.
  - **429 → `/too-many-requests`.** Halaman khusus.
- **Cookie `XSRF-TOKEN` `HttpOnly=false`** (di AUTH-15) supaya FE bisa baca via `document.cookie`. Cookie `sid` `HttpOnly=true` — FE tidak bisa baca (anti-XSS).
- **Axios 401 handler** vs Pinia `fetchSession` 401 handler:
  - Axios interceptor handle semua 401 dari API calls → redirect ke BE `/auth/login`.
  - Pinia `fetchSession` khusus handle 401 saat bootstrap: catch error, set `user = null` (axios interceptor sudah redirect, jadi state segera setelah redirect tidak relevan).
  - Penting: bila `fetchSession` di-bootstrap mengembalikan 401, axios interceptor akan redirect BEFORE Pinia catch. Solusi: axios interceptor skip 401 untuk `/auth/session` (whitelist path).
  - **Atau**: gunakan flag `isFetchingSession` di axios interceptor supaya tidak redirect saat fetch session bootstrap (handle di Pinia side).
- **Vite proxy** supaya FE + BE same-origin (via `localhost:5173` proxy ke `localhost:3001`). Cookie `sid` + `XSRF-TOKEN` jadi same-origin → tidak perlu CORS credentials + `SameSite=None`. Simpler.
- **Bila FE deploy terpisah** (production: FE di CDN, BE di server) → CORS credentials + `SameSite=None; Secure`. Config di BE (AUTH-17 `enableCors({ credentials: true })`) + cookie `SameSite=None`.
- **`hasMenu(code)`** supaya MenuAccessGuard FE-side check (cegah render menu item yang user tidak authorized). Di AUTH-22 dipakai di `AppMenu.vue`.
- **`logout()` redirect ke BE `/auth/login`** supaya OAuth flow restart dari awal (PKCE baru). Bila FE hanya reset state tanpa redirect, cookie `sid` masih ada (expired tapi belum di-clear di BE) → masalah.
- **Error handling di `fetchSession`**:
  - 401 → axios redirect ke `/auth/login` (BE). Pinia catch + set `user = null` (state clear).
  - Network error → Pinia catch + set `error = 'Failed to fetch session'`. FE bisa show retry button.
  - 5xx → Pinia catch + set `error = 'Server error'`. Show retry.
- **Plan2 section 11.2 struktur folder** — file-file ini di `apps/frontend-vue/src/api/`, `stores/`, `types/`. Konsisten dengan plan.
- Setelah task ini selesai, foundation FE Vue auth siap. Selanjutnya: AUTH-21 (router guards + auth pages) + AUTH-22 (menu component).
