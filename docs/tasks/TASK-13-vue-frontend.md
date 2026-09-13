# TASK-13 — Vue 3 + PrimeVue Dashboard (apps/frontend-vue, port 5173)

> **Task ID**: 10
> **Depends on**: 6-b (TASK-09 API Routes — `GET /payments`, `GET /payments/:id`, `POST /payments`, `POST /payments/:id/retry`, `GET /metrics`) + 6-b juga mengandalkan gateway mock (TASK-03 `/admin/config`, `/admin/stats`) dan observability registry (TASK-11 untuk `/metrics` real values). Implicitly bergantung juga pada TASK-11 (circuit breaker card membaca metrics) + TASK-07/08 (attempt history payload).
> **Estimated effort**: L (~6-8 jam — full dashboard, 4 views + 7 components + 3 Pinia stores + 3 api modules)
> **Plan reference**: Section 17 (Frontend Dashboard Strategy, rev 2) + Section 17.2 (Vue 3 + PrimeVue) + Section 17.3 (Perbandingan) + Section 18 (Demonstration Scenarios A–E)

---

## Goal

Membangun **dashboard user-facing resmi** dengan **Vue 3 + PrimeVue + Vite + Pinia + Vue Router + axios** di `apps/frontend-vue/` (port 5173). Berbeda dengan TASK-12 (Next.js sandbox yang hanya subset fungsionalitas), TASK-13 mencakup **seluruh fitur dashboard** yang didefinisikan di plan section 17.2 — konsumsi `payment-api` di port 3001 secara langsung (tanpa Caddy `XTransformPort` karena Vue dev server di 5173, bukan 3000).

Tujuan utama:

1. **Gateway mode selector** — form lengkap untuk PUT `/admin/config` ke gateway mock (port 3002). Select mode (`healthy` | `client-error` | `fail-first-n` | `always-timeout` | `rate-limited` | `response-disappear`) + dynamic InputNumber untuk parameter sesuai mode (`n`, `probability`, `retryAfterSeconds`, `timeoutMs`).
2. **Create payment dialog** — Dialog dengan form `orderId` / `amount` / `currency` + validation. Submit → `POST /api/payments` ke port 3001. Setelah submit, store otomatis refetch list.
3. **Payments list dengan filter + sort + pagination** — `GET /api/payments` di-render via PrimeVue `DataTable` dengan filter by status, sort by `createdAt` (dan kolom lain), paginator 20 rows/page. Klik row → navigasi ke route `/payments/:id`.
4. **Payment detail dengan attempt history timeline** — `GET /api/payments/:id` mengembalikan `{ payment, attempts }`. Attempts di-render via PrimeVue `Timeline` menampilkan `attemptNumber` + `outcome` + `durationMs` + `breakerState` + `traceId`.
5. **Manual retry** — tombol `POST /api/payments/:id/retry` hanya visible bila status ∈ {`failed`, `scheduled_for_retry`}. Bila `succeeded` → disabled dengan tooltip "Payment already succeeded".
6. **Circuit breaker card** — polling metrics setiap 5 detik, menampilkan state breaker (`closed` | `half_open` | `open`) + reject count + last tripped time.
7. **Metrics charts** — 3 PrimeVue `Chart` (wrapper Chart.js): Pie untuk status distribution, Line untuk request duration histogram, Bar untuk retry attempts.
8. **Demo scenario runner A–E** — 5 tombol yang menjalankan end-to-end scenario: reset gateway mode → PUT target mode → POST new payment dengan unique `orderId` prefix → poll status sampai terminal (timeout 60s) → show Toast success/failure dengan assertion → tampilkan Dialog berisi result table semua demo run.

## Scope

**In scope**:

- `apps/frontend-vue/` — complete Vue 3 + Vite app setup (package.json, vite.config.ts, tsconfig, index.html, main.ts, App.vue).
- `src/api/client.ts` — axios instance dengan `baseURL = http://localhost:3001` + response interceptor (error → toast).
- `src/api/payments.ts` — CRUD functions (`list`, `getById`, `create`, `retry`).
- `src/api/gateway.ts` — admin config GET/PUT + stats GET.
- `src/api/metrics.ts` — parser untuk Prometheus text format → structured object.
- `src/stores/payments.ts` — Pinia store: `list`, `current`, `filters`, `loading`, `error`, actions `fetchList`, `fetchOne`, `create`, `retry`, `resetFilter`.
- `src/stores/gateway.ts` — Pinia store: `config`, `stats`.
- `src/stores/metrics.ts` — Pinia store: parsed metrics object + lastUpdated.
- `src/router/index.ts` — routes `/`, `/payments`, `/payments/:id`, `/metrics`.
- `src/composables/usePolling.ts` — generic polling helper (`usePolling(fn, intervalMs)` returns `{ start, stop, isPolling }`).
- `src/views/HomeView.vue` — overview dashboard (cards: total payments, succeeded count, failed count, breaker state, mini chart).
- `src/views/PaymentsView.vue` — PrimeVue `DataTable` dengan filter + sort + paginator + click row → navigate detail.
- `src/views/PaymentDetailView.vue` — detail card + `AttemptTimeline` + manual retry button.
- `src/views/MetricsView.vue` — 3 `Chart` components (Pie, Line, Bar) + raw metrics textarea (collapsible).
- `src/components/GatewayModeSelector.vue` — Card berisi `Select` + 4 `InputNumber` (conditionally rendered based on mode).
- `src/components/CreatePaymentDialog.vue` — `Dialog` dengan form + validation rules.
- `src/components/DemoScenarioRunner.vue` — Card dengan 5 `Button` (A–E) + Badge status indicator + result Dialog.
- `src/components/CircuitBreakerCard.vue` — `Card` + `Tag` state + auto-refresh via `usePolling`.
- `src/components/StatusTag.vue` — `Tag` dengan severity mapping (`succeeded`→success, `failed`→danger, `processing`→info, `scheduled_for_retry`→warn, `circuit_open`→danger).
- `src/components/AttemptTimeline.vue` — PrimeVue `Timeline` menampilkan `attemptNumber`, `outcome`, `durationMs`, `breakerState`, `traceId`.
- `src/styles.css` — import PrimeVue theme (Aura preset) + primeicons + custom CSS variables untuk light/dark mode.
- PrimeVue theming via `@primevue/themes/aura` (PrimeVue 4.x new theming API).

**Out of scope**:

