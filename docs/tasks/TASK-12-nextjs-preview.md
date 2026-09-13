# TASK-12 — Next.js Preview Sandbox (parent root, port 3000)

> **Task ID**: 9
> **Depends on**: 6-b (TASK-09 API Routes — `GET /payments`, `GET /payments/:id`, `POST /payments`, `POST /payments/:id/retry`, `GET /metrics`) + 6-b implicitly juga bergantung pada gateway mock (TASK-03 `/admin/config`) dan observability registry (TASK-11 untuk `/metrics` real values).
> **Estimated effort**: M (~3-4 jam)
> **Plan reference**: Section 17 (Frontend Dashboard Strategy, rev 2) + Section 17.1 (Next.js Preview Sandbox) + Section 18 (Demonstration Scenarios A–E)

---

## Goal

Membangun **Next.js dashboard kompak** di parent root `/home/z/my-project/src/app/page.tsx` (overwrite existing demo scaffold) sebagai **sandbox preview** untuk plan Cockatiel Retry/Failure. Dashboard ini adalah **subset fungsionalitas** dari dashboard resmi (Vue+PrimeVue — TASK-13) — cukup untuk **verifikasi visual** dari behavior backend tanpa membuka full Docker stack.

Tujuan utama:

1. **Gateway mode selector** — form kecil untuk PUT `/admin/config` ke gateway mock (port 3002 via `XTransformPort`). Pilih mode (`healthy` | `client-error` | `fail-first-n` | `always-timeout` | `rate-limited` | `response-disappear`) + parameter (`n`, `probability`, `retryAfterSeconds`, `timeoutMs`).
2. **Create payment form** — `POST /api/payments` (port 3001 via `XTransformPort`) dengan input `orderId`, `amount`, `currency`. Setelah submit, payment langsung muncul di list (refetch invalidate).
3. **Payment list** — `GET /api/payments` dengan polling 3 detik (`refetchInterval: 3000`). Klik row → buka drawer detail.
4. **Payment detail drawer** — menampilkan field payment + attempt history (urut attemptNumber ASC). Tombol manual retry (`POST /api/payments/:id/retry`) — disabled bila status `succeeded`.
5. **Metrics snapshot** — poll `GET /metrics` (Prometheus text format) tiap 5 detik, parse dengan simple regex per line, render 7 metric cards dengan current value.
6. **Circuit breaker card** — baca metric `payment_circuit_breaker_state` (gauge 0=closed, 1=half_open, 2=open) + `payment_gateway_requests_total{result="circuit_open"}` untuk menampilkan real-time state. Polling 5 detik.
7. **Demo scenario runner** — 5 tombol (Demo A–E) yang menjalankan end-to-end scenario: reset gateway mode → PUT target mode → POST new payment dengan unique `orderId` prefix → poll `GET /api/payments/:id` tiap 1 detik sampai terminal status (timeout 60 detik) → toast hasil dengan assertions (succeeded? failed? attempts? actualCharges?).

Setelah task ini selesai:

- **TASK-13** (Vue+PrimeVue dashboard) dapat mengonsumsi data dari API yang sama. TASK-12 bukan prerequisite TASK-13 — keduanya parallel di Batch 6.
- **TASK-14** (E2E scenarios via Agent Browser) dapat diverifikasi dengan navigate ke `http://localhost:3000` dan klik tombol Demo A–E. TASK-12 menyediakan UI; TASK-14 formalisasi verifikasi end-to-end.

## Scope

**In scope**:

- `src/app/page.tsx` — **overwrite existing** demo content (saat ini adalah Next.js scaffold demo Z.ai). Replace dengan dashboard Cockatiel.
- `src/components/payments/gateway-mode-selector.tsx` — form Select + Input untuk update gateway config.
- `src/components/payments/create-payment-form.tsx` — form input `orderId`/`amount`/`currency` + submit button.
- `src/components/payments/payment-list.tsx` — list/table dengan polling auto-refresh.
- `src/components/payments/payment-detail.tsx` — drawer (vaul) yang menampilkan detail + attempt history.
- `src/components/payments/attempt-history.tsx` — sub-komponen timeline attempts (di dalam drawer).
- `src/components/payments/circuit-breaker-card.tsx` — card menampilkan breaker state (closed/half_open/open) dengan polling metrics.
- `src/components/payments/metrics-snapshot.tsx` — 7 metric cards hasil parse Prometheus text.
- `src/components/payments/demo-scenario-runner.tsx` — 5 tombol A–E yang menjalankan end-to-end scenario.
- `src/hooks/payments.ts` — TanStack Query hooks (`useCreatePayment`, `usePayments`, `usePaymentDetail`, `useManualRetry`, `useGatewayConfig`, `useUpdateGatewayConfig`, `useMetricsSnapshot`).
- `src/lib/payments/api-client.ts` — browser fetch wrappers (`apiGet`, `apiPost`, `apiPut`) yang selalu menyertakan `?XTransformPort=NNNN` ke relative path.

**Out of scope**:

- **Full dashboard** (advanced filter + sort + pagination + charts) → **TASK-13** Vue+PrimeVue. TASK-12 = preview ringkas, bukan production UI.
- **Authentication / RBAC** → tidak dipakai di plan rev 2. Semua endpoint terbuka (production caveat di TASK-15).
- **Real-time push** (WebSocket / SSE) → tidak dipakai. Pakai polling 3 detik (payments) + 5 detik (metrics). Real-time push → future work, tidak di plan rev 2.
- **Production design system** → pakai existing shadcn/ui components di `src/components/ui/*` (sudah ter-install dari scaffold). Tidak perlu custom theme — pakai default `bg-background`, `text-foreground`, `bg-muted`, `bg-primary`, dst.
- **Server-side rendering untuk initial data** → opsional. Bisa SSR dengan `fetch` di `page.tsx` server component, tapi untuk sandbox simplicity, **client-side only** (`'use client'` + TanStack Query) lebih mudah. Document trade-off di Notes.
- **Custom API proxy routes** di `src/app/api/*` → alternatif pattern (Next.js route handler proxy ke backend) lebih clean karena tidak expose `XTransformPort` ke client code. Tapi untuk demo simplicity, **direct fetch dengan `XTransformPort` di query string** diterima. Document both options di Implementation steps.
- **Idempotency-Key client-side** → service yang generate `payment.id` + derive key (lihat TASK-09 Notes). Client hanya kirim `{ orderId, amount, currency }`.
- **Demo scenario assertion logic yang exhaustive** → 5 tombol Demo A–E menjalankan flow + simple assertion (status terminal sesuai expected). Untuk full E2E assertions → TASK-14 (Jest + Agent Browser).
- **Pagination + infinite scroll** di payment list → tidak perlu untuk sandbox preview (limit 50 cukup). Document di Notes bila perlu.
- **Charts / time-series visualization** → tidak perlu. Metrics snapshot adalah numeric cards, bukan chart. Untuk chart → TASK-13 (PrimeVue Chart wrapper Chart.js).

## Plan section 17.1 strategy

Dikutip dari `upload/PLAN1_Cockatiel_Retry_Failure_Scenario.md` section 17.1:

- **Tujuan**: Visualisasi cepat di sandbox cloud yang hanya mempermit satu port (3000).
- **Stack**: Next.js 16 (App Router) + shadcn/ui + TanStack Query.
- **Scope**: Subset fungsionalitas — gateway mode selector, create payment, list, detail drawer, metrics snapshot. Cukup untuk verifikasi visual.
- **Konsumen**: Hanya dipakai bila environment sandbox Next.js aktif. Bukan bagian resmi demo bila dijalankan dengan full Docker stack.
- **Implementasi**: 1 task (TASK-12).

**Konsekuensi**:

- Tidak ada demo script production yang me-reference TASK-12 sebagai official UI. Official demo pakai TASK-13 (Vue+PrimeVue).
- Bila user menjalankan full Docker stack (Postgres + payment-api + gateway-mock + frontend-vue + Prometheus + Grafana), TASK-12 tidak perlu dijalankan. Next.js sandbox opsional.
- Tapi bila sandbox cloud hanya permit port 3000 (single-port env), Next.js preview adalah satu-satunya cara untuk visual verify backend behavior tanpa SSH-tunnel ke port lain.

## Caddy rule — `XTransformPort` pattern

Caddy di sandbox mempermit single port (default `:81` di `Caddyfile`). Semua cross-service request dari Next.js client WAJIB pakai relative path + query `?XTransformPort=NNNN`:

```text
Next.js (port 3000)
  │
  ├── GET /api/payments?XTransformPort=3001       → Caddy reverse_proxy → localhost:3001
  ├── POST /api/payments?XTransformPort=3001       → Caddy reverse_proxy → localhost:3001
  ├── GET /api/payments/:id?XTransformPort=3001    → Caddy reverse_proxy → localhost:3001
  ├── POST /api/payments/:id/retry?XTransformPort=3001 → Caddy reverse_proxy → localhost:3001
  ├── GET /api/health?XTransformPort=3001          → Caddy reverse_proxy → localhost:3001
  ├── GET /api/metrics?XTransformPort=3001         → Caddy reverse_proxy → localhost:3001
  └── PUT /admin/config?XTransformPort=3002        → Caddy reverse_proxy → localhost:3002 (gateway mock)
```

