# Gateway Mock Failure Modes — Detailed Reference

> **Source of truth**: [`apps/payment-gateway-mock/src/shared/modes/mode-handler.ts`](../apps/payment-gateway-mock/src/shared/modes/mode-handler.ts) + [`charges.service.ts`](../apps/payment-gateway-mock/src/modules/charges/charges.service.ts)
> **Plan reference**: [PLAN1 section 8](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) — Payment Gateway Mock
> **Related**: [DATABASE_ERD.md](./DATABASE_ERD.md) untuk schema `payment_attempts` (kolom `outcome`, `delay_before_next_ms`, dll)

---

## 📋 TL;DR — Quick Reference

8 failure modes yang dapat di-switch saat runtime via `PUT /admin/config`:

| # | Mode | HTTP | Delay | Retryable | Charge? | Axios timeout relevant? | Default outcome |
|---|---|---|---|---|---|---|---|
| 1 | `always-success` | 200 | 0ms | - | ✅ | ❌ | success |
| 2 | `fail-first-n` | 500→200 | 0ms | ✅ | ✅ (attempt N+1) | ❌ | success (after N retries) |
| 3 | `server-error` | 500 | 0ms | ✅ | ❌ | ❌ | retryable_failure |
| 4 | `always-timeout` | 503* | `timeoutMs` | ✅ | ❌ | ✅ **KRUSIAL** | timeout* |
| 5 | `client-error` | 400 | 0ms | ❌ | ❌ | ❌ | permanent_failure |
| 6 | `random` | 200/500 | 0ms | ✅ (kalau 500) | ✅ (kalau 200) | ❌ | random |
| 7 | `succeed-but-drop-response` | 200** | ~10s | ✅ (timeout) | ✅ (attempt 1) | ✅ **KRUSIAL** | timeout → replay → success |
| 8 | `rate-limited` | 429 | 0ms | ✅ (Retry-After) | ❌ | ❌ | retryable_failure + delay |

\*  `always-timeout` balas 503 kalau `timeoutMs < axios timeout`. Kalau `timeoutMs > axios timeout`, axios abort duluan → outcome=timeout (ECONNABORTED).
\** `succeed-but-drop-response` charge sukses tapi response di-drop setelah ~10s → client tidak pernah dapat 200.

---

## 🏗️ Arsitektur Timeout — 3 Layer

Sebelum bahas per mode, penting paham arsitektur timeout. Ada **3 layer** yang race:

```text
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1: Cockatiel Timeout Policy                                │
│   Value: GATEWAY_TIMEOUT_MS = 2000ms (default)                   │
│   Source: apps/payment-api/.env                                   │
│   Effect: Kalau fn() tidak selesai dalam 2000ms → Cockatiel      │
│           throw TimeoutError → classified retryable              │
└─────────────────────────────────────────────────────────────────┘
                            ↓ wraps fn()
┌─────────────────────────────────────────────────────────────────┐
│ Layer 2: Axios Timeout                                           │
│   Value: GATEWAY_TIMEOUT_MS - 200 = 1800ms (default)             │
│   Source: http-adapter.ts line 37                                │
│   Effect: Kalau gateway tidak respon dalam 1800ms → axios throw  │
│           ECONNABORTED "timeout of 1800ms exceeded"              │
│                                                                  │
│   Why 200ms earlier?                                             │
│   Race condition fix — axios fires FIRST supaya fn() body        │
│   (audit onAttempt callback) completes BEFORE Cockatiel timeout. │
│   Tanpa ini, audit rows bisa tertulis SETELAH payment            │
│   scheduled_for_retry (late writes).                             │
└─────────────────────────────────────────────────────────────────┘
                            ↓ HTTP request
┌─────────────────────────────────────────────────────────────────┐
│ Layer 3: Gateway Mock Response Time                              │
│   Value: Bergantung mode                                         │
│   - Most modes: ~5-20ms (instant)                               │
│   - always-timeout: timeoutMs (default 5000ms)                  │
│   - succeed-but-drop-response: ~10000ms (hardcoded)              │
│                                                                  │
│   Effect: Kalau response time > axios timeout (1800ms) →         │
│           axios abort duluan, gateway response tidak pernah      │
│           sampai ke client                                       │
└─────────────────────────────────────────────────────────────────┘
```

### Race Matrix