- **Backend changes** — TASK-13 murni frontend. Backend (controllers, gateway mock, metrics) sudah disediakan oleh TASK-09 + TASK-11 + TASK-03. Bila endpoint berubah, update api/*.ts modules (thin wrapper).
- **Authentication / RBAC** → tidak dipakai di plan rev 2. Semua endpoint terbuka. Production caveat di TASK-15.
- **Real-time push** (WebSocket / SSE) → tidak dipakai. Pakai polling (3s payments / 5s metrics / 10s breaker). Real-time push → future work, tidak di plan rev 2.
- **SSR / SSG** → SPA only. Vite dev server + build static assets (dist/). Tidak pakai Nuxt atau SSR plugin.
- **Custom design system** → pakai PrimeVue Aura preset as-is. Hanya override minor di `styles.css` (sticky footer, max-width container). Tidak ada custom CSS framework (no Tailwind, no Bootstrap).
- **Internationalization (i18n)** → hardcoded English/Indonesian mix di labels. Tidak ada `vue-i18n` setup. Production caveat di TASK-15.
- **Charts advanced** (zoom, pan, annotation) → tidak perlu. PrimeVue `Chart` wrapper Chart.js dengan default options cukup. Custom chart legend via PrimeVue styling.
- **Demo scenario assertion logic yang exhaustive** → 5 tombol A–E menjalankan flow + simple assertion (status terminal sesuai expected + verify attempt count). Full E2E assertions → TASK-14 (Jest + supertest backend + Agent Browser frontend).
- **Mobile gesture support** (swipe to refresh, pull-to-load-more) → tidak perlu. Mobile responsive via PrimeVue responsive grid + viewport meta. Touch interactions default browser.
- **Offline mode / PWA** → tidak dipakai. Dashboard mengasumsikan online + backend reachable.

## Plan section 17.2 strategy

Dikutip dari `upload/PLAN1_Cockatiel_Retry_Failure_Scenario.md` section 17.2:

- **Tujuan**: Dashboard user-facing resmi yang dipakai untuk demo scenario A–E.
- **Stack**: Vue 3 (Composition API) + Vite + PrimeVue + Pinia + Vue Router + axios.
- **Komponen PrimeVue yang dipakai**: `DataTable`, `Card`, `Button`, `Toast`, `Dialog`, `Select`, `InputText`, `InputNumber`, `Tag`, `Timeline`, `Chart` (wrapper Chart.js).
- **Scope**: Lengkap — gateway mode selector, create payment, list + filter + sort, detail dialog dengan attempt history timeline, manual retry, circuit breaker card, metrics charts, demo scenario runner (A–E).
- **Implementasi**: 1 task (TASK-13).

**Konsekuensi**:

- TASK-13 adalah **official demo UI** untuk presentasi scenario A–E ke stakeholder. Demo script di TASK-15 akan mereferensikan URL `http://localhost:5173` sebagai entry point.
- Bila user menjalankan full Docker stack (Postgres + payment-api + gateway-mock + frontend-vue + Prometheus + Grafana), TASK-12 (Next.js sandbox) opsional, TASK-13 wajib.
- TASK-13 mengkonsumsi API yang sama dengan TASK-12 (Next.js sandbox) — tidak ada endpoint khusus frontend Vue. Semua contract via TASK-09 controllers + TASK-03 gateway mock admin.

## Comparison table — Next.js sandbox vs Vue+PrimeVue (plan section 17.3)

| Aspek | Next.js Sandbox (TASK-12) | Vue+PrimeVue (TASK-13) |
|---|---|---|
| Lokasi monorepo | parent root `/home/z/my-project/` (di luar `retry-failure/`) | `retry-failure/apps/frontend-vue/` |
| Tujuan | Preview sandbox cloud (single port 3000) | Dashboard resmi untuk demo A–E |
| Stack UI | shadcn/ui (Tailwind) | PrimeVue 4 (Aura preset) |
| State management | TanStack Query | Pinia + composables |
| Routing | Next.js App Router (file-based) | Vue Router 4 (config-based) |
| Port | 3000 (Next.js dev) | 5173 (Vite dev) |
| Akses backend | fetch via Caddy `?XTransformPort=3001` | axios langsung ke `http://localhost:3001` |
| Subset/Lengkap | Subset (no charts, no pagination, no sort) | Lengkap (charts + filter + sort + pagination + timeline) |
| PrimeVue components | — | DataTable, Card, Button, Toast, Dialog, Select, InputText, InputNumber, Tag, Timeline, Chart |
| Mobile responsive | Tailwind responsive classes | PrimeVue responsive grid + viewport meta |
| Production-ready | Tidak (sandbox only) | Ya (build `dist/` bisa di-serve via nginx) |
| Demo scenario runner | Ya (5 tombol A–E) | Ya (5 tombol A–E + result dialog) |
| Konsumen API | `/api/payments`, `/api/health`, `/api/metrics`, gateway `/admin/config` | Sama — `/api/payments`, `/api/health`, `/api/metrics`, gateway `/admin/config` + `/admin/stats` |

> **PENTING**: Keduanya adalah **pure presentation layer**. Tidak ada logic bisnis di frontend — semua retry, idempotency, state machine, audit, metrics ada di backend NestJS.

## Files to create

Semua path relatif ke `/home/z/my-project/retry-failure/apps/frontend-vue/`:

### Root config

- `package.json` — Vite + Vue 3 + PrimeVue + Pinia + Vue Router + axios + Chart.js + dev deps (vue-tsc, eslint, @vitejs/plugin-vue, typescript).
- `vite.config.ts` — port 5173, `host: true` untuk preview cloud, alias `@` → `src/`.
- `tsconfig.json` — Vue 3 + Vite client types.
- `tsconfig.node.json` — untuk `vite.config.ts` context.
- `index.html` — root HTML dengan `<div id="app">` + viewport meta untuk mobile.
- `.eslintrc.cjs` — Vue 3 recommended + TypeScript.
- `.gitignore` — `node_modules`, `dist`, `*.local`.

### Source code

- `src/main.ts` — Vue app bootstrap: `createApp(App)` + `app.use(createPinia())` + `app.use(router)` + `app.use(PrimeVue, { theme: { preset: Aura } })` + `app.use(ToastService)` + `app.use(ConfirmationService)` + `app.mount('#app')`.
- `src/App.vue` — root layout: sticky header (logo + nav links + dark mode toggle) + `<main>` dengan `<router-view>` + sticky footer (mt-auto).
- `src/router/index.ts` — routes: `/` → HomeView, `/payments` → PaymentsView, `/payments/:id` → PaymentDetailView, `/metrics` → MetricsView. History mode.
- `src/api/client.ts` — axios instance `baseURL = import.meta.env.VITE_PAYMENT_API_URL ?? 'http://localhost:3001'` + response interceptor for errors (toast via Pinia event bus atau global handler).
- `src/api/payments.ts` — `list(params)`, `getById(id)`, `create(input)`, `retry(id)`.
- `src/api/gateway.ts` — `getConfig()`, `updateConfig(payload)`, `getStats()`.
- `src/api/metrics.ts` — `fetchMetrics()` returns raw text; `parsePrometheusText(text)` returns structured object.
- `src/stores/payments.ts` — Pinia store dengan state `{ list, current, filters, loading, error }` + actions.
- `src/stores/gateway.ts` — Pinia store dengan state `{ config, stats, loading }` + actions.
- `src/stores/metrics.ts` — Pinia store dengan state `{ raw, parsed, lastUpdated }` + actions.
- `src/composables/usePolling.ts` — generic `usePolling(fn, intervalMs, options?)` returns `{ start, stop, isPolling }`. Auto-cleanup on `onUnmounted`.
- `src/composables/useToast.ts` — wrapper untuk PrimeVue `useToast()` composable (consistency).
- `src/views/HomeView.vue` — overview: 4 metric Cards + mini Chart + gateway mode summary + last 5 payments table.
- `src/views/PaymentsView.vue` — `DataTable` dengan lazy + filter + sort + paginator + row click → `router.push('/payments/:id')`.
- `src/views/PaymentDetailView.vue` — Card dengan payment detail + AttemptTimeline + manual retry Button (conditional).
- `src/views/MetricsView.vue` — 3 Chart components (Pie/Line/Bar) + collapsible raw metrics textarea.
- `src/components/GatewayModeSelector.vue` — Card + Select mode + 4 InputNumber (conditional by mode) + Save Button.
- `src/components/CreatePaymentDialog.vue` — Dialog + form (orderId InputText, amount InputNumber, currency Select) + validation.
- `src/components/DemoScenarioRunner.vue` — Card dengan 5 Button (A–E) + Badge status + result Dialog (Table).
- `src/components/CircuitBreakerCard.vue` — Card + Tag state + polling 5s + counter (rejected/total).
- `src/components/StatusTag.vue` — Tag dengan severity mapping berdasarkan status string.
- `src/components/AttemptTimeline.vue` — PrimeVue Timeline dengan custom template (marker + content).
- `src/styles.css` — import `@primevue/themes/aura` + `primeicons` + custom CSS (sticky footer, container max-width 1200px, dark mode override).

### Total: ~30 files (5 config + 25 source).

## Implementation steps

### 1. `package.json` — Vite + Vue + PrimeVue + Pinia + Vue Router + axios + Chart.js

```json
{
  "name": "@cockatiel/frontend-vue",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 5173 --host",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview --port 4173 --host",
    "typecheck": "vue-tsc --noEmit",
    "lint": "eslint . --ext .vue,.ts,.tsx --max-warnings 0"
  },
  "dependencies": {
    "vue": "^3.5.13",
    "vue-router": "^4.4.5",
    "pinia": "^2.2.6",
    "axios": "^1.7.9",
    "primevue": "^4.2.5",
    "@primevue/themes": "^4.2.5",
    "primeicons": "^7.0.0",
    "chart.js": "^4.4.7"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.2.1",
    "@vue/tsconfig": "^0.7.0",
    "typescript": "^5.7.2",
    "vite": "^5.4.11",
    "vue-tsc": "^2.1.10",
    "eslint": "^9.17.0",
    "eslint-plugin-vue": "^9.32.0",
    "@typescript-eslint/parser": "^8.18.2",
    "@typescript-eslint/eslint-plugin": "^8.18.2",
    "@vue/eslint-config-typescript": "^14.2.0"
  }
}
```

> **Versi pinning**: semua major version dikunci (`^3.5`, `^4.4`, `^4.2`, `^5.4`) untuk reproducibility. PrimeVue 4.x required karena memakai new theming API (`@primevue/themes/aura`). PrimeVue 3.x pakai old CSS primeflex pattern — tidak dipakai.

### 2. `vite.config.ts` — port 5173, host for preview, alias @ → src

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true, // expose ke network untuk preview cloud + agent browser
    strictPort: true, // fail bila 5173 dipakai, jangan auto-increment
  },
  preview: {
    port: 4173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});
```

> **strictPort: true** penting — bila 5173 sibuk, Vite error (bukan pindah ke 5174). Konsumen (TASK-14 E2E, demo script) mengasumsikan 5173 konsisten.

### 3. `tsconfig.json` + `tsconfig.node.json`

`tsconfig.json`:
```json
{
  "extends": "@vue/tsconfig/tsconfig.dom.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "types": ["vite/client"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`tsconfig.node.json`:
```json
{
  "extends": "@vue/tsconfig/tsconfig.node.json",
  "compilerOptions": {
    "composite": true,
    "types": ["node"]
  },
  "include": ["vite.config.ts"]
}
```

### 4. `index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cockatiel Retry Dashboard</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

### 5. `src/main.ts` — bootstrap dengan PrimeVue + Aura + Pinia + Router + ToastService + ConfirmationService

```ts
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import Aura from '@primevue/themes/aura';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';
import './styles.css';

import App from './App.vue';
import router from './router';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.app-dark', // toggle via class on <html>
    },
  },
});
app.use(ToastService);
app.use(ConfirmationService);

app.mount('#app');
```

> **Dark mode toggle**: tambah/hapus class `app-dark` di `document.documentElement`. PrimeVue Aura preset akan auto-switch.

### 6. `src/App.vue` — root layout: header sticky + main + footer sticky mt-auto

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';

const isDark = ref(false);

function toggleDark() {
  isDark.value = !isDark.value;
  document.documentElement.classList.toggle('app-dark', isDark.value);
}

onMounted(() => {
  // Default light mode. Bila prefers-color-scheme dark, enable.
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    toggleDark();
  }
});
</script>

<template>
  <Toast position="top-right" />
  <ConfirmDialog />

  <div class="app-shell">
    <header class="app-header">
      <div class="container">
        <RouterLink to="/" class="brand">🦜 Cockatiel Retry Dashboard</RouterLink>
        <nav>
          <RouterLink to="/">Home</RouterLink>
          <RouterLink to="/payments">Payments</RouterLink>
          <RouterLink to="/metrics">Metrics</RouterLink>
        </nav>
        <Button
          :icon="isDark ? 'pi pi-sun' : 'pi pi-moon'"
          severity="secondary"
          text
          rounded
          aria-label="Toggle dark mode"
          @click="toggleDark"
        />
      </div>
    </header>

    <main class="app-main container">
      <RouterView />
    </main>

    <footer class="app-footer">
      <div class="container">
        <span>Cockatiel Payment Retry/Failure Demo — TASK-13 Vue+PrimeVue</span>
        <span>Port 5173 · API: {{ apiBaseUrl }}</span>
      </div>
    </footer>
  </div>
</template>

<script lang="ts">
// Compute API base URL untuk display di footer (tidak reactive, fine untuk footer).
const apiBaseUrl = import.meta.env.VITE_PAYMENT_API_URL ?? 'http://localhost:3001';
export default { data: () => ({ apiBaseUrl }) };
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.app-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--p-content-background);
  border-bottom: 1px solid var(--p-content-border-color);
  padding: 0.5rem 0;
}
.app-main {
  flex: 1 1 auto;
  padding: 1.5rem 0;
}
.app-footer {
  position: sticky;
  bottom: 0;
  background: var(--p-content-background);
  border-top: 1px solid var(--p-content-border-color);
  padding: 0.5rem 0;
  margin-top: auto;
}
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1rem;
  display: flex;
  align-items: center;
  gap: 1rem;
}
nav {
  display: flex;
  gap: 1rem;
  flex: 1 1 auto;
}
.brand {
  font-weight: 600;
  text-decoration: none;
  color: inherit;
}
</style>
```

> **Catatan**: footer sticky via flex layout (`min-height: 100vh` + `display: flex` + `flex-direction: column` + `margin-top: auto` pada footer). Tidak pakai `position: fixed` karena akan overlap content.

### 7. `src/api/client.ts` — axios instance + interceptors

```ts
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_PAYMENT_API_URL ?? 'http://localhost:3001',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Response interceptor — normalize errors.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const normalized = {
      status: error.response?.status ?? 0,
      message: error.response?.data?.message ?? error.message ?? 'Unknown error',
      url: error.config?.url ?? '',
      method: error.config?.method ?? '',
    };
    // Toast dipicu via custom event — listener di App.vue atau useToast composable.
    // Hindari import Pinia di sini (circular dep risk).
    window.dispatchEvent(new CustomEvent('api:error', { detail: normalized }));
    return Promise.reject(normalized);
  },
);

// Gateway mock axios instance — separate baseURL karena beda port.
const gatewayApi = axios.create({
  baseURL: import.meta.env.VITE_GATEWAY_API_URL ?? 'http://localhost:3002',
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

gatewayApi.interceptors.response.use(
  (response) => response,
  (error) => {
    const normalized = {
      status: error.response?.status ?? 0,
      message: error.response?.data?.message ?? error.message ?? 'Unknown error',
      url: error.config?.url ?? '',
      method: error.config?.method ?? '',
    };
    window.dispatchEvent(new CustomEvent('api:error', { detail: normalized }));
    return Promise.reject(normalized);
  },
);

export { api, gatewayApi };
```

> **PENTING — bukan pakai Caddy XTransformPort**: Vue app di port 5173 (bukan 3000), jadi **direct fetch ke `http://localhost:3001` di-allow** oleh browser (CORS sudah di-enable di TASK-09). Tidak perlu `?XTransformPort=3001` di query string. Berbeda dengan TASK-12 (Next.js sandbox di port 3000 yang harus via Caddy).
>
> **CORS**: TASK-09 controller meng-enable CORS untuk origin `http://localhost:5173` + `http://localhost:3000`. Verifikasi via `curl -i -X OPTIONS http://localhost:3001/api/payments -H 'Origin: http://localhost:5173'` — harus return `Access-Control-Allow-Origin: http://localhost:5173`.
>
> **Error handling**: gunakan `CustomEvent` dispatch (bukan import Pinia langsung) untuk hindari circular dependency. Listener di App.vue akan show Toast via `useToast()`.

### 8. `src/api/payments.ts` — CRUD functions

```ts
import { api } from './client';

export interface Payment {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: 'processing' | 'succeeded' | 'failed' | 'scheduled_for_retry' | 'circuit_open';
  attemptCount: number;
  totalRetryCount: number;
  idempotencyKey: string;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentAttempt {
  id: string;
  attemptNumber: number;
  outcome: 'success' | 'transient_failure' | 'permanent_failure' | 'timeout' | 'circuit_open' | 'rate_limited';
  httpStatus: number | null;
  durationMs: number;
  breakerState: 'closed' | 'half_open' | 'open' | null;
  errorCode: string | null;
  retryAfterSeconds: number | null;
  traceId: string;
  createdAt: string;
}

export interface PaymentListResponse {
  payments: Payment[];
  total: number;
  limit: number;
  offset: number;
}

export interface PaymentDetailResponse {
  payment: Payment;
  attempts: PaymentAttempt[];
}

export interface CreatePaymentInput {
  orderId: string;
  amount: number;
  currency: string;
}

export const paymentsApi = {
  async list(params?: { status?: string; limit?: number; offset?: number; sort?: string }): Promise<PaymentListResponse> {
    const { data } = await api.get<PaymentListResponse>('/api/payments', { params });
    return data;
  },

  async getById(id: string): Promise<PaymentDetailResponse> {
    const { data } = await api.get<PaymentDetailResponse>(`/api/payments/${id}`);
    return data;
  },

  async create(input: CreatePaymentInput): Promise<{ payment: Payment }> {
    const { data } = await api.post<{ payment: Payment }>('/api/payments', input);
    return data;
  },

  async retry(id: string): Promise<{ payment: Payment }> {
    const { data } = await api.post<{ payment: Payment }>(`/api/payments/${id}/retry`);
    return data;
  },
};
```

### 9. `src/api/gateway.ts` — admin config + stats

```ts
import { gatewayApi } from './client';

export type GatewayMode =
  | 'healthy'
  | 'client-error'
  | 'fail-first-n'
  | 'always-timeout'
  | 'rate-limited'
  | 'response-disappear';

export interface GatewayConfig {
  mode: GatewayMode;
  n?: number;
  probability?: number;
  retryAfterSeconds?: number;
  timeoutMs?: number;
}

export interface GatewayStats {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  replayCount: number;
  callsByMode: Record<string, number>;
  uptimeSeconds: number;
}

export const gatewayAdminApi = {
  async getConfig(): Promise<GatewayConfig> {
    const { data } = await gatewayApi.get<GatewayConfig>('/admin/config');
    return data;
  },

  async updateConfig(config: GatewayConfig): Promise<GatewayConfig> {
    const { data } = await gatewayApi.put<GatewayConfig>('/admin/config', config);
    return data;
  },

  async getStats(): Promise<GatewayStats> {
    const { data } = await gatewayApi.get<GatewayStats>('/admin/stats');
    return data;
  },
};
```

### 10. `src/api/metrics.ts` — parse Prometheus text format

```ts
import { api } from './client';

export interface MetricSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

export interface ParsedMetrics {
  samples: MetricSample[];
  raw: string;
  parsedAt: string;
}

/**
 * Parse Prometheus exposition format (text/plain; version=0.0.4).
 *
 * Format per line:
 *   metric_name{label1="value1",label2="value2"} 42
 *   metric_name 42
 *
 * Lines starting with `#` are HELP/TYPE comments — skipped.
 */
