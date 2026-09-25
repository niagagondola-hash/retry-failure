# Retry Failure - Cockatiel Edition

Production-like demo of payment processing failure handling using Cockatiel as resilience engine.

> Source plan: [`upload/PLAN1_Cockatiel_Retry_Failure_Scenario.md`](../upload/PLAN1_Cockatiel_Retry_Failure_Scenario.md)
> Subtask index: [`docs/plan1-cockatiel-retry-failure/tasks/README.md`](docs/plan1-cockatiel-retry-failure/tasks/README.md)
> Sandbox notes: [`docs/SANDBOX_NOTES.md`](docs/SANDBOX_NOTES.md)

## Quick start

```bash
# 1. Enable pnpm (sandbox only - local users may already have pnpm)
corepack enable pnpm
corepack prepare pnpm@9.12.0 --activate

# 2. Install dependencies (monorepo root)
pnpm install

# 3. Setup env file - copy one of the example files:
#    KONDISI LOCAL (Docker available):
cp .env.example apps/payment-api/.env
#    KONDISI SANDBOX (Docker NOT available, port 3000 used by Next.js preview):
cp .env.sandbox.example apps/payment-api/.env

# 4. Start PostgreSQL (LOCAL only - Docker required):
docker compose up -d postgres

# 5. Run DB migrations
pnpm db:migrate

# 6. Start all dev servers
pnpm dev
```

## Services

| Service | Port (LOCAL default) | Port (SANDBOX) | Path |
| --- | --- | --- | --- |
| `payment-api` (NestJS) | 3000 | 3001 | `apps/payment-api/` |
| `payment-gateway-mock` (NestJS) | 3001 | 3002 | `apps/payment-gateway-mock/` |
| `frontend-vue` (Vite) | 5173 | 5173 | `apps/frontend-vue/` |
| `@retry-failure/resilience` | - | - | `packages/resilience/` |
| PostgreSQL | 5432 | - | docker-compose |
| Prometheus | 9090 | - | docker-compose |
| Grafana | 3003 | - | docker-compose |
| Jaeger UI | 16686 | - | docker-compose |
| OTel OTLP | 4318 | - | docker-compose |