| Gateway response time | Axios (1800ms) | Cockatiel (2000ms) | Siapa menang? | Outcome di audit |
|---|---|---|---|---|
| < 1800ms (e.g., 50ms) | ✅ Dapat response | ✅ fn() selesai cepat | Gateway | `success` atau `retryable_failure` (tergantung HTTP status) |
| 1800ms - 2000ms | ❌ Timeout abort | ✅ fn() selesai via error | Axios | `timeout` (ECONNABORTED) |
| > 2000ms | ❌ Timeout abort (duluan) | ❌ Timeout policy fires | Axios (1800 < 2000) | `timeout` (ECONNABORTED) |

**Default config** dirancang supaya **axios selalu menang** kalau gateway lambat — supaya audit row tertulis dengan benar.

---

## 📖 Detail per Mode

### Mode 1: `always-success`

#### Behavior

Gateway langsung balas **HTTP 200** + body berisi `gateway_reference` baru (random UUID). Tidak ada delay.

```typescript
// mode-handler.ts line 71-77
case 'always-success': {
  return {
    status: 200,
    body: successBody(false),  // { status:'succeeded', gateway_reference:UUID, replayed:false }
    chargeCaptured: true,
  };
}
```

#### Config

Tidak perlu parameter tambahan. Cukup:
```bash
curl -X PUT http://localhost:3002/admin/config \
  -H "Content-Type: application/json" \
  -d '{"mode":"always-success"}'
```

#### Karakteristik

| Aspek | Value |
|---|---|
| HTTP status | 200 |
| Response delay | ~5-20ms (instant) |
| Charge captured? | ✅ Yes (actualCharges +1 per unique payment) |
| Idempotency replay? | ❌ Tidak (selalu fresh charge) |
| Axios timeout relevant? | ❌ Tidak (response cepat) |
| Cockatiel retry? | 0 (1 attempt saja, langsung sukses) |

#### Outcome di Audit

```text
payment_attempts:
  attempt_number=1, outcome=success, http_status=200,
  error_code=NULL, duration_ms=~10ms, replayed=false
```

#### Use Case

- Demo happy path / baseline
- Verifikasi sistem bekerja tanpa failure
- Demo idempotency dengan always-success (kalau request di-retry, akan replay)

---

### Mode 2: `fail-first-n`

#### Behavior

N attempts pertama balas **HTTP 500**, attempt ke-(N+1) balas **200**. Counter disimpan per `idempotencyKey` (1 counter per payment).

```typescript
// mode-handler.ts line 79-102
case 'fail-first-n': {
  const current = state.failFirstNCounter.get(idempotencyKey) ?? 0;
  const next = current + 1;
  state.failFirstNCounter.set(idempotencyKey, next);

  if (current < config.n) {
    return {
      status: 500,
      body: { error_code: 'upstream_error', message: `fail-first-n: attempt ${next} of ${config.n}` },
    };
  }
  return { status: 200, body: successBody(false), chargeCaptured: true };
}
```

#### Config

```bash
curl -X PUT http://localhost:3002/admin/config \
  -H "Content-Type: application/json" \
  -d '{"mode":"fail-first-n","n":2}'
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `n` | int | 2 | Jumlah failures sebelum success. N=0 = selalu success. N=2 = 2 gagal, ke-3 sukses. |

#### Karakteristik

| Aspek | Value |
|---|---|
| HTTP status | 500 (N kali) → 200 |
| Response delay | ~5-20ms per attempt |
| Charge captured? | ✅ Yes (saat attempt N+1 saja) |
| Idempotency replay? | ❌ Tidak (counter tracking) |
| Axios timeout relevant? | ❌ Tidak |
| Cockatiel retry? | N (dengan `maxAttempts=3`, total 4 fn() calls — kalau N=2, attempt ke-3 sukses) |

#### Outcome di Audit (contoh N=2)

```text
payment_attempts:
  attempt_number=1, outcome=retryable_failure, http_status=500, error_code=upstream_error
  attempt_number=2, outcome=retryable_failure, http_status=500, error_code=upstream_error
  attempt_number=3, outcome=success, http_status=200, duration_ms=~10ms
