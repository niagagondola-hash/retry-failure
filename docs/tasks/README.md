# Plan 1 — Cockatiel Retry/Failure Scenario — Subtask Index

> **Source plan**: `upload/PLAN1_Cockatiel_Retry_Failure_Scenario.md`
> **Execution model**: satu per satu (sequential, dengan checkpoint command di setiap task)
> **Stack target**: Next.js 16 (App Router) + TypeScript + Prisma/SQLite + Cockatiel + shadcn/ui

---

## 1. Ringkasan Eksekusi

Plan aslinya dirancang untuk **NestJS + MySQL + pnpm workspaces**. Karena environment kita adalah **Next.js 16 + Prisma/SQLite + single-port 3000 dengan Caddy gateway**, plan ini diadaptasi dengan prinsip berikut:

1. **Konsep arsitektur tetap utuh**: Cockatiel sebagai resilience engine, error classification milik aplikasi, idempotency, durable retry, audit trail, observability, dan payment gateway mock.
2. **NestJS controllers/services → Next.js App Router + lib modules**: business logic disimpan di `src/lib/payments/*` (pure TS, framework-agnostic), diatur lewat API routes di `src/app/api/*`.
3. **TypeORM + MySQL → Prisma + SQLite**: enum menggunakan `String` + validator (SQLite tidak punya native enum), `Decimal` untuk amount, `DateTime` (ISO string) untuk timestamps.
4. **Monorepo (pnpm workspaces) → single project + mini-services**: `payment-gateway-mock` & `retry-scheduler` berjalan sebagai mini-service Bun terpisah di port 3001 & 3002, diakses lewat Caddy dengan `?XTransformPort=`.
5. **`@nestjs/schedule` → mini-service poller** pada `mini-services/retry-scheduler`.
6. **OTel + Jaeger**: diadaptasi menjadi optional / simplified (trace_id disimpan di `payment_attempts` + structured log), kecuali user meminta full OTel stack.
7. **Docker compose stack**: tidak dijalankan (environment ini sudah menyediakan dev server). Yang dipertahankan adalah dev mode + mini-services.

> Lihat `TASK-14-documentation.md` untuk catatan adaptasi lengkap.

---

## 2. Execution Order & Task IDs

Task IDs mengikuti konvensi global (1 = foundation, 2-a/2-b/2-c = parallel setelah 1, dst.). Eksekusi default adalah **sequential by file number**, tetapi task parallel ditandai agar bisa dipercepat bila dikerjakan oleh sub-agent terpisah.

| Task ID | File | Title | Depends on | Est. |
|---|---|---|---|---|
| 1 | `TASK-01-scaffolding.md` | Project scaffolding & dependencies | — | S |
| 2-a | `TASK-02-database.md` | Prisma schema (payments + payment_attempts) | 1 | S |
| 2-b | `TASK-03-gateway-mock.md` | Payment gateway mock (mini-service port 3001) | 1 | M |
| 2-c | `TASK-04-error-classification.md` | Error classification + Retry-After parsing | 1 | S |
| 3 | `TASK-05-cockatiel-resilience.md` | Cockatiel policy composition (retry/timeout/breaker) | 2-c | M |
| 4 | `TASK-06-gateway-adapter.md` | PaymentGatewayPort + HTTP + resilient adapter | 2-a, 2-b, 3 | M |
| 5 | `TASK-07-payments-service.md` | Payments domain service + state machine | 2-a, 4 | M |
| 6-a | `TASK-08-audit-trail.md` | Attempt audit (AuditPort + Prisma impl) | 2-a | S |
| 6-b | `TASK-09-api-routes.md` | Next.js API routes (payments/health/metrics) | 5, 6-a | M |
| 7 | `TASK-10-retry-scheduler.md` | Durable retry scheduler (mini-service port 3002) | 6-b | M |
| 8 | `TASK-11-observability.md` | Structured logging + Prometheus metrics | 3, 5 | M |
| 9 | `TASK-12-frontend-dashboard.md` | Demo dashboard UI (`src/app/page.tsx`) | 6-b | L |
| 10 | `TASK-13-e2e-scenarios.md` | E2E scenarios via Agent Browser | 7, 8, 9 | M |
| 11 | `TASK-14-documentation.md` | README + demo guide + production caveats | 10 | S |

### Dependency graph