> **Caddyfile rule** (`/home/z/my-project/Caddyfile`):
> ```caddy
> :81 {
>   @transform_port_query { query XTransformPort=* }
>   handle @transform_port_query {
>     reverse_proxy localhost:{query.XTransformPort} { ... }
>   }
>   handle {
>     reverse_proxy localhost:3000 { ... }  # Next.js default
>   }
> }
> ```

### Aturan WAJIB (no exceptions)

1. **NEVER hardcode `http://localhost:3001` atau `http://localhost:3002` di client code**. Selalu gunakan relative path (`/api/payments`, `/admin/config`) + `?XTransformPort=NNNN`.
2. **`XTransformPort` ditambahkan di `api-client.ts`** (centralized), bukan di setiap hook. Hook hanya menerima `endpoint` arg tanpa port.
3. **Bila ingin hide `XTransformPort` dari client code** (production pattern), buat Next.js API route proxy di `src/app/api/[...path]/route.ts` yang meneruskan ke `http://localhost:NNNN`. Untuk sandbox simplicity, direct fetch dengan `XTransformPort` di query string diterima. Document both options di Implementation steps.
4. **`/api/payments` prefix** — Next.js default `src/app/api/*` route sudah ada (`src/app/api/route.ts` existing scaffold). Untuk hindari konflik, semua fetch ke payment-api pakai prefix `/api/payments?XTransformPort=3001` (Next.js route `/api/payments` belum ada, jadi Caddy akan handle). Bila Next.js punya route `/api/payments` sendiri, Caddy rule `@transform_port_query` akan short-circuit karena query param `XTransformPort` ada — tidak akan match Next.js route. **Verifikasi**: jalankan `bun run dev` + `curl -i 'http://localhost:3000/api/payments?XTransformPort=3001'` — harus return JSON dari payment-api, bukan 404 Next.js.

## Layout diagram (ASCII art)

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ HEADER (sticky top-0, z-50, backdrop-blur)                              │
│  ┌─────────────────────────────────┐  ┌──────────────────────────────┐ │
│  │ Cockatiel Retry Sandbox         │  │ Gateway: ● healthy  [pill]   │ │
│  │ Next.js preview (port 3000)     │  │ Breaker:  ● closed  [pill]   │ │
│  └─────────────────────────────────┘  └──────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│ MAIN grid (1-col mobile / 2-col md / 3-col lg, gap-4, p-4 md:p-6)       │
│                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐       │
│  │ Gateway Mode     │  │ Create Payment   │  │ Circuit Breaker  │       │
│  │ Selector         │  │ Form             │  │ Card (poll 5s)   │       │
│  │                  │  │                  │  │                  │       │
│  │ [Select mode ▼]  │  │ orderId [____]   │  │ State: ● closed  │       │
│  │ n        [____]  │  │ amount  [____]   │  │ Opens: 0         │       │
│  │ prob     [____]  │  │ currency [IDR▼]  │  │ Closes: 0        │       │
│  │ retrySec [____]  │  │ [ Create ]       │  │ Half-opens: 0    │       │
│  │ timeoutMs[____]  │  │                  │  │                  │       │
│  │ [ Save Config ]  │  │                  │  │                  │       │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘       │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Metrics Snapshot (col-span-full md:col-span-2 lg:col-span-3)    │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐         │   │
│  │  │ reqs   │ │ reqs   │ │ retry  │ │ pay    │ │ pay    │         │   │
│  │  │ total  │ │ failed │ │ attempts│ │ success│ │ failed │         │   │
│  │  │  1234  │ │   45   │ │   87   │ │  34    │ │  12    │         │   │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘         │   │
│  │  ┌────────┐ ┌────────┐                                            │   │
│  │  │ circuit│ │ circuit│                                            │   │
│  │  │ opens  │ │ state  │                                            │   │
│  │  │  3     │ │ closed │                                            │   │
│  │  └────────┘ └────────┘                                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Demo Scenario Runner (col-span-full)                            │   │
│  │  [A transient retry] [B permanent fail] [C circuit breaker]     │   │
│  │  [D idempotency hero] [E Retry-After]                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Payment List (col-span-full, polling 3s)                       │   │
│  │  orderId    amount  status        attempts  totalRetry  updated│   │
│  │  ─────────  ──────  ────────────  ────────  ──────────  ────────│   │
│  │  ORD-001    150000  ● succeeded   3/3       0           10:25   │   │
│  │  ORD-002    50000   ● failed      1/1       0           10:30   │   │
│  │  ORD-003    200000  ● processing  2/-       0           10:32   │   │
│  │  ORD-004    75000   ● scheduled   3/3       1           10:35   │   │
│  │  ↑ click row to open drawer with attempt history               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────┐
│ FOOTER (sticky bottom via mt-auto, bg-muted/50, border-t, p-4)          │
│  Scenario legend: A=transient | B=permanent | C=breaker | D=idempotency │
│                   E=Retry-After                                          │
│  v0.1 · plan rev 2 · Next.js 16 · shadcn/ui · TanStack Query            │
└─────────────────────────────────────────────────────────────────────────┘
```

**Sticky footer trick** — `min-h-screen flex flex-col` pada root, lalu `<footer className="mt-auto">`. Bila konten pendek, footer tetap di bawah viewport (tidak floating gap).

## Files to create/modify

Semua path absolut di parent root `/home/z/my-project/`:

### Create baru

- `/home/z/my-project/src/lib/payments/api-client.ts` — browser fetch helpers (`apiGet`, `apiPost`, `apiPut`, `apiDelete` opsional).
- `/home/z/my-project/src/hooks/payments.ts` — TanStack Query hooks (7 hooks).
- `/home/z/my-project/src/components/payments/gateway-mode-selector.tsx`
- `/home/z/my-project/src/components/payments/create-payment-form.tsx`
- `/home/z/my-project/src/components/payments/payment-list.tsx`
- `/home/z/my-project/src/components/payments/payment-detail.tsx` (drawer)
- `/home/z/my-project/src/components/payments/attempt-history.tsx`
- `/home/z/my-project/src/components/payments/circuit-breaker-card.tsx`
- `/home/z/my-project/src/components/payments/metrics-snapshot.tsx`
- `/home/z/my-project/src/components/payments/demo-scenario-runner.tsx`
- `/home/z/my-project/src/app/providers.tsx` (opsional — bila ingin centralize QueryClientProvider; alternatif: wrap inline di `page.tsx`).

### Modify

- `/home/z/my-project/src/app/page.tsx` — **overwrite existing** Z.ai scaffold demo dengan dashboard Cockatiel. `'use client'` directive di top of file.
- `/home/z/my-project/src/app/layout.tsx` — **minimal modify**: bila pilih pattern `providers.tsx`, wrap `{children}` dengan `<Providers>`. Bila pilih pattern inline di `page.tsx`, layout.tsx tidak perlu diubah. Implementer pilih salah satu.

### Tidak diubah

- `/home/z/my-project/src/app/api/route.ts` — existing Next.js route handler. Bila ingin hide `XTransformPort` via Next.js proxy, tambahkan route baru `/api/payments/[...path]/route.ts` (out of scope untuk sandbox simplicity — direct fetch dengan `XTransformPort` diterima).
- `/home/z/my-project/src/components/ui/*` — existing shadcn/ui components. Tidak perlu modifikasi.
- `/home/z/my-project/src/lib/utils.ts` — existing `cn()` helper (digunakan oleh semua komponen shadcn/ui).
- `/home/z/my-project/src/hooks/use-toast.ts`, `src/hooks/use-mobile.ts` — existing hooks (boleh reuse bila perlu).

## Implementation steps

### 1. `src/lib/payments/api-client.ts` — browser fetch wrappers

```ts
'use client';

/**
 * Browser-side fetch helpers untuk Next.js sandbox preview.
 *
 * Semua cross-service request WAJIB pakai relative path + ?XTransformPort=NNNN.
 * JANGAN hardcode http://localhost:3001 atau http://localhost:3002 di sini.
 *
 * Caddy rule (Caddyfile @transform_port_query) akan reverse_proxy ke
 * localhost:{query.XTransformPort} bila query param ada.
 */

const PAYMENT_API_PORT = 3001; // payment-api (NestJS)
const GATEWAY_MOCK_PORT = 3002; // payment-gateway-mock (NestJS)