```

#### Use Case

- Demo retry yang akhirnya sukses (transient failure)
- Verifikasi Cockatiel retry policy bekerja
- Demo A di Vue dashboard (fail-first-n=2 → 3 attempts → succeeded)

#### Catatan Penting

- Counter `failFirstNCounter` disimpan per `idempotencyKey`. Kalau payment baru dibuat, idempotencyKey baru → counter mulai dari 0 lagi.
- Kalau `n > maxAttempts` (e.g., n=5, maxAttempts=3), payment akan scheduled_for_retry (retry exhausted), dan scheduler akan lanjut di cycle berikutnya dengan counter yang sama.

---

### Mode 3: `server-error`

#### Behavior

Gateway langsung balas **HTTP 500** + `error_code=upstream_error`. Selalu gagal, tanpa delay.

```typescript
// mode-handler.ts line 104-113
case 'server-error': {
  return {
    status: 500,
    body: {
      status: 'failed',
      error_code: 'upstream_error',
      message: 'Internal gateway error (simulated)',
    },
  };
  // ↑ TIDAK ada delayMs — langsung balas
}
```

#### Config

```bash
curl -X PUT http://localhost:3002/admin/config \
  -H "Content-Type: application/json" \
  -d '{"mode":"server-error"}'
```

Tidak perlu parameter tambahan.

#### Karakteristik

| Aspek | Value |
|---|---|
| HTTP status | 500 |
| Response delay | ~5-20ms (instant) |
| Charge captured? | ❌ No |
| Idempotency replay? | ❌ Tidak |
| Axios timeout relevant? | ❌ **TIDAK** (response cepat) |
| Cockatiel retry? | maxAttempts (3 retries = 4 total fn() calls) |

#### Outcome di Audit

```text
payment_attempts (4 rows — 1 initial + 3 retries, all failed):
  attempt_number=1, outcome=retryable_failure, http_status=500, error_code=upstream_error
  attempt_number=2, outcome=retryable_failure, http_status=500, error_code=upstream_error
  attempt_number=3, outcome=retryable_failure, http_status=500, error_code=upstream_error
  attempt_number=4, outcome=retryable_failure, http_status=500, error_code=upstream_error
```

Payment status: `scheduled_for_retry` → (scheduler cycle ulang) → setelah `MAX_TOTAL_RETRIES` → `failed`

#### Use Case

- Demo retry exhaustion
- Demo circuit breaker triggering (3 failures konsekutif → breaker OPEN)
- Demo "downstream service crash" scenario

#### ⚠️ Bedanya dengan `always-timeout`

Banyak yang confuse `server-error` vs `always-timeout`. Bedanya:

| Aspek | `server-error` | `always-timeout` |
|---|---|---|
| Response delay | 0ms (instant) | `timeoutMs` (default 5000ms) |
| HTTP status | 500 | 503 (kalau sempat) atau tidak ada (axios abort) |
| `error_code` | `upstream_error` | `gateway_timeout` |
| Axios timeout | Tidak relevant (response cepat) | **Relevant** (race condition) |
| Outcome | `retryable_failure` (500) | `timeout` (ECONNABORTED) atau `retryable_failure` (503) |

Kalau mau demo "server down", gunakan `server-error` (lebih clean, no timeout issue). Kalau mau demo "server hang/slow", gunakan `always-timeout`.

---

### Mode 4: `always-timeout`

#### Behavior

Gateway **delay `timeoutMs` ms** dulu, lalu balas **HTTP 503** + `error_code=gateway_timeout`. Tapi client kemungkinan besar sudah timeout duluan (axios abort di 1800ms, gateway baru balas di 5000ms).

```typescript
// mode-handler.ts line 115-127
case 'always-timeout': {
  // Sleep first; client (GATEWAY_TIMEOUT_MS=2000) will time out before
  // our 503 lands. delayMs is honoured by the charges service.
  return {
    status: 503,
    body: {
      status: 'failed',
      error_code: 'gateway_timeout',
      message: 'Gateway did not respond in time (simulated)',
    },
    delayMs: config.timeoutMs,
  };
}
```

```typescript
// charges.service.ts line 81-84
if (result.delayMs && result.delayMs > 0) {
  this.logger.warn(`delaying ${result.delayMs}ms key=${key} (always-timeout mode)`);
  await sleep(result.delayMs);
}
```

#### Config

```bash
curl -X PUT http://localhost:3002/admin/config \
  -H "Content-Type: application/json" \
  -d '{"mode":"always-timeout","timeoutMs":5000}'
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `timeoutMs` | int | 5000 | Delay sebelum gateway balas 503. Kalau > axios timeout (1800ms), axios menang. Kalau < axios timeout, gateway menang. |

#### Karakteristik

