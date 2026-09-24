# TASK-15 - Documentation, Demo Guide & Production Caveats

> **Task ID**: 12
> **Depends on**: 11 (TASK-14 E2E Scenarios - `docs/e2e-results.md` sebagai sumber cross-link)
> **Estimated effort**: S (~2-3 jam - 4 file dokumentasi + cross-link update, tanpa kode implementasi)
> **Plan reference**: Section 17 (Frontend Dashboard Strategy + Demonstration Scenarios A–E di section 18 lama) + Section 19 (Hal yang Sengaja Tidak Diimplementasikan) + Section 20 (Production Caveats) + Section 22 (Definition of Done)

---

## Goal

Menyusun **dokumentasi final** project sebagai **single source of truth** untuk handover ke stakeholder / next engineer / future-self. Dokumentasi ini menutup cycle plan rev 2 (PostgreSQL + dual frontend) dan mengonsolidasikan:

1. **Root `README.md`** project - overview, quick start, struktur, link table.
2. **`docs/DEMO_SCENARIOS.md`** - narasi 5 scenario demo A–E dengan **business impact** (bukan hanya curl), resep run via Vue dashboard atau curl, expected outcome, dan link ke baris `e2e-results.md`. **Hero scenario D** (idempotency anti double-charge) mendapat emphasis khusus.
3. **`docs/PRODUCTION_CAVEATS.md`** - semua caveat dari plan section 20.1-20.4 + adaptation notes sandbox vs production (PostgreSQL vs MySQL rev 2, in-memory idempotency store, no distributed lock, no OTel SDK export, no auth/rate-limit, no Docker di sandbox, dsb).
4. **`docs/ADAPTATION_NOTES.md`** - tabel perbandingan plan asli vs implementasi: yang dipertahankan utuh vs yang diadaptasi (MySQL -> PostgreSQL, single UI -> dual frontend, scheduler as separate mini-service -> in-process `@nestjs/schedule`, port assignments, Node v20 -> v24, dsb).
5. **Cross-link** dari `docs/tasks/README.md` ke `e2e-results.md`, `DEMO_SCENARIOS.md`, `PRODUCTION_CAVEATS.md`, `ADAPTATION_NOTES.md`.
6. **Definition of Done checklist** (plan section 22) di-recap di akhir file task ini sebagai **final verification** sebelum project dideklarasikan selesai.

> Setelah TASK-15 selesai, **seluruh plan rev 2 complete**. DoD checklist di `docs/tasks/README.md` section 5 menjadi final verification gate.

---

## Scope

**In scope**:

- `/home/z/my-project/retry-failure/README.md` - main project README (root monorepo).
- `/home/z/my-project/retry-failure/docs/DEMO_SCENARIOS.md` - narrative demo guide A–E + business impact.
- `/home/z/my-project/retry-failure/docs/PRODUCTION_CAVEATS.md` - plan section 20 + sandbox adaptation caveats.
- `/home/z/my-project/retry-failure/docs/ADAPTATION_NOTES.md` - comparison table plan vs implementation.
- Modify `/home/z/my-project/retry-failure/docs/tasks/README.md` - add cross-links to the 4 new doc files + `docs/e2e-results.md`.

**Out of scope**:

- **Implementation code changes** - TASK-15 murni dokumentasi. Tidak boleh modify `.ts` / `.vue` / `.json` files kecuali `package.json` scripts bila perlu `docs:check` (opsional, tidak wajib).
- **Grafana dashboard JSON** - TASK-15 hanya menyediakan **sample PromQL queries** dalam bentuk text/code block di `PRODUCTION_CAVEATS.md` (sudah ada draft dari TASK-11). Tidak ada provisioning JSON ke `docker-compose/grafana/provisioning/dashboards/`. Full Grafana dashboard as-code -> future work.
- **OpenTelemetry / Jaeger full setup guide** - TASK-11 menyimplifikasi tracing ke `AsyncLocalStorage` + `payment_attempts.trace_id`. TASK-15 menyebut ini sebagai **future evolution** di `PRODUCTION_CAVEATS.md` (3-5 baris bullet: rekomendasi `@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations-node` + OTLP exporter ke Jaeger). Tidak ada tutorial step-by-step.
- **Performance / SLO documentation** - plan section 19 eksplisit out-of-scope. Tidak ada p95/p99 latency targets, tidak ada throughput SLO. Hanya mention di caveats bahwa production perlu load test (k6/Artillery).
- **Runbook on-call** - bukan bagian plan rev 2. Hanya pointer ke `PRODUCTION_CAVEATS.md` di README.
- **Architecture diagram (Mermaid / PlantUML)** - TASK-15 menyediakan text-based dependency tree (sudah ada di `docs/tasks/README.md` section 2). Visual diagram -> future work.
- **Translation / i18n dokumentasi** - bahasa Indonesia + technical English mix, sesuai konvensi `docs/tasks/TASK-*.md` yang ada. Tidak ada terjemahan formal.
- **Changelog / RELEASE_NOTES** - single-shot project, bukan versioned release. Tidak ada `CHANGELOG.md`. Bila nanti project di-versioning -> future work.

---

## Files to create/modify

### Files to create

- `/home/z/my-project/retry-failure/README.md` - main project README.
- `/home/z/my-project/retry-failure/docs/DEMO_SCENARIOS.md` - narrative demo A–E + business impact.
- `/home/z/my-project/retry-failure/docs/PRODUCTION_CAVEATS.md` - plan section 20 + sandbox adaptation.
- `/home/z/my-project/retry-failure/docs/ADAPTATION_NOTES.md` - comparison table plan vs implementation.

### Files to modify

- `/home/z/my-project/retry-failure/docs/tasks/README.md` - add section **"6. Final Documentation"** dengan link table ke 4 file baru + `docs/e2e-results.md`.

---

## Implementation steps

### Step 1 - Root `README.md` (project overview + quick start)

Buat `/home/z/my-project/retry-failure/README.md` dengan struktur:

