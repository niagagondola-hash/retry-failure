# TASK-12 — Frontend Demo Dashboard (`src/app/page.tsx`)

> **Task ID**: 9
> **Depends on**: 6-b (API routes) + 8 (observability — for metrics snapshot)
> **Estimated effort**: L (~3 jam)
> **Plan reference**: Section 17 (Demonstration Scenarios), Section 22 (DoD — UI untuk semua scenario)

---

## Goal

Membangun single-page demo dashboard di `/` yang mengorkestrasi seluruh scenario A–E dari plan section 17. Dashboard menjadi "hero" entry point untuk verifikasi end-to-end.

## Scope

**In scope**:
- `src/app/page.tsx` — main dashboard.
- `src/components/payments/*.tsx` — sub-components:
  - `GatewayModeSelector` — PUT `/admin/config?XTransformPort=3001`.
  - `CreatePaymentForm` — POST `/api/payments`.
  - `PaymentList` — GET `/api/payments?status=`.
  - `PaymentDetail` — GET `/api/payments/:id` (drawer / dialog).
  - `AttemptHistory` — list attempts di PaymentDetail.
  - `ManualRetryButton` — POST `/api/payments/:id/retry`.
  - `CircuitBreakerCard` — polling metrics, show state.
  - `MetricsSnapshot` — GET `/api/metrics` (parse text, show counters).
  - `DemoScenarioRunner` — quick-run untuk scenario A–E.
- `src/hooks/payments.ts` — TanStack Query hooks (create, list, detail, retry, gateway config, metrics).
- Sticky footer + responsive layout (mobile-first).
- Loading skeletons, error states, toast feedback (sonner).
- Framer Motion subtle transitions.

**Out of scope**:
- Authentication (out-of-scope untuk demo).
- Real-time push (gunakan polling 3–5s; websocket out-of-scope).
- Production-grade design system — pakai shadcn/ui yang ada.

## Layout

```text
┌─────────────────────────────────────────────────────┐
│ Header (sticky top): title + gateway status pill    │
├─────────────────────────────────────────────────────┤
│ Grid (responsive):                                  │
│  ┌──────────────┐  ┌─────────────────────────┐    │
│  │ Gateway Mode │  │ Demo Scenarios (A–E)     │    │
│  │ Selector     │  │ quick-run buttons        │    │
│  └──────────────┘  └─────────────────────────┘    │
│  ┌──────────────┐  ┌─────────────────────────┐    │
│  │ Create       │  │ Circuit Breaker Card     │    │
│  │ Payment Form │  │ + Metrics Snapshot       │    │
│  └──────────────┘  └─────────────────────────┘    │
│  ┌────────────────────────────────────────────┐   │
│  │ Payment List (filter by status)             │   │
│  │  - click row → PaymentDetail drawer          │   │
│  └────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│ Footer (sticky bottom): scenario legend + version  │
└─────────────────────────────────────────────────────┘
```

## Demo scenario runners (plan section 17)

| Button | Action sequence |
|---|---|
| **Demo A — transient retry success** | PUT mode=`fail-first-n,n=2` → POST payment → wait → assert `succeeded`, attemptCount=3 |
| **Demo B — permanent failure** | PUT mode=`client-error` → POST payment → assert `failed`, attemptCount=1 |
| **Demo C — circuit breaker protects** | PUT mode=`always-timeout` → POST 3 payments → assert breaker `open` → 4th payment returns `circuit_open` / `scheduled_for_retry` |
| **Demo D — idempotency anti double-charge** (hero) | PUT mode=`succeed-but-drop-response` → POST payment → wait for retries → assert `succeeded`, `replayed: true` on attempt #2, gateway stats `actualCharges=1` |
| **Demo E — server-directed retry** | PUT mode=`rate-limited,retryAfterSeconds=3` → POST payment → measure delay between attempt 1 & 2 → assert `>= 3000ms` |

Each runner:
1. Reset gateway mock state (PUT `always-success` lalu tunggu 1s untuk clear).
2. PUT target mode.
3. POST new payment dengan orderId unik (prefix `DEMO-A-<timestamp>`, dst.).
4. Poll `GET /api/payments/:id` setiap 1s sampai terminal status (timeout 60s).
5. Show toast: success/failure + key assertions.

## Files to create / modify

- `/home/z/my-project/src/app/page.tsx` (overwrite existing demo content).
- `/home/z/my-project/src/components/payments/gateway-mode-selector.tsx`
- `/home/z/my-project/src/components/payments/create-payment-form.tsx`
- `/home/z/my-project/src/components/payments/payment-list.tsx`
- `/home/z/my-project/src/components/payments/payment-detail.tsx`
- `/home/z/my-project/src/components/payments/attempt-history.tsx`
- `/home/z/my-project/src/components/payments/circuit-breaker-card.tsx`
- `/home/z/my-project/src/components/payments/metrics-snapshot.tsx`
- `/home/z/my-project/src/components/payments/demo-scenario-runner.tsx`
- `/home/z/my-project/src/hooks/payments.ts`
- `/home/z/my-project/src/lib/payments/api-client.ts` (browser-side fetch helpers).

## Implementation steps

1. `api-client.ts`:
   - `apiPost(path, body)`, `apiGet(path)`, `apiPut(path, body)` — wrappers around `fetch`.
   - Gateway mock call: `apiPut('/admin/config?XTransformPort=3001', body)` — relative path with XTransformPort (sesuai Caddy rule).