export function parsePrometheusText(text: string): MetricSample[] {
  const samples: MetricSample[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Match: name{labels} value OR name value
    const match = trimmed.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([0-9.eE+-]+)$/);
    if (!match) continue;

    const [, name, labelsStr, valueStr] = match;
    const labels: Record<string, string> = {};

    if (labelsStr) {
      // Parse: label1="value1",label2="value2"
      const labelRegex = /(\w+)="([^"]*)"/g;
      let labelMatch: RegExpExecArray | null;
      while ((labelMatch = labelRegex.exec(labelsStr)) !== null) {
        labels[labelMatch[1]] = labelMatch[2];
      }
    }

    samples.push({
      name,
      labels,
      value: parseFloat(valueStr),
    });
  }

  return samples;
}

export const metricsApi = {
  async fetch(): Promise<ParsedMetrics> {
    const response = await api.get<string>('/api/metrics', {
      responseType: 'text',
      transformResponse: (raw) => raw, // jangan parse sebagai JSON
    });
    const raw = response.data;
    const samples = parsePrometheusText(raw);
    return { samples, raw, parsedAt: new Date().toISOString() };
  },
};
```

### 11. `src/stores/payments.ts` — Pinia store

```ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { paymentsApi, type Payment, type PaymentAttempt, type CreatePaymentInput } from '@/api/payments';

export interface PaymentFilters {
  status: string | null; // null = all
  limit: number;
  offset: number;
  sort: string; // e.g. 'createdAt:desc'
}

