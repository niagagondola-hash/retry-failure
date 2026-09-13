# Plan 1 — Cockatiel Retry/Failure Scenario — Subtask Index (rev 2)

> **Source plan**: `upload/PLAN1_Cockatiel_Retry_Failure_Scenario.md` (rev 2 — PostgreSQL + dual frontend)
> **Execution model**: satu per satu (sequential, dengan checkpoint command di setiap task)
> **Stack target**: NestJS 11 + TypeORM 0.3 + PostgreSQL 16 + Cockatiel + pnpm workspaces + dual frontend (Next.js sandbox + Vue+PrimeVue)
> **Monorepo root**: `/home/z/my-project/retry-failure/`

---

## 1. Ringkasan Eksekusi

Plan rev 2 ditulis ulang untuk stack yang faithful dengan plan asli:
- **Backend**: NestJS 11 (AppModule + modules + controllers + services).
- **Database**: PostgreSQL 16 dengan native ENUM, `uuid`, `timestamp(3)`.
- **ORM**: TypeORM 0.3 dengan driver `pg` (node-postgres).
- **Monorepo**: pnpm workspaces (via corepack).
- **HTTP client**: axios via `@nestjs/axios`.
- **Resilience**: Cockatiel 4 di `packages/resilience`.
- **Scheduler**: `@nestjs/schedule`.
- **Logging**: `nestjs-pino`.
- **Metrics**: `prom-client`.
- **Tracing**: OpenTelemetry SDK + Jaeger.
- **Testing**: Jest + supertest.
- **Validation**: class-validator + class-transformer.
- **Config**: `@nestjs/config` + Joi schema validation.
- **Container**: Docker multi-stage + docker-compose.
- **Frontend (dual)**:
  - **Next.js sandbox** di parent root (port 3000) — preview ringkas di sandbox cloud.
  - **Vue 3 + PrimeVue** di `apps/frontend-vue/` (port 5173) — dashboard resmi.

### Adaptasi lingkungan sandbox

| Constraint sandbox | Strategi |
|---|---|
| `pnpm` belum terpasang | enable via `corepack enable pnpm` di TASK-01 |
| `docker` tidak tersedia | PostgreSQL dijalankan via package Node.js (`pg` connect ke instance eksternal bila ada) atau skip integration test DB-dependent; gunakan in-memory mock repository untuk dev bila DB unavailable. Document caveat di TASK-15. |
| Port 3000 dipakai Next.js sandbox | `payment-api` di port 3001, `payment-gateway-mock` di port 3002, `frontend-vue` di 5173 |
| `node` v24 (lebih baru dari plan v20) | acceptable — pin `engines.node >= 20` di root `package.json` |
| Caddy gateway (1 port eksternal) | Next.js sandbox di port 3000; akses ke backend NestJS via `?XTransformPort=3001` (payment-api) atau `?XTransformPort=3002` (gateway-mock). Vue frontend dev di 5173 — akses langsung via browser dev. |

---

## 2. Execution Order & Task IDs

| Task ID | File | Title | Depends on | Est. |
|---|---|---|---|---|
| 1 | `TASK-01-scaffolding.md` | pnpm workspaces + NestJS monorepo + config | — | S |
| 2-a | `TASK-02-database.md` | PostgreSQL + TypeORM entities + migrations | 1 | M |
| 2-b | `TASK-03-gateway-mock.md` | Payment gateway mock (NestJS app, port 3002) | 1 | M |
| 2-c | `TASK-04-error-classification.md` | Error classification + Retry-After parsing | 1 | S |
| 3 | `TASK-05-cockatiel-resilience.md` | Cockatiel policy composition (`packages/resilience`) | 2-c | M |
| 4 | `TASK-06-gateway-adapter.md` | PaymentGatewayPort + HTTP + resilient adapter | 2-a, 2-b, 3 | M |
| 5 | `TASK-07-payments-service.md` | Payments domain service + state machine | 2-a, 4 | M |
| 6-a | `TASK-08-audit-trail.md` | Attempt audit (TypeORM PaymentAttempt service) | 2-a | S |
| 6-b | `TASK-09-api-routes.md` | NestJS controllers (payments/health/metrics) | 5, 6-a | M |
| 7 | `TASK-10-retry-scheduler.md` | Durable retry scheduler (`@nestjs/schedule`) | 6-b | M |
| 8 | `TASK-11-observability.md` | nestjs-pino + prom-client + OTel | 3, 5 | M |
| 9 | `TASK-12-nextjs-preview.md` | Next.js preview sandbox (parent root, port 3000) | 6-b | M |
| 10 | `TASK-13-vue-frontend.md` | Vue 3 + PrimeVue dashboard (`apps/frontend-vue`) | 6-b | L |
| 11 | `TASK-14-e2e-scenarios.md` | E2E: Jest+supertest + Agent Browser | 7, 8, 9, 10 | M |
| 12 | `TASK-15-documentation.md` | README + demo guide + production caveats | 11 | S |

### Dependency graph

```text
1 (pnpm workspaces + NestJS monorepo)
├── 2-a (PostgreSQL + TypeORM entities + migrations)
├── 2-b (gateway mock NestJS app)
└── 2-c (error classification — pure TS)
        │
        └── 3 (cockatiel policies, packages/resilience)
                │
                └── 4 (gateway adapter) ── uses 2-a, 2-b, 3
                        │
                        └── 5 (payments service) ── uses 2-a
                                │
                                ├── 6-a (audit trail) ── uses 2-a
                                │
                                └── 6-b (NestJS controllers)
                                        │
                                        ├── 7 (retry scheduler)
                                        ├── 8 (observability) ── uses 3, 5
                                        ├── 9 (Next.js sandbox preview)
                                        └── 10 (Vue+PrimeVue dashboard)
                                                │
                                                └── 11 (e2e) ── uses 7, 8, 9, 10
                                                        │
                                                        └── 12 (docs)
```

