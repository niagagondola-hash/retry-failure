# TASK-14 - E2E Scenarios (Jest + supertest + Agent Browser)

> **Task ID**: 11
> **Depends on**: 7 (TASK-10 retry scheduler) + 8 (TASK-11 observability) + 9 (TASK-12 Next.js sandbox) + 10 (TASK-13 Vue dashboard)
> **Estimated effort**: M (~4-6 jam - 7 backend spec files + 5 UI demo verifications via Agent Browser + results documentation)
> **Plan reference**: Section 14.2 (E2E scenarios) + Section 17 (Demonstration) + Section 22 (Definition of Done)

---

## Goal

Meverifikasi **end-to-end** seluruh failure scenarios yang dijanjikan oleh plan section 14.2 (7 backend scenarios) dan section 17 (5 demonstration scenarios A–E) menggunakan kombinasi tooling:

1. **Jest + supertest** untuk 7 backend API scenarios - file spec `.e2e-spec.ts` di `apps/payment-api/test/e2e/`, menguji alur lengkap `POST /payments` -> gateway mock -> Cockatiel retry -> audit trail -> metrics -> scheduler cycle, dengan assertion via HTTP response body, DB query langsung ke PostgreSQL, dan Prometheus `/metrics` text scraping.
2. **Agent Browser** (skill `agent-browser`) untuk 5 UI demos - dijalankan terhadap **kedua** frontend: Next.js sandbox di port 3000 (TASK-12) **dan** Vue dashboard di port 5173 (TASK-13). Setiap demo mengklik tombol Demo A–E, memverifikasi UI state (toast / status badge / attempt timeline), lalu meng-capture screenshot sebagai evidence.
3. **Hasil**: tabel PASS/FAIL + evidence (test output, DB query snapshot, metric snapshot, screenshot) didokumentasikan di `retry-failure/docs/e2e-results.md` - sumber rujukan untuk TASK-15 (documentation) dan DoD plan section 22.

> **Hero scenario**: Scenario 4 (anti double-charge) - bila ini FAIL, plan section 22 DoD gagal. Scenario 4 WAJIB lulus.

---

## Scope

**In scope**:

- `apps/payment-api/test/e2e/*.e2e-spec.ts` - 7 Jest spec files (satu per scenario):
  - `payments.transient.e2e-spec.ts` (scenario 1 - `fail-first-n=2`)
  - `payments.permanent.e2e-spec.ts` (scenario 2 - `client-error`)
  - `payments.circuit-breaker.e2e-spec.ts` (scenario 3 - `always-timeout`, threshold=3)
  - `payments.idempotency.e2e-spec.ts` (scenario 4 - `succeed-but-drop-response`, hero)
  - `payments.retry-after.e2e-spec.ts` (scenario 5 - `rate-limited`, `retryAfterSeconds`)
  - `payments.durable-scheduler.e2e-spec.ts` (scenario 6 - `server-error` then `always-success`)
  - `payments.exhaustion.e2e-spec.ts` (scenario 7 - `server-error` persistent, `MAX_TOTAL_RETRIES=5`)
- `apps/payment-api/test/jest-e2e.json` - Jest config khusus E2E (preset ts-jest, testEnvironment node, testRegex `.e2e-spec.ts`, setupFilesAfterEnv dengan DB cleanup helper).
- `apps/payment-api/test/e2e/helpers/` - utility functions (axios client, gateway mode setter, polling waiter, metric parser, DB query helper).
- `docs/e2e-results.md` - tabel hasil eksekusi semua scenario + evidence (link ke test output / DB snapshot / metric snapshot / screenshot Agent Browser).
- **Agent Browser test runs** - manual / scripted via skill `agent-browser`, untuk 5 demos A–E di Next.js sandbox (port 3000) **dan** Vue dashboard (port 5173). Screenshot disimpan di `docs/e2e-evidence/demo-{A-E}-{nextjs|vue}-{timestamp}.png`.

**Out of scope**:

- **Performance / load testing** - secara eksplisit dikecualikan plan section 19 ("Hal yang Sengaja Tidak Diimplementasikan"). Tidak ada k6 / Artillery / wrk script. Single-request E2E cukup untuk membuktikan correctness; SLO numbers (p95 latency, throughput) adalah production concern, didokumentasikan di TASK-15 caveats.
- **Distributed / multi-instance scheduler test** - plan section 20.2 eksplisit menyebut demo single-instance, tidak ada distributed lock guarantee. E2E hanya menjalankan 1 instance `payment-api` (port 3001) dengan `@nestjs/schedule` in-process scheduler.
- **Full Grafana dashboard verification** - TASK-11 hanya menyediakan sample PromQL queries (di `docs/` caveats), tidak provisioning JSON dashboard. E2E memverifikasi metric values via `/metrics` text scraping + manual `promql` query di Prometheus (optional), **bukan** visual Grafana dashboard assertion.
- **Jaeger trace UI verification** - plan section 22 menyebut "Trace payment dapat ditemukan di Jaeger" - TASK-11 menyimplifikasi OTel ke `AsyncLocalStorage` + `payment_attempts.trace_id` (bukan full OTel SDK). E2E memverifikasi `trace_id` kolom di `payment_attempts` konsisten lintas attempts, **bukan** visual Jaeger UI screenshot. Full OTel -> future TASK.
- **Browser compatibility matrix** - Agent Browser memakai 1 browser engine (headless Chromium via `agent-browser` skill). Tidak ada cross-browser test (Firefox/Safari/Edge). Production browser matrix -> TASK-15.
- **Accessibility (a11y) audit** - Agent Browser snapshot berfokus business state (toast, status badge), bukan axe-core a11y scan. A11y audit -> future work, tidak di plan rev 2.
- **Mutation testing** - TIDAK menjalankan Stryker / mutator. Coverage 100% adalah unit test concern (TASK-04..11), bukan E2E.
- **Database performance / index tuning** - E2E tidak mengukur query plan. DB query hanya untuk assertion state, bukan EXPLAIN ANALYZE.

---

## Pre-conditions

1. **TASK-01 sampai TASK-13 selesai** - monorepo siap, semua dependencies terinstall, semua apps bisa jalan via `pnpm dev` / `pnpm start:dev`.
2. **Services running**:
   - `payment-api` (NestJS) di port **3001** - `cd apps/payment-api && pnpm start:dev`.
   - `payment-gateway-mock` (NestJS) di port **3002** - `cd apps/payment-gateway-mock && pnpm start:dev`.
   - `frontend-vue` (Vite) di port **5173** - `cd apps/frontend-vue && pnpm dev`.
   - Next.js sandbox di port **3000** - `cd /home/z/my-project && bun run dev`.
3. **PostgreSQL running** di port 5432, schema `public`, database `retry_failure`, user `retry_failure` - DB migrations terapply (`pnpm db:migrate` di `apps/payment-api`).
4. **No orphaned `processing` payments** - verifikasi sebelum run:
   ```sql
   SELECT count(*) FROM payments WHERE status = 'processing';
   -- harus return 0
   ```
   Bila ada: tunggu sampai terminal (success / failed / scheduled_for_retry), atau cleanup manual via `DELETE FROM payment_attempts WHERE payment_id IN (SELECT id FROM payments WHERE status='processing'); DELETE FROM payments WHERE status='processing';`.
5. **Circuit breaker dimulai dari state CLOSED** - verifikasi via `curl -s http://localhost:3001/metrics | grep circuit_breaker_state`. Bila sudah OPEN (dari run sebelumnya yang crash): tunggu `BREAKER_COOLDOWN_MS` (10s) + 1 successful payment untuk HALF_OPEN -> CLOSED.
6. **Environment variables di `.env`** (sudah diset di TASK-01 + TASK-10):
   ```
   SCHEDULER_INTERVAL_MS=5000   # production-like, bisa diturunkan ke 1000 untuk test env bila perlu
   MAX_TOTAL_RETRIES=5
   BREAKER_FAILURE_THRESHOLD=3
   BREAKER_COOLDOWN_MS=10000
   RETRY_MAX_ATTEMPTS=3
   GATEWAY_TIMEOUT_MS=2000
   ```
7. **Agent Browser skill available** - `agent-browser` listed di skills registry. Bila belum, install via skill-creator (lihat TASK-15 documentation).
8. **Disk space untuk screenshots** - minimal 50MB free di `docs/e2e-evidence/` (10 screenshot × ~500KB × 2 frontends × 5 demos).

---

## Backend E2E scenarios (Jest + supertest)

> **Test runner**: Jest 29 dengan preset `ts-jest`. HTTP client: `axios` (lebih mudah multipart / header manipulation daripada supertest murni untuk E2E cross-service). supertest dipakai bila ingin assert HTTP response shape via supertest's chainable API (optional - axios cukup).
>
> **Pattern umum (aktual implementasi)**: `beforeAll` → `ensureDbConnected()` + `cleanDb()` (DELETE payments + payment_attempts) + `resetGatewayState()` (POST /admin/reset untuk clear counters + idempotency store) + `resetBreaker()` (untuk S3-S7, reset Cockatiel breaker singleton). Lalu `setGatewayMode(...)`. Test: `POST /payments` → poll atau tunggu terminal/scheduled status → assert `status` + `attemptCount` + audit rows + metrics + gateway stats. `afterAll` → `resetGatewayToHealthy()` + `closeDb()`.
>
> ⚠️ **Cockatiel v4 `maxAttempts=3`** = 4 total fn() calls (1 initial + 3 retries), BUKAN 3 total. Lihat TASK-14a-circuit-breaker.md section 1.A.
>
> ⚠️ **Test helpers** pakai TypeORM DataSource (bukan `pg.Client`) untuk driver-agnostic support (PostgreSQL + SQLite). Lihat TASK-14b-dual-environment.md.
>
> ⚠️ **`--forceExit`** diperlukan saat run semua test sekaligus karena scheduler background process mencegah Jest exit.

### Scenario 1 - Transient failure (`fail-first-n=2`)

**File**: `payments.transient.e2e-spec.ts`

**Gateway mode**:
```http
PUT http://localhost:3002/admin/config
Content-Type: application/json

{ "mode": "fail-first-n", "n": 2 }
```

**Flow**:
1. `POST /payments` body `{ "orderId": "E2E-S1-<uuid>", "amount": 50000, "currency": "IDR" }`.
2. Polling `GET /payments/:id` setiap 200ms sampai `status` ∈ {`succeeded`, `failed`} atau timeout 30s.
3. Fetch `GET /payments/:id` untuk full payload `{ payment, attempts }`.
4. Fetch `GET /metrics` -> parse `retry_attempts_total{outcome="failure"}` dan `payments_current_status{status="succeeded"}`.

