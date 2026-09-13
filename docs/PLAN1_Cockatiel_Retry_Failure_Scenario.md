# Technical Plan — Retry Failure Scenario (Payment Processing) — Cockatiel Edition

> **Status**: Draft for implementation  
> **Created**: 2026-09-10  
> **Baseline**: Evolusi dari plan simulasi retry sebelumnya  
> **Purpose**: Mendemonstrasikan failure handling pada proses payment secara production-like dengan memanfaatkan library resilience **Cockatiel**, sehingga fokus utama tetap pada business flow, failure scenario, idempotency, durable retry, dan observability.

---

## 1. Tujuan

Project ini mensimulasikan proses payment processing ketika dependency eksternal (`payment-gateway-mock`) mengalami berbagai kegagalan.

Versi ini **tidak mengimplementasikan ulang algoritma retry/circuit breaker dari scratch**. Mekanisme resilience request-level menggunakan Cockatiel.

Fokus pembelajaran dan demonstrasi:

1. Retry dengan exponential backoff + jitter dan max attempts.
2. Klasifikasi error retryable vs permanent.
3. Circuit breaker (`CLOSED → OPEN → HALF_OPEN → CLOSED`).
4. Durable/business retry melalui database + scheduler.
5. Idempotency untuk mencegah double-charge.
6. Menghormati `Retry-After` dari gateway.
7. Audit trail per attempt.
8. Structured logging, Prometheus metrics, Grafana, OpenTelemetry + Jaeger.
9. Pemisahan tanggung jawab antara application/business logic dan resilience library.
10. Penggunaan Cockatiel sebagai resilience engine yang production-like.

## 2. Prinsip Arsitektur

Prinsip utama versi ini:

> **Cockatiel menangani mekanisme resilience. Aplikasi menangani semantics bisnis.**

### 2.1 Responsibility boundary

| Concern | Owner |
|---|---|
| Retry execution loop | Cockatiel |
| Exponential backoff | Cockatiel |
| Jitter | Cockatiel |
| Circuit breaker state machine | Cockatiel |
| Request timeout | Cockatiel |
| Error classification untuk payment | Application |
| `Retry-After` semantics | Application adapter/policy |
| Payment lifecycle | Application |
| Durable retry | Application: MySQL + scheduler |
| Idempotency semantics | Application + gateway mock |
| Audit trail | Application |
| Metrics | Application |
| Logging | Application |
| Distributed tracing | Application/infrastructure |
| Failure simulation | `payment-gateway-mock` |