### Recommended execution batches

- **Batch 1** (sequential): `TASK-01`
- **Batch 2** (parallel, 3 agents): `TASK-02`, `TASK-03`, `TASK-04`
- **Batch 3** (sequential): `TASK-05` → `TASK-06` → `TASK-07`
- **Batch 4** (parallel, 2 agents): `TASK-08`, lalu `TASK-09` setelah `TASK-08` selesai
- **Batch 5** (parallel, 2 agents): `TASK-10`, `TASK-11`
- **Batch 6** (parallel, 2 agents): `TASK-12` (Next.js sandbox), `TASK-13` (Vue+PrimeVue)
- **Batch 7** (sequential): `TASK-14` → `TASK-15`

---

## 3. Konvensi Penamaan File & Komando Umum

Setiap file task memakai template yang sama:

1. **Goal** — apa yang dicapai
2. **Scope** — in/out of scope
3. **Files to create/modify** — path absolut (relatif ke `/home/z/my-project/retry-failure/` bila di monorepo, atau parent root untuk Next.js sandbox)
4. **Implementation steps** — urutan konkret
5. **Acceptance criteria** — checklist
6. **Useful commands** — command yang WAJIB dijalankan setelah task selesai

### Command umum (tersedia di seluruh task)

```bash
# Enable pnpm via corepack (sekali saja)
corepack enable pnpm
corepack prepare pnpm@latest --activate

# Install dependencies monorepo (root)
cd /home/z/my-project/retry-failure && pnpm install

# Lint (root)
cd /home/z/my-project/retry-failure && pnpm lint

# Typecheck (root)
cd /home/z/my-project/retry-failure && pnpm typecheck

# Build all
cd /home/z/my-project/retry-failure && pnpm build

# Run all tests
cd /home/z/my-project/retry-failure && pnpm test

# Run E2E tests
cd /home/z/my-project/retry-failure && pnpm test:e2e

# DB migrations (TypeORM CLI)
cd /home/z/my-project/retry-failure/apps/payment-api && pnpm db:migrate
cd /home/z/my-project/retry-failure/apps/payment-api && pnpm db:migrate:revert

# Dev mode (semua apps)
cd /home/z/my-project/retry-failure && pnpm dev

# Dev mode per-app
cd /home/z/my-project/retry-failure/apps/payment-api && pnpm start:dev        # port 3001
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock && pnpm start:dev # port 3002
cd /home/z/my-project/retry-failure/apps/frontend-vue && pnpm dev              # port 5173

# Next.js sandbox (parent root, port 3000)
cd /home/z/my-project && bun run dev
```

### Port assignments

| Service | Port | Lokasi |
|---|---|---|
| `payment-api` (NestJS) | 3001 | `retry-failure/apps/payment-api/` |
| `payment-gateway-mock` (NestJS) | 3002 | `retry-failure/apps/payment-gateway-mock/` |
| `frontend-vue` (Vite dev) | 5173 | `retry-failure/apps/frontend-vue/` |
| Next.js sandbox | 3000 | parent root `/home/z/my-project/` |
| PostgreSQL | 5432 | docker-compose atau managed |
| Prometheus | 9090 | docker-compose |
| Grafana | 3001-conflict? → 3003 | docker-compose |
| Jaeger UI | 16686 | docker-compose |
| OTel OTLP | 4318 | docker-compose |

> **Catatan konflik port**: Grafana default 3000 konflik dengan Next.js sandbox. Pindah ke 3003 di `docker-compose.yml`.

### Akses via Caddy (untuk Next.js sandbox di port 3000)

```bash
# Next.js fetch ke payment-api (port 3001) atau gateway-mock (port 3002)
fetch('/api/payments?XTransformPort=3001')              # via Caddy → :3001
fetch('/admin/config?XTransformPort=3002', { method: 'PUT', ... })  # via Caddy → :3002
```

> **PENTING**: dari Next.js client code, semua request cross-service WAJIB pakai relative path + `?XTransformPort=NNNN`. Jangan hardcode `http://localhost:3001` di client.

---

## 4. Source of Truth Files

- Original plan (rev 2): `/home/z/my-project/upload/PLAN1_Cockatiel_Retry_Failure_Scenario.md`
- Subtask files: `/home/z/my-project/retry-failure/docs/tasks/TASK-*.md`
- Worklog (cross-agent): `/home/z/my-project/worklog.md` — **setiap sub-agent WAJIB membaca & menambahkan entry di sini**.

---

## 5. Definition of Done (dari plan section 22 rev 2)

- [ ] Payment API (`POST /payments`) dapat membuat payment.
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
- [ ] Audit attempt tersimpan di PostgreSQL (`payment_attempts`).
- [ ] Metrics tersedia di `/metrics`.
- [ ] Grafana dashboard tersedia.
- [ ] Trace payment dapat ditemukan di Jaeger.
- [ ] Docker full stack berjalan (postgres + payment-api + gateway-mock + prometheus + grafana + jaeger).
- [ ] Dev mode berjalan tanpa Docker.
- [ ] Unit + E2E test lulus (Jest + supertest).
- [ ] Frontend Vue+PrimeVue dapat menjalankan semua scenario A–E.
- [ ] Frontend Next.js preview sandbox dapat menampilkan data dari payment-api.
- [ ] README menjelaskan failure scenarios + business impact.
