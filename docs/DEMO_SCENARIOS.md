# Demo Scenarios — Cockatiel Retry/Failure

> **Tujuan**: Panduan demo A–E dengan **business impact** (bukan hanya curl), resep run via Vue dashboard atau curl, expected outcome, dan link ke `e2e-results.md` untuk bukti pengujian otomatis.
> **Plan reference**: [PLAN1 section 18](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) — Demonstration Scenarios
> **E2E results**: [e2e-results.md](./e2e-results.md) — sandbox (SQLite) + lokal (PostgreSQL)
> **Hero scenario**: **Demo D** — idempotency anti double-charge (paling penting dari semua demo)
> **Gateway modes**: Lihat [GATEWAY_MOCK_MODES.md](./GATEWAY_MOCK_MODES.md) untuk detail 8 failure modes
> **Database schema**: Lihat [DATABASE_ERD.md](./DATABASE_ERD.md) untuk field reference

---

## 📋 TL;DR — 5 Demo Scenarios

| Demo | Scenario | Gateway mode | Business impact | Hero? | E2E row |
|---|---|---|---|---|---|
| A | Retry menyelamatkan transient failure | `fail-first-n=2` | Auto-recovery tanpa intervensi manual | - | [row 1](./e2e-results.md) |
| B | Jangan retry permanent error | `client-error` | Hemat resource, jangan buang waktu retry error bisnis | - | [row 2](./e2e-results.md) |
| C | Circuit breaker melindungi gateway | `always-timeout` | Mencegah cascading failure saat gateway down | - | [row 3](./e2e-results.md) |
| **D** | **Idempotency mencegah double charge** | `succeed-but-drop-response` | **Anti double-charge — uang customer aman walau response hilang** | ⭐ HERO | [row 4](./e2e-results.md) |
| E | Server menentukan waktu retry | `rate-limited` | Hormati server, tidak overwhelm saat rate-limit aktif | - | [row 5](./e2e-results.md) |

Setiap demo dirancang untuk **membuktikan satu pilar resilience** yang berbeda. Bersama-sama, kelima demo membuktikan bahwa sistem mampu menangani gangguan gateway dengan aman tanpa kehilangan uang customer.

---

## 🚀 Cara Menjalankan Demo

### Prasyarat

```bash
# 1. Install dependencies (sekali saja)
pnpm install
pnpm build:resilience

# 2. Start gateway-mock (port 3002)
cd apps/payment-gateway-mock && PORT=3002 pnpm start:dev &
sleep 3

# 3. Start payment-api (port 3001) — pilih salah satu env
#    Sandbox (SQLite, tanpa Docker):
cd apps/payment-api && DB_TYPE=sqlite PORT=3001 pnpm start:dev &
#    Atau lokal (PostgreSQL via Docker):
# docker compose up -d postgres && pnpm db:migrate
# cd apps/payment-api && PORT=3001 pnpm start:dev &
sleep 5

# 4. (Opsional) Start Vue dashboard (port 5173)
cd apps/frontend-vue && pnpm dev &
sleep 5
```

### Opsi 1: Vue Dashboard (Recommended untuk demo user-facing)

> Buka browser ke **http://localhost:5173**, klik tab **"Demo Scenarios"**, lalu klik tombol **"Run Demo A/B/C/D/E"**.
>
> DemoScenarioRunner akan otomatis:
> 1. Set gateway mode via `PUT /admin/config`
> 2. Create payment via `POST /payments`
> 3. Fetch payment detail via `GET /payments/:id`
> 4. Fetch gateway stats before/after via `GET /admin/stats`
> 5. Jalankan assertion sederhana (status + attemptCount + delta stats)
> 6. Tampilkan evidence dialog: attempts table + stats delta + breaker state
> 7. Restore gateway ke `always-success` mode

Lihat detail runner di [`docs/tasks/TASK-13a-vue-improvements.md`](./tasks/TASK-13a-vue-improvements.md) sub-task TASK-13a-04 (Opsi C — Hybrid).

### Opsi 2: curl (Recommended untuk audit / CI / script)

Semua demo di bawah dapat dijalankan via curl. Cocok untuk demo headless atau untuk replay otomatis.

**Konvensi URL**:
- `http://localhost:3001` — payment-api
- `http://localhost:3002` — gateway-mock

**Helper: set gateway mode**:
```bash
set_mode() {
  curl -sX PUT http://localhost:3002/admin/config \
    -H "Content-Type: application/json" \
    -d "$1" | python3 -m json.tool
}

reset_gateway() {
  curl -sX POST http://localhost:3002/admin/reset
}
```

**Helper: get gateway stats**:
```bash
get_stats() {
  curl -s http://localhost:3002/admin/stats | python3 -m json.tool
}
```

**Helper: create payment + fetch detail**:
```bash
create_payment() {
  local order_id="$1"
  curl -sX POST http://localhost:3001/payments \
    -H "Content-Type: application/json" \
    -d "{\"orderId\":\"$order_id\",\"amount\":100,\"currency\":\"IDR\"}" \
    | python3 -m json.tool
}

get_payment_detail() {
  curl -s http://localhost:3001/payments/"$1" | python3 -m json.tool
}
```

---