| Aspek | Value |
|---|---|
| HTTP status | 503 (kalau sempat sampai client) |
| Response delay | `timeoutMs` (default 5000ms) |
| Charge captured? | ❌ No |
| Idempotency replay? | ❌ Tidak |
| Axios timeout relevant? | ✅ **KRUSIAL** — menentukan outcome |
| Cockatiel retry? | maxAttempts (3 retries = 4 total fn() calls) |

#### Race Condition — 2 Skenario

**Skenario A: `timeoutMs > axios timeout` (default 5000 > 1800)**

```text
Timeline:
  0ms     axios request terkirim
  1800ms  axios abort (ECONNABORTED) — client dapat error
  5000ms  gateway finally respond 503 — tapi client sudah pergi

Outcome di audit:
  attempt_number=1, outcome=timeout, http_status=NULL,
  error_code=ECONNABORTED, error_message="timeout of 1800ms exceeded",
  duration_ms=~1810ms
```

**Skenario B: `timeoutMs < axios timeout` (e.g., 1500 < 1800)**

```text
Timeline:
  0ms     axios request terkirim
  1500ms  gateway respond 503 — client dapat response
  (axios tidak timeout karena response sudah datang)

Outcome di audit:
  attempt_number=1, outcome=retryable_failure, http_status=503,
  error_code=gateway_timeout, error_message="Gateway did not respond in time (simulated)",
  duration_ms=~1519ms
```

#### Outcome di Audit

**Skenario A (default, timeoutMs=5000)**:
```text
payment_attempts (4 rows, semua ECONNABORTED):
  attempt_number=1, outcome=timeout, http_status=NULL, error_code=ECONNABORTED, duration_ms=~1810ms
  attempt_number=2, outcome=timeout, http_status=NULL, error_code=ECONNABORTED, duration_ms=~1810ms
  attempt_number=3, outcome=timeout, http_status=NULL, error_code=ECONNABORTED, duration_ms=~1810ms
  attempt_number=4, outcome=timeout, http_status=NULL, error_code=ECONNABORTED, duration_ms=~1810ms
```

**Skenario B (timeoutMs=1500)**:
```text
payment_attempts (4 rows, semua 503):
  attempt_number=1, outcome=retryable_failure, http_status=503, error_code=gateway_timeout, duration_ms=~1519ms
  ...
```

Payment status (kedua skenario): `scheduled_for_retry` → scheduler retry cycles → `failed` (setelah MAX_TOTAL_RETRIES)

#### Use Case

- Demo timeout handling (axios timeout + Cockatiel retry)
- Demo circuit breaker via timeout (3 cycles × 4 timeouts = 12 failures → breaker OPEN)
- Demo C di Vue dashboard (always-timeout × 3 payments → breaker triggered)

#### ⚠️ Naming Misleading

Mode ini bernama `always-timeout` tapi behavior-nya bergantung config `timeoutMs`:
- Default (5000ms): axios timeout duluan → outcome=timeout (sesuai nama mode)
- Custom (< 1800ms): gateway respond duluan → outcome=retryable_failure (bukan timeout!)

Mungkin lebih akurat kalau dinamakan `gateway-slow` atau `delayed-failure`. Tapi untuk backward compatibility, nama `always-timeout` dipertahankan.

---

### Mode 5: `client-error`

#### Behavior

Gateway langsung balas **HTTP 400** + `error_code=invalid_card`. Permanent failure — tidak retryable.

```typescript
// mode-handler.ts line 129-138
case 'client-error': {
  return {
    status: 400,
    body: {
      status: 'failed',
      error_code: 'invalid_card',
      message: 'Card number invalid',
    },
  };
}
```

#### Config

```bash
curl -X PUT http://localhost:3002/admin/config \
  -H "Content-Type: application/json" \
  -d '{"mode":"client-error"}'
```

Tidak perlu parameter tambahan.

#### Karakteristik

| Aspek | Value |
|---|---|
| HTTP status | 400 |
| Response delay | ~5-20ms (instant) |
| Charge captured? | ❌ No |
| Idempotency replay? | ❌ Tidak |
| Axios timeout relevant? | ❌ Tidak |
| Cockatiel retry? | **0** (1 attempt, langsung permanent) |

#### Klasifikasi Error

4xx (selain 429) diklasifikasikan sebagai **permanent failure** (lihat `classifier.ts`):

```typescript
// classifier.ts (paraphrased)
if (status >= 400 && status < 500 && status !== 429 && status !== 408) {
  return { retryable: false, reason: 'permanent_http_error' };
}
```

Resilient adapter TIDAK throw (karena permanent) — return result langsung. Service apply status `failed` tanpa retry.