**Assertions**:
- [ ] `payment.status === 'succeeded'`.
- [ ] `payment.attemptCount === 3` (2 retryable_failure + 1 success).
- [ ] `attempts.length === 3` (audit rows terurut ASC by `attemptNumber`).
- [ ] `attempts[0].outcome === 'retryable_failure'` && `attempts[0].httpStatus === 500`.
- [ ] `attempts[1].outcome === 'retryable_failure'` && `attempts[1].httpStatus === 500`.
- [ ] `attempts[2].outcome === 'success'` && `attempts[2].httpStatus === 200`.
- [ ] Semua 3 attempts share `traceId` yang sama (1 execution cycle).
- [ ] `retry_attempts_total{outcome="failure"}` bertambah ≥ 2 (counter cumulative).
- [ ] `payments_current_status{status="succeeded"}` bertambah 1.

**Evidence di `e2e-results.md`**:
- Test output (Jest console).
- DB query snapshot: `SELECT attempt_number, outcome, http_status, trace_id, duration_ms FROM payment_attempts WHERE payment_id = '<id>' ORDER BY attempt_number;`.
- Metric snapshot: `retry_attempts_total` + `payments_current_status` sebelum vs sesudah.

---

### Scenario 2 - Permanent failure (`client-error`)

**File**: `payments.permanent.e2e-spec.ts`

**Gateway mode**:
```http
PUT http://localhost:3002/admin/config
{ "mode": "client-error" }
```

**Flow**:
1. `POST /payments` body `{ "orderId": "E2E-S2-<uuid>", "amount": 75000, "currency": "IDR" }`.
2. Polling `GET /payments/:id` (200ms, timeout 15s - permanent failure cepat, no retry).
3. Fetch full payload + metrics.

**Assertions**:
- [ ] `payment.status === 'failed'`.
- [ ] `payment.attemptCount === 1` (no retry for permanent failure - TASK-04 classifier `isPermanent === true`).
- [ ] `payment.failureReason` mengandung `'invalid_card'` (atau `'client_error'` - sesuai classification map di TASK-04).
- [ ] `attempts.length === 1`.
- [ ] `attempts[0].outcome === 'permanent_failure'`.
- [ ] `attempts[0].httpStatus === 400`.
- [ ] `retry_attempts_total{outcome="failure"}` TIDAK bertambah (permanent failure tidak terhitung retry).
- [ ] `payments_current_status{status="failed"}` bertambah 1.
- [ ] Tidak ada `retry_scheduled` log entry di payment-api stdout untuk payment id tsb.

**Evidence**:
- Test output.
- DB query snapshot: `SELECT status, attempt_count, failure_reason FROM payments WHERE id = '<id>';` + `SELECT attempt_number, outcome, http_status FROM payment_attempts WHERE payment_id = '<id>';`.
- Metric snapshot delta untuk `retry_attempts_total` (harus 0).

---

### Scenario 3 - Circuit breaker (`always-timeout`, `BREAKER_FAILURE_THRESHOLD=3`)

**File**: `payments.circuit-breaker.e2e-spec.ts`

**Gateway mode**:
```http
PUT http://localhost:3002/admin/config
{ "mode": "always-timeout", "timeoutMs": 5000 }
```
(`GATEWAY_TIMEOUT_MS=2000` di payment-api -> gateway 5s pasti timeout di client.)

**Flow**:
1. Loop 3 kali `POST /payments` (orderId beda: `E2E-S3-1`, `E2E-S3-2`, `E2E-S3-3`).
2. Setiap POST: tunggu terminal status (semua harus jadi `scheduled_for_retry` karena Cockatiel exhaust attempts tanpa success, dan breaker transition CLOSED -> OPEN setelah failure ke-3).
3. Verifikasi breaker state via `GET /metrics` -> `circuit_breaker_state{service="payment-gateway"} === 1` (OPEN).
4. POST 4th payment `E2E-S3-4` -> ekspektasi **first attempt langsung `circuit_open`** (breaker short-circuit tanpa call gateway) + status payment `scheduled_for_retry`.
5. Reset gateway ke `always-success`, tunggu `BREAKER_COOLDOWN_MS` (10s), lalu trigger 1 successful payment untuk HALF_OPEN -> CLOSED.

**Assertions**:
- [ ] Payment #1: `attemptCount === 3` (3 timeout dalam satu Cockatiel cycle -> exhaust `RETRY_MAX_ATTEMPTS=3`), `status === 'scheduled_for_retry'`, `totalRetryCount === 0`.
- [ ] Payment #2: `attemptCount === 3`, `status === 'scheduled_for_retry'`, `totalRetryCount === 0`.
- [ ] Payment #3: `attemptCount === 3`, `status === 'scheduled_for_retry'`, `totalRetryCount === 0`.
- [ ] Setelah 3rd payment selesai: `circuit_breaker_state{service="payment-gateway"} === 1` (OPEN).
- [ ] Payment #4: `attemptCount === 1` (circuit_open di first attempt - breaker reject sebelum call gateway), `attempts[0].outcome === 'circuit_open'`, `attempts[0].httpStatus === 'breaker_open'` (string, bukan HTTP code), `status === 'scheduled_for_retry'`.
- [ ] Setelah reset + cooldown + 1 success: `circuit_breaker_state{service="payment-gateway"} === 0` (CLOSED).

**Evidence**:
- Test output untuk 4 payment.
- DB query: `SELECT id, order_id, status, attempt_count, total_retry_count FROM payments WHERE order_id LIKE 'E2E-S3-%' ORDER BY created_at;`.
- Metric snapshot `circuit_breaker_state` sebelum (CLOSED=0) -> setelah 3 payments (OPEN=1) -> setelah 4th (OPEN=1, masih) -> setelah reset (CLOSED=0).
- Audit rows untuk payment #4: `SELECT attempt_number, outcome, http_status FROM payment_attempts WHERE payment_id = '<id-payment-4>';` -> outcome `circuit_open` pada attempt #1.

> **Reset breaker**: setelah scenario ini, breaker WAJIB di-reset ke CLOSED sebelum scenario selanjutnya jalan - gunakan helper `resetBreaker()` yang: (a) PUT gateway `always-success`, (b) `sleep(BREAKER_COOLDOWN_MS + 1000)`, (c) POST 1 successful payment. Verifikasi metric `circuit_breaker_state === 0`.

---

### Scenario 4 - Anti double-charge hero (`succeed-but-drop-response`)

**File**: `payments.idempotency.e2e-spec.ts`

> **HERO SCENARIO** - bila ini FAIL, plan section 22 DoD gagal. Scenario 4 WAJIB lulus.

**Gateway mode**:
```http
PUT http://localhost:3002/admin/config
{ "mode": "succeed-but-drop-response" }
```

**Flow**:
1. `POST /payments` body `{ "orderId": "E2E-S4-HERO-<uuid>", "amount": 100000, "currency": "IDR" }`.
2. Cockatiel cycle: attempt #1 -> gateway charge succeeds (charge tercatat di gateway idempotency store) -> response dropped (client-side timeout) -> retry -> attempt #2 -> gateway detect `Idempotency-Key` exists -> replay existing response (no new charge) -> success.
3. Polling terminal status (timeout 60s karena retry cycle panjang).
4. Fetch `GET /payments/:id` untuk verify `attempts` array.
5. Fetch `GET http://localhost:3002/admin/stats` -> bandingkan `actualCharges` vs `totalRequests`.

