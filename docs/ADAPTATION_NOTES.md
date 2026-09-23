# Adaptation Notes — Plan vs Implementation

> **Tujuan**: Perbandingan antara plan asli ([`PLAN1_Cockatiel_Retry_Failure_Scenario.md`](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) rev 2) vs implementasi sandbox/lokal.
> Dibagi 3 section: (1) **Yang dipertahankan utuh** — 100% sesuai plan, jangan di-rewrite tanpa reason kuat.
> (2) **Yang diadaptasi** — ada perubahan dengan alasan teknis/environment.
> (3) **Ringkasan adaptasi kunci** — 10 poin paling penting untuk next engineer.
>
> **Plan reference**: [`PLAN1_Cockatiel_Retry_Failure_Scenario.md`](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) section 1–23
> **Cross-link**:
> - [`PRODUCTION_CAVEATS.md`](./PRODUCTION_CAVEATS.md) — caveat detail per adaptasi (sandbox vs production)
> - [`TECHNICAL_DEBT.md`](./TECHNICAL_DEBT.md) — 8 issue SOLID/clean code untuk refactor mendatang
> - [`DEMO_SCENARIOS.md`](./DEMO_SCENARIOS.md) — 5 scenario demo A–E yang membuktikan plan DoD tercapai
> - [`e2e-results.md`](./e2e-results.md) — 7 backend + 5 UI scenarios PASS dengan evidence
> - [`GATEWAY_MOCK_MODES.md`](./GATEWAY_MOCK_MODES.md) — detail 8 failure modes
> - [`DATABASE_ERD.md`](./DATABASE_ERD.md) — schema reference

---

## 📋 TL;DR — Adaptation Summary

| Kategori | Jumlah | Notes |
|---|---|---|
| Dipertahankan utuh | 8 | Core resilience + domain logic + observability contract |
| Diadaptasi (plan → implementation) | 22 | 10 key adaptations dari sandbox evolution (DB dual-env, OTel toggle, Node v24, port shift, ESM mock, breaker state, axios timeout) + 12 additional rows untuk complete coverage (ORM driver, scheduler port, idempotency store, distributed lock, auth, rate limit, Grafana JSON, logging, config, test framework, Docker availability, trace_id column type) |
| Out-of-scope (plan section 19) | 9 | Custom retry loop, distributed lock, Kafka, Redis queue, multi-region, dll |

> **Bottom line**: Adaptasi di atas **tidak mengorbankan** Demo A–E atau DoD plan section 22. Hanya mengurangi production-readiness (yang memang explicit out-of-scope per section 19 + 20).

---

## Section 1 — Yang Dipertahankan Utuh (Tidak Ada Perubahan)

Berikut aspek yang 100% sesuai plan rev 2 — **jangan di-rewrite ulang** di future refactoring tanpa reason yang sangat jelas:

### 1.1 Cockatiel v4 sebagai Resilience Engine

**Plan ref**: [PLAN1 section 5](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) — Resilience Architecture

- Composition order: `wrap(breaker, retry, timeout)` — CircuitBreaker (outer) → Retry → Timeout (inner)
- Tidak ada custom retry loop atau custom circuit breaker state machine (per [PLAN1 section 19](./PLAN1_Cockatiel_Retry_Failure_Scenario.md))
- Cockatiel `handleAll` dipakai sebagai retry policy; permanent error (4xx selain 429/408) ditangani dengan **return result, don't throw** di `ResilientPaymentGateway` (lihat `apps/payment-api/src/modules/gateway/resilient-adapter.ts` line 72-80)
- Singleton breaker per dependency (`packages/resilience/src/policies/breaker-store.ts`) — state bertahan lintas request dalam 1 process

### 1.2 Idempotency-Key Contract

**Plan ref**: [PLAN1 section 9](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) — Idempotency

- Header `Idempotency-Key` di-generate di payment-api side (UUID payment + attempt counter → `deriveIdempotencyKey(paymentId)` di `apps/payment-api/src/modules/gateway/idempotency-key.ts`)
- Gateway mock (`apps/payment-gateway-mock/src/shared/idempotency/idempotency-store.ts`) menyimpan charge result + replay response bila key sama dikirim ulang
- Standar industri diikuti: Stripe (`Idempotency-Key`), PayPal (`PayPal-Request-Id`), Adyen (`idempotency-key`) — pattern sama, header beda nama