#### Outcome di Audit

```text
payment_attempts (1 row only — no retry):
  attempt_number=1, outcome=permanent_failure, http_status=400,
  error_code=invalid_card, error_message="Card number invalid"
```

Payment status: `failed` (immediate, tidak scheduled_for_retry)

#### Use Case

- Demo permanent failure (4xx no retry)
- Demo B di Vue dashboard (client-error → 1 attempt → failed)
- Verifikasi bahwa 4xx tidak di-retry (beda dengan 5xx yang retryable)

---

### Mode 6: `random`

#### Behavior

Setiap request, gateway generate angka random. Kalau `Math.random() < probability` → balas 200, else → balas 500.

```typescript
// mode-handler.ts line 140-157
case 'random': {
  const ok = Math.random() < config.probability;
  if (ok) {
    return { status: 200, body: successBody(false), chargeCaptured: true };
  }
  return {
    status: 500,
    body: { error_code: 'random_failure', message: 'Probabilistic failure (simulated)' },
  };
}
```

#### Config

```bash
curl -X PUT http://localhost:3002/admin/config \
  -H "Content-Type: application/json" \
  -d '{"mode":"random","probability":0.5}'
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `probability` | float (0.0 - 1.0) | 0.5 | Peluang SUCCESS. `Math.random() < probability` → 200. |

#### Probability Mechanics

| `probability` | `Math.random() < probability` true untuk... | Success rate | Fail rate |
|---|---|---|---|
| 0.0 | tidak pernah | 0% | 100% |
| 0.1 | angka random 0.0-0.1 (10% range) | 10% | 90% |
| 0.3 | angka random 0.0-0.3 (30% range) | 30% | 70% |
| 0.5 (default) | angka random 0.0-0.5 (50% range) | 50% | 50% |
| 0.7 | angka random 0.0-0.7 (70% range) | 70% | 30% |
| 0.9 | angka random 0.0-0.9 (90% range) | 90% | 10% |
| 1.0 | selalu | 100% | 0% |

**Anda benar**: kalau `probability` rendah (mendekati 0), sering fail. Kalau tinggi (mendekati 1), sering success.

#### Karakteristik

| Aspek | Value |
|---|---|
| HTTP status | 200 atau 500 (random per attempt) |
| Response delay | ~5-20ms (instant) |
| Charge captured? | ✅ Yes (kalau success) |
| Idempotency replay? | ❌ Tidak (random per request) |
| Axios timeout relevant? | ❌ Tidak |
| Cockatiel retry? | Variabel — tergantung luck. Bisa 0 (langsung sukses), bisa maxAttempts (kalau sial terus) |

#### Outcome di Audit (contoh probability=0.3)

```text
Kemungkinan 1 (luck bagus, attempt 1 sukses):
  attempt_number=1, outcome=success, http_status=200

Kemungkinan 2 (cukup luck, attempt 3 sukses):
  attempt_number=1, outcome=retryable_failure, http_status=500
  attempt_number=2, outcome=retryable_failure, http_status=500
  attempt_number=3, outcome=success, http_status=200

Kemungkinan 3 (sial, semua gagal):
  attempt_number=1-4, outcome=retryable_failure, http_status=500
  Payment → scheduled_for_retry
```

#### Use Case

- Demo probabilistic failure (real-world flaky gateway)
- Verifikasi sistem bekerja dengan unpredictable failures
- Stress test (probability=0.1 → 90% fail, banyak retry)

---

### Mode 7: `succeed-but-drop-response` (HERO)

#### Behavior

Gateway **charge LANGSUNG** (captured, actualCharges+1, save ke idempotency store), lalu **hang ~10 detik** dan throw `ServiceUnavailableException` supaya socket ditutup tanpa balas 200 ke client.

```typescript
// mode-handler.ts line 159-170
case 'succeed-but-drop-response': {
  return {
    status: 200,
    body: successBody(false),
    chargeCaptured: true,
    shouldDropResponse: true,
  };
}

// charges.service.ts line 120-126
if (result.shouldDropResponse) {
  this.logger.warn(`dropping response key=${key} (charge already captured) - hanging 10s`);
  await sleep(10_000);
  throw new ServiceUnavailableException('response dropped (simulated)');
}
```

#### Config

```bash
curl -X PUT http://localhost:3002/admin/config \
  -H "Content-Type: application/json" \
  -d '{"mode":"succeed-but-drop-response"}'
