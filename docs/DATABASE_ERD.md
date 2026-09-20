# Database ERD — Cockatiel Retry-Failure

> **File**: `docs/DATABASE_ERD.dbml` (DBML format — dbdiagram.io native)
> **Source of truth**: `apps/payment-api/src/database/entities/*.entity.ts` + `migrations/*.ts`
> **Plan reference**: [PLAN1 section 11](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)

---

## 📋 Cara Pakai di dbdiagram.io

1. Buka **[dbdiagram.io/d](https://dbdiagram.io/d)**
2. Buka file [`docs/DATABASE_ERD.dbml`](./DATABASE_ERD.dbml) — copy seluruh isi
3. Paste di editor kiri dbdiagram.io (akan replace konten default)
4. Diagram akan ter-render di panel kanan
5. Klik **"Export"** (kanan atas) untuk download:
   - **PNG/SVG/PDF** — untuk dokumentasi
   - **SQL (PostgreSQL)** — untuk verify schema match dengan migrations
   - **PDF** — untuk handover ke stakeholder

---

## 🗃️ Schema Overview

### Tables (2)

| Table | Records | Purpose | PLAN1 Section |
|---|---|---|---|
| `payments` | 1 per payment lifecycle | Payment header + status + retry counters | [11.1](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) |
| `payment_attempts` | 1 per attempt (initial + retries) | Audit trail per attempt with idempotency info | [11.2](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) |

### Enums (3)

| Enum | Values | Used By |
|---|---|---|
| `payment_status_enum` | processing, succeeded, failed, scheduled_for_retry | `payments.status` |
| `attempt_outcome_enum` | success, retryable_failure, permanent_failure, timeout, circuit_open | `payment_attempts.outcome` |
| `breaker_state_enum` | closed, open, half_open | `payment_attempts.breaker_state` *(disimpan sebagai varchar(12), bukan enum)* |

### Relations (1)

```
payments.id (1) ──── (N) payment_attempts.payment_id   [ON DELETE CASCADE]
```

---

## 📊 Table: `payments`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid PK | NO | `gen_random_uuid()` | Native PG uuid PK |
| `order_id` | varchar(64) UNIQUE | NO | - | Business order ID |
| `amount` | numeric(12,2) | NO | - | Preserve precision (JS: string) |
| `currency` | varchar(3) | NO | `'IDR'` | ISO 4217 |
| `status` | payment_status_enum | NO | `'processing'` | Lifecycle status |
| `gateway_reference` | varchar(64) | YES | NULL | Dari gateway mock saat sukses |
| `attempt_count` | int | NO | 0 | Lihat **Note A** di bawah |
| `total_retry_count` | int | NO | 0 | Lihat **Note B** di bawah |
| `next_retry_at` | timestamp(3) | YES | NULL | Lihat **Note C** di bawah |
| `failure_reason` | varchar(500) | YES | NULL | Human-readable reason |
| `created_at` | timestamp(3) | NO | `now()` | - |
| `updated_at` | timestamp(3) | NO | `now()` | Trigger update |

**Indexes**:
- `idx_payments_order_id` (UNIQUE) — untuk lookup by business order ID
- `idx_payments_status` — untuk filter status (e.g., `WHERE status = 'scheduled_for_retry'`)
- `idx_payments_next_retry_at` — untuk scheduler query `WHERE next_retry_at <= NOW()`

### Note A: `payments.attempt_count`

> **Attempts dalam satu execution cycle — bukan cumulatif sepanjang lifetime payment.**

**Execution cycle** = satu sesi pemrosesan payment (initial call atau scheduler pick), yang di dalamnya Cockatiel bisa retry berkali-kali sampai maxAttempts tercapai.

**Flow**:
```text
createPayment()  ← execution cycle #1 dimulai
  ├─ Cockatiel attempt 1 (HTTP call → 500) → attempt_count = 1
  ├─ Cockatiel attempt 2 (HTTP call → 500) → attempt_count = 2
  └─ Cockatiel attempt 3 (HTTP call → 200) → attempt_count = 3
       (status → succeeded)

  ATAU kalau semua gagal:
  └─ Cockatiel attempt 4 (HTTP call → 500) → attempt_count = 4
       (retry exhausted, status → scheduled_for_retry)
```

**Kalau ada 2 execution cycle** (misal: scheduler pick payment yang sudah `scheduled_for_retry`):
```text
scheduler pick payment (next_retry_at tercapai)
  ← execution cycle #2 dimulai
  ├─ attempt_count RESET ke 0 (lihat payments.service.ts:72)
  ├─ Cockatiel attempt 1 → attempt_count = 1
  └─ Cockatiel attempt 2 → attempt_count = 2
       (status → succeeded atau scheduled_for_retry lagi)
```

**Kapan di-increment**:
- `AuditService.recordAttempt()` setelah setiap attempt (line 46: `attempt_count + 1`)
- Di-increment atomically via SQL: `SET attempt_count = attempt_count + 1`

**Inti**:
- `attempt_count` = berapa HTTP call ke gateway dalam **cycle ini saja**
- Kalau scheduler pick payment lagi (cycle berikutnya), `attempt_count` **reset ke 0** dan mulai hitung ulang
- Untuk total across semua cycle, lihat `total_retry_count`

---

### Note B: `payments.total_retry_count`

> **Durable retry cycles — di-increment oleh scheduler, bukan service. TIDAK selalu kurang dari MAX_TOTAL_RETRIES.**

**Flow increment** (di `RetrySchedulerService.processOne()` line 110-114):

```text
scheduler poll:
  payment.total_retry_count = 0  (initial)
  ↓
  scheduler: check (0 >= 5? NO)
  ↓
  scheduler: atomicUpdateStatus(totalRetryCount = 1)  ← increment jadi 1
  ↓
  scheduler: executePayment(payment)
    ├─ Cockatiel retries (attempt_count reset ke 0, lalu 1, 2, 3, 4)
    └─ Status transition tergantung hasil

scheduler poll berikutnya:
  payment.total_retry_count = 1
  ↓
  scheduler: check (1 >= 5? NO)
  ↓
  scheduler: atomicUpdateStatus(totalRetryCount = 2)
  ↓
  scheduler: executePayment(payment)
    ...

  ... begitu seterusnya sampai:

scheduler poll ke-5:
  payment.total_retry_count = 5 (sudah di-increment di cycle sebelumnya)
  ↓
  scheduler: check (5 >= 5? YES)
  ↓
  scheduler: update status = failed, failure_reason = 'max_total_retries_exceeded'
  ↓
  payment SELESAI (tidak akan di-pick lagi)
```

**Jawaban**: `total_retry_count` bisa **sampe sama dengan `MAX_TOTAL_RETRIES`** (5), tapi **tidak melebihi**. Karena:

1. Saat `currentTotal >= MAX_TOTAL_RETRIES` (misal: 5 >= 5), scheduler **tidak increment lagi** — langsung mark as `failed`
2. Increment terjadi di awal cycle (sebelum `executePayment`), jadi `total_retry_count` reflect "scheduler sedang mencoba cycle ke-N"

**Range nilai**:
- `0` — payment baru dibuat, belum pernah di-pick scheduler
- `1` sampai `MAX_TOTAL_RETRIES` (default 5) — selama masih dalam retry cycle
- `MAX_TOTAL_RETRIES` (5) — terakhir, lalu di-mark `failed`

**Default config**: `MAX_TOTAL_RETRIES=5` (lihat `.env.example`)

**Source**: PLAN1 section 10.2 line 525-533

---

### Note C: `payments.next_retry_at`

> **Kapan scheduler akan pick payment lagi. TIDAK terisi saat pertama kali hit gateway (initial createPayment).**

**Flow** (lihat `payments.service.ts` line 164-176):

```text
createPayment() → executePayment()
  ├─ Kalau sukses (HTTP 200) → status=succeeded, next_retry_at = NULL (tidak perlu retry)
  ├─ Kalau permanent error (4xx) → status=failed, next_retry_at = NULL (tidak retry)
  └─ Kalau retryable failure (5xx/timeout/circuit_open) ATAU retry exhausted:
       ↓
       status = scheduled_for_retry
       next_retry_at = new Date(Date.now() + delayMs)
       ↓
       delayMs = result.retryAfterMs ?? this.schedulerBaseDelayMs
                  ↑                          ↑
                  dari gateway 429        default 2000ms (SCHEDULER_BASE_DELAY_MS)
                  (Retry-After header)    kalau tidak ada Retry-After
```

**Jawaban**: Saat **pertama kali hit gateway** (initial createPayment), `next_retry_at` = NULL. Hanya terisi kalau:
1. Initial attempt gagal (retry exhausted) → `status = scheduled_for_retry`, `next_retry_at = NOW + delayMs`
2. Atau kalau gateway balas 429 dengan `Retry-After` header → `delayMs = retryAfterMs`

**Syarat terisi**:
- ✅ `result.errorCode === 'circuit_open'` (breaker OPEN, fast-fail)
- ✅ `result.attempts !== undefined` (retry sudah terjadi, exhausted)
- ❌ Kalau `result.status === 'succeeded'` → tetap NULL
- ❌ Kalau permanent failure (4xx selain 429) → tetap NULL

**Syarat scheduler pick** (lihat `payment.repository.ts` line 42-50):
```sql
WHERE status = 'scheduled_for_retry'
  AND next_retry_at <= NOW()  -- kapan scheduler boleh pick
ORDER BY next_retry_at ASC
```

**Kapan di-set NULL lagi**:
- Kalau `MAX_TOTAL_RETRIES` tercapai → scheduler set `next_retry_at = NULL` + `status = failed` (lihat retry-scheduler.service.ts line 105)
- Kalau attempt berikutnya berhasil → `status = succeeded`, `next_retry_at = NULL`

---

---

## 📊 Table: `payment_attempts`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid PK | NO | `gen_random_uuid()` | Native PG uuid PK |
| `payment_id` | uuid FK → payments.id | NO | - | CASCADE on delete |
| `attempt_number` | int | NO | - | Lihat **Note D** di bawah |
| `outcome` | attempt_outcome_enum | NO | - | Hasil attempt |
| `http_status` | int | YES | NULL | Null kalau network error |
| `error_code` | varchar | YES | NULL | e.g., `invalid_card`, `circuit_open`, `ECONNREFUSED` |
| `error_message` | varchar | YES | NULL | Human-readable error |
| `delay_before_next_ms` | int | YES | NULL | Lihat **Note E** di bawah |
| `breaker_state` | varchar(12) | NO | - | `closed` / `open` / `half_open` |
| `duration_ms` | int | NO | - | Lihat **Note F** di bawah |
| `trace_id` | varchar(64) | YES | NULL | UUIDv4 (36) / W3C TraceParent (55) / OTel |
| `idempotency_key` | varchar(64) | NO | - | PLAN1 section 9 — derived from payment.id |
| `gateway_reference` | varchar(64) | YES | NULL | Sama dengan payment.gateway_reference kalau sukses |
| `replayed` | boolean | NO | false | true = replay (idempotent, no charge) |
| `created_at` | timestamp(3) | NO | `now()` | - |

**Indexes**:
- `idx_payment_attempts_payment_id` — untuk join ke payments
- `idx_payment_attempts_idempotency_key` — untuk lookup by idempotency key (replay detection)

### Note D: `payment_attempts.attempt_number`

> **1-based, per execution cycle. Mulai dari 1 saat Cockatiel mulai eksekusi fn() pertama kali.**

**Kapan mulai terisi** (lihat `resilient-adapter.ts` line 47-53):

```typescript
let attemptNumber = 0;  // initial di resilient-adapter.charge()

const outcome = await executeWithResilience({
  fn: async () => {
    attemptNumber += 1;  // ← increment JADI 1 sebelum inner.charge() pertama
    // ...
  },
});
```

**Flow per execution cycle**:
```text
execution cycle #1 (createPayment):
  attempt_number = 0 (initial di resilient-adapter)
  ↓ Cockatiel mulai eksekusi fn()
  ↓ attemptNumber += 1 → attempt_number = 1 → insert payment_attempts row #1
  ↓ kalau gagal, Cockatiel retry
  ↓ attemptNumber += 1 → attempt_number = 2 → insert payment_attempts row #2
  ↓ kalau gagal lagi, Cockatiel retry
  ↓ attemptNumber += 1 → attempt_number = 3 → insert payment_attempts row #3
  ↓ kalau sukses atau retry exhausted, cycle selesai

scheduler pick (execution cycle #2):
  ↓ attemptNumber reset ke 0 lagi (karena `let attemptNumber = 0` di line 47)
  ↓ Cockatiel mulai eksekusi fn()
  ↓ attemptNumber += 1 → attempt_number = 1 → insert NEW row (audit table)
  ↓ ...
```

**Jawaban**: `attempt_number` mulai terisi **saat Cockatiel pertama kali eksekusi `fn()`** dalam sebuah execution cycle. Numbering **reset ke 1 di setiap cycle** (initial createPayment atau scheduler pick).

**Contoh data untuk 2 cycles**:
| id | payment_id | attempt_number | outcome | created_at |
|---|---|---|---|---|
| att-1 | pay-1 | 1 | retryable_failure | 10:00:00.123 |
| att-2 | pay-1 | 2 | retryable_failure | 10:00:01.456 |
| att-3 | pay-1 | 3 | retryable_failure | 10:00:02.789 |
| att-4 | pay-1 | 4 | retryable_failure | 10:00:04.012 | (retry exhausted, scheduled_for_retry)
| att-5 | pay-1 | 1 | success | 10:00:08.345 | (scheduler cycle ke-2, attempt_number reset)

**Circuit open case**: Kalau breaker OPEN, `fn()` tidak dieksekusi, tapi audit row tetap di-insert dengan `attempt_number = 1` (lihat resilient-adapter.ts line 108 — hardcoded 1 untuk circuit_open case).

---

### Note E: `payment_attempts.delay_before_next_ms`

> **Backoff delay (ms) sebelum attempt berikutnya. Diisi dari gateway `Retry-After` header ATAU formula exponential backoff. NULL kalau attempt terakhir (sukses/permanent/retry exhausted).**

**Sumber nilai** (lihat `payments.service.ts` line 255):
```typescript
delayBeforeNextMs: ctx.result.retryAfterMs ?? null,
```

**Wait — `delayBeforeNextMs` di audit row hanya diisi dari `result.retryAfterMs`** (nilai dari gateway 429 response), BUKAN dari formula exponential Cockatiel.

**Kapan terisi**:
- ✅ Gateway balas **429 + Retry-After header** → `retryAfterMs` di-set dari header (e.g., 3000ms untuk `Retry-After: 3`)
- ❌ HTTP 500/503/timeout → `retryAfterMs` = undefined → `delay_before_next_ms` = NULL
- ❌ Attempt terakhir (sukses/permanent/exhausted) → `delay_before_next_ms` = NULL (tidak ada attempt berikutnya)

**Tapi Cockatiel tetap pakai exponential backoff internal** (lihat `policies.ts` line 50-90):

```typescript
const customBackoff = new DelegateBackoff((context, state) => {
  const baseExponential = state?.exponential ?? config.retryBaseDelayMs;
  const nextExponential = Math.min(baseExponential * 2, config.retryMaxDelayMs);

  // Extract retryAfterMs from error context
  let retryAfterMs = extractRetryAfterMs(context.result);

  // Formula delay Cockatiel (internal, tidak disimpan ke audit):
  const delay = retryAfterMs !== undefined
    ? Math.max(nextExponential, retryAfterMs)  // ← honor Retry-After
    : nextExponential;                          // ← exponential default

  return { delay, state: { exponential: nextExponential } };
});
```

**Formula exponential backoff Cockatiel** (internal, tidak persist ke DB):
```
nextExponential = min(baseExponential * 2, retryMaxDelayMs)

Contoh dengan config default:
  RETRY_BASE_DELAY_MS = 500
  RETRY_MAX_DELAY_MS = 8000

  Cycle attempt 1→2: base=500, next=min(500*2, 8000) = 1000ms
  Cycle attempt 2→3: base=1000, next=min(1000*2, 8000) = 2000ms
  Cycle attempt 3→4: base=2000, next=min(2000*2, 8000) = 4000ms
  ...
```

**Inti**:
- `delay_before_next_ms` di DB = nilai dari gateway `Retry-After` header saja (kalau ada)
- Cockatiel internal delay (exponential) = tidak persist ke DB, hanya dipakai untuk `setTimeout` antar attempt
- Untuk verifikasi Retry-After dihormati, cek `delay_before_next_ms >= 3000` di audit row untuk Demo E

---

### Note F: `payment_attempts.duration_ms`

> **Duration attempt ini dalam milliseconds. Dihitung dari `performance.now()` diff. Pasti terisi (NOT NULL).**

**Cara hitung** (lihat `payments.service.ts` line 257):
```typescript
durationMs: ctx.finishedAt.getTime() - ctx.startedAt.getTime(),
```

**Sumber `startedAt` + `finishedAt`** (lihat `resilient-adapter.ts` line 54-56):
```typescript
fn: async () => {
  attemptNumber += 1;
  const startedAt = new Date();         // ← timestamp sebelum inner.charge()
  const innerResult = await this.inner.charge(req);
  const finishedAt = new Date();         // ← timestamp setelah inner.charge()

  // ... onAttempt callback akan terima startedAt + finishedAt
}
```

**"performance.now() diff" yang saya tulis di ERD awal kurang akurat** — sebenarnya pakai `Date.getTime()` diff (millisecond epoch), bukan `performance.now()`. Tapi `performance.now()` juga dipakai di tempat lain:

| Lokasi | Method | Dipakai untuk |
|---|---|---|
| `http-adapter.ts` line 43, 64, 74 | `performance.now()` | Hitung duration axios request (untuk metrics `gateway_request_duration_seconds`) |
| `payments.service.ts` line 80 | `performance.now()` | Hitung duration executePayment keseluruhan (untuk metrics `payment_processing_duration_seconds`) |
| `payments.service.ts` line 257 | `Date.getTime()` diff | Hitung `duration_ms` untuk audit row |

**Apakah pasti terisi?**
- ✅ Untuk attempt normal (HTTP call ke gateway) — selalu terisi, karena `startedAt` dan `finishedAt` selalu di-set
- ✅ Untuk `circuit_open` case — `startedAt = finishedAt = now` (lihat resilient-adapter.ts line 105-110), jadi `durationMs = 0` (bukan NULL)
- ✅ **NOT NULL constraint di schema** — tidak boleh NULL

**Range nilai yang realistis**:
- Circuit open: `0ms` (instant, no HTTP call)
- Timeout (gateway lambat): `~2000ms` (axios timeout 1800ms + overhead)
- HTTP 200/400/500: `~5-50ms` (gateway mock cepat)
- Replay (succeed-but-drop-response): `~1800ms` (axios timeout dari dropped response)

**Sumber nilai `startedAt`/`finishedAt` di audit row**:
- Di-pass via `GatewayAttemptContext` dari `resilient-adapter.ts` ke `payments.service.ts` via `onAttempt` callback
- Bukan dari audit service sendiri — audit service hanya terima dan simpan

---

---

## 🔍 Key Domain Concepts

### 1. Payment Lifecycle (PLAN1 section 10.1)

```text
            createPayment()
                  │
                  ▼
            ┌─────────────┐
            │ processing  │
            └─────┬───────┘
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
   succeeded   failed  scheduled_for_retry
                         │
                         │ (scheduler poll)
                         ▼
                    processing
                         │
                         ▼
                  succeeded/failed
```

- `attempt_count`: reset ke 0 setiap kali scheduler pick (new execution cycle)
- `total_retry_count`: cumulatif across scheduler cycles — **di-increment oleh scheduler, bukan service** (PLAN1 section 10.2)

### 2. Idempotency Invariant (PLAN1 section 9.1)

> Untuk 1 payment: `actualCharges ≤ 1`, walau `HTTP calls ≥ 2`

**Cara verify di data**:
```sql
SELECT
  p.id,
  COUNT(pa.*) AS http_calls,
  COUNT(pa.*) FILTER (WHERE pa.replayed = false AND pa.outcome = 'success') AS actual_charges
FROM payments p
JOIN payment_attempts pa ON pa.payment_id = p.id
GROUP BY p.id;
-- actual_charges should always be ≤ 1
```

### 3. Circuit Breaker Audit

`payment_attempts.outcome = 'circuit_open'` menandakan attempt di-short-circuit oleh breaker yang OPEN — tidak ada call ke gateway. Ini terjadi kalau:
- Previous attempts menyebabkan breaker OPEN (failure threshold tercapai)
- Payment ini masuk pipeline saat breaker masih OPEN → fast-fail dengan `outcome = 'circuit_open'`

### 4. Trace ID Consistency

`trace_id` di `payment_attempts` konsisten per **execution cycle** (bukan per payment). Artinya:
- Payment create → trace_id = T1
  - Attempt 1 (fail) → trace_id = T1
  - Attempt 2 (fail) → trace_id = T1
  - Attempt 3 (success) → trace_id = T1
- Scheduler pick payment → trace_id = T2 (new execution cycle)
  - Attempt 1 → trace_id = T2

---

## 📜 Migration History

| # | File | Description | Date |
|---|---|---|---|
| 1 | [`0001_init.ts`](../apps/payment-api/src/database/migrations/0001_init.ts) | Create tables + indexes + native PG enums | 2026-09-13 |
| 2 | [`0002_trace_id_varchar.ts`](../apps/payment-api/src/database/migrations/0002_trace_id_varchar.ts) | ALTER `trace_id` `char(32)` → `varchar(64)` (UUIDv4 = 36 chars, tidak muat di char(32)) | 2026-09-13 |

---

## 🛠 Dual Environment Support (TASK-14b)

| Environment | Driver | synchronize | Migrations | Notes |
|---|---|---|---|---|
| **PostgreSQL** (production + local dev with Docker) | `pg` | false | Run via `pnpm db:migrate` | Native PG enums, `gen_random_uuid()`, `timestamp(3)` |
| **SQLite** (sandbox/test) | `better-sqlite3` | true | Skipped | varchar for enum/timestamp/uuid (via helper functions) |

Helper functions in [`db-types.helper.ts`](../apps/payment-api/src/database/helpers/db-types.helper.ts):
- `getUuidColumnType()` → `'uuid'` for PG, `'varchar'` for SQLite
- `getTimestampColumnType()` → `'timestamp'` for PG, `'datetime'` for SQLite

---

## 🔗 Cross-Reference

- **Entity source code**:
  - [`payment.entity.ts`](../apps/payment-api/src/database/entities/payment.entity.ts)
  - [`payment-attempt.entity.ts`](../apps/payment-api/src/database/entities/payment-attempt.entity.ts)
  - [`enums.ts`](../apps/payment-api/src/database/entities/enums.ts)
- **Migrations**: [`migrations/`](../apps/payment-api/src/database/migrations/)
- **PLAN1 section 11**: Persistence schema reference
- **TASK-14b**: Dual environment (PostgreSQL + SQLite) — see [`TASK-14b-dual-environment.md`](./tasks/TASK-14b-dual-environment.md)
- **Bug history**: `trace_id` char(32) → varchar(64) — see [`e2e-results.md`](./e2e-results.md) bug #1