export const usePaymentsStore = defineStore('payments', () => {
  const list = ref<Payment[]>([]);
  const current = ref<{ payment: Payment; attempts: PaymentAttempt[] } | null>(null);
  const total = ref(0);
  const filters = ref<PaymentFilters>({
    status: null,
    limit: 20,
    offset: 0,
    sort: 'createdAt:desc',
  });
  const loading = ref(false);
  const error = ref<string | null>(null);

  const hasMore = computed(() => filters.value.offset + list.value.length < total.value);

  async function fetchList() {
    loading.value = true;
    error.value = null;
    try {
      const params: Record<string, string | number> = {
        limit: filters.value.limit,
        offset: filters.value.offset,
        sort: filters.value.sort,
      };
      if (filters.value.status) params.status = filters.value.status;

      const res = await paymentsApi.list(params);
      list.value = res.payments;
      total.value = res.total;
    } catch (e: any) {
      error.value = e.message ?? 'Failed to fetch payments';
    } finally {
      loading.value = false;
    }
  }

  async function fetchOne(id: string) {
    loading.value = true;
    error.value = null;
    try {
      current.value = await paymentsApi.getById(id);
    } catch (e: any) {
      error.value = e.message ?? 'Failed to fetch payment detail';
    } finally {
      loading.value = false;
    }
  }

  async function create(input: CreatePaymentInput) {
    loading.value = true;
    error.value = null;
    try {
      const res = await paymentsApi.create(input);
      await fetchList(); // refresh list
      return res.payment;
    } catch (e: any) {
      error.value = e.message ?? 'Failed to create payment';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function retry(id: string) {
    loading.value = true;
    error.value = null;
    try {
      const res = await paymentsApi.retry(id);
      await fetchOne(id); // refresh current
      return res.payment;
    } catch (e: any) {
      error.value = e.message ?? 'Failed to retry payment';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function resetFilter() {
    filters.value = { status: null, limit: 20, offset: 0, sort: 'createdAt:desc' };
    fetchList();
  }

  function setStatusFilter(status: string | null) {
    filters.value.status = status;
    filters.value.offset = 0;
    fetchList();
  }

  function setPage(offset: number) {
    filters.value.offset = offset;
    fetchList();
  }

  function setSort(sort: string) {
    filters.value.sort = sort;
    fetchList();
  }

  return {
    list, current, total, filters, loading, error, hasMore,
    fetchList, fetchOne, create, retry, resetFilter,
    setStatusFilter, setPage, setSort,
  };
});
```

### 12. `src/stores/gateway.ts` + `src/stores/metrics.ts`

`src/stores/gateway.ts`:
```ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { gatewayAdminApi, type GatewayConfig, type GatewayStats } from '@/api/gateway';

export const useGatewayStore = defineStore('gateway', () => {
  const config = ref<GatewayConfig>({ mode: 'healthy' });
  const stats = ref<GatewayStats | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchConfig() {
    loading.value = true;
    error.value = null;
    try {
      config.value = await gatewayAdminApi.getConfig();
    } catch (e: any) {
      error.value = e.message ?? 'Failed to fetch gateway config';
    } finally {
      loading.value = false;
    }
  }

  async function updateConfig(payload: GatewayConfig) {
    loading.value = true;
    error.value = null;
    try {
      config.value = await gatewayAdminApi.updateConfig(payload);
    } catch (e: any) {
      error.value = e.message ?? 'Failed to update gateway config';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function fetchStats() {
    try {
      stats.value = await gatewayAdminApi.getStats();
    } catch (e: any) {
      // Silent fail untuk stats — tidak blocking UI.
      console.warn('gateway stats fetch failed', e);
    }
  }

  return { config, stats, loading, error, fetchConfig, updateConfig, fetchStats };
});
```

`src/stores/metrics.ts`:
```ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { metricsApi, type ParsedMetrics, type MetricSample } from '@/api/metrics';

export const useMetricsStore = defineStore('metrics', () => {
  const parsed = ref<ParsedMetrics | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchMetrics() {
    loading.value = true;
    error.value = null;
    try {
      parsed.value = await metricsApi.fetch();
    } catch (e: any) {
      error.value = e.message ?? 'Failed to fetch metrics';
    } finally {
      loading.value = false;
    }
  }

  function findByName(name: string): MetricSample[] {
    return parsed.value?.samples.filter((s) => s.name === name) ?? [];
  }

  const statusDistribution = computed(() => {
    const out: Record<string, number> = {};
    for (const s of findByName('payments_total')) {
      const status = s.labels.status ?? 'unknown';
      out[status] = (out[status] ?? 0) + s.value;
    }
    return out;
  });

  const breakerState = computed(() => {
    const sample = findByName('circuit_breaker_state')[0];
    if (!sample) return { state: 'unknown', value: 0 };
    return { state: sample.labels.state ?? 'unknown', value: sample.value };
  });

  const requestDurationHistogram = computed(() => findByName('payment_request_duration_ms_bucket'));

  const retryAttempts = computed(() => findByName('payment_retry_attempts_total'));

  return {
    parsed, loading, error,
    fetchMetrics, findByName,
    statusDistribution, breakerState,
    requestDurationHistogram, retryAttempts,
  };
});
```

### 13. `src/router/index.ts`

```ts
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
    meta: { title: 'Home — Cockatiel Dashboard' },
  },
  {
    path: '/payments',
    name: 'payments',
    component: () => import('@/views/PaymentsView.vue'),
    meta: { title: 'Payments — Cockatiel Dashboard' },
  },
  {
    path: '/payments/:id',
    name: 'payment-detail',
    component: () => import('@/views/PaymentDetailView.vue'),
    props: true,
    meta: { title: 'Payment Detail — Cockatiel Dashboard' },
  },
  {
    path: '/metrics',
    name: 'metrics',
    component: () => import('@/views/MetricsView.vue'),
    meta: { title: 'Metrics — Cockatiel Dashboard' },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition ?? { top: 0 };
  },
});

router.afterEach((to) => {
  if (to.meta.title) document.title = String(to.meta.title);
});

export default router;
```

> **Lazy loading** semua views via dynamic import — Vite akan code-split per route. Bundle initial render hanya HomeView + dependencies.

### 14. `src/composables/usePolling.ts`

```ts
import { ref, onUnmounted, type Ref } from 'vue';

export interface UsePollingOptions {
  /** immediate first call on start() (default: true) */
  immediate?: boolean;
  /** skip next iteration jika fn sedang berjalan (default: true) */
  skipIfRunning?: boolean;
}

export interface UsePollingReturn {
  isPolling: Ref<boolean>;
  start: () => void;
  stop: () => void;
}

/**
 * Generic polling composable. fn dijalankan tiap intervalMs.
 * Auto-cleanup pada onUnmounted.
 */
export function usePolling(
  fn: () => Promise<void> | void,
  intervalMs: number,
  options: UsePollingOptions = {},
): UsePollingReturn {
  const { immediate = true, skipIfRunning = true } = options;
  const isPolling = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function tick() {
    if (skipIfRunning && running) return;
    running = true;
    try {
      await fn();
    } catch (err) {
      console.warn('[usePolling] iteration failed:', err);
    } finally {
      running = false;
    }
  }

  function start() {
    if (isPolling.value) return;
    isPolling.value = true;
    if (immediate) tick();
    timer = setInterval(tick, intervalMs);
  }

  function stop() {
    isPolling.value = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  onUnmounted(stop);

  return { isPolling, start, stop };
}
```

### 15. `src/components/GatewayModeSelector.vue`

```vue
<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useGatewayStore } from '@/stores/gateway';
import { useToast } from 'primevue/usetoast';
import Card from 'primevue/card';
import Button from 'primevue/button';
import Select from 'primevue/select';
import InputNumber from 'primevue/inputnumber';
import type { GatewayMode, GatewayConfig } from '@/api/gateway';

const store = useGatewayStore();
const toast = useToast();

const MODES: { label: string; value: GatewayMode }[] = [
  { label: 'healthy', value: 'healthy' },
  { label: 'client-error (400)', value: 'client-error' },
  { label: 'fail-first-n', value: 'fail-first-n' },
  { label: 'always-timeout', value: 'always-timeout' },
  { label: 'rate-limited (429)', value: 'rate-limited' },
  { label: 'response-disappear', value: 'response-disappear' },
];

const local = ref<GatewayConfig>({ mode: 'healthy' });

const showN = computed(() => local.value.mode === 'fail-first-n');
const showProbability = computed(() => local.value.mode === 'rate-limited');
const showRetryAfter = computed(() => local.value.mode === 'rate-limited');
const showTimeoutMs = computed(() => local.value.mode === 'always-timeout');

onMounted(async () => {
  await store.fetchConfig();
  local.value = { ...store.config };
});

async function save() {
  try {
    await store.updateConfig(local.value);
    toast.add({
      severity: 'success',
      summary: 'Gateway config updated',
      detail: `mode=${local.value.mode}`,
      life: 3000,
    });
  } catch (e: any) {
    toast.add({
      severity: 'error',
      summary: 'Failed to update gateway',
      detail: e.message,
      life: 5000,
    });
  }
}
</script>

<template>
  <Card>
    <template #title>Gateway Mode</template>
    <template #content>
      <div class="formgrid grid">
        <div class="field col-12 md:col-6">
          <label for="mode" class="font-semibold">Mode</label>
          <Select
            id="mode"
            v-model="local.mode"
            :options="MODES"
            option-label="label"
            option-value="value"
            class="w-full"
          />
        </div>

        <div v-if="showN" class="field col-6 md:col-3">
          <label for="n" class="font-semibold">n (fail first)</label>
          <InputNumber id="n" v-model="local.n" :min="1" :max="100" />
        </div>

        <div v-if="showProbability" class="field col-6 md:col-3">
          <label for="probability" class="font-semibold">probability (0–1)</label>
          <InputNumber
            id="probability"
            v-model="local.probability"
            :min="0"
            :max="1"
            :step="0.1"
            :min-fraction-digits="1"
            :max-fraction-digits="2"
          />
        </div>

        <div v-if="showRetryAfter" class="field col-6 md:col-3">
          <label for="retryAfterSeconds" class="font-semibold">Retry-After (s)</label>
          <InputNumber id="retryAfterSeconds" v-model="local.retryAfterSeconds" :min="1" :max="300" />
        </div>

        <div v-if="showTimeoutMs" class="field col-6 md:col-3">
          <label for="timeoutMs" class="font-semibold">timeout (ms)</label>
          <InputNumber id="timeoutMs" v-model="local.timeoutMs" :min="100" :max="30000" :step="500" />
        </div>

        <div class="field col-12">
          <Button label="Save config" icon="pi pi-save" :loading="store.loading" @click="save" />
        </div>
      </div>
    </template>
  </Card>
</template>
```

### 16. `src/components/CreatePaymentDialog.vue`

```vue
<script setup lang="ts">
import { ref, watch } from 'vue';
import { usePaymentsStore } from '@/stores/payments';
import { useToast } from 'primevue/usetoast';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import InputNumber from 'primevue/inputnumber';
import Select from 'primevue/select';

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [value: boolean]; created: [] }>();

const store = usePaymentsStore();
const toast = useToast();

const CURRENCIES = [
  { label: 'IDR', value: 'IDR' },
  { label: 'USD', value: 'USD' },
  { label: 'EUR', value: 'EUR' },
];

const form = ref({
  orderId: '',
  amount: 100000,
  currency: 'IDR',
});

const errors = ref<{ orderId?: string; amount?: string }>({});

watch(() => props.visible, (v) => {
  if (v) {
    form.value = {
      orderId: `ORD-${Date.now().toString(36).toUpperCase()}`,
      amount: 100000,
      currency: 'IDR',
    };
    errors.value = {};
  }
});

function validate(): boolean {
  errors.value = {};
  if (!form.value.orderId || form.value.orderId.length < 3) {
    errors.value.orderId = 'orderId minimal 3 karakter';
  }
  if (!form.value.amount || form.value.amount <= 0) {
    errors.value.amount = 'amount harus > 0';
  }
  return Object.keys(errors.value).length === 0;
}

async function submit() {
  if (!validate()) return;
  try {
    const payment = await store.create({
      orderId: form.value.orderId,
      amount: form.value.amount,
      currency: form.value.currency,
    });
    toast.add({
      severity: 'success',
      summary: 'Payment created',
      detail: `id=${payment.id.slice(0, 8)}… status=${payment.status}`,
      life: 4000,
    });
    emit('update:visible', false);
    emit('created');
  } catch (e: any) {
    toast.add({
      severity: 'error',
      summary: 'Create failed',
      detail: e.message,
      life: 5000,
    });
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    header="Create Payment"
    :style="{ width: '32rem' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="formgrid grid">
      <div class="field col-12">
        <label for="orderId" class="font-semibold">Order ID</label>
        <InputText id="orderId" v-model="form.orderId" class="w-full" autofocus />
        <small v-if="errors.orderId" class="p-error">{{ errors.orderId }}</small>
      </div>

      <div class="field col-6">
        <label for="amount" class="font-semibold">Amount</label>
        <InputNumber id="amount" v-model="form.amount" :min="1" class="w-full" />
        <small v-if="errors.amount" class="p-error">{{ errors.amount }}</small>
      </div>

      <div class="field col-6">
        <label for="currency" class="font-semibold">Currency</label>
        <Select
          id="currency"
          v-model="form.currency"
          :options="CURRENCIES"
          option-label="label"
          option-value="value"
          class="w-full"
        />
      </div>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="emit('update:visible', false)" />
      <Button label="Create" icon="pi pi-check" :loading="store.loading" @click="submit" />
    </template>
  </Dialog>
</template>
```

### 17. `src/components/DemoScenarioRunner.vue` — 5 buttons A–E + result Dialog

```vue
<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useGatewayStore } from '@/stores/gateway';
import { paymentsApi, type Payment } from '@/api/payments';
import { useToast } from 'primevue/usetoast';
import Card from 'primevue/card';
import Button from 'primevue/button';
import Badge from 'primevue/badge';
import Dialog from 'primevue/dialog';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import type { GatewayMode, GatewayConfig } from '@/api/gateway';

type DemoKey = 'A' | 'B' | 'C' | 'D' | 'E';

interface DemoDef {
  key: DemoKey;
  label: string;
  mode: GatewayMode;
  partial: Partial<GatewayConfig>;
  expectedStatus: Payment['status'];
  description: string;
}

const DEMOS: DemoDef[] = [
  {
    key: 'A', label: 'Demo A — transient retry', mode: 'fail-first-n',
    partial: { n: 2 }, expectedStatus: 'succeeded',
    description: 'fail-first-n=2 → 2 failed → 3rd succeeds → status=succeeded',
  },
  {
    key: 'B', label: 'Demo B — permanent failure', mode: 'client-error',
    partial: {}, expectedStatus: 'failed',
    description: 'client-error → 400 → not retried → status=failed',
  },
  {
    key: 'C', label: 'Demo C — circuit breaker', mode: 'always-timeout',
    partial: { timeoutMs: 2000 }, expectedStatus: 'scheduled_for_retry',
    description: 'always-timeout → 3 timeouts → breaker OPEN → new payment = circuit_open → scheduled_for_retry',
  },
  {
    key: 'D', label: 'Demo D — idempotency hero', mode: 'response-disappear',
    partial: {}, expectedStatus: 'succeeded',
    description: 'charge succeed + response lost → API retry → replay → actualCharges=1 (calls>=2)',
  },
  {
    key: 'E', label: 'Demo E — Retry-After', mode: 'rate-limited',
    partial: { retryAfterSeconds: 5 }, expectedStatus: 'scheduled_for_retry',
    description: '429 + Retry-After=5 → backoff honor → scheduled_for_retry with nextRetryAt ~now+5s',
  },
];

interface DemoResult {
  key: DemoKey;
  orderId: string;
  paymentId: string;
  finalStatus: Payment['status'];
  expected: Payment['status'];
  passed: boolean;
  attempts: number;
  durationMs: number;
}

const gatewayStore = useGatewayStore();
const toast = useToast();

const running = ref<DemoKey | null>(null);
const showResults = ref(false);
const results = reactive<DemoResult[]>([]);

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runDemo(def: DemoDef) {
  running.value = def.key;
  const toastId = `${Date.now()}-${def.key}`;
  toast.add({
    severity: 'info',
    summary: `Running ${def.label}…`,
    detail: 'Reset gateway + creating payment',
    life: 5000,
    id: toastId,
  });

  const orderId = `DEMO-${def.key}-${Date.now().toString(36).toUpperCase()}`;
  const startTs = Date.now();

  try {
    // 1. Reset gateway config ke mode demo.
    await gatewayStore.updateConfig({ mode: def.mode, ...def.partial });

    // 2. Create payment dengan unique orderId.
    const { payment } = await paymentsApi.create({
      orderId,
      amount: 100000,
      currency: 'IDR',
    });

    // 3. Poll status tiap 1s sampai terminal (timeout 60s).
    const TERMINAL = new Set<Payment['status']>(['succeeded', 'failed']);
    const deadline = Date.now() + 60_000;
    let final = payment;

    while (Date.now() < deadline) {
      if (TERMINAL.has(final.status)) break;
      await sleep(1000);
      const detail = await paymentsApi.getById(payment.id);
      final = detail.payment;
    }

    // 4. Fetch attempts untuk report.
    const detail = await paymentsApi.getById(payment.id);

    // 5. Assertion.
    const passed = final.status === def.expectedStatus;
    const result: DemoResult = {
      key: def.key,
      orderId,
      paymentId: payment.id,
      finalStatus: final.status,
      expected: def.expectedStatus,
      passed,
      attempts: detail.attempts.length,
      durationMs: Date.now() - startTs,
    };

    results.push(result);

    if (passed) {
      toast.remove(toastId);
      toast.add({
        severity: 'success',
        summary: `${def.label} — PASSED`,
        detail: `status=${final.status} · attempts=${detail.attempts.length}`,
        life: 5000,
      });
    } else {
      toast.remove(toastId);
      toast.add({
        severity: 'error',
        summary: `${def.label} — FAILED assertion`,
        detail: `expected=${def.expectedStatus}, got=${final.status} · attempts=${detail.attempts.length}`,
        life: 8000,
      });
    }
  } catch (e: any) {
    toast.remove(toastId);
    toast.add({
      severity: 'error',
      summary: `${def.label} — ERROR`,
      detail: e.message ?? String(e),
      life: 8000,
    });
    results.push({
      key: def.key, orderId, paymentId: '',
      finalStatus: 'failed' as Payment['status'],
      expected: def.expectedStatus, passed: false,
      attempts: 0, durationMs: Date.now() - startTs,
    });
  } finally {
    running.value = null;
  }
}

async function runAll() {
  results.length = 0;
  for (const def of DEMOS) {
    await runDemo(def);
    await sleep(500); // jeda singkat antar demo untuk reset gateway
  }
  showResults.value = true;
}
</script>

<template>
  <Card>
    <template #title>
      <div class="flex align-items-center justify-content-between">
        <span>Demo Scenario Runner</span>
        <Button
          label="Run All + Show Results"
          size="small"
          severity="secondary"
          :loading="running !== null"
          @click="runAll"
        />
      </div>
    </template>
    <template #content>
      <div class="grid">
        <div v-for="def in DEMOS" :key="def.key" class="col-12 md:col-6 lg:col-4">
          <Button
            class="w-full h-auto text-left justify-content-start"
            :label="def.label"
            :loading="running === def.key"
            :disabled="running !== null && running !== def.key"
            severity="secondary"
            outlined
            @click="runDemo(def)"
          >
            <template #default>
              <div class="p-2">
                <div class="font-semibold">{{ def.label }}</div>
                <div class="text-sm opacity-80 mt-1">{{ def.description }}</div>
                <Badge
                  v-if="results.find((r) => r.key === def.key)"
                  :value="results.find((r) => r.key === def.key)?.passed ? 'PASSED' : 'FAILED'"
                  :severity="results.find((r) => r.key === def.key)?.passed ? 'success' : 'danger'"
                  class="mt-2"
                />
              </div>
            </template>
          </Button>
        </div>
      </div>

      <Dialog v-model:visible="showResults" modal header="Demo Results" :style="{ width: '50rem' }">
        <DataTable :value="results" responsive-layout="scroll">
          <Column field="key" header="Demo" />
          <Column field="orderId" header="Order ID" />
          <Column field="finalStatus" header="Final Status" />
          <Column field="expected" header="Expected" />
          <Column field="attempts" header="Attempts" />
          <Column field="durationMs" header="Duration (ms)" />
          <Column header="Result">
            <template #body="{ data }">
              <Badge :value="data.passed ? 'PASSED' : 'FAILED'" :severity="data.passed ? 'success' : 'danger'" />
            </template>
          </Column>
        </DataTable>
      </Dialog>
    </template>
  </Card>
</template>
```

### 18. `src/components/CircuitBreakerCard.vue`

```vue
<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useMetricsStore } from '@/stores/metrics';
import { usePolling } from '@/composables/usePolling';
import Card from 'primevue/card';
import Tag from 'primevue/tag';

const store = useMetricsStore();

onMounted(() => {
  store.fetchMetrics();
  start(); // start polling
});

const { start } = usePolling(() => store.fetchMetrics(), 5_000);

const breaker = computed(() => store.breakerState);

const severity = computed(() => {
  switch (breaker.value.state) {
    case 'closed': return 'success';
    case 'half_open': return 'warn';
    case 'open': return 'danger';
    default: return 'info';
  }
});

const rejectedCount = computed(() => {
  const sample = store.findByName('circuit_breaker_rejected_total')[0];
  return sample?.value ?? 0;
});

const trippedCount = computed(() => {
  const sample = store.findByName('circuit_breaker_tripped_total')[0];
  return sample?.value ?? 0;
});
</script>

<template>
  <Card>
    <template #title>Circuit Breaker</template>
    <template #content>
      <div class="flex flex-column gap-2">
        <div class="flex align-items-center gap-2">
          <span class="font-semibold">State:</span>
          <Tag :value="breaker.state.toUpperCase()" :severity="severity" />
        </div>
        <div>Rejected requests: <strong>{{ rejectedCount }}</strong></div>
        <div>Tripped count: <strong>{{ trippedCount }}</strong></div>
        <div v-if="store.parsed" class="text-sm opacity-70">
          Last updated: {{ new Date(store.parsed.parsedAt).toLocaleTimeString() }}
        </div>
      </div>
    </template>
  </Card>
</template>
```

### 19. `src/components/StatusTag.vue`

```vue
<script setup lang="ts">
import { computed } from 'vue';
import Tag from 'primevue/tag';
import type { Payment } from '@/api/payments';

const props = defineProps<{ status: Payment['status'] }>();

const severityByStatus: Record<Payment['status'], 'success' | 'info' | 'warn' | 'danger' | 'secondary'> = {
  succeeded: 'success',
  processing: 'info',
  scheduled_for_retry: 'warn',
  failed: 'danger',
  circuit_open: 'danger',
};

const labelByStatus: Record<Payment['status'], string> = {
  succeeded: 'SUCCEEDED',
  processing: 'PROCESSING',
  scheduled_for_retry: 'SCHEDULED_RETRY',
  failed: 'FAILED',
  circuit_open: 'CIRCUIT_OPEN',
};

const severity = computed(() => severityByStatus[props.status] ?? 'secondary');
const label = computed(() => labelByStatus[props.status] ?? props.status.toUpperCase());
</script>

<template>
  <Tag :value="label" :severity="severity" />
</template>
```

### 20. `src/components/AttemptTimeline.vue` — PrimeVue Timeline

```vue
<script setup lang="ts">
import Timeline from 'primevue/timeline';
import Tag from 'primevue/tag';
import type { PaymentAttempt } from '@/api/payments';

defineProps<{ attempts: PaymentAttempt[] }>();

function outcomeSeverity(outcome: PaymentAttempt['outcome']) {
  switch (outcome) {
    case 'success': return 'success';
    case 'transient_failure': return 'warn';
    case 'permanent_failure': return 'danger';
    case 'timeout': return 'warn';
    case 'circuit_open': return 'danger';
    case 'rate_limited': return 'warn';
    default: return 'info';
  }
}
</script>

<template>
  <Timeline :value="attempts" align="alternate" class="attempt-timeline">
    <template #content="{ data }">
      <div class="attempt-item">
        <div class="flex align-items-center gap-2 mb-2">
          <strong>Attempt #{{ data.attemptNumber }}</strong>
          <Tag :value="data.outcome" :severity="outcomeSeverity(data.outcome)" />
          <Tag
            v-if="data.breakerState"
            :value="data.breakerState"
            :severity="data.breakerState === 'closed' ? 'success' : 'danger'"
          />
        </div>
        <div class="text-sm">
          <div>HTTP: {{ data.httpStatus ?? 'n/a' }}</div>
          <div>Duration: {{ data.durationMs }} ms</div>
          <div v-if="data.errorCode">Error: <code>{{ data.errorCode }}</code></div>
          <div v-if="data.retryAfterSeconds">Retry-After: {{ data.retryAfterSeconds }}s</div>
          <div class="opacity-70">Trace: <code>{{ data.traceId }}</code></div>
          <div class="opacity-70">{{ new Date(data.createdAt).toLocaleString() }}</div>
        </div>
      </div>
    </template>
    <template #marker="{ data }">
      <span class="attempt-marker" :class="`outcome-${data.outcome}`">
        {{ data.attemptNumber }}
      </span>
    </template>
  </Timeline>
</template>

<style scoped>
.attempt-item {
  padding: 0.5rem 0;
}
.attempt-marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background: var(--p-content-background);
  border: 2px solid var(--p-primary-color);
  font-weight: 600;
  font-size: 0.875rem;
}
.attempt-marker.outcome-success { border-color: var(--p-green-500); }
.attempt-marker.outcome-transient_failure,
.attempt-marker.outcome-timeout,
.attempt-marker.outcome-rate_limited { border-color: var(--p-amber-500); }
.attempt-marker.outcome-permanent_failure,
.attempt-marker.outcome-circuit_open { border-color: var(--p-red-500); }
</style>
```

### 21. `src/views/HomeView.vue`

```vue
<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { usePaymentsStore } from '@/stores/payments';
import { useMetricsStore } from '@/stores/metrics';
import { usePolling } from '@/composables/usePolling';
import Card from 'primevue/card';
import Button from 'primevue/button';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import StatusTag from '@/components/StatusTag.vue';
import GatewayModeSelector from '@/components/GatewayModeSelector.vue';
import CreatePaymentDialog from '@/components/CreatePaymentDialog.vue';
import CircuitBreakerCard from '@/components/CircuitBreakerCard.vue';
import DemoScenarioRunner from '@/components/DemoScenarioRunner.vue';
import { ref } from 'vue';

const router = useRouter();
const payments = usePaymentsStore();
const metrics = useMetricsStore();
const showCreate = ref(false);

onMounted(() => {
  payments.fetchList();
  metrics.fetchMetrics();
  startPolling();
});

const { start: startPolling } = usePolling(() => payments.fetchList(), 3_000);

const recent = computed(() => payments.list.slice(0, 5));

const totals = computed(() => {
  const all = payments.list;
  return {
    total: payments.total,
    succeeded: all.filter((p) => p.status === 'succeeded').length,
    failed: all.filter((p) => p.status === 'failed').length,
    pending: all.filter((p) => ['processing', 'scheduled_for_retry', 'circuit_open'].includes(p.status)).length,
  };
});

function gotoDetail(id: string) {
  router.push(`/payments/${id}`);
}
</script>

<template>
  <div class="grid">
    <div class="col-12 md:col-3">
      <Card>
        <template #title>Total Payments</template>
        <template #content>
          <div class="text-4xl font-bold">{{ totals.total }}</div>
        </template>
      </Card>
    </div>
    <div class="col-12 md:col-3">
      <Card>
        <template #title>Succeeded</template>
        <template #content>
          <div class="text-4xl font-bold text-green-500">{{ totals.succeeded }}</div>
        </template>
      </Card>
    </div>
    <div class="col-12 md:col-3">
      <Card>
        <template #title>Failed</template>
        <template #content>
          <div class="text-4xl font-bold text-red-500">{{ totals.failed }}</div>
        </template>
      </Card>
    </div>
    <div class="col-12 md:col-3">
      <CircuitBreakerCard />
    </div>

    <div class="col-12 md:col-6">
      <GatewayModeSelector />
    </div>

    <div class="col-12 md:col-6">
      <Card>
        <template #title>Quick Actions</template>
        <template #content>
          <div class="flex flex-column gap-2">
            <Button label="Create Payment" icon="pi pi-plus" @click="showCreate = true" />
            <Button label="View All Payments" icon="pi pi-list" severity="secondary" @click="router.push('/payments')" />
            <Button label="View Metrics" icon="pi pi-chart-bar" severity="secondary" @click="router.push('/metrics')" />
          </div>
        </template>
      </Card>
    </div>

    <div class="col-12">
      <Card>
        <template #title>Recent Payments</template>
        <template #content>
          <DataTable :value="recent" responsive-layout="scroll" @row-click="(e: any) => gotoDetail(e.data.id)">
            <Column field="orderId" header="Order ID" />
            <Column field="amount" header="Amount">
              <template #body="{ data }">{{ data.currency }} {{ data.amount.toLocaleString() }}</template>
            </Column>
            <Column header="Status">
              <template #body="{ data }"><StatusTag :status="data.status" /></template>
            </Column>
            <Column field="attemptCount" header="Attempts" />
            <Column field="createdAt" header="Created">
              <template #body="{ data }">{{ new Date(data.createdAt).toLocaleString() }}</template>
            </Column>
          </DataTable>
        </template>
      </Card>
    </div>

    <div class="col-12">
      <DemoScenarioRunner />
    </div>

    <CreatePaymentDialog v-model:visible="showCreate" />
  </div>
</template>
```

### 22. `src/views/PaymentsView.vue` — DataTable with filter + sort + pagination

```vue
<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { usePaymentsStore } from '@/stores/payments';
import { usePolling } from '@/composables/usePolling';
import Card from 'primevue/card';
import Button from 'primevue/button';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Select from 'primevue/select';
import InputText from 'primevue/inputtext';
import StatusTag from '@/components/StatusTag.vue';
import CreatePaymentDialog from '@/components/CreatePaymentDialog.vue';

const router = useRouter();
const store = usePaymentsStore();
const showCreate = ref(false);
const search = ref('');

const STATUS_FILTERS = [
  { label: 'All', value: null },
  { label: 'Processing', value: 'processing' },
  { label: 'Succeeded', value: 'succeeded' },
  { label: 'Failed', value: 'failed' },
  { label: 'Scheduled for Retry', value: 'scheduled_for_retry' },
  { label: 'Circuit Open', value: 'circuit_open' },
];

onMounted(() => {
  store.fetchList();
  startPolling();
});

const { start: startPolling } = usePolling(() => store.fetchList(), 3_000);

const filtered = computed(() => {
  if (!search.value) return store.list;
  const q = search.value.toLowerCase();
  return store.list.filter(
    (p) => p.orderId.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
  );
});

function onSort(event: { sortField: string; sortOrder: number }) {
  const field = event.sortField;
  const dir = event.sortOrder === 1 ? 'asc' : 'desc';
  store.setSort(`${field}:${dir}`);
}

function onPage(event: { first: number; rows: number }) {
  store.setPage(event.first);
}

function gotoDetail(id: string) {
  router.push(`/payments/${id}`);
}
</script>

<template>
  <Card>
    <template #title>
      <div class="flex align-items-center justify-content-between">
        <span>Payments ({{ store.total }})</span>
        <Button label="Create" icon="pi pi-plus" size="small" @click="showCreate = true" />
      </div>
    </template>
    <template #content>
      <div class="flex gap-2 mb-3">
        <Select
          v-model="store.filters.status"
          :options="STATUS_FILTERS"
          option-label="label"
          option-value="value"
          placeholder="Filter by status"
          @change="store.setStatusFilter(store.filters.status)"
        />
        <InputText v-model="search" placeholder="Search orderId / id…" class="flex-1" />
        <Button
          v-if="store.filters.status || search"
          label="Reset"
          icon="pi pi-times"
          severity="secondary"
          text
          @click="() => { store.resetFilter(); search = ''; }"
        />
      </div>

      <DataTable
        :value="filtered"
        :loading="store.loading"
        :lazy="true"
        :total-records="store.total"
        :rows="store.filters.limit"
        :first="store.filters.offset"
        :paginator="true"
        :rows-per-page-options="[10, 20, 50, 100]"
        responsive-layout="scroll"
        removable-sort
        @page="onPage"
        @sort="onSort"
        @row-click="(e: any) => gotoDetail(e.data.id)"
      >
        <Column field="id" header="ID" sortable>
          <template #body="{ data }">
            <code>{{ data.id.slice(0, 8) }}…</code>
          </template>
        </Column>
        <Column field="orderId" header="Order ID" sortable />
        <Column field="amount" header="Amount" sortable>
          <template #body="{ data }">{{ data.currency }} {{ data.amount.toLocaleString() }}</template>
        </Column>
        <Column header="Status" sortable field="status">
          <template #body="{ data }"><StatusTag :status="data.status" /></template>
        </Column>
        <Column field="attemptCount" header="Attempts" sortable />
        <Column field="totalRetryCount" header="Retries" sortable />
        <Column field="createdAt" header="Created" sortable>
          <template #body="{ data }">{{ new Date(data.createdAt).toLocaleString() }}</template>
        </Column>
      </DataTable>
    </template>
  </Card>

  <CreatePaymentDialog v-model:visible="showCreate" />
</template>
```

### 23. `src/views/PaymentDetailView.vue`

```vue
<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePaymentsStore } from '@/stores/payments';
import { useToast } from 'primevue/usetoast';
import { usePolling } from '@/composables/usePolling';
import Card from 'primevue/card';
import Button from 'primevue/button';
import StatusTag from '@/components/StatusTag.vue';
import AttemptTimeline from '@/components/AttemptTimeline.vue';