```markdown
# Cockatiel Payment Retry - Sandbox Monorepo

> Demo monorepo untuk scenario failure handling payment API menggunakan Cockatiel
> (retry + circuit breaker + timeout), idempotency anti double-charge, durable
> retry scheduler, dan full observability (pino + prom-client + trace_id).
> Adaptasi plan rev 2: PostgreSQL 16 + TypeORM 0.3 + NestJS 11 + dual frontend.

## Quick start

\`\`\`bash
# 1. Enable pnpm via corepack (sekali saja, per shell session)
corepack enable pnpm
corepack prepare pnpm@latest --activate

# 2. Install dependencies
cd /home/z/my-project/retry-failure
pnpm install

# 3. Jalankan PostgreSQL (docker compose, recommended)
docker compose up -d postgres

# 4. Apply database migrations
pnpm db:migrate

# 5. Jalankan semua services (payment-api + gateway-mock + frontend-vue)
pnpm dev
\`\`\`

Bila sandbox tanpa Docker -> gunakan PostgreSQL eksternal / managed, set `DATABASE_URL`
di `.env`, skip step 3.

## Services & ports

| Service                | Port  | Lokasi                                   |
| ---------------------- | ----- | ---------------------------------------- |
| `payment-api` (NestJS) | 3001  | `apps/payment-api/`                      |
| `payment-gateway-mock` | 3002  | `apps/payment-gateway-mock/`             |
| `frontend-vue` (Vite)  | 5173  | `apps/frontend-vue/`                     |
| Next.js sandbox        | 3000  | parent root `/home/z/my-project/`        |
| PostgreSQL             | 5432  | docker-compose atau managed              |
| Jaeger UI              | 16686 | docker-compose (optional, future OTel)   |
| Prometheus             | 9090  | docker-compose                           |
| Grafana                | 3003  | docker-compose (bukan 3000 - conflict)   |

## Project structure

\`\`\`
retry-failure/
├── apps/
│   ├── payment-api/              # NestJS - payment orchestration (port 3001)
│   ├── payment-gateway-mock/     # NestJS - mock gateway 8 failure modes (port 3002)
│   └── frontend-vue/             # Vue 3 + PrimeVue dashboard (port 5173)
├── packages/
│   └── resilience/               # Cockatiel policies (retry+breaker+timeout)
├── docker/                        # docker-compose.yml + Prometheus/Grafana config
├── docs/
│   ├── tasks/                    # TASK-01..15 spec files + README index
│   ├── e2e-results.md            # E2E test results (TASK-14)
│   ├── DEMO_SCENARIOS.md         # Demo A–E guide + business impact
│   ├── PRODUCTION_CAVEATS.md     # Caveats + sandbox adaptation
│   └── ADAPTATION_NOTES.md       # Plan vs implementation comparison
├── package.json                  # root workspace
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md                     # this file
\`\`\`

## Documentation index

- [Demo scenarios A–E + business impact](./docs/DEMO_SCENARIOS.md)
- [Production caveats + sandbox adaptation](./docs/PRODUCTION_CAVEATS.md)
- [Plan vs implementation adaptation notes](./docs/ADAPTATION_NOTES.md)
- [E2E test results](./docs/e2e-results.md)
- [Subtask index & execution order](./docs/tasks/README.md)

## Stack

- **Backend**: NestJS 11 + TypeORM 0.3 + PostgreSQL 16 + `pg` driver
- **Resilience**: Cockatiel 4 (retry + circuit breaker + timeout composition)
- **Scheduler**: `@nestjs/schedule` (in-process, single-instance - see caveats)
- **Logging**: `nestjs-pino`
- **Metrics**: `prom-client` (Prometheus text format at `/metrics`)
- **Tracing**: `AsyncLocalStorage` + `trace_id` column in `payment_attempts`
  (OpenTelemetry SDK -> future evolution, see caveats)
- **Validation**: `class-validator` + `class-transformer` + `@nestjs/swagger`
- **Config**: `@nestjs/config` + Joi schema
- **Frontend**: dual - Next.js sandbox (port 3000, shadcn/ui) + Vue 3 + PrimeVue (port 5173)
- **Test**: Jest + supertest (backend) + Agent Browser (UI demos)
- **Container**: Docker multi-stage + docker-compose (postgres + prometheus + grafana + jaeger)

## Payment Retry Demo

Cukup 5 demo scenarios di `docs/DEMO_SCENARIOS.md` untuk membuktikan failure handling.
Hero scenario: **Demo D - idempotency anti double-charge**.

## License

Internal sandbox - no license file. Plan source: `upload/PLAN1_Cockatiel_Retry_Failure_Scenario.md`.
```

> **Self-contained rule**: Quick start harus 4-5 perintah copy-pasteable. Jangan ada step implisit seperti "edit `.env` dulu" - bila perlu, sediakan `.env.example` reference inline sebagai komentar.

### Step 2 - `docs/DEMO_SCENARIOS.md` (narrative + business impact)

Buat `/home/z/my-project/retry-failure/docs/DEMO_SCENARIOS.md` dengan struktur:

```markdown
# Demo Scenarios - Cockatiel Payment Retry

> 5 demo scenario A–E dari plan section 18 (Demonstration Scenarios).
> Setiap scenario: setup, steps, expected outcome, business impact, link ke E2E results.
> Hero: **Demo D - idempotency anti double-charge**.

## Cara menjalankan demo

**Opsi 1 - via Vue+PrimeVue dashboard** (recommended):

1. Pastikan 3 service berjalan: `payment-api:3001`, `gateway-mock:3002`, `frontend-vue:5173`.
2. Buka `http://localhost:5173`.
3. Scroll ke section **Demo Scenario Runner**.
4. Klik tombol sesuai scenario (A/B/C/D/E).
5. Dashboard akan otomatis: set gateway mode -> POST payment -> poll status -> show Toast + Dialog result.

**Opsi 2 - via curl** (untuk CI / headless demo):

Lihat step "Steps (curl)" di setiap scenario. Semua command self-contained.

## Demo A - retry menyelamatkan transient failure

**Gateway mode**: `fail-first-n=2` (gagal 2x, sukses ke-3).

**Business impact**: Gateway mengalami transient error (network blip, brief overload).
Tanpa retry, payment langsung gagal -> customer melihat "payment failed" padahal sebenarnya
sistem gateway sehat di attempt ke-3. Retry menyelamatkan payment yang seharusnya bisa sukses.

### Steps (curl)

```bash
# 1. Set gateway mode
curl -X PUT http://localhost:3002/admin/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"fail-first-n","n":2}'

# 2. Create payment
PAYMENT_ID=$(curl -sX POST http://localhost:3001/api/payments \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"DEMO-A-001","amount":50000,"currency":"IDR"}' \
  | jq -r '.payment.id')

# 3. Poll sampai terminal (succeeded)
curl -s http://localhost:3001/api/payments/$PAYMENT_ID | jq '.payment.status'
# expected: "succeeded" setelah 2-5 detik

# 4. Verify attempt count
curl -s http://localhost:3001/api/payments/$PAYMENT_ID \
  | jq '{status:.payment.status, attempts:.payment.attemptCount, history:[.attempts[].outcome]}'
# expected: {"status":"succeeded","attempts":3,"history":["retryable_failure","retryable_failure","success"]}
```

### Expected outcome

- `payment.status === 'succeeded'`.
- `payment.attemptCount === 3` (2 retryable_failure + 1 success).
- Semua 3 attempts share `traceId` yang sama (1 execution cycle).

### E2E evidence

Lihat `./e2e-results.md` row **Scenario 1 - Transient failure**.

---

## Demo B - jangan retry permanent error

**Gateway mode**: `client-error` (selalu 400 invalid_card).

**Business impact**: Permanent error (4xx - invalid card, validation failed) tidak boleh di-retry.
Retry hanya membuang resource + tidak akan pernah sukses. Classifier `isPermanent === true`
menskip retry, langsung menandai payment `failed`. Customer langsung tahu kartu bermasalah,
bisa coba kartu lain - UX lebih baik daripada hang menunggu retry.

### Steps (curl)

```bash
curl -X PUT http://localhost:3002/admin/config \
  -H 'Content-Type: application/json' -d '{"mode":"client-error"}'

curl -sX POST http://localhost:3001/api/payments \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"DEMO-B-001","amount":75000,"currency":"IDR"}' \
  | jq '.payment.status'
# expected: "failed" (within 1-2 seconds - no retry)
```

### Expected outcome

- `payment.status === 'failed'`.
- `payment.attemptCount === 1` (no retry).
- `payment.failureReason` mengandung `'invalid_card'`.

### E2E evidence

Lihat `./e2e-results.md` row **Scenario 2 - Permanent failure**.

---

## Demo C - circuit breaker melindungi gateway

**Gateway mode**: `always-timeout` (gateway hang 5s, payment-api timeout 2s).

**Business impact**: Saat gateway overload / downstream dead, terus-menerus memanggil gateway
memperburuk situasi (cascading failure). Circuit breaker OPEN setelah N failure (default 3),
langsung menolak request berikutnya tanpa call network. Payment ditandai `circuit_open`
lalu `scheduled_for_retry` (durable retry). Sistem self-protect + payment tidak hilang.

### Steps (curl)

