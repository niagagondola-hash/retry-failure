# Production Caveats — Cockatiel Retry/Failure

> **Tujuan**: Daftar semua caveat yang harus diketahui sebelum mengangkat demo ini ke production. Dibagi 3 section:
> - **Section A**: Caveat dari PLAN1 section 20.1–20.4 (caveat yang sengaja didokumentasikan di plan)
> - **Section B**: Sandbox adaptation caveat (perbedaan antara plan ideal vs implementasi sandbox/lokal)
> - **Section C**: Hal yang sengaja TIDAK diimplementasikan ([PLAN1 section 19](./PLAN1_Cockatiel_Retry_Failure_Scenario.md))
>
> **Plan reference**: [PLAN1 section 19 + section 20](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)
> **Related**: [TECHNICAL_DEBT.md](./TECHNICAL_DEBT.md) — issue yang lebih kecil tapi bisa di-refactor
> **Cross-link**: [DEMO_SCENARIOS.md](./DEMO_SCENARIOS.md) — demo yang membuktikan caveat #4 (idempotency) sangat critical

---

## 📋 TL;DR — Caveat Summary

| # | Caveat | Severity production | Solusi yang dibutuhkan |
|---|---|---|---|
| A.1 | Circuit breaker in-memory per instance | High (multi-instance) | Redis-backed breaker state store |
| A.2 | Scheduler single-instance, no distributed lock | High (multi-instance) | Distributed lock (Redis SET NX / etcd lease) |
| A.3 | Retry hanya aman karena idempotency key | Critical (gateway contract) | Gateway HARUS support idempotency |
| A.4 | Metrics/logs = diagnostic, DB = source of truth | Low (cultural) | Operator training + runbook jelas |
| B.1 | SQLite vs PostgreSQL (dual env) | Low (sudah didokumentasikan) | Production: PostgreSQL mandatory |
| B.2 | In-memory idempotency store di gateway mock | High (gateway mock only) | Real gateway: Redis + TTL 24-72 jam |
| B.3 | No distributed lock scheduler (single instance only) | High (multi-instance) | Sama dengan A.2 |
| B.4 | IS_OTEL=false di sandbox default | Medium (observability) | Production: IS_OTEL=true + OTLP collector |
| B.5 | No auth on /api endpoints | Critical (security) | Tambah JWT / API key middleware |
| B.6 | No rate limiting on /api/payments | High (DDoS) | Tambah @nestjs/throttler atau API gateway |
| B.7 | Sandbox tanpa Docker | Low (env-specific) | Production: Docker / k8s mandatory |
| B.8 | Node v20 required, sandbox pakai v24 | Low (works) | Pin Node v20 LTS di Docker / .nvmrc |
| B.9 | Grafana port 3003 (bukan 3000) | Low (config) | Production: reverse proxy + path routing |
| B.10 | No GraphQL / gRPC | Low (scope) | Tambah kalau perlu, tidak blocker |
| B.11 | Sample Prometheus queries only (no Grafana dashboard JSON) | Low (artifact) | Provision dashboard JSON via Grafana provisioning |

---

## Section A — Caveat dari PLAN1 Section 20.1–20.4

Caveat di section A berasal langsung dari plan asli ([PLAN1 section 20](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)). Plan sudah mengakui hal-hal ini sejak awal, dan dengan sengaja tidak di-solve di scope demo — tapi **wajib di-address sebelum production**.

---

### A.1 Circuit Breaker State In-Memory Per-Instance

**Source**: [PLAN1 section 20.1](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)

#### Apa yang TIDAK ada

Circuit breaker Cockatiel adalah **singleton per dependency** dalam **satu process application**. State breaker (CLOSED / OPEN / HALF_OPEN) disimpan **in-memory** di `packages/resilience/src/breaker-store.ts` — tidak di-persist ke DB / Redis / shared store.

#### Kenapa tidak ada

- Plan asli (rev 2) sengaja tidak specify distributed circuit breaker — dianggap out-of-scope untuk demo (lihat [PLAN1 section 19](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) "distributed circuit breaker" di list tidak diimplementasikan)
- Cockatiel v4 sendiri tidak menyediakan distributed breaker built-in
- Implementasi distributed breaker (Redis-backed) akan menambah latency + complexity yang tidak sesuai scope demo

#### Impact ke production

Pada multi-instance deployment (misal: 3 pod payment-api di Kubernetes):

```text
API instance A → 3 failures → breaker A OPEN
API instance B → belum tahu → breaker B CLOSED → tetap call gateway → gagal lagi
API instance C → belum tahu → breaker C CLOSED → tetap call gateway → gagal lagi
```

Akibatnya:
- Saat instance A sudah Open (fast-fail), instance B & C masih bombard gateway
- Gateway tetap overloaded → tidak dapat waktu recover
- Customer di instance B & C tetap mengalami timeout (7+ detik)
- Total mitigation: hanya 1/3 dari traffic yang protected

#### Workaround di sandbox