### 1.3 8 Failure Modes Gateway Mock

**Plan ref**: [PLAN1 section 8.2](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) — Payment Gateway Mock

- `always-success`, `fail-first-n`, `server-error`, `always-timeout`, `client-error`, `random`, `succeed-but-drop-response`, `rate-limited` — semua diimplementasikan di `apps/payment-gateway-mock/src/shared/modes/mode-handler.ts`
- Switchable saat runtime via `PUT /admin/config` (lihat [GATEWAY_MOCK_MODES.md](./GATEWAY_MOCK_MODES.md) untuk detail per mode)

### 1.4 Payment Lifecycle State Machine

**Plan ref**: [PLAN1 section 10.1](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) — Payment API

- States: `pending`, `processing`, `succeeded`, `failed`, `scheduled_for_retry`, `circuit_open`
- Transition guard di `apps/payment-api/src/modules/payments/state-machine.ts` — pure function `assertCanTransition(from, to)` throw error bila invalid transition
- Note: `circuit_open` adalah intermediate state — payment transition ke `scheduled_for_retry` (durable) setelah breaker open terdeteksi

### 1.5 Durable Retry Scheduler

**Plan ref**: [PLAN1 section 12](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) — Scheduler

- Source of truth = PostgreSQL `payments.next_retry_at` column (bukan in-memory queue)
- Poller `SELECT ... WHERE next_retry_at <= NOW()` di `RetrySchedulerService.poll()` (lihat `apps/payment-api/src/modules/retry-scheduler/retry-scheduler.service.ts`)
- Scheduler survives process restart — payment `scheduled_for_retry` akan tetap di-pick setelah instance up lagi (proven by [Demo F / E2E scenario 6](./e2e-results.md))
- `MAX_TOTAL_RETRIES` (default 5) mengakhiri payment menjadi `failed` (proven by [E2E scenario 7](./e2e-results.md))

### 1.6 Audit Trail di `payment_attempts`

**Plan ref**: [PLAN1 section 11.2](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) — Persistence

- 1 row per attempt, dengan fields: `outcome`, `http_status`, `error_code`, `error_message`, `delay_before_next_ms`, `breaker_state`, `duration_ms`, `trace_id`, `idempotency_key`, `gateway_reference`, `replayed`
- AuditPort abstraction (`apps/payment-api/src/modules/payments/audit/audit-port.ts`) — `PrismaAuditService` / `TypeOrmAuditService` plug-in
- Late write detection: bila `idempotency_key` collision, audit row kedua tidak duplicate (di-skip via `IF NOT EXISTS` check at application level)

### 1.7 Metrics via `prom-client` + `/metrics` Endpoint

**Plan ref**: [PLAN1 section 13.2](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) — Metrics

- 7 metrics sesuai plan:
  1. `payment_gateway_requests_total` (counter, labels: outcome, http_status)
  2. `retry_attempts_total` (counter, labels: outcome, payment_status)
  3. `circuit_breaker_state` (gauge, labels: service)
  4. `payments_current_status` (gauge, labels: status)
  5. `payment_gateway_request_duration_seconds` (histogram)
  6. `payment_processing_duration_seconds` (histogram)
  7. `gateway_idempotent_replays_total` (counter)
- Exposition via `GET /metrics` (Prometheus text format) di `apps/payment-api/src/modules/metrics/metrics.controller.ts`
- Hindari high-cardinality labels (no `payment_id`, `order_id`, `trace_id` as labels — sesuai plan)

### 1.8 Trace ID via `AsyncLocalStorage`

**Plan ref**: [PLAN1 section 13.3](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) — Tracing (TASK-11 simplified, TASK-11b optional)