```bash
# 1. Set gateway mode (timeout 5s - pasti timeout di payment-api side)
curl -X PUT http://localhost:3002/admin/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"always-timeout","timeoutMs":5000}'

# 2. Submit 3 payments - semua akan exhaust retry (3 attempts each) -> scheduled_for_retry
for i in 1 2 3; do
  curl -sX POST http://localhost:3001/api/payments \
    -H 'Content-Type: application/json' \
    -d "{\"orderId\":\"DEMO-C-00$i\",\"amount\":10000,\"currency\":\"IDR\"}" > /dev/null
done

# 3. Verify breaker OPEN
curl -s http://localhost:3001/api/metrics | grep circuit_breaker_state
# expected: circuit_breaker_state{service="payment-gateway"} 1   (1 = OPEN)

# 4. Submit 4th payment - first attempt langsung circuit_open
curl -sX POST http://localhost:3001/api/payments \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"DEMO-C-004","amount":10000,"currency":"IDR"}' \
  | jq '.payment.status'
# expected: "scheduled_for_retry" (after 1 attempt only, outcome: circuit_open)

# 5. Reset breaker
curl -X PUT http://localhost:3002/admin/config \
  -H 'Content-Type: application/json' -d '{"mode":"always-success"}'
sleep 11  # BREAKER_COOLDOWN_MS=10000
# Submit 1 success -> HALF_OPEN -> CLOSED
curl -sX POST http://localhost:3001/api/payments \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"DEMO-C-reset","amount":1000,"currency":"IDR"}' > /dev/null
curl -s http://localhost:3001/api/metrics | grep circuit_breaker_state
# expected: ... 0   (CLOSED)
```

### Expected outcome

- Payment #1-3: `attemptCount === 3`, `status === 'scheduled_for_retry'`.
- Breaker OPEN setelah payment #3 (3 failures in Cockatiel breaker window).
- Payment #4: `attemptCount === 1`, `attempts[0].outcome === 'circuit_open'`.
- After reset + cooldown + 1 success: breaker CLOSED.

### E2E evidence

Lihat `./e2e-results.md` row **Scenario 3 - Circuit breaker**.

---

## Demo D - idempotency mencegah double charge (HERO)

> **HERO SCENARIO** - bila ini FAIL, plan section 22 DoD gagal. Demo D WAJIB lulus.

**Gateway mode**: `succeed-but-drop-response` (charge succeeds di gateway side, response
hilang di tengah jalan - network blip sesaat setelah gateway commit charge).

**Business impact**: Ini adalah **alasan utama** kenapa retry payment API *tidak aman tanpa
idempotency*. Bayangkan:

1. Payment API POST ke gateway.
2. Gateway charge kartu -> **sukses, customer dikenakan biaya $50**.
3. Response gateway -> payment API hilang di network (TCP reset, timeout, dsb).
4. Payment API lihat timeout -> **retry** (cockatiel retry policy kick in).
5. Bila TANPA idempotency: gateway charge lagi -> customer dikenakan $100 untuk order yang sama.
6. DENGAN idempotency: gateway detect `Idempotency-Key` sama -> replay response original ->
   customer dikenakan $50 (single charge), payment API dapat response sukses.

**Kenapa idempotency mandatory untuk retry-safe payment API**:

- HTTP timeout **TIDAK menjamin** server tidak memproses request - server bisa saja
  sudah commit transaction tapi response hilang di jalan.
- Retry tanpa idempotency = double-charge risk. Customer complain -> chargeback ->
  reputational damage + financial loss.
- Idempotency key (UUID per payment) menjadi **deduplication contract** antara client
  dan server: "idempotency key yang sama = request yang sama, jangan proses ulang".
- Standar industri: Stripe (`Idempotency-Key` header), PayPal (`PayPal-Request-Id`),
  Adyen (`idempotency-key`). Pattern yang sama dipakai di demo ini.

### Steps (curl)

```bash
# 1. Set gateway mode
curl -X PUT http://localhost:3002/admin/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"succeed-but-drop-response"}'

# 2. Create payment - first attempt akan "timeout" (response dropped)
#    Cockatiel akan retry. Gateway detect Idempotency-Key sama -> replay.
PAYMENT_ID=$(curl -sX POST http://localhost:3001/api/payments \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"DEMO-D-001","amount":99000,"currency":"IDR"}' \
  | jq -r '.payment.id')

# 3. Poll final state
curl -s http://localhost:3001/api/payments/$PAYMENT_ID \
  | jq '{
    status: .payment.status,
    attempts: .payment.attemptCount,
    actualCharges: .payment.actualCharges,
    callCount: .payment.gatewayCallCount,
    history: [.attempts[] | {n: .attemptNumber, outcome: .outcome, httpStatus: .httpStatus}]
  }'
# expected:
# {
#   "status": "succeeded",
#   "attempts": 2,            // API called gateway 2x (timeout + retry)
#   "actualCharges": 1,       // but only 1 real charge happened
#   "callCount": 2,           // gateway received 2 requests
#   "history": [
#     {"n":1,"outcome":"retryable_failure","httpStatus":null},  // timeout / response dropped
#     {"n":2,"outcome":"success","httpStatus":200}                // replay returned 200
#   ]
# }
```

### Expected outcome

- `payment.status === 'succeeded'`.
- `payment.attemptCount === 2` (first attempt: timeout/response-dropped -> retryable_failure;
  second attempt: gateway replay -> success).
- **`payment.actualCharges === 1`** (hanya 1 charge ke kartu customer).
- `payment.gatewayCallCount === 2` (gateway menerima 2 request dengan Idempotency-Key sama).
- `attempts[0].outcome === 'retryable_failure'`.
- `attempts[1].outcome === 'success'` && `attempts[1].httpStatus === 200`.

### Verifikasi gateway mock idempotency store

```bash
# Gateway mock menyimpan idempotency cache (in-memory)
curl -s http://localhost:3002/admin/stats | jq '.idempotencyStore
  | to_entries
  | map(select(.value.orderId == "DEMO-D-001"))
  | {hits: length, firstResponse: .[0].value.originalResponse}'
# expected: 1 entry with originalResponse httpStatus=200
```

### E2E evidence

Lihat `./e2e-results.md` row **Scenario 4 - Idempotency (hero)**.

---

## Demo E - server menentukan waktu retry

**Gateway mode**: `rate-limited` (429 + header `Retry-After: 10`).

**Business impact**: Server gateway tahu kondisinya sendiri lebih baik daripada client.
Via header `Retry-After`, server dapat menyuruh client menunggu N detik sebelum retry
(bukan exponential backoff generic). Cocok untuk rate-limit, maintenance window,
atau backpressure signaling. Client yang menghormati `Retry-After` = good API citizen.

### Steps (curl)

```bash
# 1. Set gateway mode
curl -X PUT http://localhost:3002/admin/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"rate-limited","retryAfterSeconds":10}'

# 2. Create payment - first attempt 429 + Retry-After:10
START=$(date +%s)
PAYMENT_ID=$(curl -sX POST http://localhost:3001/api/payments \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"DEMO-E-001","amount":25000,"currency":"IDR"}' \
  | jq -r '.payment.id')

# 3. Poll - payment akan jadi scheduled_for_retry (Cockatiel backoff override = Retry-After value)
curl -s http://localhost:3001/api/payments/$PAYMENT_ID | jq '.payment.status'
# expected: "scheduled_for_retry" (after first attempt fails with 429 + Retry-After)

# 4. Wait 11 seconds, scheduler pick up, second attempt succeed
sleep 11
curl -s http://localhost:3001/api/payments/$PAYMENT_ID | jq '.payment.status'
# expected: "succeeded"

END=$(date +%s)
echo "Total time: $((END - START))s"  # expected ~11-12s (1 + Retry-After + scheduler interval)
```