## 🅰️ Demo A — Retry Menyelamatkan Transient Failure

> **Gateway mode**: `fail-first-n=2` (2 attempts pertama 500, ke-3 sukses 200)
> **E2E spec**: `payments.transient.e2e-spec.ts` (sandbox PASS, ~3s)

### Business Impact

Di production, gateway sesekali mengalami transient failure — restart pod, gc pause, koneksi pool habis sekejap, atau network blip. Tanpa retry otomatis, customer harus **manual retry via UI** (UX buruk) atau **customer service telepon** (operational cost).

Demo A membuktikan Cockatiel retry policy menyembuhkan transient failure **secara transparan**: customer tidak sadar ada 2 failure, dia hanya lihat payment sukses dalam ~1 detik. Tanpa idempotency + retry yang benar, ini akan menjadi tiket support atau worse, customer churn.

**Estimasi dampak bisnis** (angka ilustratif untuk konteks demo):
- Tanpa retry: ~5% payment drop on transient gateway failure → ~50 failed payments per 1000
- Dengan retry: <0.1% drop rate → 1 failure per 1000 (still recoverable via scheduler)

### Steps

#### Via Vue dashboard
1. Buka http://localhost:5173 → tab "Demo Scenarios"
2. Klik **"Run Demo A"**
3. Tunggu ~3 detik, evidence dialog muncul
4. Verify dialog: `status=succeeded`, `attempts=3`, gateway stats delta `requestCount=+3`, `actualChargesCount=+1`

#### Via curl
```bash
# Reset state (optional, untuk demo bersih)
reset_gateway

# Capture baseline stats
echo "=== Stats BEFORE ==="
get_stats

# Set mode: fail-first-n=2 (2 failures lalu sukses)
set_mode '{"mode":"fail-first-n","n":2}'

# Create payment — akan trigger 3 attempts Cockatiel
echo "=== Create payment ==="
PAYMENT_RESPONSE=$(curl -sX POST http://localhost:3001/payments \
  -H "Content-Type: application/json" \
  -d '{"orderId":"DEMO-A-001","amount":100,"currency":"IDR"}')
echo "$PAYMENT_RESPONSE" | python3 -m json.tool
PAYMENT_ID=$(echo "$PAYMENT_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['payment']['id'])")

# Fetch detail (attempts table)
echo "=== Payment detail (attempts) ==="
get_payment_detail "$PAYMENT_ID"

# Capture stats after
echo "=== Stats AFTER ==="
get_stats

# Restore gateway ke safe mode
set_mode '{"mode":"always-success"}'
```

### Expected Outcome

| Field (payments table) | Value | Source |
|---|---|---|
| `status` | `succeeded` | DB |
| `attempt_count` | `3` | DB (Note A: per-cycle counter) |
| `total_retry_count` | `0` | DB (Note B: scheduler-only, tidak di-increment di initial cycle) |
| `next_retry_at` | `NULL` | DB (sukses, tidak perlu retry) |
| `gateway_reference` | non-null (UUID) | DB |

| Field (payment_attempts table — 3 rows) | attempt #1 | attempt #2 | attempt #3 | Source |
|---|---|---|---|---|
| `attempt_number` | 1 | 2 | 3 | DB |
| `outcome` | `retryable_failure` | `retryable_failure` | `success` | DB |
| `http_status` | 500 | 500 | 200 | DB |
| `breaker_state` | `closed` | `closed` | `closed` | DB |
| `replayed` | false | false | false | DB |
| `trace_id` | T1 (UUIDv4 36-char atau OTel 32-char hex) | T1 | T1 | DB — konsisten per execution cycle |

| Gateway stats delta | Value | Notes |
|---|---|---|
| `requestCount` | +3 | 3 HTTP calls ke gateway |
| `successCount` | +1 | attempt #3 balas 200 |
| `failureCount` | +2 | attempt #1 + #2 balas 500 |
| `actualChargesCount` | +1 | hanya attempt sukses yang charge |
| `replayCount` | 0 | tidak ada replay (semua fresh request) |

### Metrics (Prometheus / /metrics)

```text
payment_gateway_requests_total{outcome="failure",http_status="500"}  +2
payment_gateway_requests_total{outcome="success",http_status="200"} +1
retry_attempts_total{outcome="failure",payment_status="processing"}  +2
retry_attempts_total{outcome="success",payment_status="succeeded"}   +1
payments_current_status{status="succeeded"}  +1
```

### E2E Evidence

- **Sandbox (SQLite)**: [e2e-results.md row 1](./e2e-results.md) — ✅ PASS, ~3s, 3 attempts (2×500 + 1×200), trace ID consistent
- **Spec file**: `apps/payment-api/tests/e2e/payments.transient.e2e-spec.ts`
- **Vue dashboard evidence**: [TASK-13a-vue-improvements.md](./tasks/TASK-13a-vue-improvements.md) Demo A — ✅ PASS, stats delta +3/+1/+2/+1

---

## 🅱️ Demo B — Jangan Retry Permanent Error

> **Gateway mode**: `client-error` (HTTP 400 + `error_code: invalid_card`)
> **E2E spec**: `payments.permanent.e2e-spec.ts` (sandbox PASS, <1s)

### Business Impact

