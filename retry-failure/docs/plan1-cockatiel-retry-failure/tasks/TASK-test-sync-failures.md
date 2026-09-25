# TASK — Test Sync Failures: Catatan Bug Analysis (7 Failures)

> **Tanggal**: 2026-09-19
> **Status**: Investigated — failures pre-existed, bukan disebabkan fix mock `DelegateBackoff`
> **Context**: Setelah fix bug `DelegateBackoff is not a constructor` di `packages/resilience/__mocks__/cockatiel-adapter.ts`, user run `pnpm test` di root project. Masih ada 7 failures di `apps/payment-api`. Investigasi membuktikan 7 failures ini **sudah ada sebelum fix mock** — root cause-nya perubahan source code tidak diiringi update test.

---

## TL;DR

| # | Pertanyaan | Jawaban |
|---|---|---|
| 1 | Apakah fix mock `DelegateBackoff` menyebabkan 7 failures? | **Tidak.** Sudah ada sebelumnya. |
| 2 | Apakah test menjaga kondisi tetap sama walaupun ada perubahan logika? | **Ya seharusnya**, TAPI test hanya menjaga invariant yang spesifik di-assert. Kalau source berubah dan test tidak di-update, test bisa fail. |
| 3 | Kenapa bisa terjadi? | **2x commit refactor source tanpa update test**: commit `8fa0845` (13 Sep) pindah increment `totalRetryCount` dari service ke scheduler; bug fix race condition tambah `timeout` ke axios config. Test mock tidak update. |

---

## Bug History Summary

### Bug 1 — `DelegateBackoff is not a constructor` (FIXED)

**File**: `packages/resilience/__mocks__/cockatiel-adapter.ts`

**Root cause**: Mock file lupa export `DelegateBackoff`, padahal `src/policies/cockatiel-adapter.ts` (real adapter) sudah export. Jest `moduleNameMapper` redirect import ke mock → `DelegateBackoff` jadi `undefined` → `new DelegateBackoff(...)` throw TypeError.

**Fix**: Tambah mock class `DelegateBackoff` yang sesuai cockatiel v4 interface + tambahkan ke export statement.

**Impact**: 9 tests di `composition.spec.ts` jadi PASS (sebelumnya fail). 0 test lain terpengaruh.

---

### 7 Pre-existing Failures (BELUM DIPERBAIKI)

Saya verify dengan checkout file mock ke versi **sebelum** fix `DelegateBackoff`, lalu run test yang sama. Hasil: 7 failures identik. Artinya bug ini sudah ada sebelum fix mock.

#### Failures #1-3: `retry-scheduler.service.spec.ts`

```
expect(paymentsService.executePayment).toHaveBeenCalledTimes(2);
// Received: 0 calls
```

**Root cause**: Commit `8fa0845` (13 Sep 2026) refactor `RetrySchedulerService.processOne()`:
```typescript
// Source code (line 102, 112) — METHOD BARU:
if (currentTotal >= this.maxTotalRetries) {
  await this.payments.atomicUpdateStatus(paymentId, ...);  // ← method baru!
  return;
}
const incremented = await this.payments.atomicUpdateStatus(...);  // ← method baru!
if (!incremented) return;  // early return kalau concurrent change
```

```typescript
// Test code (mock repo):
function makeMockRepo(duePayments: Payment[] = []) {
  return {
    findDueRetries: jest.fn(async () => duePayments),
    // ❌ atomicUpdateStatus TIDAK ada di mock!
  };
}
```

`atomicUpdateStatus` undefined di mock → throw `TypeError: this.payments.atomicUpdateStatus is not a function` → catch di `poll()` line 78 → `executePayment` tidak pernah dipanggil → test expect 2/3/1 calls, got 0.

**Fix yang dibutuhkan**: Tambah `atomicUpdateStatus: jest.fn(async () => true)` ke `makeMockRepo()`.

---

#### Failures #4-6: `payments.service.spec.ts`

```
// Line 139, 159:
expect(result.totalRetryCount).toBe(1);
// Received: 0

// Line 217:
expect(result.status).toBe(PaymentStatus.FAILED);
// Received: scheduled_for_retry
```

**Root cause**: Commit `8fa0845` pindah increment `totalRetryCount` dari `PaymentsService` ke `RetrySchedulerService` (PLAN1 section 10.2). Service tidak increment lagi, jadi `totalRetryCount` tetap 0.