### Expected outcome

- First attempt: 429 + `Retry-After: 10`.
- Cockatiel backoff untuk attempt ke-2 di-override menjadi 10s (bukan exponential default).
- Payment `scheduled_for_retry` dengan `nextAttemptAt = now + 10s`.
- Scheduler pick up setelah 10s, second attempt success.

### E2E evidence

Lihat `./e2e-results.md` row **Scenario 5 - Retry-After respected** + **Scenario 6 - Durable scheduler**.

---

## Demo recap

| Demo | Scenario              | Outcome                          | Why it matters                            |
| ---- | --------------------- | -------------------------------- | ----------------------------------------- |
| A    | Transient failure     | `succeeded` after 3 attempts    | Retry menyelamatkan payment yang viable   |
| B    | Permanent 4xx         | `failed` (no retry)             | Tidak buang resource untuk error permanen |
| C    | Circuit breaker       | `scheduled_for_retry`           | Self-protect saat downstream down         |
| D    | Idempotency (HERO)    | `actualCharges=1, calls=2`      | Anti double-charge - wajib untuk payment  |
| E    | Retry-After respected | `scheduled_for_retry` then succ | Hormati sinyal server (rate limit, dll)   |

Setiap demo punya baris terkait di `./e2e-results.md` dengan evidence lengkap.
```

> **Hero scenario emphasis**: Demo D mendapat 3x emphasis - (a) narrative "kenapa idempotency mandatory",
> (b) verifikasi gateway mock idempotency store, (c) recap table mengulang "HERO" label.

### Step 3 - `docs/PRODUCTION_CAVEATS.md` (plan section 20 + sandbox adaptation)

Buat `/home/z/my-project/retry-failure/docs/PRODUCTION_CAVEATS.md`:

```markdown
# Production Caveats & Sandbox Adaptation

> Plan section 20 (Production Caveats yang Harus Didokumentasikan) + sandbox adaptation
> notes yang menjelaskan apa yang dikurangi dari plan asli untuk demo sandbox.

## A. Caveats dari plan (section 20)

### 20.1 - Circuit breaker in-memory per-instance

Circuit breaker Cockatiel pada instance aplikasi bersifat **in-memory** kecuali
mekanisme persistence/hydration digunakan. Pada multi-instance deployment:

\`\`\`text
API instance A -> breaker state A
API instance B -> breaker state B
\`\`\`

Ini berbeda dari global / distributed breaker.

**Production implication**:

- Bila 2+ instance payment-api di-deploy (K8s replica, ECS task, dsb), breaker state
  perlu di-share via Redis / memcached / external store.
- Atau: gunakan service mesh (Istio / Linkerd) yang punya distributed breaker bawaan.
- Atau: deploy single-instance (single pod) untuk payment-api - trade-off: SPOF.
- Demo sandbox: single-instance `payment-api:3001` -> tidak ada issue.

### 20.2 - Scheduler single-instance, no distributed lock

Versi demo memakai `@nestjs/schedule` `@Interval` di dalam process `payment-api`.
Tidak ada distributed lock (`SELECT ... FOR UPDATE SKIP LOCKED`, Redis SETNX, dsb.).

**Production implication**:

- Bila 2+ instance `payment-api` berjalan, semua instance akan poll `payments`
  table setiap `SCHEDULER_INTERVAL_MS`. Multiple instance bisa pick same payment ->
  double processing -> double charge (unless idempotency protects - Demo D covers this
  but still wasteful).
- Solusi production:
  - **PostgreSQL native**: `SELECT ... FOR UPDATE SKIP LOCKED LIMIT N` (PostgreSQL
    9.5+ - sudah didukung sejak lama, jadi tidak ada reason untuk pakai MySQL di plan rev 1).
  - **Redis SETNX lock**: acquire lock per payment id, release after process.
  - **External scheduler**: Quartz, BullMQ, Celery, AWS EventBridge + SQS - scheduler
    as separate service dengan worker pool.
  - **Single-instance scheduler**: K8s CronJob dengan `concurrencyPolicy: Forbid`.
- Demo sandbox: single-instance -> tidak ada issue. Catat bahwa `MAX_TOTAL_RETRIES`
  guard di service tetap melindungi dari double-process seandainya scheduler dobel jalan.

### 20.3 - Payment retry only safe because gateway contract uses idempotency key

Retry hanya aman karena gateway contract menggunakan **Idempotency-Key** header.

**Tidak boleh menganggap semua POST aman di-retry.**

**Production implication**:

- Selalu verify gateway downstream support idempotency. Bila tidak:
  - Buat payment record di DB **sebelum** call gateway (sudah dilakukan di demo ini).
  - Generate idempotency key dari `payment.id` + `attemptNumber` (sudah dilakukan).
  - Kirim `Idempotency-Key` header ke gateway (sudah dilakukan di TASK-06).
  - Bila gateway tidak support idempotency: jangan retry! Fail-fast atau queue.
- Pattern ini berlaku untuk semua "side-effect" POST/PUT: payment, email, sms, webhook.
- Demo D (hero) membuktikan idempotency menyelamatkan dari double-charge.

### 20.4 - Observability: DB is source of truth, metrics/logs are signals

Metrics dan logs adalah **diagnostic signals**; database payment state tetap
menjadi **source of truth**.

**Production implication**:

- Bila Prometheus down / metric scrape miss: payment state masih konsisten di PostgreSQL.
  Reconcile dari `payments` + `payment_attempts` table.
- Bila pino log shipper (Loki / ELK) lag: trace via `trace_id` column di `payment_attempts`
  tetap bisa di-query via SQL - tidak hilang.
- Bila Jaeger down / sampling miss: `payment_attempts.trace_id` tetap ada, bisa di-join
  via SQL antara payment -> attempt -> trace.
- **Penting**: jangan pernah rely 100% pada metrics untuk reconcile financial state.
  Always have SQL-based reconciliation job (e.g. daily cron: sum charges by day, compare
  dengan payment processor report).

---

## B. Sandbox adaptation caveats (tidak ada di plan asli, muncul karena env constraint)

Berikut adaptasi yang dilakukan untuk sandbox demo, dengan rekomendasi production:

### B.1 - PostgreSQL vs MySQL adaptation (rev 2 change)

- **Plan asli (rev 1)**: MySQL 8 dengan `char(36)` PK, `datetime(3)` ms precision, `decimal`.
- **Plan rev 2 + sandbox**: PostgreSQL 16 dengan native `uuid`, `timestamp(3)`,
  `numeric`, native ENUM types.
- **Keunggulan PostgreSQL untuk scenario ini**:
  - `uuid` native type - 16 bytes storage + b-tree index friendly (vs `char(36)` 36 bytes).
  - `timestamp(3)` ms precision - same as MySQL `datetime(3)`, no diff.
  - `numeric` arbitrary precision - same as MySQL `decimal`.
  - **`SELECT ... FOR UPDATE SKIP LOCKED`** native - simplifikasi scheduler distributed
    lock bila dibutuhkan production (MySQL tidak punya, perlu `SELECT ... FOR UPDATE SKIP LOCKED`
    yang baru ada di MySQL 8.0.1+; PostgreSQL sejak 9.5).
  - ENUM types native - lebih ketat daripada VARCHAR + CHECK constraint MySQL.
- **Production**: gunakan PostgreSQL managed (RDS / Cloud SQL / Aurora) untuk simplicity.

### B.2 - In-memory idempotency store di gateway mock

- **Demo**: gateway mock menyimpan idempotency cache in-process Map (JS Map).
- **Production**: butuh persistent store (Redis / PostgreSQL) untuk:
  - Survive restart - bila gateway mock restart, idempotency cache tidak hilang.
  - Multi-instance - bila 2+ gateway replica, semua perlu share idempotency cache.
- **Recommended**: Redis dengan TTL = max payment retry window (default 24 jam).
- **Alternative**: PostgreSQL table `idempotency_cache(idempotency_key, payment_id,
  response_body, created_at, expires_at)` dengan index pada `idempotency_key`.

### B.3 - No distributed lock scheduler

- **Demo**: `@nestjs/schedule` in-process, single-instance `payment-api:3001`.
- **Production**: butuh distributed lock atau external scheduler - lihat caveat 20.2 di atas.

### B.4 - No OTel SDK export to Jaeger di sandbox

- **Demo**: tracing via `AsyncLocalStorage` + `trace_id` column di `payment_attempts`.
  Tidak ada OTel SDK, tidak ada OTLP exporter, tidak ada Jaeger UI integration.
- **Production**: plug:
  - `@opentelemetry/sdk-node` - auto-init OTel.
  - `@opentelemetry/auto-instrumentations-node` - auto-instrument HTTP, PostgreSQL, dns, dsb.
  - `@opentelemetry/exporter-trace-otlp-http` - OTLP HTTP exporter ke Jaeger / Tempo / Honeycomb.
  - Konfigurasi env:
    \`\`\`
    OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318
    OTEL_SERVICE_NAME=payment-api
    OTEL_RESOURCE_ATTRIBUTES=service.version=1.0.0,deployment.environment=prod
    \`\`\`
- **Future evolution** - see TASK-11 `docs` mention.

### B.5 - No auth on /api endpoints

- **Demo**: semua endpoint `payment-api` (`/api/payments`, `/api/health`, `/api/metrics`,
  `/api/payments/:id/retry`) terbuka - no auth, no rate limit.
- **Production**: butuh:
  - **NextAuth / Clerk / Auth0** untuk user auth (admin vs customer).
  - **Middleware NestJS** untuk verify JWT / session sebelum controller.
  - **Role-based access**: customer hanya bisa lihat payment miliknya; admin bisa retry.
  - **API key** untuk service-to-service (gateway mock -> payment-api).

### B.6 - No rate limiting on /api/payments

- **Demo**: `POST /api/payments` tidak di-rate-limit. Demo scenario bisa POST 1000x
  tanpa throttle.
- **Production**: butuh:
  - `@nestjs/throttler` - IP-based rate limit (e.g. 10 req/min/IP).
  - Per-user rate limit via Redis (e.g. 100 payment/hour/user).
  - Anti-abuse: detect burst pattern, captcha after 5 failures / IP / hour.
- **Why critical**: payment API tanpa rate limit = vector untuk fraud + resource exhaustion.

### B.7 - Sandbox without Docker

- **Demo sandbox**: tidak ada `docker` binary tersedia. PostgreSQL butuh external instance
  atau di-skip (mock repository).
- **Production**: `docker compose up --build` untuk full stack (postgres + payment-api +
  gateway-mock + prometheus + grafana + jaeger) di satu command. File `docker-compose.yml`
  sudah disediakan di `docker/` folder.
- **Sandbox dev mode tanpa Docker**:
  - PostgreSQL: connect ke managed instance / external (set `DATABASE_URL` di `.env`).
  - Atau: fallback ke SQLite (TypeORM synchronize=false, dev-only) - **tidak recommended**
    untuk demo karena beberapa query PostgreSQL-specific (`FOR UPDATE SKIP LOCKED`,
    native ENUM) tidak akan jalan di SQLite.

### B.8 - Node version

- **Plan rev 1**: Node v20.19.0 (LTS Iron).
- **Sandbox**: Node v24 (lebih baru).
- **Acceptable**: pin `engines.node >= 20` di root `package.json`. Tidak ada API breaking
  change yang dipakai project ini antara v20 dan v24.

### B.9 - Grafana port 3003 (bukan 3000)

- **Default Grafana**: port 3000 - konflik dengan Next.js sandbox di parent root.
- **Adaptation**: docker-compose override `GF_SERVER_HTTP_PORT=3003`. Akses Grafana di
  `http://localhost:3003`.