**Assertions**:
- [ ] `payment.status === 'succeeded'`.
- [ ] `payment.attemptCount >= 2` (minimal 2 attempts - attempt #1 drop, attempt #2 replay).
- [ ] `attempts[1].gatewayReference` tidak null (charge ref dari gateway).
- [ ] `attempts[1].replayed === true` (flag replay dari gateway mock - TASK-03 `/admin/stats` meng-ekspos ini).
- [ ] `GET /admin/stats` dari gateway mock: `actualCharges === 1` (charge sungguhan hanya 1x, sisanya replay).
- [ ] `GET /admin/stats` dari gateway mock: `totalRequests >= 2` (calls >= 2 sesuai plan scenario 4).
- [ ] Metric `gateway_idempotent_replays_total` bertambah ≥ 1.
- [ ] Audit row untuk attempt #2: `outcome === 'success'`, `replayed === true`.

**Evidence**:
- Test output.
- DB query: `SELECT attempt_number, outcome, http_status, gateway_reference, replayed FROM payment_attempts WHERE payment_id = '<id>' ORDER BY attempt_number;`.
- Gateway stats snapshot: `curl -s http://localhost:3002/admin/stats | jq` - `{ "actualCharges": 1, "totalRequests": 2, "replayCount": 1, ... }`.
- Metric snapshot: `gateway_idempotent_replays_total` sebelum vs sesudah.

> **Optional deep check** (bila gateway mock menyediakan): `GET http://localhost:3002/admin/idempotency/:key` - verifikasi 1 entry untuk key = `payment.id`, dengan `chargeCount: 1` + `replayCount: 1`. Bila endpoint ini tidak ada di TASK-03, lewati - assertion via `/admin/stats` sudah cukup.

---

### Scenario 5 - Retry-After (`rate-limited`, `retryAfterSeconds=3`)

**File**: `payments.retry-after.e2e-spec.ts`

**Gateway mode**:
```http
PUT http://localhost:3002/admin/config
{ "mode": "rate-limited", "retryAfterSeconds": 3 }
```

**Flow**:
1. Record `t0 = Date.now()`.
2. `POST /payments` body `{ "orderId": "E2E-S5-<uuid>", "amount": 25000, "currency": "IDR" }`.
3. Polling `GET /payments/:id` (timeout 60s).
4. Setelah terminal, fetch `GET /payments/:id` untuk dapat `attempts` array dengan `createdAt` timestamps.
5. Hitung delta: `attempt[1].createdAt - attempt[0].createdAt` harus >= `retryAfterSeconds * 1000` (3000ms).

**Assertions**:
- [ ] `payment.status === 'succeeded'` (asumsi gateway mock `rate-limited` tidak unlimited 429 - bila 429 persisten, expected `scheduled_for_retry`; verify spec gateway mock di TASK-03 untuk behavior `rate-limited` - biasanya 429 sebanyak N kali lalu 200).
- [ ] Setiap attempt yang dapat 429: `outcome === 'retryable_failure'`, `httpStatus === 429`.
- [ ] `delay_before_next_ms` (jika di-log di audit row / payment api log) >= `retryAfterSeconds * 1000` (3000ms) untuk attempt yang dapat 429. Verifikasi via:
  - `payment_attempts.metadata.delay_before_next_ms` (bila kolom / JSON field ada), ATAU
  - Delta `created_at` antara attempt ke-N dan ke-(N+1) >= 3000ms.
- [ ] Response header gateway mock untuk 429 response: `Retry-After: 3` (verifikasi via curl manual atau axios interceptor log).

**Evidence**:
- Test output.
- DB query: `SELECT attempt_number, outcome, http_status, created_at FROM payment_attempts WHERE payment_id = '<id>' ORDER BY attempt_number;` - hitung delta timestamp manual.
- Payment API log snapshot: `grep "retry_delay" payment-api.log | grep <paymentId>` - harus ada line dengan `delayBeforeNextMs >= 3000`.

> **PENTING**: bila gateway mock `rate-limited` selalu 429, scenario ini tidak akan `succeeded` - akan `scheduled_for_retry`. Dalam kasus itu, expected outcome berubah: `status === 'scheduled_for_retry'`, dan delta timestamp antar attempt dalam satu Cockatiel cycle tetap >= 3000ms. Asserted via delta `created_at`.

---

### Scenario 6 - Durable scheduler retry (`server-error` then `always-success`)

**File**: `payments.durable-scheduler.e2e-spec.ts`

**Gateway mode**: dynamic - start `server-error`, switch ke `always-success` mid-run.

**Flow**:
1. PUT gateway `server-error`.
2. Record `t0 = Date.now()`.
3. `POST /payments` body `{ "orderId": "E2E-S6-<uuid>", "amount": 60000, "currency": "IDR" }`.
4. Polling (timeout 30s). Expected: status jadi `scheduled_for_retry` (Cockatiel exhaust 3 attempts -> `scheduled_for_retry` + `next_retry_at = now + backoff`).
5. Verify `payment.totalRetryCount === 0` (scheduler belum jalan).
6. Verify `payment.nextRetryAt` di-set (future timestamp).
7. PUT gateway `always-success` (switch mode mid-run).
8. Wait `<= SCHEDULER_INTERVAL_MS + buffer` (5000ms + 2000ms = 7s, atau kurangi `SCHEDULER_INTERVAL_MS=1000` di test env).
9. Verify payment-api stdout log: line `scheduler_poll` + `payment_picked` untuk payment id tsb.
10. Polling ulang (timeout 30s). Expected: `scheduled_for_retry -> processing -> succeeded`.
11. Verify `payment.totalRetryCount === 1` (scheduler cycle ke-1).

**Assertions**:
- [ ] Setelah step 4: `status === 'scheduled_for_retry'`, `totalRetryCount === 0`, `nextRetryAt !== null`.
- [ ] `nextRetryAt - createdAt >= 1000ms` (minimal backoff).
- [ ] Setelah step 8 (scheduler cycle): `totalRetryCount === 1`.
- [ ] Setelah step 10: `status === 'succeeded'`, `attemptCount >= 1` (dalam scheduler cycle, Cockatiel reset -> 1 success attempt di cycle baru).
- [ ] Trace ID **berbeda** antara initial cycle (3 attempts `server-error`) dan scheduler cycle (1 success attempt) - trace ID di-generate per execution cycle, NOT per payment.
- [ ] Audit row dari scheduler cycle: `attempts[N].source === 'scheduler'` (bila kolom `source` ada di `payment_attempts` - bila tidak, infer via log line `scheduler_poll`).

**Evidence**:
- Test output.
- DB query: `SELECT status, attempt_count, total_retry_count, next_retry_at, created_at, updated_at FROM payments WHERE id = '<id>';`.
- Audit rows: `SELECT attempt_number, outcome, trace_id, created_at FROM payment_attempts WHERE payment_id = '<id>' ORDER BY attempt_number;` - verify 2 trace IDs berbeda (initial cycle vs scheduler cycle).
- Payment API log snapshot: `grep -E "scheduler_poll|payment_picked|payment_finish" payment-api.log | grep <paymentId>`.

> **Test env tip**: bila `SCHEDULER_INTERVAL_MS=5000` terlalu lambat untuk test (total test duration > 30s), override env `SCHEDULER_INTERVAL_MS=1000` di test env (bisa via `.env.test` atau `process.env.SCHEDULER_INTERVAL_MS=1000` di `setupFilesAfterEnv`). Document caveat: production tetap 5000ms.

---

### Scenario 7 - Total retry exhaustion (`server-error` persistent, `MAX_TOTAL_RETRIES=5`, `SCHEDULER_INTERVAL_MS=5000`)

**File**: `payments.exhaustion.e2e-spec.ts`

**Gateway mode**: `server-error` (persistent, tidak di-switch).

**Flow**:
1. PUT gateway `server-error`.
2. Record `t0 = Date.now()`.
3. `POST /payments` body `{ "orderId": "E2E-S7-<uuid>", "amount": 30000, "currency": "IDR" }`.
4. Polling dengan timeout **120s** (scenario panjang - initial Cockatiel cycle ~6s + 5 scheduler cycles × ~6s + backoff delay = ~60-90s).
5. Verify setiap scheduler cycle increment `totalRetryCount`:
   - Cycle 1 (initial): `totalRetryCount=0`, status jadi `scheduled_for_retry`.
   - Cycle 2 (scheduler #1): `totalRetryCount=1`, `scheduled_for_retry`.
   - ...
   - Cycle 6 (scheduler #5): `totalRetryCount=5`, status jadi `failed` (MAX_TOTAL_RETRIES exceeded).
6. Verify `payment.failureReason` mengandung `'max_total_retries_exceeded'` (atau `'total_retry_exhausted'` - sesuai TASK-07 error reason constant).
7. Verify scheduler **tidak lagi** mem-pick payment tersebut setelah status `failed` (verifikasi via log: tidak ada `payment_picked` event setelah `payment_finish` line untuk id tsb).
8. Verify `nextRetryAt` di-set ke null setelah `failed` (scheduler skip query: `WHERE status='scheduled_for_retry' AND next_retry_at <= NOW()`).

**Assertions**:
- [ ] `payment.status === 'failed'`.
- [ ] `payment.totalRetryCount >= MAX_TOTAL_RETRIES (5)`.
- [ ] `payment.attemptCount === (1 + 5) × RETRY_MAX_ATTEMPTS` = (1 + 5) × 3 = 18 attempts (initial cycle 3 attempts + 5 scheduler cycles × 3 attempts). Atau bila scheduler cycle di-allow attempt count < 3 (bila break on first failure), minimum 6 attempts (1 per cycle).
- [ ] `payment.failureReason` contains `'max_total_retries_exceeded'` (or `'total_retry_exhausted'`).
- [ ] `payment.nextRetryAt === null` (scheduler tidak pick lagi).
- [ ] Payment API log: terdapat ≥ 5 line `scheduler_poll` untuk payment id tsb, dan 1 line `payment_finish` dengan `finalStatus=failed`.
- [ ] Tidak ada line `scheduler_poll` dengan `payment_id=<id>` AFTER `payment_finish` line.

**Evidence**:
- Test output (expect ~60-90s duration).
- DB query: `SELECT status, attempt_count, total_retry_count, failure_reason, next_retry_at, updated_at FROM payments WHERE id = '<id>';`.
- Audit rows count: `SELECT count(*) FROM payment_attempts WHERE payment_id = '<id>';` (expected 6-18 tergantung cycle behavior).
- Payment API log snapshot: `grep -E "scheduler_poll|payment_picked|payment_finish|max_total_retries" payment-api.log | grep <paymentId> | head -n 30;`.
- Metric snapshot delta: `payments_current_status{status="failed"}` bertambah 1, `retry_attempts_total{outcome="failure"}` bertambah banyak.

> **Timeout tuning**: scenario 7 duration bisa 60-90s dengan `SCHEDULER_INTERVAL_MS=5000`. Bila test terlalu lambat, override env `SCHEDULER_INTERVAL_MS=1000` + `MAX_TOTAL_RETRIES=3` di test env (bukan production env) -> duration turun ke ~15-25s. Document caveat di `e2e-results.md`.

---

## UI Demo scenarios (Agent Browser)

> **Tool**: skill `agent-browser` (headless Chromium via Rust binary + Node fallback). Untuk setiap demo, navigate ke URL, klik tombol Demo A-E, wait for completion, assert UI state, capture screenshot.
>
> **Two frontends per demo**:
> - **Next.js sandbox**: `http://localhost:3000` (TASK-12) - pakai `?XTransformPort=3001` untuk fetch ke payment-api, `?XTransformPort=3002` untuk gateway mock.
> - **Vue dashboard**: `http://localhost:5173` (TASK-13) - direct fetch ke `http://localhost:3001` + `http://localhost:3002` (CORS enabled).
>
> **Total runs**: 5 demos × 2 frontends = **10 runs**.

### Demo A - retry saves transient failure (fail-first-n=2)

**Agent Browser steps**:
1. Navigate: `http://localhost:5173` (Vue) atau `http://localhost:3000` (Next.js).
2. Reset gateway: click "Reset" button di Gateway Mode Selector (PUT `always-success`).
3. Click button labeled **"Demo A: Retry menyelamatkan transient failure"**.
4. Wait sampai status terminal (max 30s) - observer toast / status badge.
5. Assert UI state:
   - Payment muncul di list dengan status `processing` -> `succeeded`.
   - Payment detail: 3 attempts di timeline (2 failed + 1 succeeded).
   - Toast "PASSED" muncul.
6. Screenshot: save ke `docs/e2e-evidence/demo-A-vue-<timestamp>.png`.

**Backend assertion (cross-check via curl)**:
- `GET /payments?orderId=E2E-DEMO-A-*` -> payment dengan `attemptCount=3`, `status=succeeded`.

**Expected**: 5 attempts × 2 frontends = 10 payment records, semua `status=succeeded`, `attemptCount=3`.

---

### Demo B - don't retry permanent error (client-error)

**Agent Browser steps**:
1. Navigate ke dashboard.
2. Reset gateway: PUT `always-success`.
3. Click **"Demo B: Jangan retry permanent error"**.
4. Wait (max 10s - permanent failure cepat).
5. Assert:
   - Payment status: `failed`.
   - Attempt timeline: 1 attempt dengan outcome `permanent_failure`, httpStatus `400`.
   - Toast "PASSED".
6. Screenshot.

**Backend cross-check**: `attemptCount=1`, `failureReason contains 'invalid_card'`.

---

### Demo C - circuit breaker protects (always-timeout)

**Agent Browser steps**:
1. Navigate ke dashboard.
2. Reset gateway: PUT `always-success` + tunggu 10s cooldown + 1 successful payment (reset breaker ke CLOSED).
3. Click **"Demo C: Circuit breaker melindungi gateway"**.
4. Wait (max 60s - 3 payments × 3 timeout attempts + 4th circuit_open).
5. Assert:
   - 3 payment pertama: status `scheduled_for_retry`, attemptCount=3 (semua `timeout`).
   - 4th payment: status `scheduled_for_retry`, attemptCount=1, attempt[0].outcome=`circuit_open`.
   - Circuit Breaker Card: state `OPEN` (atau setelah cooldown `HALF_OPEN`).
   - Toast "PASSED".
6. Screenshot.

**Backend cross-check**: `circuit_breaker_state{service="payment-gateway"} === 1` selama scenario berjalan.

---

### Demo D - idempotency prevents double charge hero (succeed-but-drop-response)

**Agent Browser steps**:
1. Navigate ke dashboard.
2. Reset gateway: PUT `always-success` + reset breaker bila OPEN.
3. Click **"Demo D: Idempotency mencegah double charge"**.
4. Wait (max 60s - retry cycle panjang karena timeout + replay).
5. Assert:
   - Payment status: `succeeded`.
   - Attempt timeline: ≥ 2 attempts, attempt #2 dengan badge `replayed: true` + `gatewayReference` tidak null.
   - Gateway stats card (bila ada di Vue dashboard): `actualCharges=1`, `totalRequests ≥ 2`.
   - Toast "PASSED".
6. Screenshot.

**Backend cross-check**:
- `GET /payments/<id>` -> `attemptCount >= 2`.
- `GET http://localhost:3002/admin/stats` -> `actualCharges === 1`.
- `GET /metrics` -> `gateway_idempotent_replays_total` bertambah ≥ 1.

> **HERO**: Demo D adalah hero scenario. Bila FAIL di salah satu frontend, document root cause + plan follow-up di `e2e-results.md`.

---

### Demo E - server-directed retry timing (rate-limited Retry-After=10)

**Agent Browser steps**:
1. Navigate ke dashboard.
2. Reset gateway: PUT `always-success` + reset breaker bila OPEN.
3. Click **"Demo E: Server menentukan waktu retry"**.
4. Wait (max 60s - gateway mock `rate-limited` dengan `retryAfterSeconds=10`, attempt #1 429, wait 10s, attempt #2 success).
5. Assert:
   - Payment status: `succeeded` (asumsi gateway mock `rate-limited` 429 sebanyak N kali lalu 200 - verify TASK-03 spec).
   - Attempt timeline: attempt #1 `retryable_failure` httpStatus 429, attempt #2 `success`.
   - Delta `createdAt` antara attempt #1 dan #2 >= 10000ms (10s sesuai `Retry-After`).
   - Toast "PASSED".
6. Screenshot.

**Backend cross-check**:
- `SELECT created_at FROM payment_attempts WHERE payment_id='<id>' ORDER BY attempt_number;` - delta timestamp >= 10000ms.
- `GET /metrics` -> `payment_gateway_requests_total{outcome="failure",http_status="429"}` bertambah ≥ 1.

---

## Files to create

```text
/apps/payment-api/test/
├── jest-e2e.json
├── e2e/
│   ├── helpers/
│   │   ├── gateway.ts           # setGatewayMode(mode, params?) - PUT /admin/config di port 3002
│   │   ├── payments.ts          # createPayment(body), getPayment(id), waitForTerminal(id, timeoutMs=60000)
│   │   ├── metrics.ts           # getMetric(name) - GET /metrics + parse Prometheus text
│   │   ├── db.ts                # queryAttempts(paymentId), queryPayment(paymentId) - pg client direct
│   │   └── breaker.ts           # resetBreaker() - wait cooldown + 1 successful payment -> CLOSED
│   ├── payments.transient.e2e-spec.ts           # Scenario 1
│   ├── payments.permanent.e2e-spec.ts           # Scenario 2
│   ├── payments.circuit-breaker.e2e-spec.ts     # Scenario 3
│   ├── payments.idempotency.e2e-spec.ts         # Scenario 4 (HERO)
│   ├── payments.retry-after.e2e-spec.ts         # Scenario 5
│   ├── payments.durable-scheduler.e2e-spec.ts   # Scenario 6
│   └── payments.exhaustion.e2e-spec.ts          # Scenario 7

/docs/
├── e2e-results.md                               # Hasil eksekusi + evidence (tabel PASS/FAIL)
└── e2e-evidence/                                # Folder screenshot Agent Browser
    ├── demo-A-nextjs-<timestamp>.png
    ├── demo-A-vue-<timestamp>.png
    ├── demo-B-nextjs-<timestamp>.png
    ├── demo-B-vue-<timestamp>.png
    ├── demo-C-nextjs-<timestamp>.png
    ├── demo-C-vue-<timestamp>.png
    ├── demo-D-nextjs-<timestamp>.png
    ├── demo-D-vue-<timestamp>.png
    ├── demo-E-nextjs-<timestamp>.png
    └── demo-E-vue-<timestamp>.png
```

**Script files (Agent Browser - optional, bila skill butuh input script)**:
- `/scripts/e2e-ui-demo.mjs` - Node.js script yang memanggil `agent-browser` CLI untuk automasi 10 demo runs (5 demos × 2 frontends). Bila `agent-browser` skill sudah interactive, ini optional.

---

## Implementation steps

### Step 1 - `apps/payment-api/test/jest-e2e.json`

```json
{
  "preset": "ts-jest",
  "testEnvironment": "node",
  "rootDir": ".",
  "testRegex": [".*\\.e2e-spec\\.ts$"],
  "moduleFileExtensions": ["js", "json", "ts"],
  "transform": {
    "^.+\\.ts$": ["ts-jest", { "tsconfig": "tsconfig.spec.json" }]
  },
  "setupFilesAfterEnv": ["<rootDir>/test/e2e/helpers/setup.ts"],
  "testTimeout": 180000,
  "verbose": true,
  "collectCoverage": false
}
```

> **testTimeout 180000ms (3 menit)**: scenario 7 (exhaustion) butuh ~90s dengan `SCHEDULER_INTERVAL_MS=5000`. Default Jest 5s terlalu pendek.

> **tsconfig.spec.json**: extends `tsconfig.json` dengan `"types": ["jest", "node"]` + `"esModuleInterop": true`.

### Step 2 - `test/e2e/helpers/setup.ts`

```ts
import axios from 'axios';
import { Client } from 'pg';

const GATEWAY_URL = process.env.GATEWAY_MOCK_URL ?? 'http://localhost:3002';
const PAYMENT_API_URL = process.env.PAYMENT_API_URL ?? 'http://localhost:3001';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://retry_failure:retry_failure@localhost:5432/retry_failure';

export const gatewayClient = axios.create({ baseURL: GATEWAY_URL, timeout: 5000 });
export const paymentClient = axios.create({ baseURL: PAYMENT_API_URL, timeout: 5000 });

export const pgClient = new Client({ connectionString: DATABASE_URL });

beforeAll(async () => {
  await pgClient.connect();
  // Reset gateway ke always-success
  await gatewayClient.put('/admin/config', { mode: 'always-success' });
  // Cleanup DB: hapus payment_attempts + payments (urutan penting karena FK)
  await pgClient.query('DELETE FROM payment_attempts');
  await pgClient.query('DELETE FROM payments');
});

afterAll(async () => {
  // Reset gateway ke always-success
  await gatewayClient.put('/admin/config', { mode: 'always-success' });
  await pgClient.end();
});

beforeEach(async () => {
  await gatewayClient.put('/admin/config', { mode: 'always-success' });
});
```

> **PENTING - JANGAN reset DB di `beforeEach`**: scenario 6 + 7 butuh scheduler cycle lintas test boundary. Hanya reset di `beforeAll` + `afterAll`. Untuk isolation antar spec file, gunakan unique `orderId` prefix per scenario (`E2E-S1-`, `E2E-S2-`, dst) + cleanup per-spec `afterAll`.

### Step 3 - Helper utilities (`test/e2e/helpers/*.ts`)

#### `gateway.ts`
```ts
import { gatewayClient } from './setup';

export interface GatewayConfig {
  mode: 'always-success' | 'fail-first-n' | 'server-error' | 'always-timeout'
       | 'client-error' | 'random' | 'succeed-but-drop-response' | 'rate-limited';
  n?: number;
  probability?: number;
  retryAfterSeconds?: number;
  timeoutMs?: number;
}

export async function setGatewayMode(mode: GatewayConfig['mode'], params: Omit<GatewayConfig, 'mode'> = {}): Promise<void> {
  await gatewayClient.put('/admin/config', { mode, ...params });
}

export async function getGatewayStats(): Promise<any> {
  const { data } = await gatewayClient.get('/admin/stats');
  return data;
}

export async function resetGatewayToHealthy(): Promise<void> {
  await gatewayClient.put('/admin/config', { mode: 'always-success' });
}
```

#### `payments.ts`
```ts
import { paymentClient } from './setup';

export interface CreatePaymentInput {
  orderId: string;
  amount: number;
  currency: string;
}

export async function createPayment(body: CreatePaymentInput): Promise<{ payment: any; attempts: any[] }> {
  const { data } = await paymentClient.post('/payments', body);
  return data;
}

export async function getPayment(id: string): Promise<{ payment: any; attempts: any[] }> {
  const { data } = await paymentClient.get(`/payments/${id}`);
  return data;
}

export async function waitForTerminalStatus(id: string, timeoutMs = 60000): Promise<{ payment: any; attempts: any[] }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { payment, attempts } = await getPayment(id);
    if (['succeeded', 'failed'].includes(payment.status)) {
      return { payment, attempts };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Payment ${id} did not reach terminal status within ${timeoutMs}ms`);
}

export async function waitForScheduledForRetry(id: string, timeoutMs = 30000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { payment } = await getPayment(id);
    if (payment.status === 'scheduled_for_retry') return payment;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Payment ${id} did not reach scheduled_for_retry within ${timeoutMs}ms`);
}
```

#### `metrics.ts`
```ts
import { paymentClient } from './setup';

export async function getMetricsText(): Promise<string> {
  const { data } = await paymentClient.get('/metrics', { responseType: 'text', transformResponse: (d) => d });
  return data as string;
}

export interface MetricSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

export function parseMetrics(text: string): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    // Format: metric_name{label="val",...} value
    const match = line.match(/^([a-z_]+)(?:\{([^}]*)\})?\s+([\d.]+)/);
    if (!match) continue;
    const [, name, labelsStr, valueStr] = match;
    const labels: Record<string, string> = {};
    if (labelsStr) {
      for (const pair of labelsStr.split(',')) {
        const [k, v] = pair.split('=');
        if (k && v) labels[k.trim()] = v.replace(/"/g, '');
      }
    }
    samples.push({ name, labels, value: parseFloat(valueStr) });
  }
  return samples;
}

export async function getMetric(name: string, labelFilter: Record<string, string> = {}): Promise<number> {
  const text = await getMetricsText();
  const samples = parseMetrics(text).filter(
    (s) => s.name === name && Object.entries(labelFilter).every(([k, v]) => s.labels[k] === v)
  );
  return samples.reduce((sum, s) => sum + s.value, 0);
}
```

#### `db.ts`
```ts
import { pgClient } from './setup';

export async function queryAttempts(paymentId: string): Promise<any[]> {
  const { rows } = await pgClient.query(
    `SELECT attempt_number, outcome, http_status, trace_id, gateway_reference, replayed, duration_ms, created_at
     FROM payment_attempts WHERE payment_id = $1 ORDER BY attempt_number ASC`,
    [paymentId]
  );
  return rows;
}

export async function queryPayment(paymentId: string): Promise<any> {
  const { rows } = await pgClient.query(
    `SELECT id, order_id, amount, currency, status, attempt_count, total_retry_count, next_retry_at, failure_reason, created_at, updated_at
     FROM payments WHERE id = $1`,
    [paymentId]
  );
  return rows[0] ?? null;
}
```

#### `breaker.ts`
```ts
import { setGatewayMode, resetGatewayToHealthy } from './gateway';
import { createPayment, waitForTerminalStatus } from './payments';
import { getMetric } from './metrics';

export async function resetBreaker(): Promise<void> {
  // 1. Gateway ke always-success
  await resetGatewayToHealthy();
  // 2. Tunggu cooldown (BREAKER_COOLDOWN_MS=10000 + buffer 1000)
  await new Promise((r) => setTimeout(r, 11000));
  // 3. Trigger 1 successful payment untuk HALF_OPEN -> CLOSED
  const { payment } = await createPayment({ orderId: `BREAKER-RESET-${Date.now()}`, amount: 1000, currency: 'IDR' });
  await waitForTerminalStatus(payment.id, 30000);
  // 4. Verify CLOSED
  const state = await getMetric('circuit_breaker_state', { service: 'payment-gateway' });
  if (state !== 0) throw new Error(`Breaker not CLOSED after reset: state=${state}`);
}
```

### Step 4 - Spec file pattern (contoh: `payments.transient.e2e-spec.ts`)

```ts
import { setGatewayMode, getGatewayStats } from './helpers/gateway';
import { createPayment, waitForTerminalStatus } from './helpers/payments';
import { getMetric } from './helpers/metrics';
import { queryAttempts, queryPayment } from './helpers/db';

describe('Scenario 1 - Transient failure (fail-first-n=2)', () => {
  const orderId = `E2E-S1-${Date.now()}`;

  beforeAll(async () => {
    await setGatewayMode('fail-first-n', { n: 2 });
  });

  afterAll(async () => {
    await setGatewayMode('always-success');
  });

  it('should succeed after 3 attempts (2 retryable_failure + 1 success)', async () => {
    // Arrange
    const metricsBefore = {
      retryFail: await getMetric('retry_attempts_total', { outcome: 'failure' }),
      succeeded: await getMetric('payments_current_status', { status: 'succeeded' }),
    };

    // Act
    const { payment } = await createPayment({ orderId, amount: 50000, currency: 'IDR' });
    const { payment: finalPayment, attempts } = await waitForTerminalStatus(payment.id, 30000);

    // Assert - status
    expect(finalPayment.status).toBe('succeeded');
    expect(finalPayment.attemptCount).toBe(3);

    // Assert - attempts shape
    expect(attempts).toHaveLength(3);
    expect(attempts[0].outcome).toBe('retryable_failure');
    expect(attempts[0].httpStatus).toBe(500);
    expect(attempts[1].outcome).toBe('retryable_failure');
    expect(attempts[1].httpStatus).toBe(500);
    expect(attempts[2].outcome).toBe('success');
    expect(attempts[2].httpStatus).toBe(200);

    // Assert - trace ID konsisten lintas attempts
    const traceIds = new Set(attempts.map((a) => a.traceId));
    expect(traceIds.size).toBe(1);

    // Assert - DB rows
    const dbAttempts = await queryAttempts(payment.id);
    expect(dbAttempts).toHaveLength(3);

    // Assert - metrics delta
    const metricsAfter = {
      retryFail: await getMetric('retry_attempts_total', { outcome: 'failure' }),
      succeeded: await getMetric('payments_current_status', { status: 'succeeded' }),
    };
    expect(metricsAfter.retryFail - metricsBefore.retryFail).toBeGreaterThanOrEqual(2);
    expect(metricsAfter.succeeded - metricsBefore.succeeded).toBeGreaterThanOrEqual(1);
  }, 60000);
});
```

### Step 5 - Circuit breaker scenario detail (scenario 3)

Spec file `payments.circuit-breaker.e2e-spec.ts`:

```ts
import { setGatewayMode } from './helpers/gateway';
import { createPayment, waitForScheduledForRetry } from './helpers/payments';
import { getMetric } from './helpers/metrics';
import { resetBreaker } from './helpers/breaker';
import { queryAttempts } from './helpers/db';

describe('Scenario 3 - Circuit breaker (always-timeout, threshold=3)', () => {
  beforeAll(async () => {
    await resetBreaker(); // pastikan mulai dari CLOSED
    await setGatewayMode('always-timeout', { timeoutMs: 5000 });
  });

  afterAll(async () => {
    await resetBreaker(); // bersihkan state untuk scenario berikutnya
  });

  it('3 payments -> all scheduled_for_retry + breaker OPEN', async () => {
    const ids: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const { payment } = await createPayment({ orderId: `E2E-S3-${i}-${Date.now()}`, amount: 10000, currency: 'IDR' });
      const finalPayment = await waitForScheduledForRetry(payment.id, 30000);
      expect(finalPayment.status).toBe('scheduled_for_retry');
      expect(finalPayment.attemptCount).toBe(3); // 3 timeout dalam satu Cockatiel cycle
      ids.push(payment.id);
    }

    // Verifikasi breaker OPEN
    const breakerState = await getMetric('circuit_breaker_state', { service: 'payment-gateway' });
    expect(breakerState).toBe(1); // 0=CLOSED, 1=OPEN, 2=HALF_OPEN
  }, 120000);

  it('4th payment -> circuit_open in first attempt + scheduled_for_retry', async () => {
    const { payment } = await createPayment({ orderId: `E2E-S3-4-${Date.now()}`, amount: 10000, currency: 'IDR' });
    const finalPayment = await waitForScheduledForRetry(payment.id, 30000);
    expect(finalPayment.status).toBe('scheduled_for_retry');
    expect(finalPayment.attemptCount).toBe(1); // circuit_open di first attempt

    const attempts = await queryAttempts(payment.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('circuit_open');
    expect(attempts[0].httpStatus).toBe('breaker_open');
  }, 60000);
});
```

### Step 6 - Idempotency hero scenario detail (scenario 4)

Spec file `payments.idempotency.e2e-spec.ts`:

```ts
import { setGatewayMode, getGatewayStats } from './helpers/gateway';
import { createPayment, waitForTerminalStatus } from './helpers/payments';
import { getMetric } from './helpers/metrics';
import { queryAttempts } from './helpers/db';

describe('Scenario 4 - Anti double-charge hero (succeed-but-drop-response)', () => {
  const orderId = `E2E-S4-HERO-${Date.now()}`;

  beforeAll(async () => {
    await setGatewayMode('succeed-but-drop-response');
  });

  afterAll(async () => {
    await setGatewayMode('always-success');
  });

  it('HERO: calls>=2, actualCharges=1, replays>=1, status=succeeded', async () => {
    const replaysBefore = await getMetric('gateway_idempotent_replays_total');

    // Act
    const { payment } = await createPayment({ orderId, amount: 100000, currency: 'IDR' });
    const { payment: finalPayment, attempts } = await waitForTerminalStatus(payment.id, 60000);

    // Assert - payment
    expect(finalPayment.status).toBe('succeeded');
    expect(finalPayment.attemptCount).toBeGreaterThanOrEqual(2);

    // Assert - attempt #2 (replay)
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    const replayAttempt = attempts[1];
    expect(replayAttempt.gatewayReference).toBeTruthy();
    expect(replayAttempt.replayed).toBe(true);
    expect(replayAttempt.outcome).toBe('success');

    // Assert - gateway stats (hero)
    const stats = await getGatewayStats();
    expect(stats.actualCharges).toBe(1);
    expect(stats.totalRequests).toBeGreaterThanOrEqual(2);

    // Assert - metric
    const replaysAfter = await getMetric('gateway_idempotent_replays_total');
    expect(replaysAfter - replaysBefore).toBeGreaterThanOrEqual(1);

    // Assert - DB rows
    const dbAttempts = await queryAttempts(payment.id);
    expect(dbAttempts.length).toBeGreaterThanOrEqual(2);
    expect(dbAttempts[1].replayed).toBe(true);
  }, 90000);
});
```

### Step 7 - Durable scheduler scenario detail (scenario 6)

Spec file `payments.durable-scheduler.e2e-spec.ts`:

```ts
import { setGatewayMode } from './helpers/gateway';
import { createPayment, waitForScheduledForRetry, waitForTerminalStatus } from './helpers/payments';
import { queryAttempts, queryPayment } from './helpers/db';

describe('Scenario 6 - Durable scheduler retry (server-error -> always-success)', () => {
  const orderId = `E2E-S6-${Date.now()}`;
  const SCHEDULER_INTERVAL_MS = parseInt(process.env.SCHEDULER_INTERVAL_MS ?? '5000', 10);

  beforeAll(async () => {
    await setGatewayMode('server-error');
  });

  afterAll(async () => {
    await setGatewayMode('always-success');
  });

  it('payment scheduled_for_retry -> scheduler picks -> succeeded', async () => {
    // Phase 1: initial Cockatiel cycle exhaust -> scheduled_for_retry
    const { payment } = await createPayment({ orderId, amount: 60000, currency: 'IDR' });
    const scheduledPayment = await waitForScheduledForRetry(payment.id, 30000);
    expect(scheduledPayment.status).toBe('scheduled_for_retry');
    expect(scheduledPayment.totalRetryCount).toBe(0);
    expect(scheduledPayment.nextRetryAt).not.toBeNull();

    // Phase 2: switch gateway ke always-success
    await setGatewayMode('always-success');

    // Phase 3: tunggu scheduler cycle (interval + buffer)
    const bufferMs = 2000;
    await new Promise((r) => setTimeout(r, SCHEDULER_INTERVAL_MS + bufferMs));

    // Phase 4: polling sampai terminal
    const finalPayment = await waitForTerminalStatus(payment.id, 30000);
    expect(finalPayment.status).toBe('succeeded');
    expect(finalPayment.totalRetryCount).toBe(1);

    // Assert - trace ID berbeda antar cycle
    const attempts = await queryAttempts(payment.id);
    const traceIds = new Set(attempts.map((a) => a.trace_id));
    expect(traceIds.size).toBeGreaterThanOrEqual(2); // initial cycle + scheduler cycle
  }, 90000);
});
```

### Step 8 - Exhaustion scenario detail (scenario 7)

Spec file `payments.exhaustion.e2e-spec.ts`:

```ts
import { setGatewayMode } from './helpers/gateway';
import { createPayment, getPayment } from './helpers/payments';
import { queryAttempts, queryPayment } from './helpers/db';

describe('Scenario 7 - Total retry exhaustion (MAX_TOTAL_RETRIES=5)', () => {
  const orderId = `E2E-S7-${Date.now()}`;
  const MAX_TOTAL_RETRIES = parseInt(process.env.MAX_TOTAL_RETRIES ?? '5', 10);
  const SCHEDULER_INTERVAL_MS = parseInt(process.env.SCHEDULER_INTERVAL_MS ?? '5000', 10);

  beforeAll(async () => {
    await setGatewayMode('server-error');
  });

  afterAll(async () => {
    await setGatewayMode('always-success');
  });

  it('payment eventually failed after totalRetryCount >= MAX_TOTAL_RETRIES', async () => {
    const { payment } = await createPayment({ orderId, amount: 30000, currency: 'IDR' });

    // Poll sampai failed (max 120s - initial cycle + 5 scheduler cycles)
    const start = Date.now();
    let finalPayment: any;
    while (Date.now() - start < 120000) {
      const { payment: p } = await getPayment(payment.id);
      if (p.status === 'failed') { finalPayment = p; break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!finalPayment) throw new Error('Payment did not reach failed status within 120s');

    // Assert
    expect(finalPayment.status).toBe('failed');
    expect(finalPayment.totalRetryCount).toBeGreaterThanOrEqual(MAX_TOTAL_RETRIES);
    expect(finalPayment.failureReason).toMatch(/max_total_retries_exceeded|total_retry_exhausted/);
    expect(finalPayment.nextRetryAt).toBeNull();

    // Assert - scheduler tidak pick lagi setelah failed
    const attempts = await queryAttempts(payment.id);
    expect(attempts.length).toBeGreaterThanOrEqual(6); // minimum 1 per cycle × 6 cycles

    // Wait 1 more scheduler cycle dan verify no new attempt
    const attemptsBeforeWait = attempts.length;
    await new Promise((r) => setTimeout(r, SCHEDULER_INTERVAL_MS + 2000));
    const attemptsAfterWait = await queryAttempts(payment.id);
    expect(attemptsAfterWait.length).toBe(attemptsBeforeWait);
  }, 180000);
});
```

### Step 9 - Run E2E backend

```bash
cd /apps/payment-api && pnpm test:e2e
```

Tambahkan script di `apps/payment-api/package.json`:
```json
{
  "scripts": {
    "test:e2e": "jest --config test/jest-e2e.json --runInBand"
  }
}
```

> **`--runInBand`**: scenario berbagi state DB + gateway mock + circuit breaker - serial execution menghindari flakiness. Bila ingin parallel, isolate per spec file dengan instance payment-api terpisah (port beda) - di luar scope task ini.

### Step 10 - Agent Browser UI demo runs

Gunakan skill `agent-browser`:

1. **Install / verify skill**: bila `agent-browser` belum terdaftar, install via skill registry.
2. **Start services**: payment-api (3001), gateway-mock (3002), frontend-vue (5173), Next.js sandbox (3000). Verify via `curl`.
3. **Run demo A-E di Vue dashboard (5173)**:
   ```bash
   # Contoh pseudo-command (sesuaikan dengan agent-browser CLI actual)
   agent-browser navigate http://localhost:5173
   agent-browser click "button:has-text('Demo A')"
   agent-browser wait 30000
   agent-browser assert "text=Toast: PASSED"
   agent-browser screenshot /docs/e2e-evidence/demo-A-vue-$(date +%s).png
   ```
4. **Run demo A-E di Next.js sandbox (3000)**: repeat step 3 dengan URL `http://localhost:3000`.
5. **Cross-check backend**: untuk setiap demo run, `curl /payments?orderId=E2E-DEMO-{A-E}-*` dan verify DB rows / metrics sesuai expected.

### Step 11 - Document results in `docs/e2e-results.md`

Format template:
```markdown
# E2E Test Results - Cockatiel Retry/Failure

> Generated: <timestamp>
> Test env: <node version, postgres version, env vars>

## Backend E2E (Jest + supertest)

| # | Scenario | Spec file | Status | Duration | Evidence |
|---|---|---|---|---|---|
| 1 | Transient failure (fail-first-n=2) | payments.transient.e2e-spec.ts | PASS | 4.2s | [test output](./e2e-evidence/s1-output.txt) |
| 2 | Permanent failure (client-error) | payments.permanent.e2e-spec.ts | PASS | 0.8s | [test output](./e2e-evidence/s2-output.txt) |
| 3 | Circuit breaker (always-timeout) | payments.circuit-breaker.e2e-spec.ts | PASS | 45.3s | [test output](./e2e-evidence/s3-output.txt) |
| 4 | Anti double-charge hero (succeed-but-drop-response) | payments.idempotency.e2e-spec.ts | PASS | 8.1s | [test output](./e2e-evidence/s4-output.txt) |
| 5 | Retry-After (rate-limited) | payments.retry-after.e2e-spec.ts | PASS | 12.4s | [test output](./e2e-evidence/s5-output.txt) |
| 6 | Durable scheduler retry | payments.durable-scheduler.e2e-spec.ts | PASS | 18.7s | [test output](./e2e-evidence/s6-output.txt) |
| 7 | Total retry exhaustion | payments.exhaustion.e2e-spec.ts | PASS | 78.2s | [test output](./e2e-evidence/s7-output.txt) |

**Summary**: 7/7 PASS

## UI Demo (Agent Browser)

### Vue dashboard (port 5173)

| Demo | Scenario | Status | Screenshot |
|---|---|---|---|
| A | Retry saves transient failure | PASS | [demo-A-vue](./e2e-evidence/demo-A-vue-<ts>.png) |
| B | Don't retry permanent error | PASS | [demo-B-vue](./e2e-evidence/demo-B-vue-<ts>.png) |
| C | Circuit breaker protects | PASS | [demo-C-vue](./e2e-evidence/demo-C-vue-<ts>.png) |
| D | Idempotency prevents double charge (HERO) | PASS | [demo-D-vue](./e2e-evidence/demo-D-vue-<ts>.png) |
| E | Server-directed retry timing | PASS | [demo-E-vue](./e2e-evidence/demo-E-vue-<ts>.png) |

### Next.js sandbox (port 3000)

| Demo | Scenario | Status | Screenshot |
|---|---|---|---|
| A | Retry saves transient failure | PASS | [demo-A-nextjs](./e2e-evidence/demo-A-nextjs-<ts>.png) |
| B | Don't retry permanent error | PASS | [demo-B-nextjs](./e2e-evidence/demo-B-nextjs-<ts>.png) |
| C | Circuit breaker protects | PASS | [demo-C-nextjs](./e2e-evidence/demo-C-nextjs-<ts>.png) |
| D | Idempotency prevents double charge (HERO) | PASS | [demo-D-nextjs](./e2e-evidence/demo-D-nextjs-<ts>.png) |
| E | Server-directed retry timing | PASS | [demo-E-nextjs](./e2e-evidence/demo-E-nextjs-<ts>.png) |

**Summary**: 10/10 PASS

## Failures & follow-up

(none)

## Environment notes

- Node.js: v24.x
- PostgreSQL: 16.x
- SCHEDULER_INTERVAL_MS: 5000 (production-like)
- MAX_TOTAL_RETRIES: 5
- BREAKER_FAILURE_THRESHOLD: 3
```

---

## Acceptance criteria

- [ ] Semua 7 backend scenario **dieksekusi** (no `it.skip` / `xdescribe`). Bila ada yang gagal, tetap dokumentasikan dengan root cause + plan follow-up.
- [ ] `docs/e2e-results.md` berisi tabel dengan kolom: scenario, status (PASS/FAIL), evidence (link test output + DB query snapshot + metric snapshot), notes.
- [ ] **Scenario 4 (hero) PASS**: `actualCharges === 1` via `/admin/stats`, `replays >= 1` via metric `gateway_idempotent_replays_total`, `status === succeeded`, `attemptCount >= 2`, `attempts[1].replayed === true`.
- [ ] **Scenario 5 PASS**: `delay_before_next_ms >= retryAfterSeconds × 1000` (verified via delta `created_at` antar attempts, atau via metadata field bila ada).
- [ ] **Scenario 6 PASS**: scheduler memproses due payment end-to-end - `scheduled_for_retry -> processing -> succeeded`, `totalRetryCount === 1` setelah 1 scheduler cycle, trace ID berbeda antar cycle.
- [ ] **Scenario 7 PASS**: `totalRetryCount >= MAX_TOTAL_RETRIES (5)` sebelum `status === failed`, `failureReason` mengandung `max_total_retries_exceeded` (atau sinonim), `nextRetryAt === null`, scheduler tidak pick lagi setelah `failed`.
- [ ] UI demos A-E semua PASS di **kedua** frontend (Next.js sandbox port 3000 + Vue dashboard port 5173) - total 10 PASS.
- [ ] Bila ada FAIL: root cause note + plan follow-up (TASK-15 atau future task) terdokumentasi di `e2e-results.md`.
- [ ] Dev server (payment-api + gateway-mock + frontend-vue + Next.js sandbox) **tidak crash** selama run lengkap - verify via `ps aux | grep node` + log tail.
- [ ] **No console errors** di Agent Browser snapshot - verify via DevTools console log capture (Agent Browser skill output).
- [ ] `apps/payment-api/package.json` memuat script `test:e2e` yang berjalan via `pnpm test:e2e`.
- [ ] Semua screenshot Agent Browser tersimpan di `docs/e2e-evidence/` dengan naming convention `demo-{A-E}-{nextjs|vue}-<timestamp>.png`.
- [ ] Circuit breaker di-reset ke CLOSED di akhir run (verify via `curl -s http://localhost:3001/metrics | grep circuit_breaker_state` -> `circuit_breaker_state{service="payment-gateway"} 0`).
- [ ] Tidak ada orphaned `processing` payments di DB setelah run (verify via `SELECT count(*) FROM payments WHERE status='processing'` -> 0).

---

## Useful commands (run after completing this task)

### Pre-flight Check

> **WAJIB BACA**: sebelum menjalankan command di bawah, cek kondisi lingkungan Anda via [`SANDBOX_NOTES.md`](../../SANDBOX_NOTES.md) section 1 (Pre-flight Check).
>
> Ringkasan keyword:
> - `pnpm --version` ada -> KONDISI LOCAL. Tidak ada -> KONDISI SANDBOX -> jalankan `corepack enable pnpm && corepack prepare pnpm@9.12.0 --activate` dulu.
> - `docker --version` ada -> KONDISI LOCAL. Tidak ada -> KONDISI SANDBOX -> butuh external PostgreSQL atau skip DB-dependent commands.
> - `curl -s http://localhost:3000` sibuk -> KONDISI SANDBOX -> payment-api pakai PORT=3001, gateway-mock pakai PORT=3002. Bebas -> KONDISI LOCAL -> payment-api pakai PORT=3000, gateway-mock pakai PORT=3001.

Command di bawah ditulis dengan dua varian bila perlu (LOCAL / SANDBOX). Pilih salah satu sesuai kondisi.

> **Catatan KONDISI SANDBOX tanpa Docker**: skip E2E scenarios yang butuh DB persistence (1, 4, 6, 7). Pure API scenarios (2, 3, 5) tetap bisa jalan dengan gateway mock saja. Document caveat di TASK-15 `PRODUCTION_CAVEATS.md`.

---

```bash
# 0. Pre-requisite: enable pnpm via corepack (sekali saja, bila belum)
# KONDISI LOCAL (pnpm sudah terinstall, skip):
pnpm --version  # verify, expected 9.12.0

# KONDISI SANDBOX (pnpm belum terinstall):
corepack enable pnpm
corepack prepare pnpm@9.12.0 --activate
pnpm --version  # verify

# 1. Verify all services up (health endpoints) - port kondisional
#    Pola env var: API_PORT default 3000 LOCAL; set API_PORT=3001 untuk SANDBOX.
#                   GW_PORT default 3001 LOCAL; set GW_PORT=3002 untuk SANDBOX.
#    Set sekali di sesi shell:
#      export API_PORT=3000 GW_PORT=3001  (LOCAL)
#      export API_PORT=3001 GW_PORT=3002  (SANDBOX)
API_PORT="${API_PORT:-3000}"  # default 3000 LOCAL; set API_PORT=3001 untuk SANDBOX
GW_PORT="${GW_PORT:-3001}"    # default 3001 LOCAL; set GW_PORT=3002 untuk SANDBOX

curl -sf "http://localhost:${API_PORT}/api/health" | jq . || echo "payment-api DOWN"
# Expected: { "db": "ok", "gateway": "ok", "timestamp": "..." }

curl -sf "http://localhost:${GW_PORT}/health" | jq . || echo "gateway-mock DOWN"
# Expected: { "status": "ok" } (atau similar - tergantung gateway mock)

curl -s http://localhost:3000 -o /dev/null -w "%{http_code}\n" || echo "Next.js preview DOWN"
# Expected: 200 (Next.js sandbox home page) - di KONDISI SANDBOX ini otomatis jalan

curl -s http://localhost:5173 -o /dev/null -w "%{http_code}\n" || echo "Vue dashboard DOWN"
# Expected: 200 (Vue dashboard)

# 2. Verify no orphaned processing payments via psql
# KONDISI LOCAL (Docker tersedia, psql via docker exec):
docker compose -f /docker-compose.yml exec postgres \
  psql -U retry_failure -d retry_failure -c \
  "SELECT count(*) FROM payments WHERE status = 'processing';"
# Expected: 0

# KONDISI SANDBOX (Docker tidak tersedia, psql host atau Node script):
# Opsi A - psql host (bila psql tersedia & external PG connectable):
#   psql "postgresql://retry_failure:retry_failure@localhost:5432/retry_failure" \
#     -c "SELECT count(*) FROM payments WHERE status = 'processing';"
# Opsi B - Node script via ts-node (bila psql tidak ada):
#   cd /apps/payment-api && pnpm exec ts-node -e "
#     import { Client } from 'pg';
#     const c = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
#       user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME });
#     await c.connect();
#     const r = await c.query(\"SELECT count(*) FROM payments WHERE status = 'processing';\");
#     console.log(r.rows); await c.end();
#   "
# Opsi C - skip bila DB tidak connectable; pure API scenarios (2, 3, 5) tetap bisa jalan.

# 3. Verify circuit breaker CLOSED sebelum run - port kondisional via API_PORT
curl -s "http://localhost:${API_PORT}/metrics" | grep circuit_breaker_state
# Expected: circuit_breaker_state{service="payment-gateway"} 0

# 4. Reset gateway ke always-success (clean state) - port kondisional via GW_PORT
curl -s -X PUT "http://localhost:${GW_PORT}/admin/config" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"always-success"}' | jq .
# Expected: { "mode": "always-success" }

# 5. Run backend E2E (Jest + supertest) - sama kedua kondisi (asalkan DB accessible)
# KONDISI LOCAL (DB dari docker compose):
cd /apps/payment-api && pnpm test:e2e

# KONDISI SANDBOX (DB dari external instance atau skip):
# - Bila external PG connectable: command sama, pnpm test:e2e jalan.
# - Bila DB tidak connectable: skip pnpm test:e2e untuk scenarios yang butuh persistence (1, 4, 6, 7).
#   Pure API scenarios (2, 3, 5) tetap bisa jalan dengan gateway mock saja.
#   Document caveat di TASK-15 PRODUCTION_CAVEATS.md.
# Expected (bila jalan): 7 passed, 0 failed
# Output akan menampilkan:
#   Scenario 1 - Transient failure (fail-first-n=2)
#     ✓ should succeed after 3 attempts (XX ms)
#   Scenario 2 - Permanent failure (client-error)
#     ✓ should fail with invalid_card (XX ms)
#   ...
# Test Suites: 7 passed, 7 total
# Tests:       7+ passed, 7+ total

# 6. View e2e-results.md (auto-generated documentation) - sama kedua kondisi
cat /docs/e2e-results.md | head -n 60

# 7. Summary counts (PASS / FAIL) - sama kedua kondisi
PASS_COUNT=$(grep -c 'PASS' /docs/e2e-results.md)
FAIL_COUNT=$(grep -c 'FAIL' /docs/e2e-results.md)
echo "PASS: $PASS_COUNT, FAIL: $FAIL_COUNT"
# Expected: PASS: 17 (7 backend + 10 UI), FAIL: 0

# 8. Verify no orphaned processing payments AFTER run - dua varian (sama seperti step 2)
# KONDISI LOCAL:
docker compose -f /docker-compose.yml exec postgres \
  psql -U retry_failure -d retry_failure -c \
  "SELECT count(*) FROM payments WHERE status = 'processing';"
# Expected: 0

# KONDISI SANDBOX: gunakan psql host atau Node script (lihat step 2 varian SANDBOX).

# 9. Final metrics snapshot (post-run) - port kondisional via API_PORT
curl -s "http://localhost:${API_PORT}/metrics" | tee /tmp/metrics-final.txt | grep -E "payments_total|retry_attempts_total|circuit_breaker_state|gateway_idempotent_replays_total|payments_current_status"

# 10. Final dev log check - sama kedua kondisi (dev.log ada di parent root / apps)
tail -n 200 /tmp/payment-api.log 2>/dev/null | grep -iE "error|fatal|unhandled" | head -n 20
# Expected: kosong atau hanya warning non-fatal

tail -n 200 /tmp/gateway-mock.log 2>/dev/null | grep -iE "error|fatal|unhandled" | head -n 20
# Expected: kosong

tail -n 200 /tmp/frontend-vue.log 2>/dev/null | grep -iE "error|fatal" | head -n 20
# Expected: kosong

tail -n 200 /tmp/nextjs-sandbox.log 2>/dev/null | grep -iE "error|fatal" | head -n 20
# Expected: kosong

# 11. List screenshot evidence - sama kedua kondisi
ls -lah /docs/e2e-evidence/
# Expected: 10 file PNG (demo-A-nextjs, demo-A-vue, demo-B-nextjs, ..., demo-E-vue)

# 12. Optional: cleanup test data - dua varien
# KONDISI LOCAL (Docker):
# docker compose -f /docker-compose.yml exec postgres \
#   psql -U retry_failure -d retry_failure -c \
#   "DELETE FROM payment_attempts WHERE payment_id IN (SELECT id FROM payments WHERE order_id LIKE 'E2E-%');"
# docker compose -f /docker-compose.yml exec postgres \
#   psql -U retry_failure -d retry_failure -c \
#   "DELETE FROM payments WHERE order_id LIKE 'E2E-%' OR order_id LIKE 'BREAKER-RESET-%';"

# KONDISI SANDBOX (psql host atau Node script):
# psql "postgresql://retry_failure:retry_failure@localhost:5432/retry_failure" \
#   -c "DELETE FROM payment_attempts WHERE payment_id IN (SELECT id FROM payments WHERE order_id LIKE 'E2E-%');"
# psql "postgresql://retry_failure:retry_failure@localhost:5432/retry_failure" \
#   -c "DELETE FROM payments WHERE order_id LIKE 'E2E-%' OR order_id LIKE 'BREAKER-RESET-%';"
# Jangan dijalankan bila ingin inspect manual.

# 13. Run Agent Browser demos (manual / scripted) - sama kedua kondisi
#    Bila agent-browser CLI tersedia:
# agent-browser navigate http://localhost:5173
# agent-browser click "button:has-text('Demo A')"
# agent-browser wait 30000
# agent-browser screenshot /docs/e2e-evidence/demo-A-vue-$(date +%s).png
# ... ulangi untuk Demo B-E + Next.js sandbox (URL http://localhost:3000)
# Agent Browser adalah tool sandbox; di KONDISI LOCAL bisa buka browser manual.

# 14. Cross-check Demo D (hero) backend assertion setelah Agent Browser run - port kondisional
curl -s "http://localhost:${GW_PORT}/admin/stats" | jq '{ actualCharges, totalRequests, replayCount }'
# Expected: actualCharges < totalRequests (proof idempotency bekerja)

curl -s "http://localhost:${API_PORT}/metrics" | grep gateway_idempotent_replays_total
# Expected: gateway_idempotent_replays_total N (N >= 1 per demo D run)

# 15. Verify DoD plan section 22 (subset - yang di-test di TASK-14)
echo "DoD checklist verification (subset):"
echo "  [x] Payment API dapat membuat payment"
echo "  [x] Gateway mock dapat mengganti failure mode saat runtime"
echo "  [x] Cockatiel menangani request-level retry (scenario 1, 6)"
echo "  [x] Exponential backoff + jitter terkonfigurasi (config-driven, scenario 5 verify delay)"
echo "  [x] Circuit breaker dapat dibuktikan melalui E2E (scenario 3)"
echo "  [x] Permanent 4xx tidak di-retry (scenario 2)"
echo "  [x] Retry-After dihormati (scenario 5)"
echo "  [x] Exhausted execution cycle -> scheduled_for_retry (scenario 1, 6)"
echo "  [x] Scheduler memproses due payment (scenario 6)"
echo "  [x] MAX_TOTAL_RETRIES mengakhiri payment menjadi failed (scenario 7)"
echo "  [x] Idempotency menjamin actualCharges <= 1 (scenario 4 - HERO)"
echo "  [x] Audit attempt tersimpan di PostgreSQL (semua scenario)"
echo "  [x] Metrics tersedia di /metrics (semua scenario)"
echo "  [x] Frontend Vue+PrimeVue dapat menjalankan semua scenario A-E (UI Demo)"
echo "  [x] Frontend Next.js preview sandbox dapat menampilkan data dari payment-api (UI Demo)"
echo "  [ ] Grafana dashboard tersedia (TASK-11 - sample queries only, no provisioning)"
echo "  [ ] Trace payment dapat ditemukan di Jaeger (TASK-11 - simplified via AsyncLocalStorage, no OTel SDK)"
echo "  [ ] Docker full stack berjalan (TASK-15 - production concern)"
echo "  [ ] Dev mode berjalan tanpa Docker (verified in this task - all services running without Docker)"
echo "  [ ] Unit + E2E test lulus (this task - E2E; unit tests TASK-04..11)"
echo "  [ ] README menjelaskan failure scenarios + business impact (TASK-15)"
```

---

## Notes

### Use Agent Browser for UI scenarios (Demo A-E); pure API scenarios (1, 2, 5, 6, 7) cukup Jest + supertest + curl + DB inspection

- **Pure API scenarios** (1, 2, 5, 6, 7): Jest + supertest (atau axios langsung) + DB query via `pg` + curl ke `/metrics` sudah cukup. Tidak perlu UI.
- **UI scenarios (Demo A-E)**: WAJIB via Agent Browser - tujuan demo adalah membuktikan UI/UX flow berfungsi end-to-end (button click -> status badge update -> toast -> timeline render). Screenshot diperlukan sebagai evidence visual.
- **Hybrid** (scenario 4 hero): backend assertion via Jest (most stringent - `actualCharges=1` via `/admin/stats`), UI assertion via Agent Browser (toast "PASSED" + attempt timeline dengan `replayed: true` badge). Keduanya wajib PASS.

### Hero scenario 4 MUST pass - bila tidak, plan section 22 DoD fails

- Scenario 4 (anti double-charge) adalah **hero scenario** yang dipakai plan section 22 sebagai DoD item: *"Idempotency menjamin `actualCharges <= 1` walaupun `calls >= 2`"*.
- Bila scenario 4 FAIL: root cause analysis wajib dilakukan - kemungkinan:
  1. `Idempotency-Key` header tidak di-inject oleh `HttpPaymentGateway` (TASK-06 regression).
  2. Gateway mock tidak persist idempotency store (TASK-03 bug - store reset per request).
  3. `replayed` flag tidak di-set di response (TASK-03 contract bug).
  4. Cockatiel retry tidak terjadi (TASK-05 policy composition issue - timeout terlalu pendek sehingga retry tidak sempat trigger).
- Bila tidak bisa di-fix dalam task ini, document di `e2e-results.md` section "Failures & follow-up" + create follow-up task (TASK-14b atau patch ke TASK-03/05/06).

### Don't reset DB mid-run (scenario 6 + 7 need scheduler cycle)

- Scenario 6 (durable scheduler) butuh scheduler cycle lintas test boundary - bila DB di-reset di `beforeEach`, `scheduled_for_retry` payment hilang dan scheduler tidak punya apa-apa untuk dipick.
- Scenario 7 (exhaustion) butuh 5 scheduler cycles - DB reset akan memutus tracking.
- **Solution**: reset DB hanya di `beforeAll` (setup.ts) + `afterAll`. Isolation antar spec file via unique `orderId` prefix (`E2E-S1-`, `E2E-S2-`, dst).

### If breaker OPEN blocks scenario 1: reset with mode=always-success + wait cooldown + 1 successful payment -> HALF_OPEN -> CLOSED

- Setelah scenario 3 (circuit breaker) berjalan, breaker state kemungkinan OPEN.
- Scenario 1 (transient) butuh breaker CLOSED - bila OPEN, attempts pertama langsung `circuit_open` bukan `retryable_failure`, assertion fail.
- **Reset procedure** (helper `resetBreaker()`):
  1. PUT gateway `always-success`.
  2. `sleep(BREAKER_COOLDOWN_MS + 1000)` = 11s.
  3. POST 1 successful payment -> trigger HALF_OPEN -> success -> CLOSED.
  4. Verify via `getMetric('circuit_breaker_state', { service: 'payment-gateway' }) === 0`.
- **Panggil `resetBreaker()` di `beforeAll`** setiap spec yang butuh breaker CLOSED (scenario 1, 2, 4, 5, 6, 7). Scenario 3 sengaja TIDAK reset di `beforeAll` karena butuh start dari CLOSED lalu transitions ke OPEN.

### Trace ID verification - all attempts within one payment execution cycle share same trace_id

- TASK-11 meng-implement `AsyncLocalStorage` trace context - `traceId` di-generate per `executePayment()` call.
- Semua attempts dalam satu Cockatiel execution cycle (mis. scenario 1: 3 attempts) share `traceId` yang sama.
- Scheduler cycle baru = trace ID baru (scenario 6: initial cycle + scheduler cycle = 2 trace ID berbeda).
- Assertion di spec file: `const traceIds = new Set(attempts.map(a => a.trace_id)); expect(traceIds.size).toBe(1)` (scenario 1) atau `>= 2` (scenario 6).

### Optional: test env tuning untuk faster E2E

- Production env: `SCHEDULER_INTERVAL_MS=5000`, `MAX_TOTAL_RETRIES=5` -> scenario 6+7 total ~90s.
- Test env override (di `.env.test` atau `process.env` di `setup.ts`):
  ```
  SCHEDULER_INTERVAL_MS=1000
  MAX_TOTAL_RETRIES=3
  BREAKER_COOLDOWN_MS=3000
  RETRY_BASE_DELAY_MS=100
  RETRY_MAX_DELAY_MS=500
  ```
- Setelah override: scenario 6 ~15s, scenario 7 ~25s, scenario 3 ~15s (cooldown 3s lebih cepat). Total run ~70s.
- **CAVEAT**: production-like values memberikan signal yang lebih akurat - bila waktu cukup, jalankan dengan production values. Document di `e2e-results.md` section "Environment notes" apa values yang dipakai.

### After this task done - TASK-15 (documentation) can use e2e results as evidence in README

- TASK-15 akan mereferensikan `docs/e2e-results.md` sebagai bukti bahwa DoD tercapai.
- Screenshot di `docs/e2e-evidence/` dapat dipakai di README "Demonstration" section.
- Bila ada FAIL, TASK-15 akan document di "Known limitations" / "Caveats" section.
- TASK-15 juga akan menyertakan demo script yang merujuk ke URL frontend (Vue 5173 atau Next.js 3000) - bila user ingin reproduce manual.

### Agent Browser skill caveat

- Skill `agent-browser` adalah CLI tool - bila tidak tersedia di environment, alternatif:
  1. **Playwright manual script**: `npx playwright test` dengan browser Chromium headless.
  2. **Cypress**: install `cypress` sebagai devDependency, run via `cypress run --browser chromium`.
  3. **Manual screenshot**: buka browser manual, klik button Demo A-E, capture screenshot manual.
- Document pilihan di `e2e-results.md` section "Tooling notes".

### Counter intuition: `payments_current_status` adalah gauge delta

- `payments_current_status{status="succeeded"}` adalah Gauge - value saat ini = jumlah payment dengan status tsb di DB.
- Untuk assertion "bertambah 1", capture nilai `before` dan `after`:
  ```ts
  const before = await getMetric('payments_current_status', { status: 'succeeded' });
  // ... run scenario ...
  const after = await getMetric('payments_current_status', { status: 'succeeded' });
  expect(after - before).toBeGreaterThanOrEqual(1);
  ```
- Bila payment sebelumnya masih `processing` (orphaned), gauge bisa off - verifikasi `processing === 0` sebelum run.

### Test isolation - serial (`--runInBand`) bukan parallel

- Spec file berbagi: gateway mock state, DB state, circuit breaker singleton, scheduler interval.
- Parallel execution (default Jest) akan menyebabkan race condition - gateway mode berubah di tengah spec, breaker state unexpected.
- **`--runInBand`** = serial. Set di `package.json` `test:e2e` script.
- Bila ingin parallel di future: spawn multiple payment-api instances (port 3001, 3011, 3021, ...) dengan DB schema terpisah - di luar scope TASK-14.

---

## Actual Results (2026-09-18 sandbox run)

### Run summary

```
Test Suites: 7 passed, 7 total
Tests:       8 passed, 8 total
Time:        201.468s (3.3 minutes)
Command:     DB_TYPE=sqlite jest --config ./tests/e2e/jest-e2e.json --runInBand --forceExit
```

### Per-scenario results

| # | Scenario | Status | Duration | Key assertions |
|---|---|---|---|---|
| 1 | Transient failure | ✅ PASS | 3.0s | attemptCount=3, trace ID consistent, retry_attempts_total +2 |
| 2 | Permanent failure | ✅ PASS | <1s | attemptCount=1, outcome=permanent_failure, no retry |
| 3 | Circuit breaker | ✅ PASS | 64.8s | 3×4=12 attempts → breaker OPEN, 4th → circuit_open |
| 4 | Idempotency HERO | ✅ PASS | 14.0s | delta actualCharges=1, replays≥1, attempts[1].replayed=true |
| 5 | Retry-After | ✅ PASS | 21.2s | delta created_at ≥ 2500ms (DelegateBackoff honors Retry-After) |
| 6 | Durable scheduler | ✅ PASS | 25.2s | 2 trace IDs (T1≠T2), totalRetryCount=1 |
| 7 | Total exhaustion | ✅ PASS | 72.4s | 24 attempts (6 cycles × 4), totalRetryCount=5, nextRetryAt=null |

### Test isolation

`pnpm test:e2e` (run all sekaligus) PASS karena:
- `cleanDb()` di `beforeAll` setiap file → hapus payments + payment_attempts
- `resetGatewayState()` di `beforeAll` → POST /admin/reset (clear counters + idempotency store)
- `resetBreaker()` di `beforeAll` (S3-S7) → reset Cockatiel breaker singleton ke CLOSED
- `--forceExit` → prevent Jest hang dari scheduler background process

### Key differences from original spec

1. **API path**: `/payments` (bukan `/api/payments`) — NestJS tidak pakai global prefix
2. **Cockatiel v4 `maxAttempts=3`** = 4 total fn() calls per cycle (bukan 3)
3. **Test helpers**: TypeORM DataSource (bukan `pg.Client`) untuk driver-agnostic support
4. **S5 test strategy**: Poll DB untuk 2 attempts (bukan tunggu terminal status) untuk avoid circuit breaker interference
5. **S4 assertion**: Delta-based `actualChargesCount` (bukan absolut) karena gateway counter cumulative
6. **DelegateBackoff**: Custom backoff yang baca `Retry-After` header dari error context
7. **`ECONNABORTED`**: Axios timeout error code yang harus ditambahkan ke `RETRYABLE_NETWORK_CODES`

### Bug history

20 bug ditemukan + fixed selama TASK-14a/14b development. Lihat `docs/e2e-results.md` section "Bug History" untuk detail lengkap.