const route = useRoute();
const router = useRouter();
const store = usePaymentsStore();
const toast = useToast();

const id = computed(() => String(route.params.id));

onMounted(() => {
  store.fetchOne(id.value);
  startPolling();
});

const { start: startPolling } = usePolling(() => store.fetchOne(id.value), 3_000);

const payment = computed(() => store.current?.payment);
const attempts = computed(() => store.current?.attempts ?? []);

const canRetry = computed(() => {
  if (!payment.value) return false;
  return ['failed', 'scheduled_for_retry'].includes(payment.value.status);
});

async function manualRetry() {
  if (!payment.value) return;
  try {
    await store.retry(payment.value.id);
    toast.add({
      severity: 'success',
      summary: 'Retry triggered',
      detail: `Payment ${payment.value.id.slice(0, 8)}… retrying`,
      life: 3000,
    });
  } catch (e: any) {
    toast.add({
      severity: 'error',
      summary: 'Retry failed',
      detail: e.message,
      life: 5000,
    });
  }
}
</script>

<template>
  <div class="grid">
    <div class="col-12">
      <Button
        label="Back"
        icon="pi pi-arrow-left"
        severity="secondary"
        text
        @click="router.push('/payments')"
      />
    </div>

    <div class="col-12 md:col-6">
      <Card v-if="payment">
        <template #title>Payment Detail</template>
        <template #content>
          <div class="flex flex-column gap-2">
            <div><strong>ID:</strong> <code>{{ payment.id }}</code></div>
            <div><strong>Order ID:</strong> {{ payment.orderId }}</div>
            <div><strong>Amount:</strong> {{ payment.currency }} {{ payment.amount.toLocaleString() }}</div>
            <div class="flex align-items-center gap-2">
              <strong>Status:</strong> <StatusTag :status="payment.status" />
            </div>
            <div><strong>Attempt count:</strong> {{ payment.attemptCount }}</div>
            <div><strong>Total retry count:</strong> {{ payment.totalRetryCount }}</div>
            <div><strong>Idempotency key:</strong> <code>{{ payment.idempotencyKey }}</code></div>
            <div v-if="payment.nextRetryAt">
              <strong>Next retry at:</strong> {{ new Date(payment.nextRetryAt).toLocaleString() }}
            </div>
            <div><strong>Created:</strong> {{ new Date(payment.createdAt).toLocaleString() }}</div>
            <div><strong>Updated:</strong> {{ new Date(payment.updatedAt).toLocaleString() }}</div>

            <div class="mt-3">
              <Button
                v-if="canRetry"
                label="Manual Retry"
                icon="pi pi-refresh"
                :loading="store.loading"
                @click="manualRetry"
              />
              <small v-else class="opacity-70">
                Retry disabled — payment status is {{ payment.status }}
              </small>
            </div>
          </div>
        </template>
      </Card>
      <Card v-else-if="store.loading">
        <template #content>Loading…</template>
      </Card>
      <Card v-else>
        <template #content>Payment not found.</template>
      </Card>
    </div>

    <div class="col-12 md:col-6">
      <Card>
        <template #title>Attempt History ({{ attempts.length }})</template>
        <template #content>
          <AttemptTimeline v-if="attempts.length" :attempts="attempts" />
          <p v-else class="opacity-70">No attempts yet — payment may still be processing.</p>
        </template>
      </Card>
    </div>
  </div>