- **Production**: tidak ada konflik bila Next.js sandbox tidak dipakai - bisa kembalikan ke 3000.

### B.10 - No GraphQL / gRPC

- **Plan rev 2 + sandbox**: REST only (JSON over HTTP).
- **Production**: GraphQL / gRPC bisa ditambah bila perlu - out of scope plan.

### B.11 - Sample Prometheus queries (untuk Grafana dashboard)

> TASK-15 tidak provisioning Grafana JSON dashboard (out of scope). Berikut sample PromQL
> yang bisa di-copy ke Grafana Explore / dashboard panel manual:

\`\`\`promql
# Payment success rate (last 5m)
sum(rate(payments_current_status{status="succeeded"}[5m]))
  / sum(rate(payments_current_status[5m]))

# Retry attempts by outcome
sum by (outcome) (rate(retry_attempts_total[5m]))

# Circuit breaker state (1 = OPEN, 0.5 = HALF_OPEN, 0 = CLOSED)
circuit_breaker_state{service="payment-gateway"}

# Gateway request duration p95
histogram_quantile(0.95, sum by (le) (rate(gateway_request_duration_ms_bucket[5m])))

# Payment failure rate (non-retryable)
sum(rate(payments_current_status{status="failed"}[5m]))
  / sum(rate(payments_current_status[5m]))

# Average attempt count per succeeded payment
sum(payments_attempt_count_total{status="succeeded"})
  / sum(payments_current_status{status="succeeded"})
\`\`\`

> Bila ingin provisioning JSON dashboard -> future work (lihat TASK-15 out-of-scope note).

---

## C. Hal yang sengaja tidak diimplementasikan (plan section 19)

Plan section 19 eksplisit menyebut out-of-scope, direkap ulang untuk konsistensi:

- Custom retry loop (pakai Cockatiel).
- Custom circuit breaker state machine (pakai Cockatiel).
- Custom backoff algorithm (pakai Cockatiel exponential + jitter).
- Bulkhead / concurrency cap produksi penuh.
- **Distributed lock scheduler** - caveat 20.2.
- Kafka / RabbitMQ queue.
- Redis queue (Redis dipakai hanya bila ditambah untuk idempotency store - caveat B.2).
- **Distributed circuit breaker** - caveat 20.1.
- Total deadline / retry budget yang kompleks.
- Multi-region payment orchestration.

Future evolution - bukan bagian mandatory demo.
```

### Step 4 - `docs/ADAPTATION_NOTES.md` (comparison table)

Buat `/home/z/my-project/retry-failure/docs/ADAPTATION_NOTES.md`:

```markdown
# Adaptation Notes - Plan vs Implementation

> Perbandingan plan asli (`upload/PLAN1_Cockatiel_Retry_Failure_Scenario.md` rev 2)
> vs implementasi sandbox. Dibagi jadi: yang dipertahankan utuh, dan yang diadaptasi.

## Yang dipertahankan utuh (tidak ada perubahan)

Berikut aspek yang 100% sesuai plan - jangan di-rewrite ulang di future refactoring
tanpa reason yang sangat jelas:

1. **Cockatiel engine** - pakai Cockatiel 4 (`packages/resilience`) untuk compose
   retry + circuit breaker + timeout. Tidak ada custom retry loop.
2. **Error classification** - pure functions di `apps/payment-api/src/payments/errors/`:
   `classifyError`, `parseRetryAfter`, `isPermanent`, `isRetryable`. Tidak ada side-effect.
3. **Idempotency contract** - `Idempotency-Key` header generated di payment-api side
   (UUID + attempt counter), dikirim ke gateway mock. Gateway mock store replay response.
4. **Durable retry loop** - payment state machine `processing -> scheduled_for_retry -> processing`
   tetap jalan walaupun instance restart. Source of truth = PostgreSQL `payments` table.
5. **Audit trail** - `payment_attempts` table dengan 1 row per attempt, including
   `outcome`, `httpStatus`, `durationMs`, `breakerState`, `traceId`. Plan section 11.2
   terpenuhi.
6. **Metrics** - 7 metrics sesuai plan section 13.1 (payment status gauge, attempt
   counter, breaker state gauge, gateway duration histogram, retry counter, scheduler
   processed counter, in-flight gauge).
7. **Payment lifecycle states** - `pending`, `processing`, `succeeded`, `failed`,
   `scheduled_for_retry`, `circuit_open`. Sama dengan plan section 11.1.

## Yang diadaptasi

| #  | Aspek                     | Plan asli (rev 1 / rev 2)                           | Implementasi sandbox                                                | Alasan adaptasi                                                                                          |
| -- | ------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1  | Database                  | MySQL 8 (rev 1) -> PostgreSQL 16 (rev 2)            | PostgreSQL 16                                                        | Rev 2 sudah arahkan ke PostgreSQL. Sandbox ikut. Native `uuid`, `FOR UPDATE SKIP LOCKED`.                |
| 2  | ORM driver                 | `mysql2` (rev 1) -> `pg` (rev 2)                     | `pg` (node-postgres)                                                 | Konsekuensi dari #1. TypeORM 0.3 support native.                                                         |
| 3  | Persistence column types   | `char(36)` PK, `datetime(3)`, `decimal`             | `uuid`, `timestamp(3)`, `numeric` (PostgreSQL-native)                | Lebih efisien storage (16 vs 36 bytes untuk uuid). `numeric` arbitrary precision.                        |
| 4  | Frontend strategy          | Single Vue dashboard (rev 1) -> dual (rev 2)        | Dual: Next.js sandbox (port 3000) + Vue+PrimeVue (port 5173)         | Sandbox cloud Next.js di port 3000 untuk preview; Vue+PrimeVue untuk demo resmi. Plan rev 2 arahkan ini. |
| 5  | Scheduler deployment       | Mini-service terpisah (rev 1)                       | `@nestjs/schedule` in-process di `payment-api` (rev 2 + sandbox)    | Simplifikasi monorepo. Caveat: single-instance only - see PRODUCTION_CAVEATS.md 20.2.                    |
| 6  | Scheduler port            | 3003 (rev 1)                                        | N/A (in-process di `payment-api:3001`)                               | Konsekuensi dari #5. Tidak ada service terpisah.                                                          |
| 7  | `payment-api` port         | 3000 (rev 1)                                        | 3001                                                                 | Port 3000 dipakai Next.js sandbox di parent root. Avoid conflict.                                         |
| 8  | `gateway-mock` port        | 3001 (rev 1)                                        | 3002                                                                 | Shift karena `payment-api` pindah ke 3001.                                                                |
| 9  | `frontend-vue` port        | 5173 (rev 2)                                        | 5173 (Vite dev default)                                              | Sesuai plan rev 2. Tidak ada konflik.                                                                     |
| 10 | Grafana port               | 3000 (default)                                      | 3003                                                                 | Konflik dengan Next.js sandbox di port 3000.                                                              |
| 11 | Jaeger UI port             | 16686 (default)                                     | 16686                                                                | Tidak ada konflik di sandbox.                                                                             |
| 12 | OTel tracing                | Full OTel SDK + OTLP export ke Jaeger (plan rev 2)  | Simplified: `AsyncLocalStorage` + `trace_id` column di `payment_attempts` | Sandbox tidak punya Jaeger receiver aktif; full OTel -> future evolution. See PRODUCTION_CAVEATS.md B.4.   |
| 13 | Docker compose availability | Wajib (plan section 16)                            | Tersedia di `docker/docker-compose.yml` tapi sandbox env tanpa Docker binary | Production pakai `docker compose up --build`. Sandbox dev: PostgreSQL eksternal / managed.              |
| 14 | Node version               | v20.19.0 (plan rev 1)                               | v24 (sandbox)                                                        | Lebih baru, acceptable. `engines.node >= 20` di root `package.json`.                                      |
| 15 | Idempotency store gateway   | Tersirat persistent (plan section 9)                | In-memory Map (gateway mock)                                        | Demo only. Production: Redis atau DB table. See PRODUCTION_CAVEATS.md B.2.                               |
| 16 | Scheduler distributed lock  | Tersirat distributed (plan section 12 + 20.2)       | Tidak ada (single-instance in-process)                              | Demo only. Production: `FOR UPDATE SKIP LOCKED` atau external scheduler. See 20.2.                       |
| 17 | Auth on /api                | Tidak eksplisit di plan                             | Tidak ada (open API)                                                | Demo only. Production: NextAuth + middleware + rate limit. See B.5, B.6.                                  |
| 18 | Rate limiting /api/payments | Tidak eksplisit di plan                             | Tidak ada                                                            | Demo only. Production: `@nestjs/throttler` + Redis. See B.6.                                              |
| 19 | Grafana dashboard JSON      | Plan section 16 mention                             | Sample PromQL text only (PRODUCTION_CAVEATS.md B.11)                | Out of scope TASK-15. Provisioning JSON -> future work.                                                   |
| 20 | Logging                     | `nestjs-pino` (plan rev 2)                          | `nestjs-pino`                                                       | Sesuai plan. Tidak ada adaptasi.                                                                          |
| 21 | Config validation           | `@nestjs/config` + Joi (plan rev 2)                 | `@nestjs/config` + Joi                                              | Sesuai plan. Tidak ada adaptasi.                                                                          |
| 22 | Test framework              | Jest + supertest (plan rev 2)                       | Jest + supertest + Agent Browser (UI)                               | Plan mention Jest + supertest only; Agent Browser ditambah untuk UI demo verification.                    |

## Ringkasan adaptasi kunci

1. **Database**: MySQL -> PostgreSQL (rev 2 sudah arahkan, ikuti).
2. **Frontend**: single -> dual (Next.js sandbox + Vue+PrimeVue).
3. **Scheduler**: mini-service terpisah -> in-process `@nestjs/schedule`.
4. **Ports**: shifted (3001/3002/5173/3003) untuk avoid conflict dengan Next.js sandbox di 3000.
5. **Tracing**: full OTel SDK -> simplified `AsyncLocalStorage` + DB column.
6. **Docker**: wajib di plan, optional di sandbox (PostgreSQL eksternal).
7. **Auth + rate limit + distributed lock**: tidak ada di demo, production must-have.

Sisanya 100% sesuai plan rev 2. Adaptasi di atas **tidak mengorbankan** scenario A–E
demo atau DoD plan section 22. Hanya mengurangi production-readiness (yang memang
explicit out-of-scope per section 19 + 20).
```

### Step 5 - Cross-link dari `docs/tasks/README.md`

Modify `/home/z/my-project/retry-failure/docs/tasks/README.md` - add new section
**"6. Final Documentation"** setelah section 5 (Definition of Done):