```

Tidak perlu parameter tambahan. Delay hardcoded 10s.

#### Karakteristik

| Aspek | Value |
|---|---|
| HTTP status | 200 (tapi dropped, client tidak pernah dapat) |
| Response delay | ~10000ms (hardcoded) |
| Charge captured? | ✅ **YES** (di attempt 1, sebelum drop) |
| Idempotency replay? | ✅ **YES** (attempt 2+ akan replay, no actual charge) |
| Axios timeout relevant? | ✅ **KRUSIAL** — axios pasti timeout (1800ms < 10s) |
| Cockatiel retry? | 1 retry (attempt 2 = replay dari idempotency store) |

#### Flow Lengkap (HERO Scenario)

```text
Timeline:
  0ms     Client POST /payments
  0ms     Service: createPayment → executePayment → cockatiel.execute(fn)
  0ms     fn() attempt 1:
            ├─ axios.post() ke gateway
            ├─ gateway charge + save to idempotency store + actualCharges++ (CAPTURED!)
            ├─ gateway hang 10s
            └─ 1800ms: axios timeout (ECONNABORTED) → fn() throws

          Cockatiel retry (maxAttempts=3, jadi retry boleh 3 kali):
  1800ms fn() attempt 2:
            ├─ axios.post() ke gateway (SAME Idempotency-Key)
            ├─ gateway detect key sudah ada → REPLAY (no actual charge)
            ├─ gateway return 200 + replayed=true
            └─ fn() returns success

  ~2000ms Cockatiel execute return → service map outcome → status=succeeded

Payment status: succeeded
Payment.attempt_count: 2
Gateway actualCharges: 1 (HERO! no double charge)
```

#### Outcome di Audit

```text
payment_attempts (2 rows):
  attempt_number=1, outcome=timeout, http_status=NULL,
    error_code=ECONNABORTED, error_message="timeout of 1800ms exceeded",
    replayed=false, duration_ms=~1810ms
  attempt_number=2, outcome=success, http_status=200,
    error_code=NULL, replayed=TRUE,  ← ← ← KEY MARKER
    duration_ms=~10ms
```

**Key invariant**: `actualCharges ≤ 1` walaupun `HTTP calls ≥ 2` (PLAN1 section 9.1)

#### Use Case

- **Demo HERO idempotency** — anti double-charge
- Demo D di Vue dashboard (succeed-but-drop-response → 2 attempts → 1 actual charge)
- Verifikasi Idempotency-Key mechanism bekerja
- Verifikasi invariant `actualCharges ≤ 1`

#### Kenapa Delay 10s Hardcoded?

Supaya **axios pasti timeout duluan** (1800ms). Kalau delay < axios timeout, client dapat 200 dan tidak terjadi retry → tidak ada replay → idempotency tidak teruji.

10s adalah safety margin besar supaya tidak peduli config axios timeout, axios selalu timeout duluan.

---

### Mode 8: `rate-limited`

#### Behavior

Gateway langsung balas **HTTP 429** + header `Retry-After: <seconds>`. Tidak ada delay sebelum balas.

```typescript
// mode-handler.ts line 172-182
case 'rate-limited': {
  return {
    status: 429,
    body: {
      status: 'failed',
      error_code: 'rate_limited',
      message: 'Too many requests (simulated)',
    },
    headers: { 'Retry-After': String(config.retryAfterSeconds) },
  };
}
```

#### Config

```bash
curl -X PUT http://localhost:3002/admin/config \
  -H "Content-Type: application/json" \
  -d '{"mode":"rate-limited","retryAfterSeconds":3}'
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `retryAfterSeconds` | int | 10 | Value untuk header `Retry-After` (dalam detik) |

#### Karakteristik

| Aspek | Value |
|---|---|
| HTTP status | 429 |
| Response delay | ~5-20ms (instant) |
| Charge captured? | ❌ No |
| Idempotency replay? | ❌ Tidak |
| Axios timeout relevant? | ❌ Tidak |
| Cockatiel retry? | maxAttempts (3 retries = 4 total fn() calls) |
| Delay per retry | `max(exponential_backoff, retryAfterMs)` — lihat formula di bawah |

#### Retry-After Header Honoring

Cockatiel `DelegateBackoff` custom (di `policies.ts`) membaca `Retry-After` header dari error context dan menghitung delay:

```typescript
// policies.ts (simplified)
const customBackoff = new DelegateBackoff((context, state) => {
  const baseExponential = state?.exponential ?? config.retryBaseDelayMs;
  const nextExponential = Math.min(baseExponential * 2, config.retryMaxDelayMs);

  // Extract retryAfterMs dari error (dari 429 + Retry-After header)
  const retryAfterMs = extractRetryAfterMs(context.result);

  // Delay = max(exponential, retryAfterMs) supaya Retry-After selalu dihormati
  const delay = retryAfterMs !== undefined
    ? Math.max(nextExponential, retryAfterMs)
    : nextExponential;

  return { delay, state: { exponential: nextExponential } };
});
```

**Contoh dengan `retryAfterSeconds=3` (3000ms)**:
```text
attempt 1 → 429 + Retry-After:3
  delay = max(min(500*2, 8000), 3000) = max(1000, 3000) = 3000ms
  Cockatiel tunggu 3000ms sebelum attempt 2

attempt 2 → 429 + Retry-After:3
  delay = max(min(1000*2, 8000), 3000) = max(2000, 3000) = 3000ms
  Cockatiel tunggu 3000ms

attempt 3 → 429 + Retry-After:3
  delay = max(min(2000*2, 8000), 3000) = max(4000, 3000) = 4000ms ← exponential menang!

attempt 4 → 429 + Retry-After:3
  retry exhausted, status → scheduled_for_retry
```

#### Outcome di Audit

```text
payment_attempts (4 rows, semua 429):
  attempt_number=1, outcome=retryable_failure, http_status=429,
    error_code=rate_limited, delay_before_next_ms=3000,  ← ← ← KEY MARKER
    duration_ms=~10ms
  attempt_number=2, outcome=retryable_failure, http_status=429,
    delay_before_next_ms=3000, duration_ms=~10ms
  attempt_number=3, outcome=retryable_failure, http_status=429,
    delay_before_next_ms=3000, duration_ms=~10ms
  attempt_number=4, outcome=retryable_failure, http_status=429,
    delay_before_next_ms=NULL (last attempt), duration_ms=~10ms
```

**Kolom `delay_before_next_ms` hanya terisi untuk mode ini** (dari `Retry-After` header). Untuk mode lain (e.g., 500, timeout), kolom ini = NULL.

Payment status: `scheduled_for_retry` → scheduler retry cycles → `failed`

#### Use Case

- Demo Retry-After header honoring
- Demo E di Vue dashboard (rate-limited dengan retryAfterSeconds=3)
- Verifikasi Cockatiel DelegateBackoff custom bekerja (baca header, compute delay)

---

## 📊 Comparison Matrix

| Mode | HTTP | Delay | Charge? | Replay? | Axios timeout? | Cockatiel retries | Final status |
|---|---|---|---|---|---|---|---|
| `always-success` | 200 | 0ms | ✅ | ❌ | ❌ | 0 | succeeded |
| `fail-first-n` (n=2) | 500→200 | 0ms | ✅ (attempt 3) | ❌ | ❌ | 2 (3 attempts total) | succeeded |
| `server-error` | 500 | 0ms | ❌ | ❌ | ❌ | 3 (4 attempts) | failed (after MAX_TOTAL_RETRIES) |
| `always-timeout` (timeoutMs=5000) | (dropped) | 5000ms | ❌ | ❌ | ✅ axios menang | 3 (4 attempts) | failed (after MAX_TOTAL_RETRIES) |
| `always-timeout` (timeoutMs=1500) | 503 | 1500ms | ❌ | ❌ | ❌ gateway menang | 3 (4 attempts) | failed (after MAX_TOTAL_RETRIES) |
| `client-error` | 400 | 0ms | ❌ | ❌ | ❌ | 0 (permanent) | failed (immediate) |
| `random` (probability=0.5) | 200/500 | 0ms | ✅ (kalau 200) | ❌ | ❌ | variabel | variabel |
| `succeed-but-drop-response` | 200 (dropped) | 10000ms | ✅ (attempt 1) | ✅ (attempt 2+) | ✅ axios menang | 1 (2 attempts) | succeeded |
| `rate-limited` | 429 | 0ms | ❌ | ❌ | ❌ | 3 (4 attempts) | failed (after MAX_TOTAL_RETRIES) |

---

## 🛠️ Cara Ganti Mode

### Via UI (Vue Dashboard)

1. Buka http://localhost:5173/
2. Di Home page, cari card **"Gateway Mode Selector"**
3. Pilih mode dari dropdown
4. Set parameter tambahan kalau perlu (n, timeoutMs, probability, retryAfterSeconds)
5. Klik **Save**