> **Port shift rationale**: Port 3000 dipakai Next.js sandbox preview di parent root, jadi `payment-api` geser ke 3001 dan `gateway-mock` ke 3002 (sandbox mode). Detail adaptasi plan → implementation lihat [`docs/plan1-cockatiel-retry-failure/ADAPTATION_NOTES.md`](docs/plan1-cockatiel-retry-failure/ADAPTATION_NOTES.md#7-port-assignments).

## Project structure

```text
retry-failure/
├── apps/
│   ├── payment-api/              # NestJS - payment orchestration (port 3001 sandbox / 3000 local)
│   ├── payment-gateway-mock/     # NestJS - mock gateway 8 failure modes (port 3002 / 3001)
│   └── frontend-vue/             # Vue 3 + PrimeVue dashboard (port 5173)
├── packages/
│   └── resilience/               # Cockatiel policies (retry+breaker+timeout composition)
├── docker/                        # postgres init.sql + Prometheus/Grafana config
├── docs/
│   ├── plan1-cockatiel-retry-failure/   # PLAN1-specific docs (reorganized)
│   │   ├── PLAN1_Cockatiel_Retry_Failure_Scenario.md  # source of truth domain logic
│   │   ├── tasks/                # TASK-01..16 spec files + README index
│   │   ├── skenario/             # Mermaid scenario diagrams (TASK-16)
│   │   ├── DEMO_SCENARIOS.md     # Demo A–E guide + business impact
│   │   ├── PRODUCTION_CAVEATS.md # Caveats + sandbox adaptation
│   │   ├── ADAPTATION_NOTES.md   # Plan vs implementation comparison
│   │   ├── GATEWAY_MOCK_MODES.md # Detail 8 failure modes + timeout architecture
│   │   ├── DATABASE_ERD.md       # Schema reference (narrative + DBML)
│   │   ├── DATABASE_ERD.dbml     # DBML source for dbdiagram.io
│   │   ├── ESM_CJS_MODULE_RESOLUTION_NOTES.md
│   │   └── e2e-results.md        # E2E test results (7 backend + 5 UI scenarios)
│   ├── command/                  # Sync commands + e2e debug tasks
│   ├── TECHNICAL_DEBT.md         # 8 SOLID/clean code issues untuk refactor
│   ├── TEST_MAINTENANCE_RULES.md # Rule khusus test maintenance + decision framework
│   └── SANDBOX_NOTES.md          # Sandbox environment notes (root)
├── docker-compose.yml             # postgres + jaeger + prometheus + grafana
├── package.json                   # root workspace
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md                      # this file
```

## Payment Retry Demo

Demo ini membuktikan 5 pilar resilience (retry, permanent-error skip, circuit breaker, **idempotency anti double-charge**, server-directed retry) via 5 scenario A–E dengan business impact.

**Hero scenario**: **Demo D — idempotency mencegah double charge**. Bila gateway sukses charge kartu customer tapi response hilang di network, retry tanpa idempotency akan menyebabkan double-charge. Demo D membuktikan `Idempotency-Key` header mencegah hal ini — `actualCharges === 1` walaupun `gatewayCallCount >= 2`.

**Cara menjalankan demo**:
- **Opsi 1 (recommended)**: Vue+PrimeVue dashboard di `http://localhost:5173` → tab "Demo Scenarios" → klik tombol A/B/C/D/E
- **Opsi 2 (audit / CI)**: curl commands — lihat per scenario di [`docs/plan1-cockatiel-retry-failure/DEMO_SCENARIOS.md`](docs/plan1-cockatiel-retry-failure/DEMO_SCENARIOS.md)

**Bukti pengujian otomatis**: Lihat [`docs/plan1-cockatiel-retry-failure/e2e-results.md`](docs/plan1-cockatiel-retry-failure/e2e-results.md) untuk tabel PASS/FAIL 7 backend scenarios + 5 UI demos dengan evidence (test output, DB snapshot, metric snapshot).

## Documentation

### Project docs (final handover — TASK-15)

- [**Demo Scenarios A–E + business impact**](docs/plan1-cockatiel-retry-failure/DEMO_SCENARIOS.md) — narrative demo guide, hero scenario D (idempotency anti double-charge), resep run via Vue dashboard atau curl
- [**Production Caveats + sandbox adaptation**](docs/plan1-cockatiel-retry-failure/PRODUCTION_CAVEATS.md) — plan section 20 (4 caveat utama) + 11 sandbox adaptation bullets + sample PromQL queries
- [**Adaptation Notes: plan vs implementation**](docs/plan1-cockatiel-retry-failure/ADAPTATION_NOTES.md) — 8 hal yang dipertahankan utuh, 22 adaptasi dengan alasan + cross-reference matrix
- [**E2E Test Results**](docs/plan1-cockatiel-retry-failure/e2e-results.md) — 7 backend + 5 UI scenarios PASS dengan evidence (sandbox SQLite + lokal PostgreSQL)
- [**Technical Debt**](docs/TECHNICAL_DEBT.md) — 8 SOLID/clean code issues untuk refactor mendatang (observability module)

### Reference & architecture docs

- [Plan document](../upload/PLAN1_Cockatiel_Retry_Failure_Scenario.md) — **source of truth domain logic** (rev 2)
- [Task index](docs/plan1-cockatiel-retry-failure/tasks/README.md) — TASK-01..16 spec files + execution order + DoD checklist
- [Sandbox notes (environment adaptation)](docs/SANDBOX_NOTES.md) — pre-flight check LOCAL vs SANDBOX
- [**CONTRIBUTING — Development Rules**](CONTRIBUTING.md) — wajib baca sebelum ngoding (rule test setelah ubah kode, mock parity, dll)
- [**Test Maintenance Rules**](docs/TEST_MAINTENANCE_RULES.md) — rule khusus test maintenance + decision framework saat source vs test conflict
- [**Database ERD**](docs/plan1-cockatiel-retry-failure/DATABASE_ERD.md) — narasi ERD + cara pakai di dbdiagram.io
- [**Database ERD (DBML)**](docs/plan1-cockatiel-retry-failure/DATABASE_ERD.dbml) — copy-paste ke https://dbdiagram.io/d untuk render visual
- [**Gateway Mock Modes**](docs/plan1-cockatiel-retry-failure/GATEWAY_MOCK_MODES.md) — detail 8 failure modes + arsitektur timeout 3 layer + use case
- [Test sync failures — bug analysis](docs/plan1-cockatiel-retry-failure/tasks/TASK-test-sync-failures.md) — catatan 7 failures pre-existing + filosofi test maintenance

## Stack

- **Runtime**: Node.js >= 20
- **Backend**: NestJS 11
- **Database**: PostgreSQL 16
- **ORM**: TypeORM 0.3 + driver `pg`
- **Resilience**: Cockatiel 4
- **Scheduler**: `@nestjs/schedule`
- **Logging**: `nestjs-pino`
- **Metrics**: `prom-client`
- **Tracing**: OpenTelemetry SDK + Jaeger
- **Testing**: Jest + supertest
- **Validation**: class-validator + class-transformer
- **Container**: Docker multi-stage + docker-compose
- **Frontend**: Next.js (sandbox preview) + Vue 3 + PrimeVue (full dashboard)

## Useful command
```bash
#type check
pnpm typecheck

#lint check
pnpm lint

#Run development mode single
cd apps/payment-api && pnpm start:dev
cd apps/payment-gateway-mock && pnpm start:dev
cd apps/frontend-vue && pnpm dev

#run test single file
pnpm --filter payment-api test tests\modules\retry-scheduler\retry-scheduler.service.spec.ts

#run integration test with log
pnpm test:e2e 2>&1 | Tee-Object -FilePath "apps\logs\e2e\S-e2e-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
```