- `AsyncLocalStorage<TraceContext>` di `apps/payment-api/src/modules/observability/trace-context.ts` — trace ID available lintas async boundary tanpa explicit parameter passing
- Trace ID persist di `payment_attempts.trace_id` column (varchar(64)) — korelasi log + DB row + metric label
- `IS_OTEL` toggle (default `false` di sandbox): bila `true`, OTel SDK aktif + Jaeger export; bila `false`, ALS fallback (lihat adaptasi #4 di bawah)

---

## Section 2 — Yang Diadaptasi (Perubahan dari Plan + Alasan)

> Format tabel: `# | Aspek | Plan asli (rev 2) | Implementasi sandbox | Alasan adaptasi | Impact`

| # | Aspek | Plan asli (rev 2) | Implementasi sandbox | Alasan adaptasi | Impact / Cross-link |
|---|---|---|---|---|---|
| 1 | Database driver | PostgreSQL 16 native (PLAN1 section 3) | PostgreSQL 16 **+ SQLite** dual environment (TASK-14b) | Sandbox Z.ai tidak punya Docker binary — butuh SQLite untuk testing tanpa PostgreSQL | Helper `getUuidColumnType()` + `getTimestampColumnType()` di `apps/payment-api/src/database/helpers/db-types.helper.ts`. Env var `DB_TYPE=sqlite\|postgres` switches driver via `buildDbConfig()` di `db-config.ts`. Migration `0002_trace_id_varchar.ts` fix `char(32)` → `varchar(64)` agar compatible dengan UUID format |
| 2 | Entity column types | Native PG: `uuid` PK, `timestamp(3)`, `numeric(12,2)`, native PG enum | Driver-agnostic: `getUuidColumnType()` returns `'uuid'\|'varchar'`, `getTimestampColumnType()` returns `'timestamp'\|'datetime'`, enum pakai `varchar(30)` (SQLite tidak support native enum) | SQLite tidak support native `uuid`/`timestamp`/`enum` types — TypeORM adapter butuh fallback | Entity columns pakai helper function. Native PG enum (`payment_status_enum`, `attempt_outcome_enum`) **tetap dipakai di PostgreSQL** via migration SQL (lihat `0001_init.ts`), tapi entity column type-nya `varchar` agar TypeORM validation pass di kedua driver. Plan ideal rev 2 native types tetap achievable di PostgreSQL |
| 3 | Frontend strategy | Dual frontend (PLAN1 section 17 rev 2): Next.js ringkas + Vue+PrimeVue resmi | Dual sesuai plan: Next.js sandbox preview (port 3000, parent root) + Vue+PrimeVue (port 5173, `apps/frontend-vue/`) | Plan rev 2 sudah specify dual frontend — implementation follow plan, BUKAN adaptation baru. Adaptasi hanya di port assignment (lihat #7) | Tidak ada logic bisnis di frontend — pure presentation layer. Demo A–E official via Vue dashboard. Next.js cuma untuk sandbox preview ringkas |
| 4 | Scheduler deployment | `@nestjs/schedule` in-process (PLAN1 section 12 + 3) | `@nestjs/schedule` in-process di `payment-api` (same process, port 3001) — sesuai plan rev 2 | Plan rev 2 sudah arahkan ke `@nestjs/schedule` (in-process), bukan mini-service terpisah. Rev 1 dulu specify mini-service terpisah, tapi rev 2 simplify. Implementation follow rev 2 | Tidak butuh separate service/port untuk scheduler. Caveat: single-instance only — multi-instance butuh distributed lock (see [PRODUCTION_CAVEATS.md A.2 + B.3](./PRODUCTION_CAVEATS.md)) |
| 5 | OTel tracing | Full OTel SDK + OTLP export ke Jaeger (PLAN1 section 13.3 + 3) | Simplified AsyncLocalStorage + `trace_id` column (default), `IS_OTEL=true` toggle untuk full OTel SDK + Jaeger export | Sandbox tidak punya Docker untuk Jaeger receiver — `IS_OTEL=false` default supaya sandbox tetap jalan tanpa spam ECONNREFUSED ke `localhost:4318`. TASK-11b implement full OTel SDK tetap available sebagai opt-in | Trace ID format beda: ALS generate UUIDv4 (36 char dengan hyphen) → `varchar(64)`; OTel SDK generate W3C TraceParent (32 hex char) → juga fit `varchar(64)`. Bug fix #1: `dotenv.config()` di `otel.ts` top-level (line 22-35) wajib di-load sebelum evaluate `IS_OTEL` karena otel.ts di-import SEBELUM NestJS ConfigModule |
| 6 | Node version | Node v20.19.0 (PLAN1 section 3) | Node v24 (sandbox Z.ai) | Sandbox Z.ai pakai Node v24 — tidak bisa downgrade. Implementation compatible dengan v24 | `engines.node >= 20` di root `package.json` tetap specify v20 sebagai target. V24 work tanpa issue, tapi production should pin v20 LTS via Docker base image / `.nvmrc` |
| 7 | Port assignments | payment-api 3000 + gateway-mock 3001 (PLAN1 implicit, rev 1 default) | payment-api 3001 + gateway-mock 3002 + Vue 5173 + Grafana 3003 | Next.js sandbox preview otomatis jalan di port 3000 (parent root `/home/z/my-project/`) — port 3000 tidak bisa dipakai payment-api | Shift semua port +1: payment-api 3001, gateway-mock 3002, Grafana 3003 (bukan default 3000). Vue 5173 (Vite default). Jaeger 16686, Prometheus 9090 (sesuai default, tidak ada konflik) |
| 8 | Test mock untuk Cockatiel | Tidak specify (implisit pakai cockatiel real di Jest) | Manual mock `packages/resilience/__mocks__/cockatiel-adapter.ts` | Cockatiel v4 adalah ESM-only module. Jest 29 default CommonJS — tidak bisa `import cockatiel from 'cockatiel'` di Jest test tanpa ESM jest config. Manual mock provide minimal `wrap`, `retry`, `circuitBreaker`, `timeout` API untuk unit test | Mock ada di `packages/resilience/__mocks__/cockatiel-adapter.ts` (266 lines). Implement `MockRetryPolicy`, `MockCircuitBreakerPolicy`, `MockTimeoutPolicy`, `MockEvent`. **Integration test** tetap pakai cockatiel real via `tsx` runtime (lihat `tests/e2e/`) — mock hanya untuk unit test di `packages/resilience/test/` |
| 9 | Circuit breaker state tracking | Plan section 13.2 mention `circuit_breaker_state` gauge | `onStateChange` callback wired di `composition.ts` → `MetricsService.setBreakerState()` gauge | Bug fix #4 — awalnya breaker state tidak ter-propagate ke metrics (gauge selalu 0 = CLOSED). `buildBreakerPolicy` accept callback yang fire saat state transition CLOSED → OPEN → HALF_OPEN → CLOSED | Callback chain: `breaker-store.ts getBreaker(config, onStateChange)` → `composition.ts executeWithResilience(opts.onStateChange)` → `resilient-adapter.ts ResilientPaymentGatewayOptions.metrics` → `MetricsService.setBreakerState(state)` update gauge. Verifiable di `GET /metrics` line `circuit_breaker_state{service="payment-gateway"} 0\|1\|2` |
| 10 | axios timeout | Plan tidak eksplisit specify (implisit cockatiel timeout saja) | `GATEWAY_TIMEOUT_MS - 200` (default 1800ms bila GATEWAY_TIMEOUT_MS=2000ms) di `http-adapter.ts` line 36-37 | Bug fix #2 — race condition: axios default wait full response (5s di always-timeout), sementara Cockatiel timeout policy (2s) sudah move on ke retry. Audit `onAttempt` callback axios jalan **setelah** payment already `scheduled_for_retry` → late writes / missing audit rows | Buffer 200ms ensure axios fires FIRST (1800ms < 2000ms Cockatiel) bahkan dengan clock jitter. Audit row tertulis dengan benar sebelum Cockatiel Promise.race resolve. Lihat detail di [GATEWAY_MOCK_MODES.md "Arsitektur Timeout 3 Layer"](./GATEWAY_MOCK_MODES.md) |
| 11 | ORM driver | `mysql2` (rev 1) → `pg` (rev 2) | `pg` (node-postgres) + `better-sqlite3` (dual driver) | Konsekuensi dari #1. TypeORM 0.3 support native. Plan rev 2 sudah drop MySQL | `pg` untuk production/lokal Docker, `better-sqlite3` untuk sandbox/test tanpa Docker. Tidak ada `mysql2` sama sekali |
| 12 | Scheduler port | 3003 (rev 1, mini-service terpisah) | N/A — scheduler in-process di `payment-api:3001` | Konsekuensi dari #5. Tidak ada service terpisah, tidak butuh port | Scheduler jalan via `SchedulerRegistry.addInterval('retry-scheduler-poll', setInterval(...))` di `RetrySchedulerService.onApplicationBootstrap()`. Internal ke process, tidak expose port |
| 13 | Idempotency store di gateway mock | Plan section 9 tersirat persistent (Redis / DB table production-grade) | In-memory `Map<string, ChargeResult>` di `idempotency-store.ts` | Demo only — no Redis dependency. Plan ideal production: Redis + TTL 24-72 jam | Restart gateway mock = idempotency cache hilang. Untuk demo tidak masalah (single session), tapi **production must-have Redis atau DB-backed store**. See [PRODUCTION_CAVEATS.md B.2](./PRODUCTION_CAVEATS.md) |
| 14 | Scheduler distributed lock | Plan section 12 + 20.2 tersirat distributed (`FOR UPDATE SKIP LOCKED` atau Redis) | Tidak ada — single-instance in-process via `setInterval` | Plan rev 2 section 19 explicit "distributed lock scheduler" di list tidak diimplementasikan. Implementation follow ini | Multi-instance = race condition: 2+ scheduler pick same payment → double-process. Production must-have `FOR UPDATE SKIP LOCKED` (PostgreSQL native) atau Redis SET NX. See [PRODUCTION_CAVEATS.md A.2 + B.3](./PRODUCTION_CAVEATS.md) |
| 15 | Auth pada `/api` endpoints | Tidak eksplisit di plan (implisit gateway/API handle) | Tidak ada — open API, siapapun bisa POST /payments | Plan rev 2 section 19 explicit "auth" tidak di scope demo. Implementation follow | Demo only. Production must-have JWT / API key middleware + NextAuth untuk admin endpoints. See [PRODUCTION_CAVEATS.md B.5](./PRODUCTION_CAVEATS.md) |
| 16 | Rate limiting pada `/api/payments` | Tidak eksplisit di plan | Tidak ada | Plan rev 2 section 19 implicit out-of-scope | Demo only. Production must-have `@nestjs/throttler` + Redis backend, atau API gateway (Kong, AWS API Gateway) edge rate limit. See [PRODUCTION_CAVEATS.md B.6](./PRODUCTION_CAVEATS.md) |
| 17 | Grafana dashboard JSON | Plan section 16 mention Grafana dashboard provisioning | Sample PromQL text queries di [PRODUCTION_CAVEATS.md B.11](./PRODUCTION_CAVEATS.md) — tidak ada dashboard JSON file | Out of scope TASK-15. Provisioning JSON → future work | `docker/grafana/dashboards/` folder kosong. Production: provision via `docker/grafana/provisioning/dashboards/retry.json` auto-loaded. 7 metrics yang perlu visualisasi: `payment_gateway_requests_total`, `retry_attempts_total`, `circuit_breaker_state`, `payments_current_status`, `payment_gateway_request_duration_seconds`, `payment_processing_duration_seconds`, `gateway_idempotent_replays_total` |
| 18 | Logging | `nestjs-pino` (PLAN1 section 3 + 13.1) | `nestjs-pino` (sama) — **tidak ada adaptasi** | Sesuai plan 100% | Structured JSON logging via `Logger.log({ paymentId, orderId, traceId }, 'message')`. Pino-pretty untuk dev mode |
| 19 | Config validation | `@nestjs/config` + Joi schema (PLAN1 section 3) | `@nestjs/config` + Joi schema (`apps/payment-api/src/config/validation.schema.ts`) — **tidak ada adaptasi** | Sesuai plan 100% | Joi schema validate env vars saat startup. Fail-fast kalau ada env missing. Note: ada legacy `configuration.ts` + `env.ts` (class-validator) yang TIDAK dipakai — see [TECHNICAL_DEBT.md Issue 7 + 8](./TECHNICAL_DEBT.md) |
| 20 | Test framework | Jest + supertest (PLAN1 section 3) | Jest + supertest + **Agent Browser** (untuk UI demo verification) | Plan mention Jest + supertest only; Agent Browser ditambah untuk UI demo (Vue dashboard) verification via headless browser | Backend: 142 unit tests + 7 E2E scenarios PASS. UI: 5 demo scenarios verified via Agent Browser screenshot comparison |
| 21 | Docker compose availability | Wajib (PLAN1 section 16) | Tersedia di `docker-compose.yml` (postgres + jaeger + prometheus + grafana) tapi sandbox env tanpa Docker binary | Sandbox Z.ai tidak install Docker binary. Production/local pakai `docker compose up --build`. Sandbox dev: PostgreSQL eksternal / managed atau SQLite | `docker-compose.yml` ready-to-use di local. Sandbox: `DB_TYPE=sqlite` fallback. `docker/postgres/init.sql` create extension + initial schema. `docker/prometheus/prometheus.yml` scrape `/metrics` endpoint |
| 22 | Trace ID column type | Plan implisit `char(32)` (W3C TraceParent 32 hex) | `varchar(64)` (akomodasi UUIDv4 36 char + W3C 55 char) | Bug fix: schema awal `char(32)` tidak muat UUIDv4 (36 char). `PaymentsService` generate traceId via `randomUUID()` → 36 char. INSERT gagal → audit silent loss. Migration `0002_trace_id_varchar.ts` fix | Migration up: `ALTER COLUMN trace_id TYPE varchar(64)`. Migration down: `LEFT(trace_id, 32)` (lossy). Entity `@Column({ type: 'varchar', length: 64, nullable: true })`. Kompatibel dengan kedua format (ALS UUIDv4 + OTel W3C) |

---

## Section 3 — Ringkasan Adaptasi Kunci (10 Poin Penting untuk Next Engineer)

> Urutan prioritas baca untuk onboarding cepat — kalau cuma baca 1 section, baca ini.

### 1. Database dual-environment (TASK-14b) — paling pervasive adaptation

- PostgreSQL untuk production + lokal Docker, SQLite untuk sandbox testing tanpa Docker binary
- Helper functions di `database/helpers/db-types.helper.ts` abstract per-driver column types
- Env var `DB_TYPE=postgres|sqlite` switches DataSourceOptions via `buildDbConfig()` factory
- Migration `0002_trace_id_varchar.ts` fix bug: schema asli `char(32)` tidak muat UUIDv4 (36 char) — di-alter ke `varchar(64)`

### 2. Trace ID via AsyncLocalStorage (IS_OTEL toggle)

- Default `IS_OTEL=false` → ALS fallback, trace ID = UUIDv4 (36 char)
- Opt-in `IS_OTEL=true` → full OTel SDK + Jaeger export, trace ID = W3C TraceParent (32 hex char)
- **Critical bug fix**: `dotenv.config()` wajib di-load di `otel.ts` top-level (line 22-35) **sebelum** evaluate `IS_OTEL`, karena `otel.ts` di-import SEBELUM NestJS ConfigModule load `.env`. Tanpa ini, `process.env.IS_OTEL` undefined → SDK tidak start → trace_context.ts fallback ALS (silent)

### 3. Scheduler in-process (bukan mini-service terpisah)

- `@nestjs/schedule` SchedulerRegistry + `setInterval` di `RetrySchedulerService.onApplicationBootstrap()`
- Interval default 5000ms (`SCHEDULER_INTERVAL_MS`), batch size 50 (`SCHEDULER_BATCH_SIZE`), max retries 5 (`MAX_TOTAL_RETRIES`)
- Single-instance only — multi-instance butuh `FOR UPDATE SKIP LOCKED` atau external scheduler (see [PRODUCTION_CAVEATS.md A.2](./PRODUCTION_CAVEATS.md))

### 4. Port shift (3001 + 3002 + 3003)

- Port 3000 dipakai Next.js sandbox preview di parent root `/home/z/my-project/`
- Konsekuensi: payment-api `3001`, gateway-mock `3002`, Grafana `3003` (bukan default 3000)
- Jaeger 16686 + Prometheus 9090 + OTLP 4318 tetap default (tidak ada konflik di sandbox)
- Konstanta `GATEWAY_URL` di `.env` harus specify port 3002 eksplisit

### 5. Manual mock untuk Cockatiel ESM

- Cockatiel v4 = ESM-only. Jest 29 default CommonJS tidak bisa `import cockatiel`
- Solution: `packages/resilience/__mocks__/cockatiel-adapter.ts` (266 lines manual mock) untuk unit test
- Integration/E2E test tetap pakai real cockatiel via `tsx` runtime (lihat `apps/payment-api/tests/e2e/`)
- Mock provide: `wrap`, `retry`, `circuitBreaker`, `timeout`, `handleAll`, `delegate`, `FallbackPolicy`, `MockEvent` dengan `on/emit/dispose` API

### 6. axios timeout = Cockatiel timeout - 200ms (race condition fix)

- `http-adapter.ts` line 36-37: `this.timeoutMs = Math.max(100, cockatielTimeout - 200)`
- Buffer 200ms ensures axios fires FIRST (sebelum Cockatiel timeout policy), supaya `fn()` body (termasuk `onAttempt` audit callback) selesai sebelum Cockatiel move on ke retry
- Tanpa ini: audit rows late-write — payment sudah `scheduled_for_retry` sementara audit row attempt terakhir belum tertulis → `attemptCount` mismatch di E2E test
- Detail race matrix di [GATEWAY_MOCK_MODES.md](./GATEWAY_MOCK_MODES.md) section "Arsitektur Timeout 3 Layer"

### 7. Circuit breaker state propagation (bug fix #4)

- Composition: `getBreaker(dependencyName, config, onStateChange)` — callback fired saat state transition
- Wire chain: `composition.ts` → `resilient-adapter.ts ResilientPaymentGatewayOptions.metrics` → `MetricsService.setBreakerState(state)` update gauge `circuit_breaker_state{service="payment-gateway"}`
- Singleton breaker cache di `breaker-store.ts` Map — callback captured in closure pada FIRST creation only (acceptable karena adapter adalah singleton juga)
- Verifiable: `curl http://localhost:3001/metrics | grep circuit_breaker_state` → value 0 (CLOSED) / 1 (OPEN) / 2 (HALF_OPEN)

### 8. Entity types driver-agnostic (varchar + datetime untuk SQLite compat)

- Native PG enum `payment_status_enum` + `attempt_outcome_enum` tetap dipakai di PostgreSQL via migration SQL
- Entity column type `varchar(30)` (bukan native PG enum) supaya TypeORM reflection pass di kedua driver — trade-off: type safety slightly weaker di entity, tapi native enum tetap ada di DB level
- `getTimestampColumnType()` returns `'timestamp'` (PG) atau `'datetime'` (SQLite) — SQLite tidak support `'timestamp'` string literal
- `getUuidColumnType()` returns `'uuid'` (PG) atau `'varchar'` (SQLite 36 char) — SQLite tidak support native `uuid` type

### 9. Node v20 LTS target, v24 sandbox (works, but pin v20 untuk production)

- Root `package.json` `"engines": { "node": ">=20", "pnpm": ">=9" }` — specify v20 sebagai target LTS
- Sandbox Z.ai pakai v24 (tidak bisa downgrade) — v24 work tanpa issue
- Production should pin v20 LTS via Docker base image (`node:20-alpine`) atau `.nvmrc` file
- See [PRODUCTION_CAVEATS.md B.8](./PRODUCTION_CAVEATS.md) untuk detail

### 10. Dual frontend (plan rev 2 sudah specify, implementation follow)

- Next.js sandbox preview (port 3000, parent root `/home/z/my-project/`) — dashboard ringkas, shadcn/ui, TanStack Query
- Vue+PrimeVue (port 5173, `apps/frontend-vue/`) — dashboard resmi, demo A–E runner, PrimeVue components (DataTable, Card, Button, Toast, Dialog, Timeline, Chart)
- Keduanya konsumen API yang sama (`/api/payments`, `/api/health`, `/api/metrics`, gateway `/admin/config`) — pure presentation, no business logic
- Bukan adaptation baru — plan rev 2 section 17 sudah specify ini. Mention di sini sebagai "key" karena next engineer mungkin expect single frontend

---

## Section 4 — Cross-Reference Matrix

> Cross-link antara adaptasi di atas dengan doc lain — bila baca doc X, cek adaptasi Y.

| Adaptasi # | PLAN1 section | PRODUCTION_CAVEATS.md | TECHNICAL_DEBT.md | DEMO_SCENARIOS.md | e2e-results.md |
|---|---|---|---|---|---|
| 1 (DB dual) | 3, 11 | B.1 | - | - | Run Option B (SQLite) |
| 2 (Entity types) | 11.1, 11.2 | B.1 | - | - | - |
| 3 (Frontend dual) | 17 | - | - | Cara menjalankan demo | - |
| 4 (Scheduler in-process) | 12 | A.2, B.3 | - | Demo C (breaker) + E2E S6 | Scenario 6 row |
| 5 (OTel toggle) | 13.3 | B.4 | - | - | Run Option A vs B |
| 6 (Node v24) | 3 | B.8 | - | - | - |
| 7 (Port shift) | - (implicit) | B.9 | - | Cara menjalankan demo | - |
| 8 (Mock Cockatiel) | - (test infra) | - | - | - | - |
| 9 (Breaker state) | 13.2 | A.1 | Issue 3 (fat interface) | Demo C | Scenario 3 row |
| 10 (axios timeout) | - (bug fix) | - | - | Demo C (always-timeout) | Scenario 3 row |
| 11 (ORM driver) | 3 | - | - | - | - |
| 12 (Scheduler port) | 12 | A.2 | - | - | - |
| 13 (Idempotency store) | 9 | B.2 | - | Demo D | Scenario 4 row |
| 14 (Distributed lock) | 12, 19, 20.2 | A.2, B.3 | - | - | - |
| 15 (Auth) | 19 | B.5 | - | - | - |
| 16 (Rate limit) | 19 | B.6 | - | - | - |
| 17 (Grafana JSON) | 16 | B.11 | - | - | - |
| 18 (Logging) | 3, 13.1 | - | Issue 1, 2 (legacy stub) | - | - |
| 19 (Config validation) | 3 | - | Issue 7, 8 (legacy orphans) | - | - |
| 20 (Test framework) | 3, 14 | - | - | Demo A–E (UI) | All scenarios |
| 21 (Docker availability) | 16 | B.7 | - | Cara menjalankan demo | Run Option A vs B |
| 22 (Trace ID column type) | 11.2 | - | - | - | Scenario 3 (audit loss bug fix) |

---

## Section 5 — Hal yang Sengaja TIDAK Diadaptasi (Plan Section 19)

Plan rev 2 section 19 eksplisit list hal-hal yang **tidak diimplementasikan** — implementation 100% ikuti ini (tidak ada improvisasi):

- ❌ Custom retry loop (pakai Cockatiel)
- ❌ Custom circuit breaker state machine (pakai Cockatiel)
- ❌ Custom backoff algorithm (pakai Cockatiel `exponentialBackoff` + decorrelated jitter)
- ❌ Bulkhead / concurrency cap produksi penuh
- ❌ Distributed lock scheduler (`FOR UPDATE SKIP LOCKED` atau Redis SET NX)
- ❌ Kafka / RabbitMQ
- ❌ Redis queue
- ❌ Distributed circuit breaker (Redis-backed)
- ❌ Total deadline / retry budget yang kompleks
- ❌ Multi-region payment orchestration

> Bila next engineer mau implement salah satu di atas, baca [PRODUCTION_CAVEATS.md](./PRODUCTION_CAVEATS.md) dulu — setiap caveat punya rekomendasi solusi production-grade.

---

## 📝 Update History

| Tanggal | Perubahan | Alasan |
|---|---|---|
| 2026-09-25 | Initial creation | TASK-15 step 4 — final documentation handover. Konsolidasi 10 adaptasi kunci dari sandbox evolution (TASK-14b dual env + bug fixes #1, #2, #4 + ESM mock + breaker state propagation) |

---

## 💡 Catatan Akhir

- **Adaptasi di atas tidak mengorbankan plan DoD** — semua 13 DoD items di [PLAN1 section 22](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) tercapai (proven by [e2e-results.md](./e2e-results.md) 7/7 PASS + [DEMO_SCENARIOS.md](./DEMO_SCENARIOS.md) A–E verified)
- **Trade-off**: Pure plan compliance = production-ready but sandbox-unfriendly. Adapted implementation = sandbox-friendly dengan documented caveats. Pilihan ini explicit di [PLAN1 section 19 + 20](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)
- **Future evolution**: Bila ingin upgrade ke production, prioritas dari tertinggi ke terendah:
  1. PostgreSQL mandatory (drop SQLite support, atau pisahkan ke test-only)
  2. OTel SDK + Jaeger full-time (`IS_OTEL=true`)
  3. Distributed scheduler lock (Redis SET NX atau `FOR UPDATE SKIP LOCKED`)
  4. Auth + rate limit di `/api` endpoints
  5. Idempotency store Redis (bukan in-memory Map di gateway mock)
  6. Refactor technical debt di [TECHNICAL_DEBT.md](./TECHNICAL_DEBT.md) Priority 1 (delete dead code, 20 menit)