```markdown
---

## 6. Final Documentation

Setelah TASK-15 selesai, dokumentasi final tersedia di:

- [Project root README](../../../README.md) - quick start + service ports + structure.
- [Demo scenarios A–E + business impact](../DEMO_SCENARIOS.md) - narrative demo guide,
  hero scenario D (idempotency anti double-charge).
- [Production caveats + sandbox adaptation](../PRODUCTION_CAVEATS.md) - plan section 20
  + 11 sandbox adaptation bullets + sample PromQL queries.
- [Adaptation notes: plan vs implementation](../ADAPTATION_NOTES.md) - 22-row comparison
  table, 7 yang dipertahankan utuh, 22 yang diadaptasi.
- [E2E test results](../e2e-results.md) - tabel PASS/FAIL untuk 7 backend scenarios + 5 UI
  demos dengan evidence (test output, DB snapshot, metric snapshot, screenshot).

> Bila salah satu cross-link di atas dead (file belum dibuat), TASK-15 belum complete.
```

### Step 6 - Verify all files exist + cross-link valid

Setelah semua file dibuat:

```bash
ls /home/z/my-project/retry-failure/README.md \
   /home/z/my-project/retry-failure/docs/DEMO_SCENARIOS.md \
   /home/z/my-project/retry-failure/docs/PRODUCTION_CAVEATS.md \
   /home/z/my-project/retry-failure/docs/ADAPTATION_NOTES.md
```

Verifikasi semua relative link valid (gunakan `grep` untuk relative path markdown link):

```bash
cd /home/z/my-project/retry-failure
rg '\]\(\.\./?[^)]+\)' --no-filename README.md docs/*.md docs/tasks/README.md \
  | sort -u
```

Pastikan tidak ada link ke path yang tidak ada.

---

## Acceptance criteria

- [ ] `/home/z/my-project/retry-failure/README.md` ada dan memuat:
  - [ ] Section "Quick start" dengan 4-5 perintah copy-pasteable (`corepack enable pnpm` -> `pnpm install` -> `docker compose up -d postgres` -> `pnpm db:migrate` -> `pnpm dev`).
  - [ ] Section "Payment Retry Demo" dengan pointer ke `docs/DEMO_SCENARIOS.md`.
  - [ ] Tabel "Services & ports" dengan 8 service: payment-api 3001, gateway-mock 3002, frontend-vue 5173, Next.js sandbox 3000, postgres 5432, jaeger 16686, prometheus 9090, grafana 3003.
  - [ ] Section "Project structure" dengan tree diagram.
  - [ ] Link table ke 5 doc file: DEMO_SCENARIOS, PRODUCTION_CAVEATS, ADAPTATION_NOTES, e2e-results, tasks/README.
- [ ] `/home/z/my-project/retry-failure/docs/DEMO_SCENARIOS.md` ada dan memuat:
  - [ ] Cara menjalankan demo (2 opsi: Vue dashboard + curl).
  - [ ] 5 scenario A–E, masing-masing dengan: gateway mode, business impact, steps curl, expected outcome, link ke e2e-results row.
  - [ ] **Hero scenario D** dengan ≥3 paragraph emphasis (kenapa idempotency mandatory + standard industri Stripe/PayPal/Adyen + verifikasi gateway mock idempotency store).
  - [ ] Recap table di akhir dengan 5 row (A–E).
- [ ] `/home/z/my-project/retry-failure/docs/PRODUCTION_CAVEATS.md` ada dan memuat:
  - [ ] Plan section 20.1 (circuit breaker in-memory per-instance).
  - [ ] Plan section 20.2 (scheduler single-instance, no distributed lock).
  - [ ] Plan section 20.3 (retry only safe because idempotency key).
  - [ ] Plan section 20.4 (DB is source of truth, metrics/logs are signals).
  - [ ] ≥11 sandbox adaptation bullets (B.1-B.11): PostgreSQL vs MySQL, in-memory idempotency store, no distributed lock scheduler, no OTel SDK, no auth, no rate limit, sandbox without Docker, Node v24, Grafana port 3003, no GraphQL, sample PromQL queries.
  - [ ] Plan section 19 recap (hal yang sengaja tidak diimplementasikan).
- [ ] `/home/z/my-project/retry-failure/docs/ADAPTATION_NOTES.md` ada dan memuat:
  - [ ] Section "Yang dipertahankan utuh" dengan 7 bullet (Cockatiel engine, error classification, idempotency, durable retry, audit trail, metrics, payment lifecycle).
  - [ ] Comparison table dengan ≥22 row (database, ORM driver, persistence types, frontend, scheduler deployment, port assignments, OTel, Docker, Node version, idempotency store, distributed lock, auth, rate limit, Grafana JSON, logging, config, test framework, dsb.).
  - [ ] Ringkasan 7 adaptasi kunci di akhir.
- [ ] `/home/z/my-project/retry-failure/docs/tasks/README.md` punya section **"6. Final Documentation"** dengan 5 cross-link valid.
- [ ] Semua cross-link relative path (bukan `/home/z/...` absolute), tidak ada dead link.
- [ ] `pnpm lint` clean (tidak ada issue lint yang muncul dari doc changes - bila TASK-15 murni docs, lint tidak terpengaruh, tapi tetap run untuk memastikan).
- [ ] DoD checklist di `docs/tasks/README.md` section 5 di-recap di bawah file TASK-15 ini (lihat section "Final Definition of Done checklist" di akhir file ini).

---

## Useful commands (run after completing this task)

### Pre-flight Check

> **WAJIB BACA**: sebelum menjalankan command di bawah, cek kondisi lingkungan Anda via [`SANDBOX_NOTES.md`](../../SANDBOX_NOTES.md) section 1 (Pre-flight Check).
>
> Ringkasan keyword:
> - `pnpm --version` ada -> KONDISI LOCAL. Tidak ada -> KONDISI SANDBOX -> jalankan `corepack enable pnpm && corepack prepare pnpm@9.12.0 --activate` dulu.
> - `docker --version` ada -> KONDISI LOCAL. Tidak ada -> KONDISI SANDBOX -> butuh external PostgreSQL atau skip DB-dependent commands.
> - `curl -s http://localhost:3000` sibuk -> KONDISI SANDBOX -> payment-api pakai PORT=3001, gateway-mock pakai PORT=3002. Bebas -> KONDISI LOCAL -> payment-api pakai PORT=3000, gateway-mock pakai PORT=3001.

Command di bawah ditulis dengan dua varian bila perlu (LOCAL / SANDBOX). Pilih salah satu sesuai kondisi. Untuk TASK-15 (documentation task), kebanyakan command sama kedua kondisi karena hanya manipulasi file markdown.

---