Cockatiel menyediakan retry, backoff, circuit breaker, timeout, policy composition, serta event hooks. Circuit breaker harus direuse pada lifecycle aplikasi agar benar-benar mempertahankan state. [Cockatiel npm](https://www.npmjs.com/package/cockatiel)

### 2.2 Target dependency flow

```text
PaymentController
      |
      v
PaymentsService
      |
      v
PaymentGatewayPort
      |
      v
ResilientPaymentGateway
      |
      +-----------------------------+
      |                             |
      v                             v
Application policy             Cockatiel policies
(error classification,         retry
 Retry-After semantics)        exponential backoff
                               circuit breaker
                               timeout
                                     |
                                     v
                                  Axios/HTTP
                                     |
                                     v
                            payment-gateway-mock
```

Business layer tidak boleh menyebarkan import Cockatiel ke seluruh application.

---

## 3. Stack Teknologi

- **Runtime**: Node.js 20.19.0
- **Language**: TypeScript 5.x, strict mode
- **Framework**: NestJS 11.x
- **Database**: Postgres 16.x
- **ORM**: TypeORM 0.3.x + driver menyesuikan database
- **Monorepo**: pnpm workspaces
- **HTTP client**: axios melalui `@nestjs/axios`
- **Resilience**: Cockatiel 4.x
- **Scheduler**: `@nestjs/schedule`
- **Logging**: `nestjs-pino` / pino
- **Metrics**: `prom-client`
- **Tracing**: OpenTelemetry SDK + auto instrumentation
- **Testing**: Jest + supertest
- **API docs**: Swagger/OpenAPI
- **Validation**: class-validator + class-transformer
- **Config**: `@nestjs/config` + schema validation
- **Container**: Docker multi-stage + docker-compose

> Catatan: versi package sebaiknya dipin di `package.json`/lockfile pada saat implementasi.

---

## 4. Struktur Monorepo

```text
retry-failure/
├── apps/
│   ├── payment-api/
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── payments/
│   │   │   │   ├── gateway/
│   │   │   │   ├── resilience/
│   │   │   │   ├── audit/
│   │   │   │   ├── retry-scheduler/
│   │   │   │   ├── observability/
│   │   │   │   └── health/
│   │   │   ├── config/
│   │   │   ├── database/
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   └── test/
│   └── payment-gateway-mock/
│       └── src/
│           ├── modules/charges/
│           └── modules/admin/
├── packages/
│   └── resilience/
│       ├── src/
│       │   ├── policies/
│       │   ├── adapters/
│       │   ├── errors/
│       │   ├── types/
│       │   └── index.ts
│       └── test/
├── docker/
│   ├── prometheus/prometheus.yml
│   └── grafana/
│       ├── provisioning/
│       └── dashboards/retry.json
├── docs/
│   ├── PLAN1_Cockatiel_Retry_Failure_Scenario.md
│   └── tasks/
├── docker-compose.yml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
└── README.md
```

### 4.1 Perubahan dari versi custom

Versi sebelumnya memiliki `packages/retry-core` sebagai implementation engine.

Versi Cockatiel mengubah responsibility package menjadi adapter/application boundary:

```text
packages/resilience
    |
    +-- Cockatiel configuration
    +-- Payment-specific policy adapters
    +-- domain/application types
    +-- observers/integration
```

Library tidak ditulis ulang.

---

## 5. Resilience Architecture

### 5.1 Request-level resilience

Satu execution cycle payment menggunakan policy Cockatiel:

```text
request
  |
  v
Circuit Breaker
  |
  v
Retry
  |
  v
Timeout
  |
  v
Gateway HTTP call
```

Policy composition menggunakan `wrap(...)` atau equivalent composition Cockatiel.

**Catatan penting:** urutan policy harus ditetapkan dan diuji karena wrapper order memengaruhi semantics.

Target behaviour:

- Timeout membatasi execution gateway.
- Error retryable dapat memicu retry.
- Circuit breaker mencegah request ketika dependency dianggap unhealthy.
- Retry mencoba kembali sampai max attempts.
- Exhaustion dikembalikan ke application layer untuk menentukan durable retry.

Cockatiel menyediakan `retry`, `ExponentialBackoff`, `circuitBreaker`, `ConsecutiveBreaker`, `timeout`, dan `wrap`. [Cockatiel npm](https://www.npmjs.com/package/cockatiel) [Cockatiel GitHub](https://github.com/connor4312/cockatiel)

### 5.2 Circuit breaker lifecycle

Breaker adalah **long-lived singleton/per-dependency instance**, bukan dibuat ulang setiap request.

```text
CLOSED
  |
  | failure threshold reached
  v
OPEN
  |
  | cooldown elapsed
  v
HALF_OPEN
  |   |  success failure
  |      |
  v      v
CLOSED  OPEN
```

Gunakan configurasi awal:

- failure threshold: `BREAKER_FAILURE_THRESHOLD=3`
- cooldown: `BREAKER_COOLDOWN_MS=10000`

Untuk HALF_OPEN, gunakan semantics trial call Cockatiel dan pastikan behaviour concurrent calls didokumentasikan/tested. Cockatiel mendukung `halfOpenSampling` bila diperlukan. [Cockatiel npm](https://www.npmjs.com/package/cockatiel)

### 5.3 Error classification

Application mempunyai classifier/policy khusus payment:

```text
5xx              -> retryable
429              -> retryable
timeout          -> retryable
ECONNREFUSED     -> retryable
ECONNRESET       -> retryable
4xx selain 429   -> permanent
```

Classifier menghasilkan informasi yang digunakan oleh adapter Cockatiel dan audit:

```ts
{
  retryable: boolean;
  reason: string;
  retryAfterMs?: number;
}
```

Tujuan utamanya bukan mengulang engine Cockatiel, melainkan menjaga decision semantics tetap milik aplikasi.

---

## 6. `Retry-After`

Gateway dapat mengembalikan:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 10
```

atau response yang sesuai kontrak simulasi.

Rule:

```text
Retry-After tersedia
    -> gunakan delay server

Retry-After tidak tersedia
    -> gunakan Cockatiel backoff
```

Tidak boleh dijumlahkan secara otomatis:

```text
Retry-After + exponential backoff  ❌
```

Acceptance test harus membuktikan bahwa delay yang digunakan memenuhi nilai server-directed delay.

Untuk kebutuhan dynamic delay, gunakan adapter/backoff mechanism yang sesuai Cockatiel, tanpa mengubah domain semantics.

---

## 7. Business-Level Durable Retry

Cockatiel menangani retry **dalam satu execution cycle**.

Durable retry berada di application layer.

```text
POST /payments
    |
    v
execution cycle
    |
    +--> attempt 1
    +--> attempt 2
    +--> attempt 3
              |
              v
          exhausted
              |
              v
      scheduled_for_retry
              |
              v
           MySQL
              |
              v
       RetryScheduler
              |
              v
      new execution cycle
              |
              v
           Cockatiel
```

Dengan demikian tidak terjadi double retry engine.

### 7.1 Batas retry

```text
RETRY_MAX_ATTEMPTS = 3
```

berlaku untuk **satu execution cycle**.

```text
MAX_TOTAL_RETRIES = 5
```

berlaku untuk **durable retry lintas scheduler cycles**.

Keduanya tidak boleh dicampur.

---

## 8. Payment Gateway Mock

`payment-gateway-mock` tetap dipertahankan sebagai dependency eksternal simulasi.

### 8.1 Endpoint

- `POST /v1/charges`
- `GET /admin/config`
- `PUT /admin/config`
- `GET /admin/stats`
- `GET /metrics`

### 8.2 Failure modes

| Mode | Behaviour | Expected application handling |
|---|---|---|
| `always-success` | always 200 | success |
| `fail-first-n` | 500 N kali, lalu success | retryable → eventual success |
| `server-error` | selalu 500 | retry + circuit breaker |
| `always-timeout` | melebihi timeout client | timeout → retry/circuit |
| `client-error` | 400 `invalid_card` | permanent → no retry |
| `random` | probabilistic failure | retryable |
| `succeed-but-drop-response` | charge tercatat, response hilang | timeout → retry → replay |
| `rate-limited` | 429 + `Retry-After` | respect server delay |

### 8.3 Runtime configuration

Contoh:

```http
PUT /admin/config
Content-Type: application/json

{
  "mode": "fail-first-n",
  "n": 2
}
```

Tidak perlu restart service untuk mengganti failure mode.

---

## 9. Idempotency

Semua charge call menggunakan:

```http
Idempotency-Key: <payment.id>
```

Key stabil sepanjang:

- initial request
- Cockatiel retry attempts
- scheduler retry cycle
- manual retry

### 9.1 Target invariant

Untuk satu payment:

```text
actualCharges <= 1
```

Walaupun:

```text
HTTP calls >= 2
```

pada skenario response loss.

### 9.2 Replay

Jika gateway sudah mencatat charge sukses:

```text
same Idempotency-Key
        |
        v
gateway returns original result
        |
        +-- replayed: true
```

Failure yang belum menghasilkan charge sukses tidak perlu menyimpan successful idempotency result.

---

## 10. Payment API

### 10.1 Endpoint

| Method | Path | Fungsi |
|---|---|---|
| POST | `/payments` | create + process payment |
| GET | `/payments?status=` | list/filter payment |
| GET | `/payments/:id` | detail + attempt history |
| POST | `/payments/:id/retry` | manual retry |
| GET | `/health` | DB health |
| GET | `/metrics` | Prometheus |
| GET | `/docs` | Swagger |

### 10.2 Flow

```text
POST /payments
   |
   +--> validate request
   +--> create payment: processing
   |
   +--> payment execution
           |
           +--> circuit open
           |      |
           |      +--> scheduled_for_retry
           |
           +--> Cockatiel policy
                  |
                  +--> success
                  |      |
                  |      +--> succeeded
                  |
                  +--> permanent failure
                  |      |
                  |      +--> failed
                  |
                  +--> retry exhausted
                         |
                         +--> scheduled_for_retry

RetryScheduler
   |
   +--> find due payment
   +--> execute payment flow again
   +--> increment durable retry count
   |
   +--> if exceeds MAX_TOTAL_RETRIES
           |
           +--> failed
```

---

## 11. Persistence

### 11.1 `payments`

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `order_id` | varchar(64) | unique |
| `amount` | decimal(12,2) | |
| `currency` | char(3) | default IDR |
| `status` | enum | processing/succeeded/failed/scheduled_for_retry |
| `gateway_reference` | varchar(64) | nullable |
| `attempt_count` | int | attempts dalam execution cycle |
| `total_retry_count` | int | durable retry cycles |
| `next_retry_at` | datetime(3) | nullable |
| `failure_reason` | varchar(500) | nullable |
| `created_at` | datetime(3) | |
| `updated_at` | datetime(3) | |

### 11.2 `payment_attempts`

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `payment_id` | char(36) FK | index |
| `attempt_number` | int | |
| `outcome` | enum | success/retryable_failure/permanent_failure/timeout/circuit_open |
| `http_status` | int | nullable |
| `error_code` | varchar | nullable |
| `error_message` | varchar | nullable |
| `delay_before_next_ms` | int | nullable |
| `breaker_state` | varchar(12) | closed/open/half_open |
| `duration_ms` | int | |
| `trace_id` | char(32) | nullable |
| `idempotency_key` | varchar(64) | recommended for audit clarity |
| `gateway_reference` | varchar(64) | nullable |
| `created_at` | datetime(3) | |

Migrations menggunakan TypeORM. `synchronize: false` selalu.

---

## 12. Scheduler

Scheduler adalah **durable retry mechanism**, bukan pengganti Cockatiel.

Konfigurasi:

```text
SCHEDULER_INTERVAL_MS=5000
MAX_TOTAL_RETRIES=5
```

Poller:

```text
SELECT scheduled_for_retry
WHERE next_retry_at <= NOW()
```

Untuk versi single-instance demo, scheduler locking kompleks tidak diwajibkan.

Namun concurrency semantics harus didokumentasikan:

> Scheduler versi ini ditujukan untuk single-instance payment-api.

Future production evolution dapat mempertimbangkan row locking (`FOR UPDATE SKIP LOCKED`), queue, atau distributed scheduler.

---

## 13. Observability

### 13.1 Logging

Gunakan structured JSON logging.

Event minimal:

- payment start/finish
- attempt start/finish
- retry scheduled
- retry delay
- permanent failure
- breaker state change
- scheduler poll
- idempotency replay
- gateway failure mode

Trace ID / span ID harus tersedia pada log melalui OTel context.

### 13.2 Metrics

Metrics minimal:

| Metric | Type | Labels |
|---|---|---|
| `payment_gateway_requests_total` | counter | outcome, http_status |
| `retry_attempts_total` | counter | outcome, payment_status |
| `circuit_breaker_state` | gauge | service |
| `payments_current_status` | gauge | status |
| `payment_gateway_request_duration_seconds` | histogram | none |
| `payment_processing_duration_seconds` | histogram | none |
| `gateway_idempotent_replays_total` | counter | none |

Hindari label high-cardinality seperti `payment_id`, `order_id`, `trace_id`, atau raw error message.

### 13.3 Tracing

OTel:

```text
payment-api
    |
    +--> HTTP request
    +--> payment processing
           |
           +--> gateway attempt #1
           +--> gateway attempt #2
           +--> gateway attempt #3
```

Gateway mock juga diinstrument.

Tujuan:

- satu trace menggambarkan payment journey
- span error memperlihatkan failure
- trace context propagate ke mock
- trace ID dapat dikorelasikan dengan `payment_attempts`

---

## 14. Testing Strategy

### 14.1 Unit test

Fokus unit test versi ini berpindah dari menguji algoritma retry buatan sendiri menjadi menguji:

1. Payment error classification.
2. `Retry-After` extraction/semantics.
3. Resilience policy composition.
4. Circuit breaker configuration/integration boundary.
5. Payment lifecycle transitions.
6. Scheduler due-payment query.
7. Audit event mapping.
8. Idempotency handling.

Tidak perlu menulis unit test yang membuktikan bahwa Cockatiel sendiri menghitung exponential backoff dengan benar.

### 14.2 E2E scenarios

#### Scenario 1 — transient failure

```text
fail-first-n=2
```

Expected:

```text
attempt 1 -> 500
attempt 2 -> 500
attempt 3 -> 200

payment = succeeded
attempt rows = 3
```

#### Scenario 2 — permanent failure

```text
client-error
```

Expected:

```text
1 attempt
payment = failed
no retry
```

#### Scenario 3 — circuit breaker

```text
always-timeout
threshold rendah
```

Expected:

```text
initial failures
   -> breaker OPEN
   -> subsequent call rejected
   -> payment scheduled_for_retry
```

#### Scenario 4 — anti double-charge

```text
succeed-but-drop-response
```

Expected:

```text
calls >= 2
actualCharges = 1
replays >= 1
payment = succeeded
```

#### Scenario 5 — Retry-After

```text
rate-limited
Retry-After = N seconds
```

Expected:

```text
chosen delay >= Retry-After
```

#### Scenario 6 — durable scheduler retry

```text
payment scheduled_for_retry
   -> due
   -> scheduler picks
   -> Cockatiel executes
   -> success
```

#### Scenario 7 — total retry exhaustion

```text
persistent gateway failure
   -> scheduler cycles
   -> MAX_TOTAL_RETRIES exceeded
   -> payment = failed
```

---

## 15. Configuration

```text
PORT=3000
GATEWAY_URL=http://localhost:3001
GATEWAY_TIMEOUT_MS=2000

RETRY_MAX_ATTEMPTS=3
RETRY_BASE_DELAY_MS=500
RETRY_MAX_DELAY_MS=8000
RETRY_JITTER_RATIO=0.1

MAX_TOTAL_RETRIES=5

BREAKER_FAILURE_THRESHOLD=3
BREAKER_COOLDOWN_MS=10000

SCHEDULER_INTERVAL_MS=5000

DB_HOST=localhost
DB_PORT=3306
DB_USER=sso
DB_PASS=...
DB_NAME=retry_failure

OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
LOG_LEVEL=info
```

Nilai retry/circuit breaker di atas adalah application configuration yang diteruskan ke Cockatiel policy builder.

---

## 16. Docker & Dev Workflow

Services:

```text
mysql
payment-api
payment-gateway-mock
prometheus
grafana
jaeger
```

### Full stack

```bash
docker compose up --build
```

### Dev mode

```bash
docker compose up -d mysql prometheus grafana jaeger
pnpm dev
```

Root scripts:

```text
dev
build
test
test:e2e
lint
db:migrate
db:migrate:revert
docker:up
docker:down
```

---

## 17. Demonstration Scenarios

Project sebaiknya mempunyai demo script / documentation yang menjelaskan business impact, bukan hanya API call.

### Demo A — retry menyelamatkan transient failure

```text
Gateway: fail-first-n=2

Payment:
processing
  -> attempt 1 failed
  -> attempt 2 failed
  -> attempt 3 succeeded
  -> succeeded
```

### Demo B — jangan retry permanent error

```text
Gateway: client-error

Payment:
processing
  -> 400 invalid_card
  -> failed
```

### Demo C — circuit breaker melindungi gateway

```text
Gateway: always-timeout

Payment API:
timeout
timeout
timeout
  -> breaker OPEN

New payment:
  -> circuit_open
  -> scheduled_for_retry
```

### Demo D — idempotency mencegah double charge

```text
Gateway:
charge succeeds
response disappears

API:
timeout
retry

Gateway:
replay existing charge

Result:
calls >= 2
actualCharges = 1
```

### Demo E — server menentukan waktu retry

```text
Gateway:
429
Retry-After: 10

API:
wait according to server
```

Demo D adalah **hero scenario** karena memperlihatkan mengapa retry payment membutuhkan idempotency.

---

## 18. SOLID dan Clean Architecture

Pada versi Cockatiel, SOLID tidak ditunjukkan dengan mengimplementasikan ulang retry engine.

Fokus SOLID:

### Single Responsibility

```text
PaymentsService
PaymentGateway
Resilience adapter
AuditService
RetryScheduler
Metrics
```

mempunyai tanggung jawab terpisah.

### Open/Closed

Policy/business classification dapat dikembangkan tanpa mengubah business service.

### Liskov

`PaymentGatewayPort` dapat diganti antara real HTTP client, mock, atau test fake.

### Interface Segregation

Gunakan port kecil:

```text
PaymentGatewayPort
AuditPort
```

bukan service raksasa.

### Dependency Inversion

```text
PaymentsService
      ↓
PaymentGatewayPort
      ↑
HttpPaymentGateway
```

Resilience library berada pada infrastructure/application adapter boundary.

---

## 19. Hal yang Sengaja Tidak Diimplementasikan

Untuk menjaga fokus:

- custom retry loop
- custom circuit breaker state machine
- custom backoff algorithm
- Bulkhead/concurrency cap produksi penuh
- distributed lock scheduler
- Kafka/RabbitMQ
- Redis queue
- distributed circuit breaker
- total deadline/retry budget yang kompleks
- multi-region payment orchestration

Out-of-scope ini dapat menjadi future evolution, bukan bagian mandatory demo.

---

## 20. Production Caveats yang Harus Didokumentasikan

### 20.1 Circuit breaker state

Circuit breaker Cockatiel pada instance aplikasi bersifat in-memory kecuali mekanisme persistence/hydration digunakan.

Pada multi-instance deployment:

```text
API instance A -> breaker state A
API instance B -> breaker state B
```

Ini berbeda dari global/distributed breaker.

### 20.2 Scheduler

Versi demo single-instance tidak memberikan distributed scheduler guarantee.

### 20.3 Payment retry

Retry hanya aman karena gateway contract menggunakan idempotency key.

**Tidak boleh menganggap semua POST aman di-retry.**

### 20.4 Observability

Metrics dan logs adalah diagnostic signals; database payment state tetap menjadi source of truth.

---

## 21. Urutan Implementasi

Task implementation sebaiknya mengikuti dependency berikut:

1. Monorepo + workspace + Node pinning
2. Shared configuration + application bootstrap
3. MySQL + TypeORM + migrations
4. Payment domain + repository
5. Gateway mock + runtime failure modes
6. PaymentGatewayPort + HTTP adapter
7. Cockatiel resilience adapter
8. Error classification + Retry-After handling
9. Payment execution + idempotency
10. Attempt audit
11. Durable retry scheduler
12. Observability: logs + metrics
13. OpenTelemetry + Jaeger
14. E2E scenarios
15. Docker integration
16. Documentation/demo scenarios

Setiap task harus memiliki acceptance criteria dan checkpoint commit.

---

## 22. Definition of Done

Project dianggap selesai ketika seluruh kondisi berikut terpenuhi:

- [ ] Payment API dapat membuat payment.
- [ ] Gateway mock dapat mengganti failure mode saat runtime.
- [ ] Cockatiel menangani request-level retry.
- [ ] Exponential backoff + jitter terkonfigurasi.
- [ ] Circuit breaker dapat dibuktikan melalui E2E.
- [ ] Permanent 4xx tidak di-retry.
- [ ] `Retry-After` dihormati.
- [ ] Exhausted execution dapat menjadi durable scheduled retry.
- [ ] Scheduler memproses due payment.
- [ ] `MAX_TOTAL_RETRIES` mengakhiri payment menjadi failed.
- [ ] Idempotency menjamin actual charge maksimal satu.
- [ ] Audit attempt tersimpan di MySQL.
- [ ] Metrics tersedia.
- [ ] Grafana dashboard tersedia.
- [ ] Trace payment dapat ditemukan di Jaeger.
- [ ] Docker full stack berjalan.
- [ ] Dev mode berjalan.
- [ ] Unit + E2E test lulus.
- [ ] README menjelaskan failure scenarios dan business impact.

---

## 23. Referensi

- Cockatiel npm: https://www.npmjs.com/package/cockatiel
- Cockatiel GitHub: https://github.com/connor4312/cockatiel

Referensi di atas digunakan untuk memastikan API dan capability Cockatiel yang dijadikan asumsi arsitektur pada dokumen ini.