2. `hooks/payments.ts`:
   - `useCreatePayment()` mutation.
   - `usePayments(status?)` query with 3s refetch interval.
   - `usePaymentDetail(id)` query.
   - `useManualRetry()` mutation.
   - `useGatewayConfig()` query + `useUpdateGatewayConfig()` mutation.
   - `useMetricsSnapshot()` query with 5s refetch.
3. Sub-components:
   - Pakai shadcn `Card`, `Button`, `Select`, `Input`, `Badge`, `Dialog`, `Drawer`, `Skeleton`, `Sonner`.
   - Status pill warna: `processing` (yellow), `succeeded` (green), `failed` (red), `scheduled_for_retry` (blue).
   - Breaker state pill: `closed` (green), `open` (red), `half_open` (yellow).
4. `page.tsx`:
   - `min-h-screen flex flex-col` root.
   - Header sticky top (`sticky top-0 z-50`).
   - Main grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4 md:p-6`.
   - Footer: `mt-auto` dengan `bg-muted/50 border-t p-4`.
   - Wrap dengan `<QueryClientProvider>` (lihat layout.tsx — biasanya sudah setup).
5. Demo scenario runner:
   - Component dengan 5 button.
   - On click: jalankan sequence di atas, update status indicator di button (idle/running/success/failed).
   - Show result modal dengan assertions.
6. Metrics snapshot:
   - Parse Prometheus text format sederhana (regex per line).
   - Show 7 metric cards dengan current value.
7. Gateway mode selector:
   - Select component untuk mode + input untuk `n`/`probability`/`retryAfterSeconds`/`timeoutMs`.
   - On save: `apiPut('/admin/config?XTransformPort=3001', body)`.
8. Payment detail drawer:
   - Buka saat click row di PaymentList.
   - Show payment fields + AttemptHistory.
   - Manual retry button (disabled jika status `succeeded`).

## Acceptance criteria

- [ ] `/` renders dashboard tanpa hydration error (cek `dev.log`).
- [ ] Gateway mode selector: pilih `client-error` → PUT ke mock berhasil → pill di header update.
- [ ] Create payment form: submit → payment muncul di list dengan status terminal.
- [ ] Payment list auto-refresh tiap 3s (status update terlihat).
- [ ] Click payment row → drawer dengan attempt history.
- [ ] Manual retry button pada `failed` payment → status berubah ke `processing` lalu terminal.
- [ ] Manual retry button pada `succeeded` → disabled (atau toast "cannot retry succeeded").
- [ ] Demo A–E buttons dapat di-click dan menyelesaikan sequence masing-masing.
- [ ] Circuit breaker card menampilkan state real-time (polling metrics).
- [ ] Metrics snapshot menampilkan 7 metric dengan nilai yang update.
- [ ] Mobile responsive: layout 1-kolom di <768px, 2-kolom di md, 3-kolom di lg.
- [ ] Footer sticky di bottom (tidak floating saat content pendek).
- [ ] `bun run lint` bersih.
- [ ] `bunx tsc --noEmit` bersih.
- [ ] Agent Browser verification (TASK-13 will formalize).

## Useful commands (run after completing this task)

```bash
# 0. Start gateway mock + dev server
cd /home/z/my-project/mini-services/payment-gateway-mock && bun run dev > /tmp/gateway.log 2>&1 &
sleep 1
bun run dev > /tmp/next-dev.log 2>&1 &
sleep 5

# 1. Lint & typecheck
bun run lint
bunx tsc --noEmit

# 2. Cek dev log
tail -n 40 /home/z/my-project/dev.log

# 3. Manual quick verification (curl key endpoints the UI will call)
curl -s "http://localhost:3000/admin/config?XTransformPort=3001" | jq .
curl -s -X PUT "http://localhost:3000/admin/config?XTransformPort=3001" \
  -H 'Content-Type: application/json' -d '{"mode":"always-success"}'
curl -s http://localhost:3000/api/health | jq .
curl -s http://localhost:3000/api/payments | jq .

# 4. (Manual) Buka preview panel di sebelah kanan interface ini,
#    atau klik "Open in New Tab" untuk view di browser tab terpisah.

# 5. Agent Browser verification — akan dijalankan formal di TASK-13,
#    tapi quick check sekarang:
#    - page load tanpa error
#    - 5 demo button terlihat
#    - gateway mode selector terlihat
```

## Notes

- **Server-side fetch untuk initial data**: bisa pakai server component untuk fetch first payment list (SEO tidak relevan untuk demo, tetapi lebih cepat first paint). Atau full client-side dengan TanStack Query. Pilih full client-side agar simpler.
- **No absolute URLs**: semua fetch di client pakai relative path (`/api/...` dan `/admin/config?XTransformPort=3001`). JANGAN hardcode `http://localhost:3000` di client code — akan break di preview env.
- **Polling interval**: 3s untuk payment list, 5s untuk metrics. Gunakan TanStack Query `refetchInterval`.
- **Sticky footer**: root div `min-h-screen flex flex-col`, footer `mt-auto`. Header `sticky top-0 z-50 bg-background/95 backdrop-blur`.
- **Toast feedback**: `sonner` sudah ada di dependency. Pakai `toast.success`/`toast.error` untuk semua mutation result.
- **Color restriction**: NO indigo / blue (sesuai UI rules). Pakai Tailwind built-in variables (`bg-primary`, `text-primary-foreground`, `bg-muted`, `bg-destructive/10`, dst.). Status pill warna boleh yellow/green/red/blue TIPIS (badge dengan variant).
- Setelah task ini selesai, TASK-13 akan verifikasi semua scenario end-to-end via Agent Browser.