/** Helper: bangun URL dengan XTransformPort query param. */
function withPort(path: string, port: number): string {
  // Preserve existing query params bila ada (mis. ?status=failed).
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}XTransformPort=${port}`;
}

/** Typed wrapper untuk fetch JSON. */
async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...init,
  });

  if (!res.ok) {
    // Coba parse error body — NestJS default exception filter:
    // { statusCode, message, error } atau { statusCode, message: string[], error }
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text();
    }
    const err = new Error(
      `HTTP ${res.status} ${res.statusText} on ${method} ${path}`,
    ) as Error & { status: number; detail: unknown };
    err.status = res.status;
    err.detail = detail;
    throw err;
  }

  // Untuk /metrics (Prometheus text), response bukan JSON.
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/plain')) {
    return (await res.text()) as unknown as T;
  }
  // 204 No Content
  if (res.status === 204) {
    return undefined as unknown as T;
  }
  return (await res.json()) as T;
}

// === Payment API (port 3001) ===

export const paymentApi = {
  list: (status?: string) =>
    request<{ payments: PaymentView[]; limit: number; offset: number }>(
      'GET',
      withPort('/api/payments' + (status ? `?status=${status}` : ''), PAYMENT_API_PORT),
    ),
  detail: (id: string) =>
    request<{ payment: PaymentView; attempts: AttemptView[] }>(
      'GET',
      withPort(`/api/payments/${id}`, PAYMENT_API_PORT),
    ),
  create: (body: { orderId: string; amount: number; currency: string }) =>
    request<{ payment: PaymentView }>(
      'POST',
      withPort('/api/payments', PAYMENT_API_PORT),
      body,
    ),
  retry: (id: string) =>
    request<{ payment: PaymentView }>(
      'POST',
      withPort(`/api/payments/${id}/retry`, PAYMENT_API_PORT),
    ),
  health: () =>
    request<{ db: 'ok' | 'down'; gateway: 'ok' | 'down'; timestamp: string }>(
      'GET',
      withPort('/api/health', PAYMENT_API_PORT),
    ),
  metrics: () =>
    request<string>('GET', withPort('/api/metrics', PAYMENT_API_PORT)),
};

// === Gateway Mock (port 3002) ===

export const gatewayApi = {
  getConfig: () =>
    request<GatewayConfig>('GET', withPort('/admin/config', GATEWAY_MOCK_PORT)),
  updateConfig: (body: Partial<GatewayConfig>) =>
    request<GatewayConfig>(
      'PUT',
      withPort('/admin/config', GATEWAY_MOCK_PORT),
      body,
    ),
};

// === Types (boleh juga pindah ke src/lib/payments/types.ts bila ingin share) ===

export type PaymentStatus =
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'scheduled_for_retry';

export interface PaymentView {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  gatewayReference?: string | null;
  attemptCount: number;
  totalRetryCount: number;
  nextRetryAt?: string | null;
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttemptView {
  id: string;
  paymentId: string;
  attemptNumber: number;
  status: 'failed' | 'succeeded' | 'circuit_open';
  httpStatus?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  traceId?: string | null;
  startedAt: string;
  endedAt?: string | null;
}

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
```

> **Catatan**: bila ingin hide `XTransformPort` dari client (production pattern), buat Next.js route handler di `src/app/api/proxy/[...path]/route.ts` yang meneruskan request ke `http://localhost:${searchParams.port}/${path}`. Untuk sandbox simplicity, direct fetch dengan `XTransformPort` di query string diterima. Document pilihan di Notes.

### 2. `src/hooks/payments.ts` — TanStack Query hooks

```ts
'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { paymentApi, gatewayApi } from '@/lib/payments/api-client';
import type { GatewayConfig, PaymentStatus } from '@/lib/payments/api-client';

// === Query keys ===

export const qk = {
  payments: (status?: PaymentStatus) => ['payments', status ?? 'all'] as const,
  paymentDetail: (id: string) => ['payment', id] as const,
  gatewayConfig: ['gateway-config'] as const,
  metrics: ['metrics'] as const,
  health: ['health'] as const,
};

// === Payments queries ===

/** GET /api/payments — auto-refresh tiap 3 detik. */
export function usePayments(status?: PaymentStatus) {
  return useQuery({
    queryKey: qk.payments(status),
    queryFn: () => paymentApi.list(status),
    refetchInterval: 3000, // polling 3 detik
    refetchOnWindowFocus: true,
  });
}

/** GET /api/payments/:id — auto-refresh tiap 3 detik (untuk drawer). */
export function usePaymentDetail(id: string | null) {
  return useQuery({
    queryKey: qk.paymentDetail(id ?? ''),
    queryFn: () => paymentApi.detail(id!),
    enabled: !!id,
    refetchInterval: 3000,
  });
}

// === Payments mutations ===

/** POST /api/payments — invalidate list on success. */
export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: paymentApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] }); // invalidate semua status variants
    },
  });
}

/** POST /api/payments/:id/retry — invalidate detail + list. */
export function useManualRetry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: paymentApi.retry,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: qk.paymentDetail(data.payment.id) });
      qc.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}

// === Gateway config ===

/** GET /admin/config (gateway mock) — no polling (manual refresh via refetch). */
export function useGatewayConfig() {
  return useQuery({
    queryKey: qk.gatewayConfig,
    queryFn: gatewayApi.getConfig,
    staleTime: 0, // always refetch when component mounts
  });
}

/** PUT /admin/config — invalidate config on success. */
export function useUpdateGatewayConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: gatewayApi.updateConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.gatewayConfig });
    },
  });
}

// === Metrics ===

/** GET /api/metrics — auto-refresh tiap 5 detik. */
export function useMetricsSnapshot() {
  return useQuery({
    queryKey: qk.metrics,
    queryFn: paymentApi.metrics,
    refetchInterval: 5000, // polling 5 detik
    select: parsePrometheusText,
  });
}

// === Health ===

/** GET /api/health — auto-refresh tiap 10 detik. */
export function useHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: paymentApi.health,
    refetchInterval: 10000,
  });
}

// === Prometheus parser ===

export interface MetricSnapshot {
  name: string;
  value: number;
  labels: Record<string, string>;
}

/**
 * Simple Prometheus exposition format parser.
 * Format per line: `metric_name{label1="val1",label2="val2"} 123.45`
 * Lines starting with `#` (HELP/TYPE) di-skip.
 */
function parsePrometheusText(text: string): MetricSnapshot[] {
  const lines = text.split('\n');
  const out: MetricSnapshot[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Regex: name{labels} value   |   name value
    const m = trimmed.match(/^([a-z_:][a-z0-9_:]*)(\{[^}]*\})?\s+(\S+)$/i);
    if (!m) continue;

    const [, name, labelsRaw, valueRaw] = m;
    const labels: Record<string, string> = {};
    if (labelsRaw) {
      // Parse: {label1="val1",label2="val2"}
      const labelRegex = /(\w+)="([^"]*)"/g;
      let lm: RegExpExecArray | null;
      while ((lm = labelRegex.exec(labelsRaw)) !== null) {
        labels[lm[1]] = lm[2];
      }
    }

    const value = parseFloat(valueRaw);
    if (Number.isNaN(value)) continue;

    out.push({ name, value, labels });
  }
  return out;
}
```

### 3. `src/components/payments/gateway-mode-selector.tsx` — gateway config form

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  useGatewayConfig,
  useUpdateGatewayConfig,
} from '@/hooks/payments';
import type { GatewayMode } from '@/lib/payments/api-client';

const MODES: { value: GatewayMode; label: string; hint: string }[] = [
  { value: 'healthy', label: 'Healthy', hint: 'Always 200 OK' },
  { value: 'client-error', label: 'Client Error', hint: '400 invalid_card (permanent)' },
  { value: 'fail-first-n', label: 'Fail First N', hint: 'Fail N times, then succeed' },
  { value: 'always-timeout', label: 'Always Timeout', hint: 'No response (breaker trigger)' },
  { value: 'rate-limited', label: 'Rate Limited', hint: '429 + Retry-After' },
  { value: 'response-disappear', label: 'Response Disappear', hint: 'Charge succeed, response lost (Demo D)' },
];

export function GatewayModeSelector() {
  const { data: config, isLoading } = useGatewayConfig();
  const update = useUpdateGatewayConfig();

  const [mode, setMode] = useState<GatewayMode>('healthy');
  const [n, setN] = useState(2);
  const [probability, setProbability] = useState(0.5);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(10);
  const [timeoutMs, setTimeoutMs] = useState(2000);

  // Sync local state saat config loaded.
  useEffect(() => {
    if (config) {
      setMode(config.mode);
      setN(config.n ?? 2);
      setProbability(config.probability ?? 0.5);
      setRetryAfterSeconds(config.retryAfterSeconds ?? 10);
      setTimeoutMs(config.timeoutMs ?? 2000);
    }
  }, [config]);

  function onSave() {
    update.mutate(
      { mode, n, probability, retryAfterSeconds, timeoutMs },
      {
        onSuccess: () => toast.success('Gateway config updated', { description: `mode=${mode}` }),
        onError: (err) => toast.error('Failed to update gateway config', { description: String(err) }),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gateway Mode Selector</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading config…</p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="gw-mode">Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as GatewayMode)}>
                <SelectTrigger id="gw-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      <span className="font-medium">{m.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{m.hint}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="gw-n">n (fail-first-n)</Label>
                <Input id="gw-n" type="number" min={1} value={n}
                  onChange={(e) => setN(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gw-prob">probability</Label>
                <Input id="gw-prob" type="number" min={0} max={1} step={0.1} value={probability}
                  onChange={(e) => setProbability(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gw-retry">retryAfterSeconds</Label>
                <Input id="gw-retry" type="number" min={0} value={retryAfterSeconds}
                  onChange={(e) => setRetryAfterSeconds(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gw-timeout">timeoutMs</Label>
                <Input id="gw-timeout" type="number" min={100} step={100} value={timeoutMs}
                  onChange={(e) => setTimeoutMs(Number(e.target.value))} />
              </div>
            </div>

            <Button onClick={onSave} disabled={update.isPending} className="w-full">
              {update.isPending ? 'Saving…' : 'Save Config'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

### 4. `src/components/payments/create-payment-form.tsx` — form input payment

```tsx
'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useCreatePayment } from '@/hooks/payments';

const CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD'];

export function CreatePaymentForm() {
  const create = useCreatePayment();
  const [orderId, setOrderId] = useState('');
  const [amount, setAmount] = useState(150000);
  const [currency, setCurrency] = useState('IDR');

  function onSubmit() {
    if (!orderId.trim()) {
      toast.error('orderId is required');
      return;
    }
    if (amount <= 0) {
      toast.error('amount must be > 0');
      return;
    }
    create.mutate(
      { orderId: orderId.trim(), amount, currency },
      {
        onSuccess: (data) => {
          toast.success('Payment created', {
            description: `id=${data.payment.id.slice(0, 8)}… status=${data.payment.status}`,
          });
          setOrderId(''); // reset
        },
        onError: (err: any) => {
          toast.error('Create payment failed', {
            description: err?.detail ? JSON.stringify(err.detail) : String(err),
          });
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Payment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="orderId">orderId</Label>
          <Input id="orderId" value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="ORD-DEMO-001" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="amount">amount</Label>
          <Input id="amount" type="number" min={1} value={amount}
            onChange={(e) => setAmount(Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="currency">currency</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger id="currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={onSubmit} disabled={create.isPending} className="w-full">
          {create.isPending ? 'Creating…' : 'Create Payment'}
        </Button>
      </CardContent>
    </Card>
  );
}
```

### 5. `src/components/payments/payment-list.tsx` — polling list

```tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { usePayments } from '@/hooks/payments';
import type { PaymentStatus, PaymentView } from '@/lib/payments/api-client';

const STATUS_VARIANT: Record<PaymentStatus, string> = {
  processing: 'bg-yellow-100 text-yellow-900',
  succeeded: 'bg-green-100 text-green-900',
  failed: 'bg-red-100 text-red-900',
  scheduled_for_retry: 'bg-blue-100 text-blue-900',
};

export function PaymentList({ onSelect }: { onSelect: (id: string) => void }) {
  const { data, isLoading } = usePayments();

  return (
    <Card className="col-span-full md:col-span-2 lg:col-span-3">
      <CardHeader>
        <CardTitle>Payment List <span className="text-xs text-muted-foreground">(polling 3s)</span></CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : data && data.payments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-3">orderId</th>
                  <th className="py-2 pr-3">amount</th>
                  <th className="py-2 pr-3">status</th>
                  <th className="py-2 pr-3">attempts</th>
                  <th className="py-2 pr-3">retries</th>
                  <th className="py-2 pr-3">updated</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p: PaymentView) => (
                  <tr
                    key={p.id}
                    onClick={() => onSelect(p.id)}
                    className="border-b last:border-0 cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <td className="py-2 pr-3 font-mono text-xs">{p.orderId}</td>
                    <td className="py-2 pr-3 tabular-nums">{Number(p.amount).toLocaleString()} {p.currency}</td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className={STATUS_VARIANT[p.status]}>
                        ● {p.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{p.attemptCount}</td>
                    <td className="py-2 pr-3 tabular-nums">{p.totalRetryCount}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {new Date(p.updatedAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No payments yet. Create one →</p>
        )}
      </CardContent>
    </Card>
  );
}
```

### 6. `src/components/payments/payment-detail.tsx` — drawer (vaul)

```tsx
'use client';

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { usePaymentDetail, useManualRetry } from '@/hooks/payments';
import { AttemptHistory } from './attempt-history';

const STATUS_VARIANT: Record<string, string> = {
  processing: 'bg-yellow-100 text-yellow-900',
  succeeded: 'bg-green-100 text-green-900',
  failed: 'bg-red-100 text-red-900',
  scheduled_for_retry: 'bg-blue-100 text-blue-900',
};

export function PaymentDetail({
  paymentId,
  onClose,
}: {
  paymentId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = usePaymentDetail(paymentId);
  const retry = useManualRetry();

  const payment = data?.payment;

  function onRetry() {
    if (!paymentId) return;
    if (payment?.status === 'succeeded') {
      toast.error('Cannot retry succeeded payment (terminal state)');
      return;
    }
    retry.mutate(paymentId, {
      onSuccess: (d) => toast.success('Retry triggered', { description: `status=${d.payment.status}` }),
      onError: (err: any) => {
        if (err?.status === 409) {
          toast.error('Retry not allowed (409)', { description: 'Payment is in terminal or in-progress state' });
        } else {
          toast.error('Retry failed', { description: String(err) });
        }
      },
    });
  }

  return (
    <Drawer open={!!paymentId} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader>
          <DrawerTitle>Payment Detail</DrawerTitle>
          <DrawerDescription>
            {payment ? `id: ${payment.id}` : 'Loading…'}
          </DrawerDescription>
        </DrawerHeader>

        {isLoading || !payment ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <div className="px-4 pb-6 space-y-4 overflow-y-auto">
            {/* Fields grid */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="orderId" value={payment.orderId} mono />
              <Field label="amount" value={`${Number(payment.amount).toLocaleString()} ${payment.currency}`} />
              <Field label="status" value={
                <Badge variant="outline" className={STATUS_VARIANT[payment.status]}>
                  ● {payment.status}
                </Badge>
              } />
              <Field label="gatewayReference" value={payment.gatewayReference ?? '—'} mono />
              <Field label="attemptCount" value={String(payment.attemptCount)} />
              <Field label="totalRetryCount" value={String(payment.totalRetryCount)} />
              <Field label="nextRetryAt" value={payment.nextRetryAt ? new Date(payment.nextRetryAt).toLocaleString() : '—'} />
              <Field label="failureReason" value={payment.failureReason ?? '—'} mono />
              <Field label="createdAt" value={new Date(payment.createdAt).toLocaleString()} />
              <Field label="updatedAt" value={new Date(payment.updatedAt).toLocaleString()} />
            </div>

            {/* Manual retry */}
            <Button
              onClick={onRetry}
              disabled={retry.isPending || payment.status === 'succeeded'}
              variant="default"
              className="w-full"
            >
              {payment.status === 'succeeded'
                ? 'Retry disabled (succeeded)'
                : retry.isPending
                ? 'Retrying…'
                : 'Manual Retry'}
            </Button>

            {/* Attempt history timeline */}
            <AttemptHistory attempts={data.attempts} />
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={mono ? 'font-mono text-xs' : ''}>{value}</div>
    </div>
  );
}
```

### 7. `src/components/payments/attempt-history.tsx` — timeline attempts

```tsx
'use client';

import type { AttemptView } from '@/lib/payments/api-client';
import { Badge } from '@/components/ui/badge';

const STATUS_VARIANT: Record<string, string> = {
  succeeded: 'bg-green-100 text-green-900',
  failed: 'bg-red-100 text-red-900',
  circuit_open: 'bg-yellow-100 text-yellow-900',
};

export function AttemptHistory({ attempts }: { attempts: AttemptView[] }) {
  if (!attempts || attempts.length === 0) {
    return <p className="text-sm text-muted-foreground">No attempts recorded yet.</p>;
  }
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">Attempt History ({attempts.length})</h3>
      <ol className="relative border-l border-muted pl-4 space-y-3">
        {attempts.map((a) => (
          <li key={a.id} className="text-xs">
            <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-muted-foreground/40" />
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">#{a.attemptNumber}</span>
              <Badge variant="outline" className={STATUS_VARIANT[a.status] ?? 'bg-muted'}>
                {a.status}
              </Badge>
              {a.httpStatus && (
                <span className="text-muted-foreground">HTTP {a.httpStatus}</span>
              )}
              {a.durationMs !== null && a.durationMs !== undefined && (
                <span className="text-muted-foreground">{a.durationMs}ms</span>
              )}
            </div>
            {a.errorCode && (
              <div className="mt-0.5 text-red-700 font-mono">{a.errorCode}</div>
            )}
            {a.errorMessage && (
              <div className="text-muted-foreground break-all">{a.errorMessage}</div>
            )}
            <div className="text-muted-foreground mt-0.5">
              {new Date(a.startedAt).toLocaleTimeString()}
              {a.traceId && <span className="ml-2 font-mono">trace: {a.traceId.slice(0, 8)}…</span>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

### 8. `src/components/payments/circuit-breaker-card.tsx` — real-time breaker state

```tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useMetricsSnapshot } from '@/hooks/payments';

/** Map gauge value → state label + color. */
function breakerStateLabel(value: number | undefined): { label: string; color: string } {
  if (value === undefined) return { label: 'unknown', color: 'bg-muted' };
  // 0 = closed, 1 = half_open, 2 = open (per TASK-11 gauge definition)
  switch (value) {
    case 0: return { label: 'closed', color: 'bg-green-100 text-green-900' };
    case 1: return { label: 'half_open', color: 'bg-yellow-100 text-yellow-900' };
    case 2: return { label: 'open', color: 'bg-red-100 text-red-900' };
    default: return { label: `value=${value}`, color: 'bg-muted' };
  }
}

export function CircuitBreakerCard() {
  const { data: metrics, isLoading } = useMetricsSnapshot();

  // Cari metric: payment_circuit_breaker_state (gauge, no labels)
  const breakerState = metrics?.find((m) => m.name === 'payment_circuit_breaker_state')?.value;
  // Cari counter: payment_circuit_breaker_state_transitions_total{to="open"}
  const opens = metrics
    ?.filter((m) => m.name === 'payment_circuit_breaker_state_transitions_total' && m.labels.to === 'open')
    .reduce((acc, m) => acc + m.value, 0);
  // ... dst (closes, half_opens) — implementasi serupa.

  const { label, color } = breakerStateLabel(breakerState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Circuit Breaker <span className="text-xs text-muted-foreground">(poll 5s)</span></CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <Skeleton className="h-8 w-full" />
        ) : (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">State</span>
              <Badge variant="outline" className={color}>● {label}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Opens</span>
              <span className="font-mono tabular-nums">{opens ?? 0}</span>
            </div>
            {/* closes, half_opens — impl serupa, omitted untuk brevity */}
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

### 9. `src/components/payments/metrics-snapshot.tsx` — 7 metric cards

```tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMetricsSnapshot, type MetricSnapshot } from '@/hooks/payments';

/** 7 metric definitions (per TASK-11 + plan section 13.2). */
const METRIC_DEFS: { name: string; label: string; format?: (v: number) => string }[] = [
  { name: 'payment_gateway_requests_total', label: 'Gateway Requests' },
  { name: 'payment_gateway_requests_total', label: 'Gateway Failed', filter: (m) => m.labels.result === 'failed' },
  { name: 'payment_retry_attempts_total', label: 'Retry Attempts' },
  { name: 'payment_success_total', label: 'Payment Success' },
  { name: 'payment_failed_total', label: 'Payment Failed' },
  { name: 'payment_circuit_breaker_state_transitions_total', label: 'Breaker Opens', filter: (m) => m.labels.to === 'open' },
  { name: 'payment_circuit_breaker_state', label: 'Breaker State', format: (v) => ['closed', 'half_open', 'open'][v] ?? String(v) },
];

export function MetricsSnapshot() {
  const { data: metrics, isLoading } = useMetricsSnapshot();

  return (
    <Card className="col-span-full md:col-span-2 lg:col-span-3">
      <CardHeader>
        <CardTitle>Metrics Snapshot <span className="text-xs text-muted-foreground">(poll 5s)</span></CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !metrics ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {METRIC_DEFS.map((def, i) => {
              const matched = matchMetric(metrics, def.name, def.filter);
              const value = matched ? (def.format ? def.format(matched.value) : formatNumber(matched.value)) : '—';
              return (
                <div key={i} className="bg-muted/40 rounded-md p-3">
                  <div className="text-xs text-muted-foreground">{def.label}</div>
                  <div className="text-lg font-mono tabular-nums mt-1">{value}</div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function matchMetric(
  metrics: MetricSnapshot[],
  name: string,
  filter?: (m: MetricSnapshot) => boolean,
): MetricSnapshot | undefined {
  // Untuk counter tanpa label filter, ambil sum semua label variants.
  // Untuk gauge, ambil value tunggal.
  const matched = metrics.filter((m) => m.name === name && (!filter || filter(m)));
  if (matched.length === 0) return undefined;
  if (matched.length === 1) return matched[0];
  // Sum variants (counter with labels).
  return {
    name,
    labels: {},
    value: matched.reduce((acc, m) => acc + m.value, 0),
  };
}

function formatNumber(v: number): string {
  if (Number.isInteger(v)) return v.toLocaleString();
  return v.toFixed(2);
}
```

> **Catatan**: nama metric `payment_*` di atas harus match dengan TASK-11 registry. Bila TASK-11 belum finalisasi nama metric, sesuaikan `METRIC_DEFS` setelah TASK-11 selesai. Verifikasi dengan `curl 'http://localhost:3000/api/metrics?XTransformPort=3001'` dan lihat output Prometheus text.

### 10. `src/components/payments/demo-scenario-runner.tsx` — 5 buttons A–E

```tsx
'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { gatewayApi, paymentApi } from '@/lib/payments/api-client';
import type { GatewayMode } from '@/lib/payments/api-client';

type DemoKey = 'A' | 'B' | 'C' | 'D' | 'E';

const DEMOS: Record<DemoKey, {
  label: string;
  mode: GatewayMode;
  partial: Partial<{ n: number; probability: number; retryAfterSeconds: number; timeoutMs: number }>;
  expectedStatus: 'succeeded' | 'failed' | 'scheduled_for_retry';
  description: string;
}> = {
  A: {
    label: 'Demo A — transient retry',
    mode: 'fail-first-n',
    partial: { n: 2 },
    expectedStatus: 'succeeded',
    description: 'fail-first-n=2 → 2 failed attempts → 3rd succeeds → payment.status=succeeded',
  },
  B: {
    label: 'Demo B — permanent failure',
    mode: 'client-error',
    partial: {},
    expectedStatus: 'failed',
    description: 'client-error → 400 invalid_card → not retried → payment.status=failed',
  },
  C: {
    label: 'Demo C — circuit breaker',
    mode: 'always-timeout',
    partial: { timeoutMs: 2000 },
    expectedStatus: 'scheduled_for_retry',
    description: 'always-timeout → 3 timeouts → breaker OPEN → new payment = circuit_open → scheduled_for_retry',
  },
  D: {
    label: 'Demo D — idempotency hero',
    mode: 'response-disappear',
    partial: {},
    expectedStatus: 'succeeded',
    description: 'charge succeed + response lost → API retry → gateway replay → actualCharges=1 (calls>=2). Verify via attempt history.',
  },
  E: {
    label: 'Demo E — Retry-After',
    mode: 'rate-limited',
    partial: { retryAfterSeconds: 5 },
    expectedStatus: 'scheduled_for_retry',
    description: '429 + Retry-After=5 → backoff honor Retry-After → payment scheduled_for_retry with nextRetryAt ~now+5s',
  },
};

export function DemoScenarioRunner() {
  const [running, setRunning] = useState<DemoKey | null>(null);

  async function runDemo(key: DemoKey) {
    const demo = DEMOS[key];
    setRunning(key);
    const orderIdPrefix = `DEMO-${key}-${Date.now().toString(36)}`;
    const toastId = toast.loading(`Running ${demo.label}…`, { description: 'Resetting gateway + creating payment' });

    try {
      // 1. Reset gateway config ke mode demo.
      await gatewayApi.updateConfig({ mode: demo.mode, ...demo.partial });

      // 2. Create payment dengan unique orderId.
      const { payment } = await paymentApi.create({
        orderId: `${orderIdPrefix}`,
        amount: 100000,
        currency: 'IDR',
      });

      // 3. Poll GET /api/payments/:id tiap 1 detik sampai terminal (timeout 60s).
      const TERMINAL = new Set(['succeeded', 'failed']);
      const deadline = Date.now() + 60_000;
      let final = payment;

      while (Date.now() < deadline) {
        if (TERMINAL.has(final.status)) break;
        await sleep(1000);
        const detail = await paymentApi.detail(payment.id);
        final = detail.payment;
      }

      // 4. Assertion.
      const passed = final.status === demo.expectedStatus;
      const attempts = await paymentApi.detail(payment.id);

      if (passed) {
        toast.success(`${demo.label} — PASSED`, {
          id: toastId,
          description: `status=${final.status} (expected ${demo.expectedStatus}) · attempts=${attempts.attempts.length}`,
        });
      } else {
        toast.error(`${demo.label} — FAILED assertion`, {
          id: toastId,
          description: `expected=${demo.expectedStatus}, got=${final.status} · attempts=${attempts.attempts.length}`,
        });
      }
    } catch (err: any) {
      toast.error(`${demo.label} — ERROR`, {
        id: toastId,
        description: err?.message ?? String(err),
      });
    } finally {
      setRunning(null);
    }
  }

  return (
    <Card className="col-span-full md:col-span-2 lg:col-span-3">
      <CardHeader>
        <CardTitle>Demo Scenario Runner</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {(Object.keys(DEMOS) as DemoKey[]).map((key) => (
          <Button
            key={key}
            onClick={() => runDemo(key)}
            disabled={running !== null}
            variant="outline"
            className="h-auto py-3 text-left whitespace-normal"
          >
            <div>
              <div className="font-semibold">{DEMOS[key].label}</div>
              <div className="text-xs text-muted-foreground mt-1">{DEMOS[key].description}</div>
            </div>
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

### 11. `src/app/page.tsx` — rewrite root dashboard

```tsx
'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { GatewayModeSelector } from '@/components/payments/gateway-mode-selector';
import { CreatePaymentForm } from '@/components/payments/create-payment-form';
import { PaymentList } from '@/components/payments/payment-list';
import { PaymentDetail } from '@/components/payments/payment-detail';
import { CircuitBreakerCard } from '@/components/payments/circuit-breaker-card';
import { MetricsSnapshot } from '@/components/payments/metrics-snapshot';
import { DemoScenarioRunner } from '@/components/payments/demo-scenario-runner';
import { useGatewayConfig, useMetricsSnapshot } from '@/hooks/payments';

// Single QueryClient instance (sandbox simplicity — tidak perlu providers.tsx).
// Catatan: bila ingin SSR-safe, pindahkan ke src/app/providers.tsx dengan useState
// pattern (lihat Notes).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 0, refetchOnWindowFocus: true },
  },
});

export default function DashboardPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster richColors position="top-right" />
      <DashboardShell />
    </QueryClientProvider>
  );
}

function DashboardShell() {
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const { data: gwConfig } = useGatewayConfig();
  const { data: metrics } = useMetricsSnapshot();

  const breakerValue = metrics?.find((m) => m.name === 'payment_circuit_breaker_state')?.value;
  const breakerLabel = breakerValue === 0 ? 'closed' : breakerValue === 1 ? 'half_open' : breakerValue === 2 ? 'open' : 'unknown';
  const breakerColor = breakerLabel === 'closed' ? 'bg-green-100 text-green-900'
    : breakerLabel === 'half_open' ? 'bg-yellow-100 text-yellow-900'
    : breakerLabel === 'open' ? 'bg-red-100 text-red-900'
    : 'bg-muted';

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header sticky top */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="flex items-center justify-between px-4 py-3 gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold">Cockatiel Retry Sandbox</h1>
            <p className="text-xs text-muted-foreground">Next.js preview · port 3000 · plan rev 2</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              Gateway: <span className="ml-1 font-mono">{gwConfig?.mode ?? '—'}</span>
            </Badge>
            <Badge variant="outline" className={breakerColor}>
              Breaker: ● {breakerLabel}
            </Badge>
          </div>
        </div>
      </header>

      {/* Main grid */}
      <main className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4 md:p-6">
        <GatewayModeSelector />
        <CreatePaymentForm />
        <CircuitBreakerCard />
        <MetricsSnapshot />
        <DemoScenarioRunner />
        <PaymentList onSelect={setSelectedPaymentId} />
      </main>

      {/* Footer sticky bottom (mt-auto) */}
      <footer className="mt-auto bg-muted/50 border-t p-4 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            Scenario legend: A=transient retry · B=permanent fail · C=circuit breaker · D=idempotency hero · E=Retry-After
          </div>
          <div>v0.1 · plan rev 2 · Next.js 16 · shadcn/ui · TanStack Query</div>
        </div>
      </footer>

      {/* Detail drawer */}
      <PaymentDetail
        paymentId={selectedPaymentId}
        onClose={() => setSelectedPaymentId(null)}
      />
    </div>
  );
}
```

### 12. Sonner Toaster — install bila belum

Sonner sudah ter-install di `package.json` (`"sonner": "^2.0.6"`). Existing layout.tsx memakai `@/components/ui/toaster` (Radix toast), bukan sonner. Untuk TASK-12:

- **Tambahkan `<Toaster />` dari `sonner`** di `page.tsx` (lihat step 11) — import: `import { Toaster } from 'sonner'`.
- Tidak perlu modifikasi `layout.tsx` bila `Toaster` di-render di dalam `page.tsx` (sebagai child dari `DashboardShell`).
- Bila ingin global toast (semua page), tambahkan `<Toaster />` dari sonner di `layout.tsx` setelah `<Toaster />` existing (Radix). Implementer pilih — sandbox simplicity → inline di `page.tsx` cukup.

### 13. Verifikasi XTransformPort pattern

Sebelum menjalankan UI, pastikan Caddy + payment-api + gateway-mock berjalan:

```bash
# Caddy harus running di :81 (atau port lain via env).
# Test cross-service proxy:
curl -i 'http://localhost:81/api/health?XTransformPort=3001'
# Expected: 200 OK, JSON { db: 'ok', gateway: 'ok', timestamp: ... }

curl -i 'http://localhost:81/admin/config?XTransformPort=3002'
# Expected: 200 OK, JSON { mode: 'healthy', ... }

# Lalu dari Next.js browser (port 3000):
# Buka DevTools → Network → fetch /api/payments?XTransformPort=3001 → harus 200 (via Caddy proxy).
```

Bila Next.js dev server di port 3000 dan Caddy di port 81, browser fetch ke `/api/payments?XTransformPort=3001` akan **relatif ke origin Next.js (port 3000)**, bukan Caddy (port 81). Maka Next.js akan menerima request `/api/payments?XTransformPort=3001` dan (karena Next.js tidak punya route handler `/api/payments`) akan return 404. **Solusi**: 

- **Opsi A**: Next.js dev server dijalankan **di belakang Caddy** (Caddy `:81` reverse_proxy ke Next.js `:3000` bila tidak ada `XTransformPort`). User akses dashboard via `http://localhost:81/`. Maka fetch relatif `/api/payments?XTransformPort=3001` akan masuk Caddy → match `@transform_port_query` → reverse_proxy ke `localhost:3001`. ✅ Pattern ini yang direkomendasikan.
- **Opsi B**: Next.js route handler proxy di `src/app/api/[...path]/route.ts` yang membaca `XTransformPort` query param + meneruskan ke `http://localhost:${port}/${path}`. Pattern ini hide `XTransformPort` dari client code (client hanya fetch `/api/payments`, Next.js tambahkan `XTransformPort` di server side). Out of scope untuk sandbox simplicity — document di Notes.

**Implementasi TASK-12** mengikuti **Opsi A** (akses dashboard via `http://localhost:81/`, Next.js sendiri listen di 3000 tapi tidak langsung diakses user). Caddy `:81` adalah single entry point.

> **PENTING untuk acceptance criteria**: bila menjalankan `bun run dev` dan akses `http://localhost:3000/` langsung (tanpa Caddy), semua fetch akan 404 karena Next.js tidak punya route `/api/payments`. WAJIB akses via Caddy `:81`.

## Acceptance criteria

- [ ] `/` (via Caddy `:81`) renders dashboard tanpa hydration error — cek `dev.log` tidak ada `Warning: Text content did not match` atau `Hydration failed`.
- [ ] **Gateway mode selector**: pilih `client-error` → klik Save → toast "Gateway config updated" → header pill "Gateway: client-error" ter-update (auto refetch via `useGatewayConfig` invalidation).
- [ ] **Create payment form**: isi `orderId=TEST-001`, `amount=150000`, `currency=IDR` → klik Create → toast "Payment created" → payment muncul di list dalam < 3 detik (polling), dengan `status=succeeded` atau `failed` tergantung gateway mode saat itu.
- [ ] **Payment list auto-refresh**: dengan gateway mode `healthy`, create payment → setelah 1-2 detik, status di list harus berubah dari `processing` → `succeeded`. Verifikasi dengan watch list: setiap 3 detik, kolom `updated` berubah timestamp.
- [ ] **Click payment row** → drawer slide-up (vaul) → menampilkan field payment (orderId, amount, status, attemptCount, dst.) + attempt history timeline.
- [ ] **Manual retry button on failed payment**: klik → status berubah `processing` (toast "Retry triggered") → setelah polling 3 detik, status berubah ke terminal (`succeeded` atau `failed` tergantung gateway mode). Drawer auto-update.
- [ ] **Manual retry on succeeded payment**: button disabled (label "Retry disabled (succeeded)"). Bila somehow bisa di-klik (mis. race condition), toast "Cannot retry succeeded payment (terminal state)" muncul.
- [ ] **Demo A button** (transient retry): klik → toast loading "Running Demo A…" → setelah ~5-10 detik, toast success "Demo A — PASSED" dengan `status=succeeded, attempts=3`. Bila gagal assertion, toast error dengan expected vs actual.
- [ ] **Demo B button** (permanent failure): klik → toast success "Demo B — PASSED" dengan `status=failed, attempts=1` (permanent error tidak di-retry).
- [ ] **Demo C button** (circuit breaker): klik → toast success "Demo C — PASSED" dengan `status=scheduled_for_retry`. Verifikasi circuit breaker card menampilkan state `open` selama demo berjalan.
- [ ] **Demo D button** (idempotency hero): klik → toast success "Demo D — PASSED" dengan `status=succeeded`. Buka drawer payment → attempt history harus menunjukkan `calls>=2` tapi `actualCharges=1` (verifikasi via `gatewayReference` sama pada multiple attempts — idempotency replay). **Catatan**: assertion `actualCharges` memerlukan gateway mock endpoint khusus untuk inspect internal idempotency store — bila belum ada di TASK-03, skip assertion ini dan document sebagai caveat.
- [ ] **Demo E button** (Retry-After): klik → toast success "Demo E — PASSED" dengan `status=scheduled_for_retry` dan `nextRetryAt` ~ `now + retryAfterSeconds`.
- [ ] **Circuit breaker card** menampilkan real-time state — saat Demo C berjalan, breaker pill berubah dari `closed` (green) → `open` (red). Polling 5 detik.
- [ ] **Metrics snapshot** menampilkan 7 metric cards dengan values yang berubah setiap 5 detik (polling). Bila TASK-11 belum finalisasi nama metric, cards mungkin menampilkan `—` — document caveat.
- [ ] **Mobile responsive**: resize browser < 768px → layout 1 column; 768-1024px → 2 columns; > 1024px → 3 columns. Header + footer tetap full-width.
- [ ] **Sticky footer**: bila konten pendek (mis. hanya 1 payment), footer tetap di bawah viewport (tidak floating gap di tengah). Verifikasi dengan resize window sangat pendek — footer tidak overlap dengan konten.
- [ ] **Sticky header**: scroll down → header tetap terlihat (z-50, backdrop-blur).
- [ ] `bun run lint` clean — tidak ada error ESLint (warning boleh untuk `any` types di hooks).
- [ ] `bunx tsc --noEmit` clean — tidak ada TypeScript error.
- [ ] **Manual quick verification via curl** (lihat Useful commands) — semua endpoint return 200 OK dengan `?XTransformPort=3001` atau `=3002`.
- [ ] **Agent Browser verification** (TASK-14 akan formalisasi) — untuk sandbox preview, jalankan minimal: navigate ke `http://localhost:81/`, screenshot dashboard, klik Demo A, tunggu toast, screenshot result. Tidak perlu full E2E matrix — itu TASK-14.

## Useful commands (run after completing this task)

### Pre-flight Check

> **WAJIB BACA**: sebelum menjalankan command di bawah, cek kondisi lingkungan Anda via [`SANDBOX_NOTES.md`](./SANDBOX_NOTES.md) section 1 (Pre-flight Check).
>
> Ringkasan keyword:
> - `pnpm --version` ada → KONDISI LOCAL. Tidak ada → KONDISI SANDBOX → jalankan `corepack enable pnpm && corepack prepare pnpm@9.12.0 --activate` dulu.
> - `docker --version` ada → KONDISI LOCAL. Tidak ada → KONDISI SANDBOX → butuh external PostgreSQL atau skip DB-dependent commands.
> - `curl -s http://localhost:3000` sibuk → KONDISI SANDBOX → Next.js preview sudah otomatis berjalan di 3000, payment-api pakai PORT=3001, gateway-mock pakai PORT=3002. Bebas → KONDISI LOCAL → Next.js di-start manual di 3000, payment-api pakai PORT=3000, gateway-mock pakai PORT=3001.
> - `command -v bun` ada → bisa pakai `bun run dev` untuk Next.js. Tidak ada → install via `npm i -g bun` atau pakai `pnpm dev`.

Command di bawah ditulis dengan dua varian bila perlu (LOCAL / SANDBOX). Pilih salah satu sesuai kondisi.

> **Catatan runtime**: Pilih salah satu runtime (pnpm atau bun) untuk Next.js. Di KONDISI SANDBOX, bun sudah otomatis tersedia (Next.js preview otomatis pakai `bun run dev` di port 3000).

---

```bash
# 1. Start backend services (di terminal terpisah)
#    a. PostgreSQL (bila belum running — sandbox mungkin pakai in-memory atau managed)
# KONDISI LOCAL (Docker tersedia):
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml up -d postgres
sleep 3
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml ps postgres

# KONDISI SANDBOX (Docker tidak tersedia):
# - Butuh external PostgreSQL instance (set DB_HOST/DB_PORT/DB_USER/DB_PASS/DB_NAME di apps/payment-api/.env)
# - Atau skip DB-dependent commands; inspect via Node script (lihat SANDBOX_NOTES.md section 2.6)

#    b. Gateway mock (port kondisional)
# KONDISI LOCAL (port 3001 bebas):
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock && PORT=3001 pnpm start:dev
# Expected log: "Gateway mock running on http://localhost:3001"

# KONDISI SANDBOX (port 3002, karena 3001 dipakai payment-api):
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock && PORT=3002 pnpm start:dev
# Expected log: "Gateway mock running on http://localhost:3002"

#    c. Payment API (port kondisional)
# KONDISI LOCAL (port 3000 bebas):
cd /home/z/my-project/retry-failure/apps/payment-api && PORT=3000 pnpm start:dev
# Expected log: "Payment API running on http://localhost:3000" + "Swagger UI: http://localhost:3000/docs"

# KONDISI SANDBOX (port 3001, karena 3000 dipakai Next.js preview):
cd /home/z/my-project/retry-failure/apps/payment-api && PORT=3001 pnpm start:dev
# Expected log: "Payment API running on http://localhost:3001" + "Swagger UI: http://localhost:3001/docs"

# 2. Start Next.js sandbox (port 3000)
# KONDISI LOCAL (user memilih runtime):
cd /home/z/my-project && pnpm dev     # bila prefer pnpm
# ATAU
cd /home/z/my-project && bun run dev  # bila prefer bun (install via npm i -g bun)
# Expected log: "Ready in ~500ms" + "Local: http://localhost:3000"
# dev.log ada di /home/z/my-project/dev.log (tee dari dev script)

# KONDISI SANDBOX:
# Next.js sudah otomatis berjalan di port 3000 (sandbox preview).
# Bila belum jalan, jalankan: bun run dev
cd /home/z/my-project && bun run dev  # hanya bila belum jalan
# Expected: preview panel otomatis refresh dengan dashboard Next.js

# 3. Lint + typecheck (dual runtime — pilih salah satu)
# KONDISI LOCAL:
pnpm lint && pnpm typecheck
# ATAU bila prefer bun:
bun run lint && bunx tsc --noEmit

# KONDISI SANDBOX (bun sudah otomatis tersedia):
bun run lint
bunx tsc --noEmit

# 4. Tail dev log — sama kedua kondisi (dev.log ada di parent root)
tail -n 100 /home/z/my-project/dev.log

# 5. Manual quick verification via curl (dari shell lain)
# KONDISI LOCAL (langsung ke service, tanpa Caddy):
curl -s http://localhost:3000/api/health | jq .     # payment-api di 3000
curl -s http://localhost:3001/admin/config | jq .   # gateway-mock di 3001
curl -s http://localhost:3000/api/payments | jq .   # payment-api di 3000
curl -s http://localhost:3000/api/metrics | head -n 30

# KONDISI SANDBOX (via Caddy dengan XTransformPort — Next.js preview di port 3000):
curl -s "http://localhost:3000/api/health?XTransformPort=3001" | jq .      # → payment-api:3001
curl -s "http://localhost:3000/admin/config?XTransformPort=3002" | jq .   # → gateway-mock:3002
curl -s "http://localhost:3000/api/payments?XTransformPort=3001" | jq .   # → payment-api:3001
curl -s "http://localhost:3000/api/metrics?XTransformPort=3001" | head -n 30

#    Contoh POST new payment (untuk trigger dashboard):
# KONDISI LOCAL:
curl -s -X POST http://localhost:3000/api/payments \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"MANUAL-001","amount":150000,"currency":"IDR"}' | jq .

# KONDISI SANDBOX:
curl -s -X POST "http://localhost:3000/api/payments?XTransformPort=3001" \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"MANUAL-001","amount":150000,"currency":"IDR"}' | jq .
# Expected: 201 Created, { "payment": { ..., "status": "succeeded"|"failed"|"scheduled_for_retry" } }

#    PUT gateway config (switch mode):
# KONDISI LOCAL:
curl -s -X PUT http://localhost:3001/admin/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"fail-first-n","n":2}' | jq .

# KONDISI SANDBOX:
curl -s -X PUT "http://localhost:3000/admin/config?XTransformPort=3002" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"fail-first-n","n":2}' | jq .
# Expected: 200 OK, { "mode": "fail-first-n", "n": 2, ... }

# 6. Manual UI verification via browser
# KONDISI LOCAL:
#    a. Buka http://localhost:3000/ di browser (akses langsung Next.js dev server).
#    b. Dashboard harus render tanpa hydration warning (cek DevTools console).
#    c. Klik tombol "Demo A — transient retry" → tunggu toast hasil.
#    d. Click row di Payment List → drawer slide-up → lihat attempt history.

# KONDISI SANDBOX (preview panel):
#    a. Buka preview panel yang sudah otomatis expose port 3000.
#    b. Klik "Open in New Tab" button untuk full-screen view di browser tab terpisah.
#    c. Dashboard harus render tanpa hydration warning (cek DevTools console).
#    d. Klik tombol "Demo A — transient retry" → tunggu toast hasil.
#    e. Cross-service fetch via ?XTransformPort query param otomatis oleh Caddy
#       yang fronting port 3000 (lihat SANDBOX_NOTES.md section 2.12).

# 7. Agent Browser verification (akan diformalkan di TASK-14)
#    - Untuk TASK-12: minimal 1 screenshot dashboard + 1 screenshot setelah Demo A run.
#    - Full E2E matrix (Demo A-E, manual retry, gateway mode switch, mobile viewport)
#      → TASK-14 akan automate via Agent Browser + assertions.
#    - Agent Browser adalah tool sandbox; di KONDISI LOCAL bisa buka browser manual.

# 8. Cleanup bila perlu — sama kedua kondisi (ganti URL bila perlu)
#    a. Reset gateway config ke healthy
# KONDISI LOCAL:
curl -X PUT http://localhost:3001/admin/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"healthy"}'

# KONDISI SANDBOX:
curl -X PUT "http://localhost:3000/admin/config?XTransformPort=3002" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"healthy"}'

#    b. Stop services (Ctrl+C di masing-masing terminal)
#    c. dev.log bisa di-inspect untuk debug:
tail -n 200 /home/z/my-project/dev.log | rg "error|Error|ERROR" -i
```

## Notes

### Server-side fetch untuk initial data — optional

Pattern SSR (server component fetch initial data di `page.tsx` tanpa `'use client'`) memberikan:

- ✅ Faster First Contentful Paint (FCP) — data sudah ada saat HTML di-render.
- ✅ SEO-friendly (tidak relevant untuk sandbox, tapi best practice).
- ❌ Kompleksitas tinggi: butuh `dehydrate`/`hydrate` TanStack Query + `HydrationBoundary`.
- ❌ `XTransformPort` fetch dari server Next.js bisa langsung ke `http://localhost:3001` (tidak perlu Caddy). Tapi ini berarti client hydration butuh data yang konsisten — race condition bila data berubah antara server-fetch dan client-mount.

**Decision untuk TASK-12**: pure client-side (`'use client'` + TanStack Query). Lebih sederhana, cukup untuk sandbox preview. SSR pattern → TASK-13 (Vue+PrimeVue tidak butuh SSR, tapi production dashboard Next.js bisa pakai SSR — future work).

### NO absolute URLs in client code — enforced

Aturan ini di-enforce secara kode di `api-client.ts`: semua helper (`paymentApi`, `gatewayApi`) menerima `path` relatif (mis. `/api/payments`, `/admin/config`) dan menambahkan `?XTransformPort=NNNN` di internal. Tidak ada `http://localhost:3001` atau `http://localhost:3002` di source code client. Bila perlu berbeda port (mis. lokal dev tanpa Caddy), ubah `PAYMENT_API_PORT` / `GATEWAY_MOCK_PORT` constant di `api-client.ts` (atau pindah ke env var `NEXT_PUBLIC_PAYMENT_API_PORT`).

### Polling intervals — 3s payments / 5s metrics / 10s health

- **Payments** (`usePayments`, `usePaymentDetail`): 3 detik. Cukup cepat untuk melihat status berubah (`processing` → `succeeded`) tapi tidak overload backend. Total request rate: 1 list + 1 detail (drawer) = 2 req / 3s = ~0.67 req/s. Sangat ringan.
- **Metrics** (`useMetricsSnapshot`, `CircuitBreakerCard`): 5 detik. Metrics tidak berubah tiap detik — 5 detik cukup. Total: 2 req / 5s = 0.4 req/s.
- **Health** (`useHealth` opsional): 10 detik. Backend jarang berubah status.
- **Gateway config** (`useGatewayConfig`): no polling (manual refetch via invalidation setelah PUT).

> Total background request rate: ~1.5 req/s. Sangat acceptable untuk sandbox.

### Sticky footer via `min-h-screen flex flex-col` + `mt-auto`

Pattern Tailwind:

```tsx
<div className="min-h-screen flex flex-col bg-background">
  <header className="sticky top-0 z-50 ...">...</header>
  <main className="flex-1 ...">...</main>
  <footer className="mt-auto ...">...</footer>
</div>
```

- `min-h-screen` — root div minimal selebar viewport.
- `flex flex-col` — children stack vertical.
- `main flex-1` — main mengambil sisa space yang tersisa, mendorong footer ke bawah.
- `footer mt-auto` — bila main kurang dari viewport, `mt-auto` mendorong footer ke bawah (karena flexbox column).
- Hasil: footer tetap di bawah viewport bila konten pendek; scroll natural bila konten panjang.

### Toast feedback via sonner untuk semua mutations

Setiap mutation (`useCreatePayment`, `useManualRetry`, `useUpdateGatewayConfig`, demo scenario runner) WAJIB memanggil `toast.success` / `toast.error` / `toast.loading` di `onSuccess` / `onError`. Pattern:

```ts
mutation.mutate(input, {
  onSuccess: (data) => toast.success('Action succeeded', { description: ... }),
  onError: (err: any) => toast.error('Action failed', { description: err?.message ?? String(err) }),
});
```

Sonner dipilih (bukan Radix toast existing di `src/components/ui/toaster.tsx`) karena:

- API lebih sederhana (`toast.success()` imperative vs Radix yang butuh state management).
- Auto-dismiss dengan progress bar visual.
- Mendukung `richColors` (green/red/yellow background).
- Sudah ter-install di `package.json` (`"sonner": "^2.0.6"`).

> Bila ingin konsisten dengan existing Radix toast, tidak masalah — tapi sonner lebih cepat untuk demo sandbox.

### Color restriction — NO indigo/blue primary

Project rules melarang indigo/blue sebagai warna primary (lihat README rev 2 catatan warna). Dashboard TASK-12 memakai:

- **Tailwind built-in neutral palette**: `bg-background`, `text-foreground`, `bg-muted`, `bg-muted/50`, `border` (default border color).
- **Primary button**: `bg-primary text-primary-foreground` (default shadcn/ui = neutral/foreground hitam-putih, bukan indigo).
- **Status pills** (subtle, bukan primary): `bg-yellow-100 text-yellow-900`, `bg-green-100 text-green-900`, `bg-red-100 text-red-900`, `bg-blue-100 text-blue-900`.
  - ⚠️ `bg-blue-100` untuk `scheduled_for_retry` adalah exception — bukan indigo primary, tapi light blue subtle. Bila project rules sangat strict (no blue sama sekali), ganti ke `bg-cyan-100 text-cyan-900` atau `bg-sky-100 text-sky-900`. **Decision untuk TASK-12**: pakai `bg-blue-100 text-blue-900` karena `scheduled_for_retry` perlu visual distinction yang jelas dari `processing` (yellow) dan `succeeded` (green). Document di TASK-15 bila production butuh palette berbeda.
- **Destructive**: `bg-destructive/10 text-destructive` untuk error message highlight.
- **TIDAK ADA** `bg-indigo-*`, `text-indigo-*`, `bg-blue-600`, atau warna primary yang dominan indigo/blue.

### Setelah task ini selesai

- **TASK-13 (Vue+PrimeVue dashboard)** dapat dimulai secara paralel (sudah ada di Batch 6). TASK-12 dan TASK-13 independen — keduanya konsumsi API yang sama.
- **TASK-14 (E2E scenarios via Agent Browser)** dapat diverifikasi dengan navigate ke `http://localhost:81/` (atau `:3000` bila tanpa Caddy) + klik Demo A–E. TASK-12 menyediakan UI; TASK-14 formalisasi assertions end-to-end (matrix 5 demo × multi-viewport × multi-assertion).
- **TASK-15 (documentation)** dapat me-reference TASK-12 sebagai "sandbox preview mode" di README + demo guide. Bila user menjalankan full Docker stack, TASK-12 opsional — official demo pakai TASK-13.

### Production caveat (document di TASK-15)

- **Tidak ada auth** — siapapun dengan akses ke `http://localhost:81/` dapat create payment + trigger retry + change gateway mode. Untuk production, tambahkan NextAuth (sudah ter-install: `"next-auth": "^4.24.11"`) dengan admin role guard di `page.tsx` server component.
- **Tidak ada rate limiting** — Demo A–E bisa di-spam. Untuk production, tambahkan server-side rate limit (mis. Upstash Ratelimit) di Next.js route handler atau di Caddy.
- **`XTransformPort` exposed di client** — bila user inspects Network tab, mereka bisa lihat `?XTransformPort=3001` dan langsung call backend dari outside (bila port terbuka). Untuk production, hide via Next.js route handler proxy (Opsi B di step 13). Untuk sandbox, acceptable.
- **Single QueryClient instance di module level** — bila HMR (Hot Module Replacement) terjadi, QueryClient di-recreate (cache hilang). Untuk production, gunakan `useState(() => new QueryClient())` di root component agar stabil across HMR. Sandbox simplicity — module-level instance diterima.
- **Polling tidak pause saat tab inactive** — bila user pindah tab, polling tetap jalan (battery drain + request waste). Untuk production, tambahkan `refetchIntervalInBackground: false` (TanStack Query default sudah false) — verifikasi.