Permanent errors (4xx selain 429/408) adalah **error bisnis**, bukan error infrastruktur. Contoh:
- `invalid_card` — kartu expired / nomor salah
- `insufficient_funds` — saldo tidak cukup
- `expired_card` — kartu kedaluwarsa

Meng-retry error seperti ini adalah **pemborosan resource** (HTTP call, gateway CPU, DB write, audit row) dan **tidak menghasilkan apa-apa** — error akan tetap sama di attempt ke-100. Lebih buruk, retry bisa memenuhi connection pool dan menunda payment lain yang mungkin masih bisa sukses.

Demo B membuktikan classifier kita mengenali permanent error (HTTP 4xx selain 429/408) dan **menghentikan retry segera** — hanya 1 attempt, 0 retry. `PaymentsService.isPermanentFailure()` (`payments.service.ts` line 234-241) adalah gatekeeper:

```typescript
if (http !== undefined && http >= 400 && http < 500 && http !== 429 && http !== 408) {
  return true; // permanent failure, jangan retry
}
```

**Estimasi dampak bisnis**:
- Tanpa classifier: setiap `invalid_card` consume 4 Cockatiel attempts → 4× gateway load + 4× DB writes
- Dengan classifier: 1 attempt saja → hemat 75% resource untuk error yang pasti gagal

### Steps

#### Via Vue dashboard
1. Tab "Demo Scenarios" → klik **"Run Demo B"**
2. Evidence dialog muncul dalam <1 detik
3. Verify: `status=failed`, `attempts=1`, gateway stats delta `requestCount=+1`, `failureCount=+1`

#### Via curl
```bash
reset_gateway
echo "=== Stats BEFORE ==="
get_stats

# Set mode: client-error (400 invalid_card)
set_mode '{"mode":"client-error"}'

echo "=== Create payment ==="
PAYMENT_RESPONSE=$(curl -sX POST http://localhost:3001/payments \
  -H "Content-Type: application/json" \
  -d '{"orderId":"DEMO-B-001","amount":100,"currency":"IDR"}')
echo "$PAYMENT_RESPONSE" | python3 -m json.tool
PAYMENT_ID=$(echo "$PAYMENT_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['payment']['id'])")

echo "=== Payment detail ==="
get_payment_detail "$PAYMENT_ID"

echo "=== Stats AFTER ==="
get_stats

set_mode '{"mode":"always-success"}'
```

### Expected Outcome