Tidak ada — sandbox single-instance, breaker behavior benar untuk scope demo. Lihat [Demo C](./DEMO_SCENARIOS.md#-demo-c--circuit-breaker-melindungi-gateway) untuk bukti.

#### Yang perlu di-add untuk production

1. **Redis-backed breaker state store**:
   - Simpan `{ dependencyName → state, lastFailureAt, failureCount }` di Redis
   - TTL sesuai `BREAKER_COOLDOWN_MS`
   - Saat instance mau call gateway: cek Redis dulu (1 RTT overhead)
2. **Atau**: pakai service mesh (Istio, Linkerd) dengan circuit breaker native distributed (OutlierDetection)
3. **Atau**: gateway level — API gateway (Kong, AWS API Gateway) handle circuit breaker di edge

---

### A.2 Scheduler Single-Instance, No Distributed Guarantee

**Source**: [PLAN1 section 20.2](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)

#### Apa yang TIDAK ada

`RetrySchedulerService` (`apps/payment-api/src/modules/retry-scheduler/retry-scheduler.service.ts`) pakai `setInterval` in-process via `@nestjs/schedule` SchedulerRegistry. Tidak ada:

- Distributed lock (Redis SET NX / etcd lease / Postgres advisory lock)
- Leader election (Raft, Consul, Kubernetes lease)
- Multi-instance coordination

#### Kenapa tidak ada

- Plan section 19 secara eksplisit menyebut "distributed lock scheduler" sebagai hal yang sengaja tidak diimplementasikan
- Untuk demo single-instance, `setInterval` cukup — tidak ada race condition antar instance
- Distributed lock akan menambah dependency (Redis) yang tidak sesuai scope demo

#### Impact ke production

Pada multi-instance deployment:

```text
Scheduler instance A: poll() → find due payments → process
Scheduler instance B: poll() → find due payments (SAMA!) → process
Scheduler instance C: poll() → find due payments (SAMA!) → process
```

Akibatnya:
- Payment yang sama di-pick oleh 3 scheduler bersamaan
- `atomicUpdateStatus(paymentId, SCHEDULED_FOR_RETRY, PROCESSING)` di `payments.service.ts` line 102 mengandalkan optimistic locking — hanya 1 yang sukses transition, 2 lainnya dapat `BadRequestException`
- 2 instance yang gagal retry — `totalRetryCount` mereka tidak di-increment (karena gagal di awal)
- Tapi: idempotency key (Demo D) **menyelamatkan** uang customer — gateway akan replay, tidak double-charge
- **Efisiensi**: tetap waste CPU + DB query, tapi correctness preserved oleh idempotency

#### Workaround di sandbox

Tidak perlu — sandbox single-instance. Untuk multi-instance demo, gunakan sticky session di load balancer (hanya route scheduler traffic ke 1 instance).

#### Yang perlu di-add untuk production

1. **Redis SET NX dengan TTL** sebagai distributed lock:
   ```typescript
   const lockKey = `scheduler:lock:payment:${paymentId}`;
   const acquired = await redis.set(lockKey, instanceId, 'NX', 'EX', 30);
   if (!acquired) return; // some other instance got it
   try { await processPayment(paymentId); } finally { await redis.del(lockKey); }
   ```
2. **Atau**: Postgres `SELECT ... FOR UPDATE SKIP LOCKED` di query `findDueRetries()`:
   ```sql
   SELECT * FROM payments
   WHERE status = 'scheduled_for_retry' AND next_retry_at <= NOW()
   FOR UPDATE SKIP LOCKED
   LIMIT 50;
   ```
3. **Atau**: Pindahkan scheduler ke worker process terpisah (1 instance saja) — deployment pattern "scheduler as singleton pod"

---

### A.3 Payment Retry Hanya Aman Karena Idempotency Key

**Source**: [PLAN1 section 20.3](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)

#### Apa yang TIDAK ada

Tidak ada jaminan bahwa **semua POST ke gateway** aman di-retry. Aman-nya retry **bergantung sepenuhnya** pada kontrak gateway yang mendukung `Idempotency-Key` header.

#### Kenapa tidak ada (di scope ini)

- Plan section 9 ([idempotency](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)) secara eksplisit mensyaratkan: gateway mock WAJIB implement idempotency store
- Demo D ([hero scenario](./DEMO_SCENARIOS.md#-demo-d--idempotency-mencegah-double-charge--hero)) membuktikan ini bekerja
- Plan asumsi: integrasi production ke gateway real (Stripe, Adyen, Midtrans) yang sudah mendukung idempotency

#### Impact ke production

**TIDAK BOLEH** menganggap semua POST aman di-retry. Contoh gateway yang TIDAK support idempotency:
- Internal legacy services yang belum di-upgrade
- SOAP services yang hanya punya request ID
- Custom vendor API yang tidak punya kontrak retry-safe

Kalau payment-api retry POST ke gateway tanpa idempotency:
- Attempt 1: gateway charge sukses → response hilang → payment-api anggap gagal
- Attempt 2: gateway charge lagi → **DOUBLE CHARGE** → customer complain → refund process (operational cost + customer trust loss)

#### Workaround di sandbox

N/A — gateway mock di sandbox sudah implement idempotency store ([Demo D](./DEMO_SCENARIOS.md) membuktikan). Lihat juga [GATEWAY_MOCK_MODES.md](./GATEWAY_MOCK_MODES.md) section "succeed-but-drop-response" untuk detail flow.

#### Yang perlu di-add untuk production

1. **Audit kontrak gateway**: verifikasi semua gateway tujuan sudah support `Idempotency-Key` header
2. **Kalau gateway tidak support**:
   - Generate unique idempotency key client-side (UUID per payment)
   - Simpan ke DB **sebelum** call gateway
   - Setelah response (success atau failed), check DB apakah charge sudah recorded
   - Kalau belum, query gateway untuk verify — hanya lanjutkan kalau yakin belum charge
3. **Document all retry-safe POST endpoints** di internal wiki — operator harus tahu mana yang aman retry

---

### A.4 Observability: DB = Source of Truth, Metrics/Logs = Diagnostic

**Source**: [PLAN1 section 20.4](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)

#### Apa yang TIDAK ada

Metrics dan logs **bukan** source of truth. Hanya **diagnostic signals**. Source of truth tetap `payments` + `payment_attempts` table di database.

#### Kenapa tidak ada

Ini design decision yang benar — bukan bug. DB adalah persistent state yang survive restart. Metrics (in-memory Prometheus counter) dan logs (Pino JSON) bisa hilang saat pod restart / crash.

#### Impact ke production

- Operator alerting **HARUS** query DB untuk state final, bukan metrics
- Contoh: kalau `payments_current_status{status="failed"}` naik 10, jangan langsung conclude 10 payment failed — bisa saja metric lost dan re-counted
- **Verify via DB**:
  ```sql
  SELECT status, COUNT(*) FROM payments
  WHERE created_at >= NOW() - INTERVAL '1 hour'
  GROUP BY status;
  ```
- Metrics cocok untuk **trend** + **alerting threshold** (e.g., "error rate > 5% selama 5 menit"), bukan untuk **count exact**

#### Workaround di sandbox

Sandbox tidak ada issue karena single-instance. Production butuh:
- Prometheus remote-write ke long-term storage (Thanos, Mimir, VictoriaMetrics)
- Pino logs ship ke ELK / Loki / CloudWatch
- DB backup + replication

#### Yang perlu di-add untuk production

1. **Runbook jelas**: kalau alert trigger dari metric, step pertama harus verify di DB
2. **Dashboard Grafana**: tampilkan metric **dan** DB query panel (PostgreSQL data source di Grafana)
3. **Audit log retention**: `payment_attempts` table jangan di-delete ( regulatory compliance PCI-DSS butuh audit trail 18+ bulan)
4. **Backup strategy**: DB backup harian + point-in-time recovery (PITR) untuk PostgreSQL

---

## Section B — Sandbox Adaptation Caveats

Caveat di section B muncul dari **adaptasi** implementasi terhadap environment sandbox/lokal. Plan asli ([PLAN1](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)) men specify stack ideal (PostgreSQL, Docker, OTel SDK), tapi implementasi actual di sandbox memiliki trade-off untuk memudahkan demo tanpa Docker.

---

### B.1 PostgreSQL vs SQLite Adaptation

#### Apa yang TIDAK ada (di sandbox)

Sandbox default pakai SQLite (`DB_TYPE=sqlite` di `.env`). Tidak ada:
- Native PostgreSQL enum (`payment_status_enum`, `attempt_outcome_enum`)
- `gen_random_uuid()` PG function (pakai `crypto.randomUUID()` di app)
- `timestamp(3)` millisecond precision (SQLite pakai `datetime` = second precision)
- Native `uuid` column type (SQLite pakai `varchar(36)`)
- Migrations (SQLite pakai `synchronize: true`, skip migration files)

#### Kenapa tidak ada

- Sandbox environment tidak selalu punya PostgreSQL / Docker
- SQLite lebih ringan — 0 setup, file-based (`apps/payment-api/test.db`)
- TASK-14b ([dual environment](./tasks/TASK-14b-dual-environment.md)) mengaktifkan dual-driver support via `buildDbConfig()` factory

#### Impact ke production

**Production WAJIB pakai PostgreSQL** (atau MySQL rev 0 kalau vendor constraint). SQLite tidak cocok karena:
- Single-writer lock — concurrent write akan serialize
- Tidak support native `uuid` → index performance lebih buruk
- Tidak support native enum → application-level validation (lihat [DATABASE_ERD.md](./DATABASE_ERD.md) section "Dual Environment Support")
- Timestamp second precision → demo E (Retry-After) assertion `delta >= 2500ms` butuh tolerance 500ms di SQLite

#### Workaround di sandbox

Production switch otomatis via env:

```env
# Production / Lokal dengan Docker:
DB_TYPE=postgres
DB_HOST=localhost
DB_PORT=5432
DB_USER=retry_failure
DB_PASS=retry_failure
DB_NAME=retry_failure

# Sandbox / Test tanpa Docker:
DB_TYPE=sqlite
# File: apps/payment-api/test.db (auto-created via synchronize:true)
```

Helper functions di [`db-types.helper.ts`](../apps/payment-api/src/database/helpers/db-types.helper.ts):
- `getUuidColumnType()` → `'uuid'` PG, `'varchar'` SQLite
- `getTimestampColumnType()` → `'timestamp'` PG, `'datetime'` SQLite

#### Yang perlu di-add untuk production

- Migration wajib run via `pnpm db:migrate` sebelum service start
- `synchronize: false` MANDATORY di production (lihat [DATABASE_ERD.md](./DATABASE_ERD.md) "Dual Environment Support" table)
- Connection pool tuning: `DB_POOL_SIZE=20` (default TypeORM 10)

---

### B.2 In-Memory Idempotency Store di Gateway Mock

#### Apa yang TIDAK ada

Gateway mock (`apps/payment-gateway-mock/src/shared/idempotency/`) menyimpan idempotency records **in-memory** (Map). Tidak ada:
- Persistence ke Redis / DB
- TTL-based expiry (store grow unlimited selama proses hidup)
- Cross-process sharing (kalau gateway mock di-restart, store hilang)
- Cross-instance sharing (kalau ada 2 instance gateway mock)

#### Kenapa tidak ada

- Plan section 8 (gateway mock) tidak specify distributed idempotency store
- Untuk demo D, in-memory store cukup karena:
  - Demo single-instance
  - Store hanya perlu survive sepanjang satu payment lifecycle (~15 detik)
  - Restart gateway mock = reset demo state (acceptable untuk testing)

#### Impact ke production

**Gateway mock BUKAN gateway production**. Production gateway WAJIB:
- Redis cluster dengan TTL 24-72 jam (sesuai window idempotency)
- Persistence ke DB untuk audit (kadang regulatory compliance)
- Cross-instance sharing via Redis (kalau gateway di-scale horizontal)

Untuk payment-api sendiri, idempotency **di-handle di gateway**, bukan di payment-api. payment-api hanya **send header** `Idempotency-Key: <payment.id>` — contract-nya jelas: gateway yang bertanggung jawab deduplicate.

#### Workaround di sandbox

Lihat [GATEWAY_MOCK_MODES.md](./GATEWAY_MOCK_MODES.md) section "succeed-but-drop-response" untuk detail flow. Untuk demo, idempotency store cukup in-memory.

#### Yang perlu di-add untuk production

1. **Redis cluster** dengan key pattern: `idempotency:{key}` → `{ gateway_reference, captured_at, amount, currency, order_id }`
2. **TTL**: 24-72 jam (sesuai business requirement — Stripe pakai 24 jam, Adyen 72 jam)
3. **Atomic write**: pakai `SET NX EX` di Redis untuk mencegah race condition
4. **Audit log**: selain Redis, write ke DB persistent table untuk audit trail (regulatory)

---

### B.3 No Distributed Lock Scheduler (Single Instance Only)

> Note: caveat ini duplikat dengan A.2, tapi di-list di section B karena juga adaptation (bukan plan decision)

#### Apa yang TIDAK ada

Sama dengan [A.2](#a2-scheduler-single-instance-no-distributed-guarantee): scheduler tidak punya distributed lock. Di sandbox, scheduler in-process via `@nestjs/schedule` SchedulerRegistry.

#### Kenapa tidak ada

- Plan section 19 menyebut "distributed lock scheduler" sebagai hal yang sengaja tidak diimplementasikan
- Sandbox single-instance → tidak butuh lock

#### Impact ke production

Lihat [A.2](#a2-scheduler-single-instance-no-distributed-guarantee). Untuk multi-instance, scheduler bisa double-process payment yang sama (walau idempotency di gateway tetap amankan).

#### Workaround di sandbox

N/A — single instance.

#### Yang perlu di-add untuk production

Lihat [A.2](#a2-scheduler-single-instance-no-distributed-guarantee) — Redis SET NX atau Postgres `FOR UPDATE SKIP LOCKED`.

---

### B.4 No OTel SDK Export to Jaeger di Sandbox (IS_OTEL=false)

#### Apa yang TIDAK ada

Sandbox default `IS_OTEL=false`. Ini berarti:
- OTel SDK **tidak** start (skip di `apps/payment-api/src/otel.ts` dan `apps/payment-gateway-mock/src/otel.ts`)
- Trace ID via **AsyncLocalStorage fallback** (`crypto.randomUUID()` → 36 char UUID)
- **Tidak ada span tree** di Jaeger UI (service tidak muncul di dropdown)
- **Tidak ada cross-service trace** propagation via W3C TraceParent header
- Auto-instrumentations (HTTP, NestJS, axios) tidak terpasang

#### Kenapa tidak ada

- Sandbox tidak selalu punya Docker untuk run Jaeger container
- OTel SDK add startup overhead (~500ms) — tidak ideal untuk hot-reload dev mode
- ALS fallback sudah cukup untuk korelasi log `trace_id` di `payment_attempts` table
- TASK-11b ([OTel SDK](./tasks/TASK-11b-otel-sdk.md)) menambahkan toggle agar bisa switch mode

#### Impact ke production

**Production WAJIB `IS_OTEL=true`** dengan:
- OTLP collector (Jaeger, Tempo, atau vendor SaaS seperti Honeycomb, Datadog, Lightstep)
- Auto-instrumentations untuk HTTP, NestJS, TypeORM, axios
- Cross-service trace propagation (W3C TraceParent)

Tanpa OTel di production:
- Trace ID tidak konsisten format (UUID 36 char vs W3C 32 char hex)
- Tidak bisa korelasi trace antara payment-api → gateway mock (cross-service)
- Tidak bisa visualisasi span tree di Jaeger UI
- Debugging distributed system jadi sangat sulit

#### Workaround di sandbox

```bash
# Switch ke OTel mode (perlu Docker):
docker compose up -d jaeger
# Edit apps/payment-api/.env: IS_OTEL=true
# Restart payment-api
cd apps/payment-api && PORT=3001 pnpm start:dev

# Verify: trace_id harus 32 char hex (bukan 36 char UUID)
curl -X POST http://localhost:3001/payments -H "Content-Type: application/json" \
  -d '{"orderId":"OTEL-VERIFY","amount":100,"currency":"IDR"}'
# Lihat trace_id di DB — harus 32 char hex
# Buka Jaeger UI: http://localhost:16686
```

#### Yang perlu di-add untuk production

1. **OTLP collector** (Jaeger all-in-one atau Tempo + Grafana)
2. **Sampling strategy**: 100% untuk error traces, 10% untuk success (manage volume)
3. **Auto-instrumentations**: `@opentelemetry/auto-instrumentations-node` register di `otel.ts`
4. **Resource attributes**: tambah `service.version`, `deployment.environment`, `host.name` untuk filter di Jaeger UI
5. **Baggage propagation**: kalau butuh pass business context (orderId, customerId) across services

---

### B.5 No Auth on /api Endpoints

#### Apa yang TIDAK ada

Semua endpoint payment-api terbuka tanpa autentikasi:
- `POST /payments` — siapapun bisa create payment
- `GET /payments` — siapapun bisa list semua payment
- `GET /payments/:id` — siapapun bisa lihat detail payment + attempts
- `POST /payments/:id/retry` — siapapun bisa trigger manual retry
- `GET /metrics` — siapapun bisa scrape Prometheus metrics

Gateway mock juga terbuka:
- `PUT /admin/config` — siapapun bisa switch failure mode (DANGEROUS!)
- `GET /admin/stats` — siapapun bisa lihat gateway stats

#### Kenapa tidak ada

- Plan section 10 ([Payment API](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)) tidak specify auth — fokus pada resilience pattern, bukan security
- Auth dianggap out-of-scope demo
- Demo Vue dashboard memang akses langsung tanpa login

#### Impact ke production

**CRITICAL SECURITY ISSUE**:
- Attacker bisa create payment dengan orderId customer lain → IDOR (Insecure Direct Object Reference)
- Attacker bisa trigger manual retry massal → DoS via `POST /payments/:id/retry`
- Attacker bisa switch gateway mock mode → sabotage production
- Attacker bisa scrape `/metrics` → leak business intelligence (transaction volume, error rate)

#### Workaround di sandbox

Sandbox tidak perlu auth karena tidak exposed ke internet. Untuk local dev, tetap hati-hati jangan port-forward ke public.

#### Yang perlu di-add untuk production

1. **JWT authentication**:
   ```typescript
   // apps/payment-api/src/auth/jwt.strategy.ts
   @Injectable()
   export class JwtStrategy extends PassportStrategy(JwtStrategy) {
     constructor(config: ConfigService) {
       super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), ... });
     }
   }
   ```
2. **API key untuk internal services** (gateway mock admin endpoints):
   ```typescript
   @Controller('admin')
   @UseGuards(ApiKeyGuard)  // header: X-API-Key: <secret>
   export class AdminController {}
   ```
3. **Authorization (RBAC)**:
   - Customer: hanya bisa lihat payment miliknya (filter by `customer_id`)
   - Admin: bisa lihat semua payment + trigger retry
4. **Rate limiting** (lihat [B.6](#b6-no-rate-limiting-on-apipayments))
5. **HTTPS only** — enforce TLS di load balancer / API gateway

---

### B.6 No Rate Limiting on /api/payments

#### Apa yang TIDAK ada

Tidak ada rate limiting di payment-api. Setiap request langsung di-process tanpa throttle:
- `POST /payments` — siapapun bisa flood (1.000 req/detik → DB connection pool habis)
- `POST /payments/:id/retry` — bisa trigger retry storm
- Gateway mock juga tidak rate-limit (selain `rate-limited` mode yang explicit simulate)

#### Kenapa tidak ada

- Plan tidak specify rate limiting — out-of-scope demo
- Rate limiting adalah infra concern, biasanya di API gateway (Kong, AWS API Gateway) bukan di app

#### Impact ke production

Tanpa rate limiting:
- DDoS attack → DB connection pool habis → service unavailable
- Retry storm dari client yang tidak hormat exponential backoff → gateway overload
- Satu customer bisa monopolize resource (create 1.000 payment/detik)

#### Workaround di sandbox

N/A — sandbox tidak perlu.

#### Yang perlu di-add untuk production

1. **`@nestjs/throttler`** untuk app-level rate limiting:
   ```typescript
   @Controller('payments')
   @Throttle({ default: { limit: 10, ttl: 60000 } })  // 10 req/menit per IP
   export class PaymentsController {}
   ```
2. **API gateway level** (Kong, AWS API Gateway, Cloudflare):
   - Global rate limit (e.g., 100 req/menit per IP)
   - Per-customer limit (e.g., 5 payment/menit per user)
3. **Connection pool limit** di TypeORM:
   ```env
   DB_POOL_SIZE=20
   DB_POOL_MAX=50  # burst
   ```
4. **Circuit breaker outbound** ke gateway (sudah ada via Cockatiel) — lihat [Demo C](./DEMO_SCENARIOS.md#-demo-c--circuit-breaker-melindungi-gateway)

---

### B.7 Sandbox Without Docker

#### Apa yang TIDAK ada

Sandbox bisa run tanpa Docker (DB_TYPE=sqlite, IS_OTEL=false, no Jaeger/Prometheus/Grafana). Yang tidak available di sandbox mode:
- PostgreSQL 16 (diganti SQLite)
- Jaeger UI (trace ID pakai ALS fallback)
- Prometheus + Grafana dashboard (manual scrape dari `/metrics`)
- `docker compose up` satu perintah untuk full stack

#### Kenapa tidak ada

- Sandbox environment kadang tidak punya Docker daemon
- Untuk development iteration cepat, hot-reload tanpa Docker lebih produktif
- TASK-14b ([dual environment](./tasks/TASK-14b-dual-environment.md)) memungkinkan dual mode

#### Impact ke production

**Production WAJIB Docker / k8s** untuk:
- Reproducible deployment
- Container orchestration (auto-scaling, health check, rolling update)
- Network isolation + secret management

#### Workaround di sandbox

```bash
# Mode 1: Sandbox tanpa Docker (cepat untuk dev/test)
DB_TYPE=sqlite IS_OTEL=false pnpm dev

# Mode 2: Lokal dengan Docker (full stack observability)
docker compose up -d postgres jaeger prometheus grafana
IS_OTEL=true DB_TYPE=postgres pnpm dev

# Mode 3: Full Docker (semua service di container)
docker compose up --build
```

#### Yang perlu di-add untuk production

1. **Docker image** untuk payment-api + gateway mock (Dockerfile + multi-stage build)
2. **Kubernetes manifests** atau Helm chart:
   - Deployment + Service + Ingress
   - ConfigMap + Secret
   - HorizontalPodAutoscaler
   - PodDisruptionBudget
3. **CI/CD pipeline**: GitHub Actions / GitLab CI untuk build + push image + deploy
4. **Health check + readiness probe** (sudah ada `GET /health`, perlu expose `/ready`)

---

### B.8 Node Version (v20 Required, Sandbox v24 Work)

#### Apa yang TIDAK ada

`package.json` specify `"engines": { "node": ">=20", "pnpm": ">=9" }`. Tidak ada:
- Engine strict mode (`engine-strict=true` di `.npmrc` — sandbox tidak aktif)
- Node version pinning (`.nvmrc` file tidak ada)
- Specific Node v20 test di CI

#### Kenapa tidak ada

- Plan tidak specify Node version exact — hanya "v20+"
- Sandbox bisa pakai v24 (latest LTS) tanpa issue
- v20 LTS masih supported sampai April 2026

#### Impact ke production

Production bisa pakai v20 atau v24 — keduanya LTS. Yang penting:
- Consistent version across instances (jangan campur v20 + v24 di cluster yang sama)
- Test di version yang sama dengan production (sandbox v24 vs production v20 bisa ada subtle bug)

#### Workaround di sandbox

Sandbox pakai Node v24.21.0 — semua 142 test PASS. Tidak ada issue kompatibilitas terdeteksi.

#### Yang perlu di-add untuk production

1. **`.nvmrc` file** di repo root:
   ```
   20.18.0
   ```
2. **`.npmrc`** dengan `engine-strict=true`:
   ```ini
   engine-strict=true
   ```
3. **Docker image base**: `node:20.18-alpine` (pin minor version)
4. **CI matrix test**: test di v20 + v24 untuk catch version-specific bug

---

### B.9 Grafana Port 3003 (Bukan 3000)

#### Apa yang TIDAK ada

Grafana di `docker-compose.yml` di-map ke host port **3003** (container port 3000), BUKAN default 3000. Alasan: konflik dengan Next.js yang juga pakai port 3000.

```yaml
# docker-compose.yml
grafana:
  image: grafana/grafana:11.2.0
  ports:
    - '3003:3000'  # ← host 3003 → container 3000
```

#### Kenapa tidak ada (default 3000)

- Next.js preview di `apps/payment-api` (root, port 3000) sudah pakai 3000
- Kalau Grafana juga di 3000, conflict → salah satu tidak bisa start
- Solution: Grafana di 3003 (jarang dipakai), Next.js tetap di 3000

#### Impact ke production

Production biasanya pakai reverse proxy (nginx, Traefik, AWS ALB) — port number internal tidak exposed. Tapi:
- Operator perlu tahu Grafana URL: `http://grafana.example.com` (path-based routing) atau `http://monitoring.example.com` (host-based)
- Bookmark / dashboard link harus konsisten

#### Workaround di sandbox

Akses Grafana di `http://localhost:3003` (default login: admin/admin).

#### Yang perlu di-add untuk production

1. **Reverse proxy** (nginx/Traefik):
   - `grafana.example.com` → service:3000
   - `prometheus.example.com` → service:9090
   - `jaeger.example.com` → service:16686
2. **Authentication**: SSO (OAuth, SAML) untuk Grafana
3. **HTTPS only**: TLS termination di reverse proxy

---

### B.10 No GraphQL / gRPC

#### Apa yang TIDAK ada

Payment-api hanya expose REST API (`POST /payments`, `GET /payments/:id`, dll). Tidak ada:
- GraphQL endpoint (`/graphql` dengan Apollo Server atau Mercurius)
- gRPC service (Protocol Buffers + gRPC-node)
- WebSocket untuk real-time payment status update

#### Kenapa tidak ada

- Plan section 10 ([Payment API](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)) hanya specify REST
- Untuk demo, REST cukup + Swagger UI (`/docs`) untuk explorer
- GraphQL/gRPC akan menambah scope yang tidak sesuai target

#### Impact ke production

Untuk demo: tidak ada impact. Untuk production:
- GraphQL cocok kalau client butuh flexible query (e.g., "ambil payment + attempts + gateway stats dalam 1 request") — REST butuh 3 round-trip
- gRPC cocok untuk internal service-to-service (lebih cepat dari REST karena binary + HTTP/2)
- WebSocket cocok untuk real-time notification (e.g., "payment succeeded" push ke client)

#### Workaround di sandbox

N/A — REST sudah cukup untuk demo.

#### Yang perlu di-add untuk production (kalau perlu)

1. **GraphQL** (Apollo Server + NestJS GraphQL module):
   - Schema: `Payment`, `PaymentAttempt`, `GatewayStats`
   - Query: `payments(filter)`, `payment(id)`, `gatewayStats`
   - Mutation: `createPayment`, `retryPayment`
2. **gRPC** (nice-grpc atau @grpc/grpc-js):
   - Define `.proto` files
   - Generate TypeScript types
   - Server + client implementation
3. **WebSocket** (Socket.io atau native ws):
   - Subscribe: `payment:updated:{id}`
   - Emit pada status transition (succeeded/failed/scheduled_for_retry)

---

### B.11 Sample Prometheus Queries (Untuk Grafana Dashboard)

> **Status**: Sample PromQL queries saja — dashboard JSON belum di-provision (lihat [e2e-results.md DoD](./e2e-results.md) "Grafana dashboard belum provisioned")
> **Prerequisite**: `docker compose up -d prometheus grafana` (Prometheus scrape `/metrics` dari payment-api)
> **Access**: Grafana di `http://localhost:3003` (lihat [B.9](#b9-grafana-port-3003-bukan-3000))

#### 7 Metrics yang di-expose payment-api

Source: [`apps/payment-api/src/modules/observability/metrics.service.ts`](../apps/payment-api/src/modules/observability/metrics.service.ts) (PLAN1 section 13.2)

| # | Metric name | Type | Labels | Description |
|---|---|---|---|---|
| 1 | `payment_gateway_requests_total` | Counter | `outcome`, `http_status` | Total HTTP request ke gateway per outcome + HTTP status |
| 2 | `retry_attempts_total` | Counter | `outcome`, `payment_status` | Total Cockatiel retry attempts per outcome + payment status |
| 3 | `circuit_breaker_state` | Gauge | `service` | Breaker state: 0=CLOSED, 1=OPEN, 2=HALF_OPEN |
| 4 | `payments_current_status` | Gauge | `status` | Active payments count by status (processing/succeeded/failed/scheduled_for_retry) |
| 5 | `payment_gateway_request_duration_seconds` | Histogram | (none) | Duration HTTP call ke gateway (single attempt) |
| 6 | `payment_processing_duration_seconds` | Histogram | (none) | Duration total payment cycle (incl. retries) |
| 7 | `gateway_idempotent_replays_total` | Counter | (none) | Total replay detected (`response.replayed === true`) |

> Anti-pattern: tidak ada high-cardinality labels (`payment_id`, `order_id`, `trace_id`, `error_message`). Itu log fields only.

#### 8 Sample PromQL Queries untuk Grafana Dashboard

##### Query 1 — Gateway Error Rate

```promql
# Persentase request ke gateway yang gagal (5xx + timeout + network error)
sum(rate(payment_gateway_requests_total{outcome="failure"}[5m]))
/
sum(rate(payment_gateway_requests_total[5m]))
* 100
```

**Panel type**: Stat / Gauge. Threshold: <1% green, 1-5% yellow, >5% red.

##### Query 2 — Gateway Requests per Second (RPS) by HTTP Status

```promql
# RPS ke gateway, breakdown per HTTP status code
sum(rate(payment_gateway_requests_total[5m])) by (http_status)
```

**Panel type**: Time series (stacked). Useful untuk lihat komposisi 200/400/429/500/timeout.

##### Query 3 — Circuit Breaker State

```promql
# State breaker (0=CLOSED, 1=OPEN, 2=HALF_OPEN)
circuit_breaker_state{service="payment-gateway"}
```

**Panel type**: Stat. Color: 0=green (CLOSED), 1=red (OPEN), 2=yellow (HALF_OPEN).

##### Query 4 — Active Payments by Status

```promql
# Jumlah payment per status saat ini
payments_current_status
```

**Panel type**: Bar gauge. Threshold: `scheduled_for_retry > 100` = warning (scheduler kewalahan).

##### Query 5 — Retry Attempt Success Rate

```promql
# Persentase retry attempt yang sukses
sum(rate(retry_attempts_total{outcome="success"}[5m]))
/
sum(rate(retry_attempts_total[5m]))
* 100
```

**Panel type**: Stat. Target: >70% (sisanya retry exhaustion → scheduler cycle).

##### Query 6 — Gateway Latency p95 / p99

```promql
# p95 latency single attempt ke gateway
histogram_quantile(0.95, sum(rate(payment_gateway_request_duration_seconds_bucket[5m])) by (le))

# p99 latency
histogram_quantile(0.99, sum(rate(payment_gateway_request_duration_seconds_bucket[5m])) by (le))
```

**Panel type**: Time series. Threshold: p95 > 1s = warning, p99 > 2s = critical.

##### Query 7 — Total Payment Processing Duration p50 / p95

```promql
# p50 total payment cycle (incl. retries)
histogram_quantile(0.50, sum(rate(payment_processing_duration_seconds_bucket[5m])) by (le))

# p95 total payment cycle
histogram_quantile(0.95, sum(rate(payment_processing_duration_seconds_bucket[5m])) by (le))
```

**Panel type**: Time series. Threshold: p95 > 10s = warning (too many retries).

##### Query 8 — Idempotent Replay Rate (HERO metric)

```promql
# Rate replay detected per detik (indikator drop-response atau retry)
rate(gateway_idempotent_replays_total[5m])

# Atau: ratio replay vs total requests (lebih meaningful)
sum(rate(gateway_idempotent_replays_total[5m]))
/
sum(rate(payment_gateway_requests_total[5m]))
* 100
```

**Panel type**: Time series. Spike > 10% = network issue (banyak response drop).

#### Cara Setup di Grafana

1. Login ke `http://localhost:3003` (admin/admin)
2. **Configuration → Data Sources → Add data source → Prometheus**
   - URL: `http://prometheus:9090` (dari dalam Docker network)
   - Atau: `http://localhost:9090` (kalau Grafana di-host)
3. **Create → Dashboard → Add panel**
   - Pilih metric dari dropdown atau paste PromQL query
   - Pilih panel type (Stat, Time series, Bar gauge, Gauge)
4. **Save dashboard** dengan nama "Cockatiel Payment Resilience"

#### Yang perlu di-add untuk production

1. **Provisioning via JSON** (Grafana Infrastructure-as-Code):
   - Taruh dashboard JSON di `docker/grafana/dashboards/*.json`
   - Provisioning config di `docker/grafana/provisioning/dashboards/dashboards.yml`
2. **Alert rules** (Grafana Alerting atau Prometheus Alertmanager):
   - `circuit_breaker_state == 1` for >1 menit → alert
   - `payment_gateway_requests_total{outcome="failure"}` rate > 10% → alert
   - `payments_current_status{status="scheduled_for_retry"}` > 100 → alert (scheduler kewalahan)
3. **Long-term storage** (kalau retention > 15 hari): Thanos / Mimir / VictoriaMetrics
4. **Multi-tenant** (kalau multiple team): Grafana Organizations + RBAC

---

## Section C — Hal yang Sengaja TIDAK Diimplementasikan

**Source**: [PLAN1 section 19 — Hal yang Sengaja Tidak Diimplementasikan](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)

Plan section 19 secara eksplisit menyebut hal-hal berikut sebagai **out-of-scope** untuk demo. Bukan karena tidak penting, tapi karena fokus demo adalah **membuktikan Cockatiel + idempotency + scheduler pattern bekerja**, bukan membangun production payment platform.

### C.1 Custom Retry Loop

**Tidak ada**: implementasi custom retry algorithm sendiri (loop + setTimeout + counter).

**Kenapa**: pakai Cockatiel v4 — library production-grade untuk resilience. Custom loop akan menambah bug surface area yang tidak perlu.

**Impact ke production**: tidak ada. Cockatiel sudah tested + production-proven.

### C.2 Custom Circuit Breaker State Machine

**Tidak ada**: implementasi state machine CLOSED → OPEN → HALF_OPEN sendiri.

**Kenapa**: Cockatiel sudah punya circuit breaker built-in dengan state machine yang benar + tested. Lihat [`packages/resilience/src/breaker/`](../packages/resilience/src/breaker/) untuk adapter.

**Impact ke production**: tidak ada. Yang perlu di-add: distributed state store (lihat [A.1](#a1-circuit-breaker-state-in-memory-per-instance)).

### C.3 Custom Backoff Algorithm

**Tidak ada**: implementasi custom exponential backoff + jitter sendiri.

**Kenapa**: Cockatiel `ExponentialBackoff` + `DelegateBackoff` sudah cukup. Custom hanya untuk handle `Retry-After` header (lihat [`policies.ts` `customBackoff`](../packages/resilience/src/policies.ts)).

**Impact ke production**: tidak ada.

### C.4 Bulkhead / Concurrency Cap Produksi Penuh

**Tidak ada**: bulkhead policy untuk cap concurrent call ke gateway (misal: max 10 concurrent, sisanya queue).

**Kenapa**: Cockatiel support bulkhead, tapi untuk demo tidak diaktifkan. Production gateway biasanya punya connection pool sendiri di axios/undici yang sudah cap.

**Impact ke production**: medium. Tanpa bulkhead, sudden traffic spike bisa penuhi connection pool axios → semua request serialize.

**Yang perlu di-add**: `BulkheadPolicy` dari Cockatiel dengan `maxConcurrent=20` (sesuai DB pool size).

### C.5 Distributed Lock Scheduler

**Tidak ada**: lihat [A.2](#a2-scheduler-single-instance-no-distributed-guarantee) dan [B.3](#b3-no-distributed-lock-scheduler-single-instance-only).

### C.6 Kafka / RabbitMQ

**Tidak ada**: message queue untuk async payment processing.

**Kenapa**: plan pilih synchronous payment processing (POST /payments block sampai sukses/gagal) untuk demo simplicity. Async dengan Kafka bisa untuk high-throughput, tapi add complexity yang tidak sesuai scope.

**Impact ke production**: untuk high-volume payment platform (Stripe-scale), async via Kafka wajar. Untuk mid-scale, sync dengan retry + scheduler cukup.

### C.7 Redis Queue

**Tidak ada**: Redis sebagai queue backend untuk retry.

**Kenapa**: scheduler pakai DB-backed queue (`payments` table dengan `next_retry_at` timestamp). Redis queue bisa lebih cepat, tapi DB sudah cukup untuk demo volume.

**Impact ke production**: untuk >1000 payment/detik, Redis queue (BullMQ, Sidekiq) lebih scalable.

### C.8 Distributed Circuit Breaker

**Tidak ada**: lihat [A.1](#a1-circuit-breaker-state-in-memory-per-instance).

### C.9 Total Deadline / Retry Budget yang Kompleks

**Tidak ada**: total deadline per payment (misal: "payment harus sukses dalam 5 menit, kalau tidak failed") atau retry budget (misal: "max 10 retry total across all cycles").

**Kenapa**: plan pakai simpler `MAX_TOTAL_RETRIES=5` (counter scheduler cycle). Tidak ada deadline wall-clock.

**Impact ke production**: medium. Tanpa deadline, payment bisa stuck di retry loop jam-jam kalau gateway slow-recover.

**Yang perlu di-add**:
- `payments.deadline_at` column (timestamp)
- Scheduler check: `if (now > payment.deadline_at) → mark failed`
- Set `deadline_at = NOW + 5 menit` saat payment create

### C.10 Multi-Region Payment Orchestration

**Tidak ada**: active-active multi-region deployment + cross-region failover.

**Kenapa**: out-of-scope demo. Multi-region adalah infra concern (database replication, traffic routing, data residency).

**Impact ke production**: untuk global payment platform, multi-region wajib (regulatory + latency). Untuk local payment processor, single-region cukup.

---

## 🔗 Cross-Reference

- **Demo scenarios**: [DEMO_SCENARIOS.md](./DEMO_SCENARIOS.md) — bukti 5 demo yang membuktikan resilience pattern
- **E2E results**: [e2e-results.md](./e2e-results.md) — sandbox (SQLite) + lokal (PostgreSQL) test results
- **Gateway mock modes**: [GATEWAY_MOCK_MODES.md](./GATEWAY_MOCK_MODES.md) — detail 8 failure modes
- **Database schema**: [DATABASE_ERD.md](./DATABASE_ERD.md) — `payments` + `payment_attempts` table + 6 Note sections
- **Technical debt**: [TECHNICAL_DEBT.md](./TECHNICAL_DEBT.md) — 8 issue yang lebih kecil tapi bisa di-refactor
- **Vue dashboard spec**: [TASK-13a-vue-improvements.md](./tasks/TASK-13a-vue-improvements.md) — DemoScenarioRunner Opsi C
- **OTel SDK toggle**: [TASK-11b-otel-sdk.md](./tasks/TASK-11b-otel-sdk.md) — IS_OTEL=true vs false detail
- **Dual environment**: [TASK-14b-dual-environment.md](./tasks/TASK-14b-dual-environment.md) — PostgreSQL vs SQLite adaptation
- **Plan asli**: [PLAN1 section 19 + 20](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)

---

## 📝 Update History

| Tanggal | Perubahan | Alasan |
|---|---|---|
| 2026-09-23 | Initial creation | TASK-15 step 3 — production caveats untuk stakeholder handover |