### Via curl

```bash
# Always success
curl -X PUT http://localhost:3002/admin/config \
  -H "Content-Type: application/json" \
  -d '{"mode":"always-success"}'

# Fail first n=2
curl -X PUT http://localhost:3002/admin/config \
  -H "Content-Type: application/json" \
  -d '{"mode":"fail-first-n","n":2}'

# Always timeout dengan delay 1500ms
curl -X PUT http://localhost:3002/admin/config \
  -H "Content-Type: application/json" \
  -d '{"mode":"always-timeout","timeoutMs":1500}'

# Random dengan 30% success
curl -X PUT http://localhost:3002/admin/config \
  -H "Content-Type: application/json" \
  -d '{"mode":"random","probability":0.3}'

# Rate-limited dengan Retry-After 3 detik
curl -X PUT http://localhost:3002/admin/config \
  -H "Content-Type: application/json" \
  -d '{"mode":"rate-limited","retryAfterSeconds":3}'
```

### Cek Config Saat Ini

```bash
curl http://localhost:3002/admin/config
# Response: {"mode":"always-success","n":2,"probability":0.5,"retryAfterSeconds":10,"timeoutMs":5000}
```

### Cek Stats (request count, success, failure, replays, actualCharges)

```bash
curl http://localhost:3002/admin/stats
# Response: {"requestCount":15,"successCount":3,"failureCount":12,"replayCount":2,"actualChargesCount":3,"idempotencyStoreSize":2}
```

### Reset Stats

```bash
curl -X POST http://localhost:3002/admin/reset \
  -H "Content-Type: application/json" -d '{}'
```

---

## 🎯 Use Case per Demo Scenario

Mapping ke Vue dashboard Demo A-E:

| Demo | Gateway Mode | Config | Apa yang dibuktikan |
|---|---|---|---|
| **A: Transient Retry** | `fail-first-n` | `n=2` | Cockatiel retry bekerja — 3 attempts, akhirnya sukses |
| **B: Permanent Failure** | `client-error` | - | 4xx tidak di-retry — 1 attempt, langsung failed |
| **C: Circuit Breaker** | `always-timeout` | `timeoutMs=5000` | Breaker OPEN setelah 3×4 timeouts — 4th payment short-circuit (circuit_open) |
| **D: Idempotency HERO** | `succeed-but-drop-response` | - | Anti double-charge — 2 HTTP calls, 1 actual charge |
| **E: Retry-After** | `rate-limited` | `retryAfterSeconds=3` | Retry-After header dihormati — delay_before_next_ms=3000 |

---

## 📚 Cross-Reference

- **Source code**:
  - [`apps/payment-gateway-mock/src/shared/modes/mode-handler.ts`](../apps/payment-gateway-mock/src/shared/modes/mode-handler.ts) — pure function mode → result
  - [`apps/payment-gateway-mock/src/modules/charges/charges.service.ts`](../apps/payment-gateway-mock/src/modules/charges/charges.service.ts) — delay + drop + idempotency store
  - [`apps/payment-gateway-mock/src/shared/state/mock-state.ts`](../apps/payment-gateway-mock/src/shared/state/mock-state.ts) — config defaults
- **Error classification**:
  - [`packages/resilience/src/errors/classifier.ts`](../packages/resilience/src/errors/classifier.ts) — 4xx permanent, 5xx/429/timeout retryable
- **PLAN1**:
  - [Section 8](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) — Payment Gateway Mock (8.1 endpoint, 8.2 failure modes, 8.3 runtime config)
  - [Section 9](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) — Idempotency
  - [Section 15](./PLAN1_Cockatiel_Retry_Failure_Scenario.md) — Configuration (GATEWAY_TIMEOUT_MS, RETRY_*)
- **Related docs**:
  - [`DATABASE_ERD.md`](./DATABASE_ERD.md) — schema `payment_attempts` (kolom `outcome`, `delay_before_next_ms`, `replayed`)
  - [`e2e-results.md`](./e2e-results.md) — hasil E2E test 7 scenarios (cross-ref ke mode yang dipakai)
  - [`tasks/TASK-14-e2e-scenarios.md`](./tasks/TASK-14-e2e-scenarios.md) — detail E2E test scenarios A-E
  - [`tasks/TASK-13a-vue-improvements.md`](./tasks/TASK-13a-vue-improvements.md) — DemoScenarioRunner Vue (mapping demo → mode)