Untuk test #6 (`max_total_retries_exceeded`), logic check juga pindah ke scheduler. Service hanya return `scheduled_for_retry` setelah retry exhausted — **tidak return `failed`** karena max_total_retries check di scheduler.

**Fix yang dibutuhkan**: Update test expectasi:
- `totalRetryCount` = 0 (bukan 1), karena increment pindah ke scheduler
- `result.status` = `scheduled_for_retry` (bukan `failed`), karena service tidak cek max_total_retries

**Atau**: Pindahkan test ini ke integration test yang melibatkan scheduler + service bersama.

---

#### Failure #7: `http-adapter.spec.ts`

```
expect(http.post).toHaveBeenCalledWith(
  'http://localhost:3002/v1/charges',
  { amount: 100, currency: 'IDR', order_id: 'ORD-001' },
  {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'pay-001',
    },
  },
);
// Received: same + timeout: 1800  ← unexpected field
```

**Root cause**: Bug fix race condition (lihat worklog `13a-vue-improvements` bug #2) menambah `timeout: this.timeoutMs` ke axios config di `HttpPaymentGateway.charge()`:

```typescript
// http-adapter.ts (line 54-60) — tambahan fix race condition:
this.http.post(
  url,
  { amount: Number(req.amount), currency: req.currency, order_id: req.orderId },
  {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    timeout: this.timeoutMs,  // ← tambahan baru! 200ms sebelum cockatiel timeout
  },
)
```

Test tidak expect `timeout` field di assertion.

**Fix yang dibutuhkan**: Update test assertion supaya expect `timeout: 1800` (atau gunakan `expect.objectContaining({ headers: expect.objectContaining({ 'Idempotency-Key': 'pay-001' }) })`).

---

## Pembuktian Pre-existing

```bash
# Checkout file mock ke versi sebelum fix DelegateBackoff
cd 
git checkout 500ae7a -- packages/resilience/__mocks__/cockatiel-adapter.ts

# Run tests yang fail
cd apps/payment-api
npx jest tests/modules/retry-scheduler/retry-scheduler.service.spec.ts \
         tests/modules/payments/payments.service.spec.ts \
         tests/modules/gateway/http-adapter.spec.ts

# Hasil:
# Test Suites: 3 failed, 3 total
# Tests:       7 failed, 22 passed, 29 total
```

**Hasil dengan old mock = hasil dengan new mock**: 7 failures identik. Fix mock tidak menyebabkan skenario test jadi invalid.

---

## Filosofi: Apa itu "Test Menjaga Kondisi"?

### ✅ Test menjaga invariant YANG SPESIFIK DI-ASSERT

Test meng-assert: "kalau saya panggil `svc.poll()` dengan 2 due payments, maka `executePayment` dipanggil 2 kali". Itu invariant yang dijaga.

### ⚠️ Tapi test BISA RUSAK kalau:

#### a. Source code berubah, test tidak di-update

Source: `RetrySchedulerService.processOne()` tambah call ke `payments.atomicUpdateStatus()`.
Test: mock repo tidak implement method itu.
Result: `atomicUpdateStatus is not a function` → error → executePayment tidak dipanggil → test fail.

#### b. Bug di source di-assert sebagai expected behavior

Test expect `result.status === FAILED`.
Actual: `result.status === scheduled_for_retry`.
Bisa: bug di source ATAU test outdated. Harus investigate domain logic.

---

## Kesimpulan: Kenapa Skenario Test Harus Diubah?

Berdasarkan analisis 7 failures, dapat disimpulkan bahwa **test skenario harus diubah karena domain logic dari proyek memang sengaja berevolusi sesuai PLAN1**, tetapi test yang ditulis di commit awal belum mengakomodasi behavior yang dirancang PLAN1.

### Perubahan Source yang Sesuai PLAN1 (Bukan Bug — Memang Harus Begitu)

#### 1. Increment `totalRetryCount` pindah dari Service ke Scheduler

**PLAN1 section 10.2** (line 525-533) secara eksplisit menggambarkan:

```text
RetryScheduler
   |
   +--> find due payment
   +--> execute payment flow again
   +--> increment durable retry count          ← INCREMENT DI SINI
   |
   +--> if exceeds MAX_TOTAL_RETRIES           ← MAX CHECK DI SINI
           |
           +--> failed
```

PLAN1 **mensyaratkan** scheduler yang increment `total_retry_count` (durable retry cycles, bukan in-cycle attempts). Sehingga:

| Before refactor | After refactor (sesuai PLAN1) |
|---|---|
| `PaymentsService.executePayment()` increment `totalRetryCount` | ❌ Tidak increment lagi |
| `PaymentsService` cek `MAX_TOTAL_RETRIES` | ❌ Tidak cek lagi |
| `RetrySchedulerService` tidak peduli counter | ✅ Increment + check MAX_TOTAL_RETRIES |
| Test expect service return `totalRetryCount=1` setelah retry | ❌ Salah — service tidak increment |
| Test expect service return `failed` saat `max_total_retries` | ❌ Salah — itu tugas scheduler |

**Implikasi ke test** (failures #4, #5, #6):
- `payments.service.spec.ts` line 139, 159: expect `totalRetryCount=1` → harus jadi `0` (karena service tidak increment)
- `payments.service.spec.ts` line 217: expect `result.status=failed` → harus jadi `scheduled_for_retry` (karena max_total_retries check di scheduler)

**Atau alternatif yang lebih tepat**: pindahkan test ini ke integration test yang melibatkan scheduler + service bersamaan, supaya behavior complete (service processing + scheduler retry cycle) teruji end-to-end.

---

#### 2. `atomicUpdateStatus` di Scheduler — Konsekuensi Concurrency Safety

**PLAN1 section 12** (line 604-610) menyebutkan:

> Scheduler versi ini ditujukan untuk single-instance payment-api.
> Future production evolution dapat mempertimbangkan row locking (`FOR UPDATE SKIP LOCKED`), queue, atau distributed scheduler.

Walau PLAN1 menyebut "single-instance", implementasi `RetrySchedulerService.processOne()` sudah menggunakan **atomic conditional update** untuk mencegah race condition (lihat worklog `14a-durable-scheduler`):

```typescript
const incremented = await this.payments.atomicUpdateStatus(
  paymentId,
  PaymentStatus.SCHEDULED_FOR_RETRY,
  { totalRetryCount: newTotal },
);
if (!incremented) {
  // Status changed concurrently - skip
  return;
}
```

Ini lebih robust dari yang PLAN1 minimum — tetapi memerlukan method `atomicUpdateStatus` di repository. **Test mock tidak update** untuk implement method baru ini → failures #1, #2, #3.

**Implikasi ke test**:
- `makeMockRepo()` di `retry-scheduler.service.spec.ts` harus tambah `atomicUpdateStatus: jest.fn(async () => true)` agar scheduler bisa memanggilnya tanpa throw

---

#### 3. Axios `timeout` Field — Konsekuensi Bug Fix Race Condition

**PLAN1 section 15** (line 796) menyebutkan:
```
GATEWAY_TIMEOUT_MS=2000
```

PLAN1 tidak secara eksplisit mensyaratkan axios-level timeout terpisah dari Cockatiel timeout. Namun saat implementasi, ditemukan **race condition** (lihat worklog `13a-vue-improvements` bug #2):

- Cockatiel timeout (2s) dan gateway response timing bisa overlap
- Audit rows (`payment_attempts`) tertulis setelah payment sudah `scheduled_for_retry` (late writes)
- Fix: set axios timeout 200ms lebih awal dari Cockatiel timeout (`GATEWAY_TIMEOUT_MS - 200 = 1800ms`)

```typescript
// http-adapter.ts
private readonly timeoutMs: number;
constructor(...) {
  const cockatielTimeout = configService.get<number>('GATEWAY_TIMEOUT_MS') ?? 2000;
  this.timeoutMs = Math.max(100, cockatielTimeout - 200);  // 1800ms
}
async charge(...) {
  this.http.post(url, body, {
    headers: { ... },
    timeout: this.timeoutMs,  // ← tambahan baru, 1800ms
  });
}
```

**Implikasi ke test**:
- `http-adapter.spec.ts` line 145: test assert `http.post` dipanggil dengan 3 args (url, body, { headers }) → harus update supaya expect 4 fields: `{ headers, timeout: 1800 }`
- Atau pakai `expect.objectContaining({ headers: expect.objectContaining({ 'Idempotency-Key': 'pay-001' }) })` untuk assertion yang lebih longgar (tidak strict equality)

---

### Cross-Check ke PLAN1 — Apakah Source Behavior Sudah Sesuai?

| Domain Behavior | PLAN1 Reference | Source Implementation | Test Outdated? |
|---|---|---|---|
| Increment `total_retry_count` di scheduler | Section 10.2 (line 529) | ✅ `RetrySchedulerService.processOne()` line 111 | ❌ Test expect increment di service |
| `MAX_TOTAL_RETRIES` check di scheduler | Section 10.2 (line 531-533) | ✅ `RetrySchedulerService.processOne()` line 97 | ❌ Test expect service return `failed` |
| `Idempotency-Key: <payment.id>` | Section 9 (line 440) | ✅ `http-adapter.ts` line 41 + 57 | ✅ Test sudah benar — hanya `timeout` field baru yang miss |
| Axios timeout untuk race condition fix | (Tidak eksplisit di PLAN1 — implementation detail) | ✅ `http-adapter.ts` line 36-37 | ❌ Test tidak expect `timeout` di axios config |
| Cockatiel `DelegateBackoff` untuk Retry-After | Section 6 (line 248) + Section 9.2 | ✅ `policies.ts` line 50 | ❌ Mock lupa export `DelegateBackoff` (FIXED) |
| Scheduler single-instance + atomic update | Section 12 (line 604-610) | ✅ `atomicUpdateStatus` di repo | ❌ Mock repo tidak implement `atomicUpdateStatus` |

### Kesimpulan Akhir

7 test failures terjadi karena **test ditulis pada saat source code belum fully mengikuti PLAN1**. Setelah commit `8fa0845` (13 Sep 2026) yang menyelaraskan source dengan PLAN1 section 10.2, test tidak di-update untuk merefleksikan perubahan ini. Oleh karena itu, **test skenario memang harus diubah supaya match dengan domain logic yang dirancang PLAN1** — bukan source code-nya yang salah.

Ini juga pelajaran berharga: **PLAN1 adalah source of truth**. Saat ada konflik antara source code dan test, cek PLAN1 untuk tentukan mana yang benar.

---

## Rekomendasi Fix

| # | Test File | Fix Approach | Effort | Sesuai PLAN1? |
|---|---|---|---|---|
| 1-3 | `retry-scheduler.service.spec.ts` | Tambah `atomicUpdateStatus: jest.fn(async () => true)` ke `makeMockRepo()` | S | ✅ Section 12 |
| 4-5 | `payments.service.spec.ts` (lines 139, 159) | Update expectasi `totalRetryCount = 0` (increment pindah ke scheduler) | S | ✅ Section 10.2 |
| 6 | `payments.service.spec.ts` (line 217) | Update expectasi `result.status = scheduled_for_retry` ATAU pindah ke integration test | M | ✅ Section 10.2 |
| 7 | `http-adapter.spec.ts` | Update assertion expect `timeout: 1800` atau pakai `objectContaining` matcher | S | ✅ Implementation detail (race condition fix) |

Total effort: ~30 menit untuk semua fix.

---

## Pencegahan Masa Depan

Lihat `CONTRIBUTING.md` (root project) untuk **rule wajib test setelah ubah kode**.

Lihat juga [`docs/TEST_MAINTENANCE_RULES.md`](./TEST_MAINTENANCE_RULES.md) untuk **rule khusus test maintenance** + decision framework saat source vs test conflict.

Aturan utama:
1. **Setiap commit yang ubah source code WAJIB run `pnpm test` dulu**
2. Kalau ada test fail, ada 2 pilihan:
   - Fix source code supaya match test (kalau source yang salah)
   - Update test supaya match source (kalau source sengaja diubah)
3. **Jangan commit jika ada test fail** — kecuali documented sebagai known issue
4. Run `pnpm test` di root project (bukan hanya satu package) untuk catch cross-package regressions
5. **Saat ada konflik source vs test, cek PLAN1** untuk tentukan mana yang benar

Script yang tersedia:
- `pnpm test` — run semua test di semua package (auto-build resilience dulu)
- `pnpm test:fast` — skip build, langsung run test (kalau resilience dist sudah up-to-date)
- `pnpm --filter @retry-failure/resilience test` — test resilience package only
- `pnpm --filter payment-api test` — test payment-api only

---

## Cross-reference

- Worklog `13a-vue-improvements` — bug #2 race condition fix (tambah `timeout` ke axios)
- Worklog `14a-durable-scheduler` — refactor increment totalRetryCount dari service ke scheduler
- `docs/tasks/TASK-14a-durable-scheduler.md` — section bug history
- `packages/resilience/__mocks__/cockatiel-adapter.ts` — fix `DelegateBackoff` mock