| Field (payments table) | Value | Source |
|---|---|---|
| `status` | `failed` | DB |
| `attempt_count` | `1` | DB (hanya 1 attempt, Cockatiel tidak retry permanent) |
| `total_retry_count` | `0` | DB (scheduler tidak pick, sudah failed) |
| `next_retry_at` | `NULL` | DB (permanent failure, tidak dijadwalkan retry) |
| `failure_reason` | `Card number invalid` (atau `invalid_card` sesuai bug fix #8) | DB |

| Field (payment_attempts table — 1 row) | Value | Source |
|---|---|---|
| `attempt_number` | 1 | DB |
| `outcome` | `permanent_failure` | DB |
| `http_status` | 400 | DB |
| `error_code` | `invalid_card` | DB |
| `breaker_state` | `closed` | DB |
| `duration_ms` | ~5-15ms (sangat cepat — tanpa retry) | DB |

| Gateway stats delta | Value | Notes |
|---|---|---|
| `requestCount` | +1 | 1 HTTP call |
| `successCount` | 0 | |
| `failureCount` | +1 | 400 dari gateway |
| `actualChargesCount` | 0 | tidak ada charge (permanent error) |
| `replayCount` | 0 | |

### Metrics

```text
payment_gateway_requests_total{outcome="failure",http_status="400"}  +1
retry_attempts_total{outcome="failure",payment_status="failed"}     +1
payments_current_status{status="failed"}                             +1
```

### E2E Evidence

- **Sandbox (SQLite)**: [e2e-results.md row 2](./e2e-results.md) — ✅ PASS, <1s, 1 attempt, no retry, invalid_card
- **Spec file**: `apps/payment-api/tests/e2e/payments.permanent.e2e-spec.ts`
- **Vue dashboard evidence**: [TASK-13a](./tasks/TASK-13a-vue-improvements.md) Demo B — ✅ PASS, 1 attempt (400 invalid_card), no retry

---

## 🅲 Demo C — Circuit Breaker Melindungi Gateway

> **Gateway mode**: `always-timeout` (delay 5000ms, axios timeout 1800ms → ECONNABORTED)
> **E2E spec**: `payments.circuit-breaker.e2e-spec.ts` (sandbox PASS, ~65s)

### Business Impact

Saat gateway benar-benar down (overloaded, crash, network partition), setiap payment yang masuk akan timeout. Tanpa circuit breaker, setiap request baru akan:
1. Hold connection 1.8 detik (axios timeout)
2. Cockatiel retry 4× → 7.2 detik total per payment
3. Connection pool payment-api habis
4. Cascade failure ke service lain yang bergantung payment-api
5. Customer melihat 502/504 dari API gateway

Circuit breaker Cockatiel (singleton per dependency, [PLAN1 section 5.2](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)) memutus jalur ke gateway setelah N consecutive failure (`BREAKER_FAILURE_THRESHOLD=3`). Request berikutnya **di-fast-fail** tanpa menyentuh gateway — hemat resource, cepatkan response customer, dan beri waktu gateway untuk recover.

Demo C membuktikan: setelah 3 payments × 4 attempts = **12 timeout**, breaker OPEN. Payment ke-4 langsung dapat `outcome=circuit_open` tanpa HTTP call ke gateway (`duration_ms=0`, karena fast-fail di `resilient-adapter.ts` line 105-110).

**Estimasi dampak bisnis**:
- Tanpa breaker: gateway overload bertahan lama → customer menunggu 7+ detik per payment → abandoned checkout
- Dengan breaker: payment ke-4+ langsung `scheduled_for_retry` → customer tidak blocking → retry nanti saat gateway recover

### Steps

#### Via Vue dashboard
1. Tab "Demo Scenarios" → klik **"Run Demo C"**
2. **Note**: demo ini lambat (~60-70 detik) karena harus trip breaker dulu (3×4 timeouts)
3. Evidence dialog menampilkan: breaker state (1=OPEN), 4th payment attempts table
4. Verify: `breaker_state=1` (OPEN), 4th payment `attemptCount=1`, last attempt `outcome=circuit_open`

#### Via curl
```bash
reset_gateway
echo "=== Stats BEFORE ==="
get_stats

# Set mode: always-timeout (delay 5000ms, axios timeout 1800ms)
set_mode '{"mode":"always-timeout","timeoutMs":5000}'

# Fire 3 payments untuk trip breaker (each: 4 timeouts Cockatiel)
for i in 0 1 2; do
  echo "=== Payment $i (3 timeout-batches) ==="
  curl -sX POST http://localhost:3001/payments \
    -H "Content-Type: application/json" \
    -d "{\"orderId\":\"DEMO-C-00$i\",\"amount\":100,\"currency\":\"IDR\"}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'status={d[\"payment\"][\"status\"]} attempts={d[\"payment\"][\"attemptCount\"]}')"
done

# Verify breaker OPEN via /metrics
echo "=== Breaker state ==="
curl -s http://localhost:3001/metrics | grep circuit_breaker_state
# Expected: circuit_breaker_state{service="payment-gateway"} 1

# 4th payment — should short-circuit (circuit_open outcome)
echo "=== 4th payment (after breaker OPEN) ==="
PAYMENT_RESPONSE=$(curl -sX POST http://localhost:3001/payments \
  -H "Content-Type: application/json" \
  -d '{"orderId":"DEMO-C-004","amount":100,"currency":"IDR"}')
echo "$PAYMENT_RESPONSE" | python3 -m json.tool
PAYMENT_ID=$(echo "$PAYMENT_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['payment']['id'])")

echo "=== 4th payment detail (should show circuit_open) ==="
get_payment_detail "$PAYMENT_ID"

echo "=== Stats AFTER ==="
get_stats

set_mode '{"mode":"always-success"}'
```

### Expected Outcome

**Payment 1-3 (each, sebagai `scheduled_for_retry`)**:

| Field | Value | Notes |
|---|---|---|
| `status` | `scheduled_for_retry` | DB — retry exhausted, dijadwalkan ulang |
| `attempt_count` | `4` | Cockatiel v4: 1 initial + 3 retries = 4 total fn() calls |
| `next_retry_at` | NOW + SCHEDULER_BASE_DELAY_MS (2000ms sandbox / 30000ms prod) | DB — Note C |
| `failure_reason` | `timeout` atau `ECONNABORTED` | DB |

**Payment 4 (setelah breaker OPEN)**:

| Field | Value | Notes |
|---|---|---|
| `status` | `scheduled_for_retry` | DB — juga dijadwalkan retry |
| `attempt_count` | **1** | DB — fast-fail, hanya 1 audit row |
| `next_retry_at` | NOW + SCHEDULER_BASE_DELAY_MS | DB |
| `failure_reason` | `circuit_open` | DB |

**Payment 4 — payment_attempts row**:

| Field | Value | Source |
|---|---|---|
| `attempt_number` | 1 | DB |
| `outcome` | **`circuit_open`** | DB — ini bukti breaker bekerja |
| `http_status` | `NULL` | DB — tidak ada HTTP call |
| `error_code` | `circuit_open` | DB |
| `breaker_state` | `open` | DB |
| `duration_ms` | **`0`** | DB — fast-fail, no HTTP call (lihat `resilient-adapter.ts` line 105-110) |
| `trace_id` | T4 (UUIDv4) | DB |

**Gateway stats delta**:

| Metric | Value | Notes |
|---|---|---|
| `requestCount` | +12 | 3 payments × 4 attempts (4th payment = 0 HTTP call!) |
| `successCount` | 0 | semua timeout |
| `failureCount` | +12 | semua 503 atau ECONNABORTED |
| `actualChargesCount` | 0 | tidak ada charge (gateway down) |
| `replayCount` | 0 | |

**Metrics (kunci)**:

```text
circuit_breaker_state{service="payment-gateway"} 1   # 0=CLOSED, 1=OPEN, 2=HALF_OPEN
payment_gateway_requests_total{outcome="failure",http_status="timeout"} +12
retry_attempts_total{outcome="failure",payment_status="processing"}  +12
retry_attempts_total{outcome="failure",payment_status="scheduled_for_retry"} +4
payments_current_status{status="scheduled_for_retry"} +4
```

### E2E Evidence

- **Sandbox (SQLite)**: [e2e-results.md row 3](./e2e-results.md) — ✅ PASS, ~65s, 3×4=12 timeouts → breaker OPEN, 4th → circuit_open
- **Spec file**: `apps/payment-api/tests/e2e/payments.circuit-breaker.e2e-spec.ts`
- **Vue dashboard evidence**: [TASK-13a](./tasks/TASK-13a-vue-improvements.md) Demo C — ✅ PASS, 3×4 timeouts → breaker OPEN, 4th payment circuit_open

---

## 🅳 Demo D — Idempotency Mencegah Double Charge ⭐ HERO

> **Gateway mode**: `succeed-but-drop-response` (charge sukses, response drop setelah 10s)
> **E2E spec**: `payments.idempotency.e2e-spec.ts` (sandbox PASS, ~14s)
> **HERO karena**: ini alasan **utama** kenapa retry payment butuh idempotency. Tanpa idempotency, retry = double charge = customer complain.

### Business Impact

Skenario nyata yang dimodelkan:
1. Customer klik "Pay" → payment-api kirim `POST /v1/charges` ke gateway
2. Gateway **sukses charge** kartu (uang masuk)
3. Gateway response (200 OK) **hilang di network** — TCP reset, load balancer timeout, dll
4. payment-api tidak dapat response → anggap failure → **retry**
5. Tanpa idempotency: gateway charge **lagi** → customer dikenai 2× seharga payment

**Idempotency key** (`Idempotency-Key: <payment.id>` header) menyelesaikan masalah ini:
- Setiap charge ke gateway disimpan di **idempotency store** gateway mock (in-memory, [PLAN1 section 9](./PLAN1_Cockatiel_Retry_Failure_Scenario.md))
- Attempt ke-2 dengan key yang sama → gateway **replay** hasil sukses yang sudah disimpan (`replayed=true`), **tidak charge ulang**
- Payment invariant: `actualCharges ≤ 1` walau `HTTP calls ≥ 2` ([DATABASE_ERD.md](./DATABASE_ERD.md) section "Idempotency Invariant")

Demo D adalah hero karena:
- **Business critical**: uang customer aman walau network tidak reliable
- **Counter-intuitive**: "retry" biasanya = "do it again", tapi idempotency membuat "do it again" = "give me same result"
- **Production guarantee**: semua payment gateway real (Stripe, Adyen, Midtrans) memerlukan idempotency key untuk exactly-once semantics

### Steps

#### Via Vue dashboard
1. Tab "Demo Scenarios" → klik **"Run Demo D"** (highlighted dengan ⭐ icon)
2. Tunggu ~15 detik (1st attempt timeout 1.8s + 2nd attempt replay cepat)
3. Evidence dialog menampilkan: 2 attempts, `replayed=true` di attempt ke-2, gateway stats delta `actualChargesCount=+1`
4. **Kritikal assertion**: `actualCharges delta === 1` (NO DOUBLE CHARGE)
5. Kalau `actualCharges delta > 1` → assertion FAIL dengan warning "DOUBLE CHARGE DETECTED!"

#### Via curl
```bash
reset_gateway
echo "=== Stats BEFORE (baseline actualChargesCount) ==="
get_stats

# Set mode: succeed-but-drop-response
# Gateway akan charge + simpan idempotency store, lalu hang 10s (axios timeout 1.8s)
set_mode '{"mode":"succeed-but-drop-response"}'

# Create payment — Cockatiel akan timeout attempt 1, retry attempt 2 (replay)
echo "=== Create payment ==="
PAYMENT_RESPONSE=$(curl -sX POST http://localhost:3001/payments \
  -H "Content-Type: application/json" \
  -d '{"orderId":"DEMO-D-001","amount":100,"currency":"IDR"}')
echo "$PAYMENT_RESPONSE" | python3 -m json.tool
PAYMENT_ID=$(echo "$PAYMENT_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['payment']['id'])")

echo "=== Payment detail (verify 2 attempts, replayed=true pada attempt 2) ==="
get_payment_detail "$PAYMENT_ID"

echo "=== Stats AFTER (verify actualChargesCount delta === 1) ==="
get_stats

echo "=== Verify idempotency store size ==="
curl -s http://localhost:3002/admin/stats | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'idempotencyStoreSize={d[\"idempotencyStoreSize\"]}')"

set_mode '{"mode":"always-success"}'
```

### Expected Outcome

| Field (payments table) | Value | Source |
|---|---|---|
| `status` | `succeeded` | DB |
| `attempt_count` | `2` | DB — attempt 1 (timeout), attempt 2 (replay → sukses) |
| `total_retry_count` | `0` | DB (initial cycle sukses) |
| `gateway_reference` | non-null (UUID yang sama di kedua attempt) | DB |

| Field (payment_attempts table — 2 rows) | attempt #1 | attempt #2 | Source |
|---|---|---|---|
| `attempt_number` | 1 | 2 | DB |
| `outcome` | `timeout` | `success` | DB |
| `http_status` | `NULL` (timeout) | 200 | DB |
| `error_code` | `ECONNABORTED` (atau `ETIMEDOUT`) | `NULL` | DB |
| `replayed` | **`false`** | **`true`** ⭐ | DB — bukti replay |
| `breaker_state` | `closed` | `closed` | DB |
| `duration_ms` | ~1800ms (axios timeout) | ~5-20ms (replay cepat) | DB |
| `trace_id` | T1 (konsisten per cycle) | T1 | DB |
| `idempotency_key` | `<payment.id>` | `<payment.id>` (sama) | DB |

**Idempotency invariant** ([DATABASE_ERD.md section 2](./DATABASE_ERD.md)):

```sql
SELECT
  COUNT(pa.*) AS http_calls,           -- expected: 2
  COUNT(pa.*) FILTER (
    WHERE pa.replayed = false
      AND pa.outcome = 'success'
  ) AS actual_charges                    -- expected: ≤ 1 (HERO assertion)
FROM payments p
JOIN payment_attempts pa ON pa.payment_id = p.id
WHERE p.order_id = 'DEMO-D-001';
```

**Gateway stats delta** (kunci assertion HERO):

| Metric | Value | Notes |
|---|---|---|
| `requestCount` | +2 | 2 HTTP calls |
| `successCount` | +1 | hanya attempt 2 yang balas 200 (attempt 1 timeout) |
| `failureCount` | +1 | attempt 1 dianggap failure (axios timeout) |
| **`actualChargesCount`** | **`+1`** ⭐ | **HERO — hanya 1 charge, walau 2 calls** |
| `replayCount` | +1 | attempt 2 detected as replay |
| `idempotencyStoreSize` | +1 | 1 entry di idempotency store |

> ⭐ **Assertion HERO**: `actualCharges delta === 1` → **NO DOUBLE CHARGE**.
> Kalau `actualCharges delta > 1` → demo FAIL dengan warning "DOUBLE CHARGE DETECTED!".

### Metrics

```text
payment_gateway_requests_total{outcome="failure",http_status="timeout"} +1   # attempt 1
payment_gateway_requests_total{outcome="success",http_status="200"}   +1   # attempt 2 (replay)
gateway_idempotent_replays_total                                      +1   # replay detected
retry_attempts_total{outcome="failure",payment_status="processing"}   +1
retry_attempts_total{outcome="success",payment_status="succeeded"}    +1
payments_current_status{status="succeeded"}                           +1
```

### Verifikasi Idempotency Store Gateway Mock

Setelah Demo D, gateway mock harus punya 1 entry di idempotency store (keyed by payment.id):

```bash
curl -s http://localhost:3002/admin/stats | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'idempotencyStoreSize = {d[\"idempotencyStoreSize\"]}')
print(f'actualChargesCount   = {d[\"actualChargesCount\"]}')
print(f'replayCount          = {d[\"replayCount\"]}')
print()
print('Invariant: actualCharges ≤ 1 per payment')
print('Invariant: replayCount === httpCalls - actualCharges (untuk drop-response mode)')
"
```

### E2E Evidence

- **Sandbox (SQLite)**: [e2e-results.md row 4](./e2e-results.md) — ✅ PASS, ~14s, delta actualCharges=1, requestCount≥2, replays≥1, attempts[1].replayed=true
- **Spec file**: `apps/payment-api/tests/e2e/payments.idempotency.e2e-spec.ts`
- **Vue dashboard evidence**: [TASK-13a](./tasks/TASK-13a-vue-improvements.md) Demo D — ✅ PASS, 2 attempts (timeout + replay), actualCharges delta=1 (NO DOUBLE CHARGE)

### Production Connection

Idempotency key di production:
- **Stripe**: `Idempotency-Key` header ([docs](https://stripe.com/docs/api/idempotent_requests))
- **Adyen**: `merchantAccount` + `reference` + idempotency logic di backend
- **Midtrans**: `order_id` berfungsi sebagai natural idempotency key
- Internal store biasanya Redis (TTL 24-72 jam), bukan in-memory seperti gateway mock

Lihat [PRODUCTION_CAVEATS.md section B.2](./PRODUCTION_CAVEATS.md) untuk perbedaan sandbox vs production idempotency store.

---

## 🅴 Demo E — Server Menentukan Waktu Retry

> **Gateway mode**: `rate-limited` (HTTP 429 + `Retry-After: 3` header)
> **E2E spec**: `payments.retry-after.e2e-spec.ts` (sandbox PASS, ~21s)

### Business Impact

Saat gateway overloaded, ia balas `429 Too Many Requests` dengan header `Retry-After: N` (detik). Ini sinyal eksplisit dari server: **"tunggu N detik sebelum request lagi"**.

Tanpa Retry-After handling:
- Client retry sesuai exponential backoff sendiri (misal 500ms, 1s, 2s)
- Gateway masih overloaded → semua retry gagal → cascade failure tetap terjadi
- Client tidak hormat ke rate limit gateway → bisa kena IP ban atau HTTP 403

Dengan DelegateBackoff custom ([`policies.ts`](../apps/payment-api/src/modules/observability/policies.ts) atau [`packages/resilience/src/policies.ts`](../packages/resilience/src/policies.ts)):
- Cockatiel ambil `Math.max(exponential, retryAfterMs)` — selalu hormati server
- Backoff minimal = `Retry-After` walau exponential Cockatiel lebih pendek
- `delay_before_next_ms` di audit row = 3000 (bukti persist ke DB)

Demo E membuktikan: 4 attempts Cockatiel, masing-masing delay 3000ms (bukan exponential 500/1000/2000). Customer lihat payment `scheduled_for_retry` (bukan `failed`) dengan `next_retry_at = NOW + 3000ms` (server-directed).

**Estimasi dampak bisnis**:
- Tanpa Retry-After: gateway rate-limit × retry exponential = storm → IP banned
- Dengan Retry-After: hormati server → gateway recover → customer payment sukses di cycle scheduler berikutnya

### Steps

#### Via Vue dashboard
1. Tab "Demo Scenarios" → klik **"Run Demo E"**
2. Tunggu ~21 detik (4 attempts × ~3s delay + overhead)
3. Evidence dialog menampilkan: 4 attempts, `delayBeforeNextMs=3000` di setiap row, `httpStatus=429`
4. Verify: `status=scheduled_for_retry`, `attempts[0].delayBeforeNextMs >= 3000`

#### Via curl
```bash
reset_gateway
echo "=== Stats BEFORE ==="
get_stats

# Set mode: rate-limited dengan Retry-After 3 detik
set_mode '{"mode":"rate-limited","retryAfterSeconds":3}'

# Create payment — Cockatiel akan 4 attempts dengan delay 3000ms masing-masing
echo "=== Create payment (akan ~12+ detik) ==="
PAYMENT_RESPONSE=$(curl -sX POST http://localhost:3001/payments \
  -H "Content-Type: application/json" \
  -d '{"orderId":"DEMO-E-001","amount":100,"currency":"IDR"}')
echo "$PAYMENT_RESPONSE" | python3 -m json.tool
PAYMENT_ID=$(echo "$PAYMENT_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['payment']['id'])")

echo "=== Payment detail (verify 4 attempts, delay_before_next_ms=3000) ==="
get_payment_detail "$PAYMENT_ID"

echo "=== Stats AFTER ==="
get_stats

set_mode '{"mode":"always-success"}'
```

### Expected Outcome

| Field (payments table) | Value | Source |
|---|---|---|
| `status` | `scheduled_for_retry` | DB — retry exhausted, akan di-pick scheduler |
| `attempt_count` | `4` | Cockatiel 4 total calls (1 + 3 retries) |
| `total_retry_count` | `0` | DB (initial cycle, scheduler belum pick) |
| `next_retry_at` | NOW + 3000ms (dari Retry-After header, lihat `payments.service.ts` line 186: `delayMs = result.retryAfterMs ?? this.schedulerBaseDelayMs`) | DB |

| Field (payment_attempts table — 4 rows, semua sama) | Value | Source |
|---|---|---|
| `attempt_number` | 1 / 2 / 3 / 4 | DB |
| `outcome` | `retryable_failure` (4 semua) | DB |
| `http_status` | `429` | DB |
| `error_code` | `rate_limited` (atau `null`) | DB |
| `delay_before_next_ms` | **`3000`** ⭐ | DB — bukti Retry-After dihormati (lihat `DATABASE_ERD.md` Note E) |
| `breaker_state` | `closed` | DB (429 tidak dianggap failure untuk breaker threshold — lihat GATEWAY_MOCK_MODES) |
| `duration_ms` | ~5-15ms (response cepat, delay di Cockatiel) | DB |

> ⭐ **Assertion kunci**: `attempts[0].delay_before_next_ms >= 3000`.
> Kalau `< 3000` → Retry-After tidak dihormati (warning di Vue dashboard).

**Gateway stats delta**:

| Metric | Value | Notes |
|---|---|---|
| `requestCount` | +4 | 4 HTTP calls |
| `successCount` | 0 | semua 429 |
| `failureCount` | +4 | 429 dianggap failure untuk counter |
| `actualChargesCount` | 0 | tidak ada charge |
| `replayCount` | 0 | |

**Metrics**:

```text
payment_gateway_requests_total{outcome="failure",http_status="429"} +4
retry_attempts_total{outcome="failure",payment_status="processing"} +4
payments_current_status{status="scheduled_for_retry"} +1
```

### Catatan Teknis: DelegateBackoff

Cockatiel v4 `ExponentialBackoff` tidak baca `Retry-After` header (default behavior). Karena itu, kami pakai `DelegateBackoff` custom function di [`packages/resilience/src/policies.ts`](../packages/resilience/src/policies.ts):

```typescript
const customBackoff = new DelegateBackoff((context, state) => {
  const baseExponential = state?.exponential ?? config.retryBaseDelayMs;
  const nextExponential = Math.min(baseExponential * 2, config.retryMaxDelayMs);

  let retryAfterMs = extractRetryAfterMs(context.result);

  const delay = retryAfterMs !== undefined
    ? Math.max(nextExponential, retryAfterMs)  // ← honor Retry-After, ambil MAX
    : nextExponential;                          // ← exponential default

  return { delay, state: { exponential: nextExponential } };
});
```

- `Math.max(exponential, retryAfterMs)` — selalu hormati server (ambil nilai lebih besar)
- Cockatiel internal delay (exponential 500/1000/2000/4000) tidak persist ke DB — hanya dipakai untuk `setTimeout` antar attempt
- `delay_before_next_ms` di DB = nilai dari gateway `Retry-After` header saja (lihat [DATABASE_ERD.md Note E](./DATABASE_ERD.md))

### E2E Evidence

- **Sandbox (SQLite)**: [e2e-results.md row 5](./e2e-results.md) — ✅ PASS, ~21s, delta created_at ≥ 2500ms (Retry-After 3000ms honored via DelegateBackoff)
- **Spec file**: `apps/payment-api/tests/e2e/payments.retry-after.e2e-spec.ts`
- **Vue dashboard evidence**: [TASK-13a](./tasks/TASK-13a-vue-improvements.md) Demo E — ✅ PASS, 4 attempts (429), delayBeforeNextMs=3000ms

---

## 🎯 Demo Recap — 5 Pillar Resilience yang Dibuktikan

| Demo | Pillar Resilience | Business value yang dibuktikan |
|---|---|---|
| **A** | **Retry dengan exponential backoff** | Auto-recovery dari transient failure tanpa intervensi manual |
| **B** | **Error classification** | Hemat resource — jangan retry error bisnis (4xx) yang pasti gagal |
| **C** | **Circuit breaker** | Mencegah cascading failure — fast-fail saat dependency down |
| **D** ⭐ | **Idempotency** | **Anti double-charge — uang customer aman walau response hilang di network** |
| **E** | **Retry-After server-directed** | Hormati rate-limit server — tidak overwhelm saat gateway overloaded |

Bersama-sama, kelima demo membuktikan sistem payment **resilient secara end-to-end**:

1. **Availability** — retry + circuit breaker menjaga service tetap hidup saat dependency flaky
2. **Integrity** — idempotency menjamin tidak ada double-charge walau network unreliable
3. **Resource efficiency** — classifier menghentikan retry yang sia-sia (permanent error)
4. **Server respect** — Retry-After membuat client tidak menambah beban gateway saat overloaded
5. **Observability** — setiap attempt tercatat di `payment_attempts` table + Prometheus metrics + Jaeger trace (jika IS_OTEL=true)

### Cross-link

- **E2E test results lengkap**: [e2e-results.md](./e2e-results.md) — 7 scenarios (termasuk scheduler retry + exhaustion yang tidak di-demo interaktif)
- **Gateway mock 8 failure modes**: [GATEWAY_MOCK_MODES.md](./GATEWAY_MOCK_MODES.md)
- **Database schema + idempotency invariant**: [DATABASE_ERD.md](./DATABASE_ERD.md)
- **Vue dashboard DemoScenarioRunner spec**: [TASK-13a-vue-improvements.md](./tasks/TASK-13a-vue-improvements.md) sub-task TASK-13a-04
- **Production caveats**: [PRODUCTION_CAVEATS.md](./PRODUCTION_CAVEATS.md) — apa yang TIDAK ada di demo ini
- **Technical debt yang terkait**: [TECHNICAL_DEBT.md](./TECHNICAL_DEBT.md) — issue #1-#8 (observability + dead code)
- **Plan asli**: [PLAN1 section 18 — Demonstration Scenarios](./PLAN1_Cockatiel_Retry_Failure_Scenario.md)

---

## 📚 Referensi Implementasi

| Komponen | File source | Plan reference |
|---|---|---|
| Payment orchestration + state machine | `apps/payment-api/src/modules/payments/payments.service.ts` | [PLAN1 §10](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) |
| Cockatiel policy (retry + breaker + timeout) | `packages/resilience/src/policies.ts` | [PLAN1 §5](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) |
| HTTP adapter (axios + Retry-After parse) | `apps/payment-api/src/modules/gateway/http-adapter.ts` | [PLAN1 §8](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) |
| Resilient adapter (Cockatiel wrap + onAttempt) | `apps/payment-api/src/modules/gateway/resilient-adapter.ts` | [PLAN1 §5.2](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) |
| Error classifier | `apps/payment-api/src/modules/gateway/classifier.ts` | [PLAN1 §4 (error classification)](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) |
| Audit service + payment_attempts table | `apps/payment-api/src/modules/payments/audit/` | [PLAN1 §11.2](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) |
| Retry scheduler | `apps/payment-api/src/modules/retry-scheduler/retry-scheduler.service.ts` | [PLAN1 §12](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) |
| Gateway mock (8 modes + idempotency store) | `apps/payment-gateway-mock/src/` | [PLAN1 §8](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) |
| Vue dashboard DemoScenarioRunner | `apps/frontend-vue/src/components/DemoScenarioRunner.vue` | [PLAN1 §17.2](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) |
| Metrics (7 Prometheus metrics) | `apps/payment-api/src/modules/observability/metrics.service.ts` | [PLAN1 §13.2](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) |

---

## 📝 Update History

| Tanggal | Perubahan | Alasan |
|---|---|---|
| 2026-09-23 | Initial creation | TASK-15 step 2 — business docs untuk stakeholder handover |