</template>
```

### 24. `src/views/MetricsView.vue` — 3 charts via PrimeVue Chart

```vue
<script setup lang="ts">
import { onMounted, computed, ref } from 'vue';
import { useMetricsStore } from '@/stores/metrics';
import { usePolling } from '@/composables/usePolling';
import Card from 'primevue/card';
import Button from 'primevue/button';
import Chart from 'primevue/chart';
import ToggleButton from 'primevue/togglebutton';

const store = useMetricsStore();
const showRaw = ref(false);

onMounted(() => {
  store.fetchMetrics();
  startPolling();
});

const { start: startPolling } = usePolling(() => store.fetchMetrics(), 5_000);

// Pie chart — status distribution.
const pieData = computed(() => {
  const dist = store.statusDistribution;
  return {
    labels: Object.keys(dist),
    datasets: [
      {
        data: Object.values(dist),
        backgroundColor: ['#22c55e', '#ef4444', '#3b82f6', '#f59e0b', '#a855f7'],
      },
    ],
  };
});

const pieOptions = {
  plugins: { legend: { position: 'bottom' } },
  responsive: true,
  maintainAspectRatio: false,
};

// Line chart — request duration histogram (cumulative).
const lineData = computed(() => {
  const buckets = store.requestDurationHistogram;
  const byLe = buckets.map((b) => ({ le: parseFloat(b.labels.le ?? '0'), value: b.value }));
  byLe.sort((a, b) => a.le - b.le);
  return {
    labels: byLe.map((b) => `${b.le}ms`),
    datasets: [
      {
        label: 'Cumulative requests',
        data: byLe.map((b) => b.value),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.2)',
        fill: true,
      },
    ],
  };
});