```bash
# 1. Verify all 4 doc files exist - sama kedua kondisi
ls -la /home/z/my-project/retry-failure/README.md \
       /home/z/my-project/retry-failure/docs/DEMO_SCENARIOS.md \
       /home/z/my-project/retry-failure/docs/PRODUCTION_CAVEATS.md \
       /home/z/my-project/retry-failure/docs/ADAPTATION_NOTES.md

# 2. Verify README content - quick start section (sama kedua kondisi)
rg -n '## Quick start|## Payment Retry Demo|## Services & ports|## Project structure|## Documentation index' \
  /home/z/my-project/retry-failure/README.md

# 3. Verify DEMO_SCENARIOS content (sama kedua kondisi)
rg -n '## Demo [A-E]|## Hero|## Demo recap|## Cara menjalankan' \
  /home/z/my-project/retry-failure/docs/DEMO_SCENARIOS.md

# 4. Verify PRODUCTION_CAVEATS content - all 4 plan caveats + adaptation bullets (sama)
rg -n '### 20\.[1-4]|### B\.[0-9]+|## C\. Hal yang sengaja' \
  /home/z/my-project/retry-failure/docs/PRODUCTION_CAVEATS.md

# 5. Verify ADAPTATION_NOTES comparison table row count (sama kedua kondisi)
rg -n '^\| [0-9]+ ' /home/z/my-project/retry-failure/docs/ADAPTATION_NOTES.md | wc -l
# expected: >= 22

# 6. Quick link check - all relative markdown links resolve (sama kedua kondisi)
cd /home/z/my-project/retry-failure
rg -o '\]\((\.\./[^)]+|README\.md|docs/[^)]+)\)' \
  --no-filename README.md docs/*.md docs/tasks/README.md \
  | sed 's/](//;s/)$//' | sort -u | while read -r p; do
      resolved="$(realpath --relative-to=. "$p" 2>/dev/null || echo "MISSING:$p")"
      echo "$p -> $resolved"
    done

# 7. Verify cross-link section added to docs/tasks/README.md (sama kedua kondisi)
rg -n '## 6\. Final Documentation' /home/z/my-project/retry-failure/docs/tasks/README.md

# 8. Final lint (catch stray TS issues if doc imports code - shouldn't, but run anyway)
# KONDISI LOCAL:
cd /home/z/my-project/retry-failure && pnpm lint

# KONDISI SANDBOX (asalkan pnpm sudah ter-enable via corepack):
cd /home/z/my-project/retry-failure && pnpm lint

# 9. Final typecheck
# KONDISI LOCAL:
cd /home/z/my-project/retry-failure && pnpm typecheck

# KONDISI SANDBOX (asalkan pnpm sudah ter-enable via corepack):
cd /home/z/my-project/retry-failure && pnpm typecheck

# 10. Sanity: open dashboard one last time via Agent Browser
#     - Verify all 5 demo buttons visible (A/B/C/D/E)
#     - Verify sticky footer
#     - Verify mobile responsive (resize to 375px width)
# KONDISI SANDBOX: Agent Browser adalah tool sandbox, bisa langsung dipakai.
#     (manual via skill agent-browser; screenshot tidak wajib di-attach ke TASK-15)
# KONDISI LOCAL: user bisa buka browser manual di http://localhost:5173 (Vue dashboard)
#     atau http://localhost:3000 (Next.js sandbox). Tidak perlu Agent Browser bila sudah
#     punya browser grafis lokal.

# 11. Final dev log check - pastikan services still up & healthy (port kondisional)
API_PORT="${API_PORT:-3000}"  # default 3000 LOCAL; set API_PORT=3001 untuk SANDBOX
GW_PORT="${GW_PORT:-3001}"    # default 3001 LOCAL; set GW_PORT=3002 untuk SANDBOX
curl -sf "http://localhost:${API_PORT}/api/health" | jq .
curl -sf "http://localhost:${GW_PORT}/health" | jq .
curl -sf http://localhost:5173/ > /dev/null && echo "frontend-vue OK"

# 12. Optional cleanup: kill background services bila tidak diperlukan lagi (sama kedua kondisi)
#     pkill -f "pnpm start:dev" ; pkill -f "pnpm dev"
```

---

## Notes

- **No emoji** sesuai project rules (kecuali user explicitly request). Task file ini
  tidak memakai emoji di section header atau bullet.
- **Markdown links** selalu relative path (`./DEMO_SCENARIOS.md`, `../e2e-results.md`),
  bukan absolute path (`/home/z/...`). Ini agar repo portable.
- **Quick start** harus self-contained 4-5 perintah copy-pasteable. Tidak ada step implisit
  seperti "edit `.env` dulu" - bila perlu, sediakan `.env.example` reference sebagai komentar
  di dalam quick start block.
- **Adaptation notes** jujur tentang apa yang dikurangi dari plan: full OTel, distributed
  lock, ms-precision datetime (sekarang di PostgreSQL sama saja, no reduction), auth,
  rate limit, Grafana JSON. Tidak ada yang di-hidden.
- **Hero scenario D** wajib dapat emphasis ekstra: 3 paragraph business impact + reference
  ke standard industri (Stripe / PayPal / Adyen idempotency-key header).
- **Indonesian + technical English mix** sesuai konvensi `docs/tasks/TASK-*.md` yang sudah ada.
- Setelah TASK-15 selesai, **seluruh plan rev 2 complete**. DoD checklist di
  `docs/tasks/README.md` section 5 + recap di bawah ini menjadi **final verification gate**.
- TASK-15 tidak menambah / modify kode TypeScript / Vue / JSON config. Hanya markdown.
  Bila lint / typecheck gagal setelah TASK-15, masalahnya di task sebelumnya (TASK-14 atau
  lebih awal), bukan di TASK-15.

---

## Final Definition of Done checklist

> Recap dari `docs/tasks/README.md` section 5 + plan section 22. Seluruh checklist harus
> terpenuhi sebelum project dideklarasikan selesai.

### Functional (payment lifecycle)

- [ ] Payment API (`POST /api/payments`) dapat membuat payment.
- [ ] Gateway mock dapat mengganti failure mode saat runtime via dashboard.
- [ ] Cockatiel menangani request-level retry (bukti di `payment_attempts`).
- [ ] Exponential backoff + jitter terkonfigurasi (config-driven).
- [ ] Circuit breaker dapat dibuktikan melalui E2E scenario 3.
- [ ] Permanent 4xx tidak di-retry (scenario 2).
- [ ] `Retry-After` dihormati (scenario 5).
- [ ] Exhausted execution cycle -> `scheduled_for_retry`.
- [ ] Scheduler memproses due payment (scenario 6).
- [ ] `MAX_TOTAL_RETRIES` mengakhiri payment sebagai `failed` (scenario 7).
- [ ] **Idempotency menjamin `actualCharges <= 1` walaupun `calls >= 2` (scenario 4 - HERO)**.

### Observability

- [ ] Audit attempt tersimpan di PostgreSQL (`payment_attempts`).
- [ ] Metrics tersedia di `/metrics` (prom-client registry, 7 metrics).
- [ ] Grafana dashboard tersedia (atau sample PromQL queries di PRODUCTION_CAVEATS.md
      bila JSON provisioning di-skip - caveat B.11).
- [ ] Payment trace dapat ditemukan di Jaeger (atau `trace_id` column di `payment_attempts`
      bila full OTel SDK di-skip - caveat B.4).

### Infrastructure

- [ ] Docker full stack berjalan (`docker compose up --build` - postgres + payment-api +
      gateway-mock + prometheus + grafana + jaeger).
- [ ] Dev mode berjalan tanpa Docker (PostgreSQL eksternal + `pnpm dev`).

### Quality

- [ ] Unit + E2E test lulus (Jest + supertest untuk backend, Agent Browser untuk UI demos).
- [ ] Frontend Vue+PrimeVue dapat menjalankan semua scenario A–E (5 demo buttons).
- [ ] Frontend Next.js preview sandbox dapat menampilkan data dari payment-api
      (subset fungsionalitas, port 3000).

### Documentation

- [ ] `README.md` menjelaskan failure scenarios + business impact (pointer ke
      `docs/DEMO_SCENARIOS.md`).
- [ ] `docs/DEMO_SCENARIOS.md` memuat 5 scenario A–E dengan business impact per scenario.
- [ ] `docs/PRODUCTION_CAVEATS.md` memuat plan section 20.1-20.4 + ≥11 sandbox
      adaptation bullets.
- [ ] `docs/ADAPTATION_NOTES.md` memuat comparison table ≥22 row + 7 bullet "dipertahankan
      utuh".
- [ ] `docs/tasks/README.md` punya section "6. Final Documentation" dengan 5 cross-link valid.

---

> Bila seluruh checklist di atas ✅, **plan rev 2 complete**. Project siap untuk handover
> ke stakeholder / production team. Next evolution path: lihat `docs/PRODUCTION_CAVEATS.md`
> section B (sandbox adaptation) untuk production hardening checklist.