```text
1 (scaffolding)
├── 2-a (database)
├── 2-b (gateway mock)
└── 2-c (error classification)
        │
        └── 3 (cockatiel policies)
                │
                └── 4 (gateway adapter) ── uses 2-a, 2-b, 3
                        │
                        └── 5 (payments service) ── uses 2-a
                                │
                                ├── 6-a (audit trail) ── uses 2-a
                                │
                                └── 6-b (API routes) ── uses 5, 6-a
                                        │
                                        ├── 7 (retry scheduler)
                                        ├── 8 (observability) ── uses 3, 5
                                        └── 9 (frontend dashboard)
                                                │
                                                └── 10 (e2e) ── uses 7, 8, 9
                                                        │
                                                        └── 11 (docs)
```

### Recommended execution batches

- **Batch 1** (sequential): `TASK-01`
- **Batch 2** (parallel, 3 agents): `TASK-02`, `TASK-03`, `TASK-04`
- **Batch 3** (sequential): `TASK-05` → `TASK-06` → `TASK-07`
- **Batch 4** (parallel, 2 agents): `TASK-08`, lalu `TASK-09` (setelah `TASK-08` selesai)
- **Batch 5** (parallel, 2 agents): `TASK-10`, `TASK-11`
- **Batch 6** (sequential): `TASK-12` → `TASK-13` → `TASK-14`

---

## 3. Konvensi Penamaan File & Komando Umum

Setiap file task memakai template yang sama:

1. **Goal** — apa yang dicapai
2. **Scope** — in/out of scope
3. **Files to create/modify** — path absolut
4. **Implementation steps** — urutan konkret
5. **Acceptance criteria** — checklist
6. **Useful commands** — command yang WAJIB dijalankan setelah task selesai (lint, typecheck, db:push, dev server, curl, agent-browser)

### Command umum (tersedia di seluruh task)

```bash
# Lint (wajib setelah setiap task)
bun run lint

# Typecheck cepat
bunx tsc --noEmit

# Push schema ke SQLite
bun run db:push

# Generate prisma client
bun run db:generate

# Baca dev log (cek error runtime)
tail -n 80 /home/z/my-project/dev.log

# Restart mini-service (background)
# Contoh: payment-gateway-mock
cd /home/z/my-project/mini-services/payment-gateway-mock && bun run dev &
```

### Mini-service ports

| Service | Port | Akses dari browser (via Caddy) |
|---|---|---|
| `payment-api` (Next.js) | 3000 | `/` (default) |
| `payment-gateway-mock` | 3001 | `/?XTransformPort=3001` atau `/v1/charges?XTransformPort=3001` |
| `retry-scheduler` | 3002 | `/?XTransformPort=3002` |

> **PENTING**: dari frontend Next.js, request ke mini-service WAJIB memakai relative path + `?XTransformPort=NNNN`. Jangan pernah hardcode `http://localhost:3001` di client code.

---

## 4. Source of Truth Files

- Original plan: `/home/z/my-project/upload/PLAN1_Cockatiel_Retry_Failure_Scenario.md`
- Subtask files: `/home/z/my-project/docs/tasks/TASK-*.md`
- Worklog (cross-agent): `/home/z/my-project/worklog.md` — **setiap sub-agent WAJIB membaca & menambahkan entry di sini**.

---

## 5. Definition of Done (dari plan section 22, diadaptasi)

- [ ] Payment API (`POST /api/payments`) dapat membuat payment.
- [ ] Gateway mock dapat mengganti failure mode saat runtime via dashboard.
- [ ] Cockatiel menangani request-level retry (bukti di `payment_attempts`).
- [ ] Exponential backoff + jitter terkonfigurasi (config-driven).
- [ ] Circuit breaker dapat dibuktikan melalui E2E scenario 3.
- [ ] Permanent 4xx tidak di-retry (scenario 2).
- [ ] `Retry-After` dihormati (scenario 5).
- [ ] Exhausted execution cycle → `scheduled_for_retry`.
- [ ] Scheduler memproses due payment (scenario 6).
- [ ] `MAX_TOTAL_RETRIES` mengakhiri payment menjadi `failed` (scenario 7).
- [ ] Idempotency menjamin `actualCharges <= 1` walaupun `calls >= 2` (scenario 4 — hero).
- [ ] Audit attempt tersimpan di SQLite (`payment_attempts`).
- [ ] Metrics tersedia di `/api/metrics`.
- [ ] Trace ID tersimpan di `payment_attempts.trace_id` + terlihat di log.
- [ ] Mini-service gateway mock + scheduler berjalan.
- [ ] Unit test (lint + typecheck) lulus.
- [ ] Dashboard UI menjalankan semua scenario A-E.
- [ ] README menjelaskan failure scenarios + business impact.