const lineOptions = {
  plugins: { legend: { position: 'bottom' } },
  responsive: true,
  maintainAspectRatio: false,
  scales: { y: { beginAtZero: true } },
};

// Bar chart — retry attempts per outcome.
const barData = computed(() => {
  const retries = store.retryAttempts;
  const grouped: Record<string, number> = {};
  for (const r of retries) {
    const outcome = r.labels.outcome ?? 'unknown';
    grouped[outcome] = (grouped[outcome] ?? 0) + r.value;
  }
  return {
    labels: Object.keys(grouped),
    datasets: [
      {
        label: 'Retry attempts',
        data: Object.values(grouped),
        backgroundColor: '#f59e0b',
      },
    ],
  };
});

const barOptions = {
  plugins: { legend: { position: 'bottom' } },
  responsive: true,
  maintainAspectRatio: false,
  scales: { y: { beginAtZero: true } },
};
</script>

<template>
  <div class="grid">
    <div class="col-12 md:col-4">
      <Card>
        <template #title>Status Distribution</template>
        <template #content>
          <div style="height: 300px"><Chart type="pie" :data="pieData" :options="pieOptions" /></div>
        </template>
      </Card>
    </div>

    <div class="col-12 md:col-4">
      <Card>
        <template #title>Request Duration (histogram)</template>
        <template #content>
          <div style="height: 300px"><Chart type="line" :data="lineData" :options="lineOptions" /></div>
        </template>
      </Card>
    </div>

    <div class="col-12 md:col-4">
      <Card>
        <template #title>Retry Attempts by Outcome</template>
        <template #content>
          <div style="height: 300px"><Chart type="bar" :data="barData" :options="barOptions" /></div>
        </template>
      </Card>
    </div>

    <div class="col-12">
      <Card>
        <template #title>
          <div class="flex align-items-center justify-content-between">
            <span>Raw Metrics (Prometheus text)</span>
            <ToggleButton
              v-model="showRaw"
              on-label="Hide raw"
              off-label="Show raw"
              on-icon="pi pi-eye-slash"
              off-icon="pi pi-eye"
            />
          </div>
        </template>
        <template #content>
          <pre v-if="showRaw" class="raw-metrics">{{ store.parsed?.raw ?? 'No metrics loaded.' }}</pre>
          <p v-else class="opacity-70">Click "Show raw" to view the full Prometheus exposition text.</p>
          <Button
            label="Refresh now"
            icon="pi pi-refresh"
            severity="secondary"
            :loading="store.loading"
            class="mt-2"
            @click="store.fetchMetrics()"
          />
        </template>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.raw-metrics {
  max-height: 400px;
  overflow: auto;
  background: var(--p-content-hover-background);
  padding: 1rem;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.875rem;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
```

### 25. `src/styles.css` — PrimeVue theme import + custom

```css
/* PrimeVue 4 Aura preset — sudah di-import via main.ts (preset: Aura). */
/* Tapi primeicons CSS tetap perlu di-import manual di sini. */
@import 'primeicons/primeicons.css';

/* Reset + base. */
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--p-font-family, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
  background: var(--p-content-background, #ffffff);
  color: var(--p-text-color, #1e293b);
  min-height: 100vh;
}

/* Dark mode override (toggle via .app-dark class on <html>). */
html.app-dark body {
  background: #0f172a;
  color: #e2e8f0;
}

/* Code styling. */
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--p-content-hover-background, #f1f5f9);
  padding: 0.125rem 0.375rem;
  border-radius: 3px;
  font-size: 0.875em;
}

/* Link styling. */
a { color: var(--p-primary-color); text-decoration: none; }
a:hover { text-decoration: underline; }

/* PrimeVue router-link active state. */
nav a.router-link-active {
  font-weight: 600;
  color: var(--p-primary-color);
}

/* Mobile responsive container. */
@media (max-width: 768px) {
  .container { padding: 0 0.5rem; }
  nav { gap: 0.5rem; font-size: 0.875rem; }
}
```

## Acceptance criteria

- [ ] `cd apps/frontend-vue && pnpm dev` starts Vite dev server on `http://localhost:5173` tanpa error (check console output: "VITE v5.4.x ready in ~300ms").
- [ ] `/` route renders `HomeView` dengan sticky header (logo + nav + dark mode toggle) + sticky footer (text + API base URL).
- [ ] `GatewayModeSelector`: pilih mode (misal `fail-first-n`) + isi `n=2` + Save → toast success muncul + verify via `curl http://localhost:3002/admin/config` bahwa config benar-benar ter-update.
- [ ] `CreatePaymentDialog`: click "Create Payment" → Dialog muncul → isi orderId + amount + currency → submit → toast success muncul + verify via `curl http://localhost:3001/api/payments` bahwa payment baru ada di list.
- [ ] `PaymentsView`: DataTable menampilkan payments dengan kolom id (truncated), orderId, amount, currency, status (StatusTag), attemptCount, totalRetryCount, createdAt. Filter by status berfungsi. Sort by kolom berfungsi. Paginator 20 rows berfungsi. Search box filter berfungsi.
- [ ] Klik row di DataTable → navigate ke `/payments/:id` → `PaymentDetailView` muncul dengan payment detail + `AttemptTimeline`.
- [ ] `AttemptTimeline`: menampilkan setiap attempt dengan attemptNumber, outcome (Tag), breakerState (Tag), durationMs, httpStatus, traceId, createdAt.
- [ ] Manual retry button: visible hanya bila status ∈ {`failed`, `scheduled_for_retry`}. Hidden bila `succeeded` (dengan helper text "Retry disabled — payment status is succeeded"). Click → trigger `POST /api/payments/:id/retry` → toast + refetch.
- [ ] `MetricsView`: 3 Chart components (Pie status distribution, Line duration histogram, Bar retry attempts) menampilkan data dari `/api/metrics`. Charts auto-refresh tiap 5 detik. Raw metrics textarea collapsible.
- [ ] `DemoScenarioRunner`: 5 tombol A–E visible. Click satu → toast "Running…" → gateway mode ter-reset → payment dibuat → poll sampai terminal → toast PASSED/FAILED dengan assertion. Click "Run All + Show Results" → 5 demo run sequential → Dialog result table muncul dengan kolom Demo, Order ID, Final Status, Expected, Attempts, Duration, Result Badge.
- [ ] `CircuitBreakerCard`: menampilkan state breaker (closed/half_open/open) + rejected count + tripped count. Auto-refresh tiap 5 detik.
- [ ] Mobile responsive: viewport `375x812` (iPhone) → layout grid collapse ke 1 kolom, header nav masih readable, DataTable horizontal scroll, semua cards stack vertikal.
- [ ] Dark mode toggle: click button sun/moon di header → tema berubah (Aura preset dark). Re-check all components readable di dark mode.
- [ ] `pnpm typecheck` lulus (vue-tsc --noEmit, no errors). `pnpm lint` lulus (eslint --max-warnings 0).
- [ ] `pnpm build` menghasilkan `dist/` folder dengan `index.html` + `assets/*.js` + `assets/*.css`. `pnpm preview` serve di port 4173 tanpa error.
- [ ] Agent Browser verification (akan diformalkan di TASK-14): minimal 1 screenshot dashboard + 1 screenshot setelah Demo A run + 1 screenshot PaymentDetailView dengan AttemptTimeline. Full E2E matrix → TASK-14.

## Useful commands (run after completing this task)

```bash
# 0. Pre-requisite: enable pnpm via corepack (sekali saja, bila belum)
corepack enable pnpm
corepack prepare pnpm@latest --activate

# 1. Start backend services (di terminal terpisah, urutan penting)
#    a. PostgreSQL (bila pakai docker-compose)
cd /home/z/my-project/retry-failure && docker compose up -d postgres
# Atau bila PostgreSQL managed eksternal, skip — pastikan DATABASE_URL reachable.

#    b. Gateway mock (port 3002)
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock && pnpm start:dev
# Expected log: "Gateway mock running on http://localhost:3002"

#    c. Payment API (port 3001)
cd /home/z/my-project/retry-failure/apps/payment-api && pnpm start:dev
# Expected log: "Payment API running on http://localhost:3001" + "Swagger UI: http://localhost:3001/docs"

# 2. Install frontend dependencies (first time only)
cd /home/z/my-project/retry-failure/apps/frontend-vue && pnpm install
# Expected: lockfile created, node_modules populated, ~200 packages installed.

# 3. Dev mode (port 5173)
cd /home/z/my-project/retry-failure/apps/frontend-vue && pnpm dev
# Expected log: "VITE v5.4.x ready in ~300ms" + "Local: http://localhost:5173/"
# Note: ini BUKAN port 3000 (Next.js sandbox) — buka tab baru di browser.

# 4. Typecheck (vue-tsc)
cd /home/z/my-project/retry-failure/apps/frontend-vue && pnpm typecheck
# Expected: exit 0, no output (all good).

# 5. Lint (eslint)
cd /home/z/my-project/retry-failure/apps/frontend-vue && pnpm lint
# Expected: exit 0, no warnings.

# 6. Production build
cd /home/z/my-project/retry-failure/apps/frontend-vue && pnpm build
# Expected: "dist/index.html" + "dist/assets/index-*.js" + "dist/assets/index-*.css" + sourcemaps.

# 7. Preview production build (port 4173)
cd /home/z/my-project/retry-failure/apps/frontend-vue && pnpm preview
# Expected: "Local: http://localhost:4173/"

# 8. Open browser
#    - Buka http://localhost:5173 di browser (NEW TAB — bukan preview sandbox 3000)
#    - Dashboard harus render tanpa console error (cek DevTools Console).
#    - Click "Create Payment" → Dialog muncul → submit → payment muncul di Recent Payments.
#    - Click row → navigate ke /payments/:id → AttemptTimeline muncul.
#    - Click "Run All + Show Results" di Demo Scenario Runner → 5 demo run → Dialog result.

# 9. Manual curl verification of API endpoints the Vue app will call
#    (semua harus 200 OK atau 201 Created)

#    a. GET gateway config (port 3002, NOT via Caddy)
curl -i http://localhost:3002/admin/config
# Expected: 200 OK, { "mode": "healthy", ... }

#    b. PUT gateway config (port 3002)
curl -i -X PUT http://localhost:3002/admin/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"fail-first-n","n":2}'
# Expected: 200 OK, { "mode": "fail-first-n", "n": 2, ... }

#    c. GET gateway stats (port 3002)
curl -i http://localhost:3002/admin/stats
# Expected: 200 OK, { "totalRequests": ..., "successCount": ..., ... }

#    d. GET payment-api health (port 3001)
curl -i http://localhost:3001/api/health
# Expected: 200 OK, { "db": "ok", "gateway": "ok", "timestamp": "..." }

#    e. GET payments list (port 3001)
curl -i http://localhost:3001/api/payments
# Expected: 200 OK, { "payments": [...], "total": N, "limit": 50, "offset": 0 }

#    f. POST new payment (port 3001)
curl -i -X POST http://localhost:3001/api/payments \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"MANUAL-VUE-001","amount":150000,"currency":"IDR"}'
# Expected: 201 Created, { "payment": { ..., "status": "succeeded"|"failed"|"scheduled_for_retry" } }

#    g. GET payment detail by id (port 3001) — replace <id> dari response (f)
curl -i http://localhost:3001/api/payments/<id>
# Expected: 200 OK, { "payment": { ... }, "attempts": [...] }

#    h. POST manual retry (port 3001) — only bila status failed/scheduled_for_retry
curl -i -X POST http://localhost:3001/api/payments/<id>/retry
# Expected: 200 OK, { "payment": { ..., "status": "processing" } }
# Atau 409 Conflict bila status=succeeded.

#    i. GET metrics (port 3001, Prometheus text format)
curl -s http://localhost:3001/api/metrics | head -n 30
# Expected: text/plain, lines seperti:
#   # HELP payment_gateway_requests_total ...
#   payment_gateway_requests_total{result="success"} 5
#   # HELP circuit_breaker_state ...
#   circuit_breaker_state{state="closed"} 1
#   ...

#    j. CORS preflight check (bila Vue app di 5173 fetch ke 3001)
curl -i -X OPTIONS http://localhost:3001/api/payments \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: GET'
# Expected: 204 No Content + header:
#   Access-Control-Allow-Origin: http://localhost:5173
#   Access-Control-Allow-Methods: GET, POST, ...

# 10. Agent Browser verification (akan diformalkan di TASK-14)
#     - Minimal 3 screenshots:
#       (1) HomeView dengan cards + gateway selector
#       (2) Setelah Demo A run — toast PASSED muncul
#       (3) PaymentDetailView dengan AttemptTimeline
#     - Full E2E matrix (Demo A-E, manual retry, gateway mode switch, mobile viewport)
#       → TASK-14 akan automate via Agent Browser + assertions.

# 11. Cleanup bila perlu
#     a. Reset gateway config ke healthy
curl -X PUT http://localhost:3002/admin/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"healthy"}'

#     b. Stop services (Ctrl+C di masing-masing terminal)
#     c. Inspect Vite dev log bila ada error:
tail -n 200 /tmp/vite-vue.log 2>/dev/null || true
```

## Notes

### Vue app runs on port 5173 (NOT 3000) — direct fetch to payment-api:3001 allowed

- Next.js sandbox (TASK-12) berjalan di port 3000 (parent root), terkunci Caddy single-port → harus pakai `?XTransformPort=NNNN` di query string.
- Vue dashboard (TASK-13) berjalan di port 5173 (Vite dev server di `apps/frontend-vue/`), **bukan via Caddy** → **direct fetch ke `http://localhost:3001` di-allow** oleh browser.
- CORS di TASK-09 controller meng-enable origin `http://localhost:5173` + `http://localhost:3000`. Verifikasi via OPTIONS request (lihat command 9.j di atas).
- Build production (`pnpm build`) menghasilkan `dist/` folder — bisa di-serve via nginx / any static server. Untuk production, set `VITE_PAYMENT_API_URL` ke URL production API sebelum build.

### PrimeVue 4.x new theming API — presets (Aura, Material, Lara, Nora)

- PrimeVue 4.x memperkenalkan theming API baru berbasis **preset** (bukan CSS primeflex lama).
- Preset yang tersedia: `Aura` (default, modern), `Material` (Material Design), `Lara` (legacy), `Nora` (purple-accent).
- TASK-13 pakai **Aura preset** (default light + dark mode toggle via `.app-dark` class).
- Import via `import Aura from '@primevue/themes/aura'` lalu `app.use(PrimeVue, { theme: { preset: Aura, options: { darkModeSelector: '.app-dark' } } })`.
- primeicons CSS tetap perlu di-import manual di `styles.css` (`@import 'primeicons/primeicons.css'`).

### Composition API + script setup

- Semua component memakai `<script setup lang="ts">` — sintaks paling modern Vue 3.5.
- Tidak pakai Options API (`export default { data, methods, computed }`) kecuali untuk edge case (lihat `App.vue` yang punya `<script lang="ts">` kedua untuk non-reactive `apiBaseUrl`).
- Type-only imports pakai `import type { ... }` (Vue 3.5 + TS 5.7 requirement).

### Pinia for state (bukan Vuex)

- Vuex deprecated untuk proyek baru — Vue 3 official state management adalah Pinia.
- Setup-style store (`defineStore('name', () => { ... })`) — lebih type-safe + better tree-shaking daripada options-style.
- Store terpisah per domain: `payments`, `gateway`, `metrics`. Composable `usePolling` untuk periodic refetch.

### vue-router for SPA routing

- Mode: `createWebHistory()` (HTML5 history API, bukan hash mode). Requires server-side fallback ke `index.html` untuk deep links (di production nginx: `try_files $uri $uri/ /index.html;`).
- Semua views lazy-loaded via dynamic `import()` — Vite code-split per route.
- Scroll behavior: reset ke top on navigate (kecuali `savedPosition` untuk back/forward).

### axios dengan interceptors untuk error handling

- Satu instance axios per backend (`api` untuk payment-api:3001, `gatewayApi` untuk gateway-mock:3002).
- Response interceptor meng-normalize error menjadi `{ status, message, url, method }` lalu dispatch `CustomEvent` (`api:error`) — listener di App.vue show Toast.
- **Tidak import Pinia langsung di `client.ts`** untuk hindari circular dependency (Pinia store butuh api module, api module butuh Pinia untuk toast — cycle). CustomEvent adalah clean solution.

### Polling via composables/usePolling.ts

- Generic composable: `usePolling(fn, intervalMs, options?)` returns `{ isPolling, start, stop }`.
- Auto-cleanup pada `onUnmounted` (memanggil `stop()`).
- Options: `immediate: true` (default — call fn on start), `skipIfRunning: true` (default — skip iteration bila fn sebelumnya masih berjalan).
- Interval yang dipakai: 3s (payments list + payment detail), 5s (metrics + circuit breaker), 10s (health — bila ditampilkan).
- Tidak ada WebSocket/SSE — semua real-time illusion via polling.

### PrimeVue Chart wrapper untuk Chart.js (line + bar + pie + doughnut)

- PrimeVue `Chart` adalah thin wrapper di sekitar Chart.js 4.x.
- Props: `type` ('pie' | 'doughnut' | 'bar' | 'line' | 'radar' | 'polarArea' | 'horizontalBar'), `data`, `options`.
- Data reactive — bila Pinia store update, chart otomatis re-render.
- Tidak perlu install Chart.js manual selain dependency di `package.json` (`chart.js@4.4.7`). PrimeVue Chart component akan pakai Chart.js global dari peer dep.
- Container harus punya height explicit (Chart.js butuh height — bila parent height 0, chart akan render 0px). Pakai `<div style="height: 300px"><Chart ... /></div>`.

### Mobile responsive via PrimeVue responsive grid

- PrimeVue 4.x pakai CSS grid 12-column (`col-12`, `col-6`, `col-4`, dst).
- Responsive breakpoints: `md:col-6` (768px+), `lg:col-4` (992px+), `xl:col-3` (1200px+).
- Default mobile (under 768px): semua col jadi `col-12` (full width).
- DataTable: `responsiveLayout="scroll"` untuk horizontal scroll di mobile bila kolom terlalu banyak.

### Setelah task ini selesai

- TASK-14 (E2E scenarios) bisa verify **both** Next.js sandbox (TASK-12, port 3000) **dan** Vue dashboard (TASK-13, port 5173).
- TASK-15 (documentation) akan mereferensikan `http://localhost:5173` sebagai official demo URL (bukan port 3000).
- Production deploy: `pnpm build` → copy `dist/` ke nginx / CDN. Set env `VITE_PAYMENT_API_URL` ke URL production API sebelum build.
- Bila ingin dashboard lebih kaya (real-time push, more charts, user auth), buat TASK-16+ (future work, tidak di plan rev 2).
