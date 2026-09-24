# Test Maintenance Rules

> **Dokumen ini berisi rule khusus untuk maintenance test file.**
> Pelengkap dari [`CONTRIBUTING.md`](../../CONTRIBUTING.md) yang berisi development rules umum.
>
> **Dibuat setelah insiden 7 test failures yang tidak terdeteksi lintas commit** — lihat [`TASK-test-sync-failures.md`](./plan1-cockatiel-retry-failure/tasks/TASK-test-sync-failures.md) untuk bug analysis lengkap.

---

## TL;DR — 5 Aturan Inti

1. **PLAN1 adalah source of truth** — saat source vs test konflik, cek PLAN1 dulu
2. **Setiap refactor behavior WAJIB update test** — bukan opsional
3. **Mock file harus sync dengan real adapter** — tambah export di real → update mock
4. **Jangan skip/disable test tanpa dokumentasi** — kalau harus skip, tulis alasan + TODO
5. **Run `pnpm test` di root project sebelum commit** — bukan hanya di package yang diubah

---

## 📐 Decision Framework: Saat Source vs Test Conflict

Saat test fail setelah Anda ubah source code, jangan langsung update test. Ikuti decision tree ini:

```text
TEST FAIL → Investigate root cause
  │
  ├── Apakah source behavior sesuai PLAN1?
  │   │
  │   ├── YA → Source benar, test outdated
  │   │         │
  │   │         ├── Update test supaya match source
  │   │         ├── Tulis commit message: "refactor X (update tests to match PLAN1 section Y)"
  │   │         └── DONE
  │   │
  │   └── TIDAK → Source salah, test benar
  │             │
  │             ├── Fix source code supaya match PLAN1
  │             ├── Test harus PASS setelah fix (jangan diubah)
  │             └── DONE
  │
  └── Apakah PLAN1 tidak jelas/tidak menyebut?
      │
      ├── YA → Diskusi dengan tim / update PLAN1 dulu
      │       │
      │       ├── Kalau PLAN1 di-update: ikuti PLAN1 baru
      │       └── Kalau PLAN1 dibiarkan ambiguous: pilih yang lebih robust
      │
      └── (kasus langka)
```

### Contoh Penerapan Decision Framework

#### Kasus 1: `totalRetryCount` pindah dari service ke scheduler

- **Test fail**: `expect(result.totalRetryCount).toBe(1)` → got 0
- **Source behavior**: Service tidak increment `totalRetryCount`, scheduler yang increment
- **Cek PLAN1**: Section 10.2 (line 529) — "RetryScheduler → increment durable retry count"
- **Kesimpulan**: Source benar (sesuai PLAN1), test outdated
- **Action**: Update test expectasi ke `0`, atau pindah test ke integration test scheduler+service

#### Kasus 2: `result.status` expect `failed`, actual `scheduled_for_retry`

- **Test fail**: `expect(result.status).toBe(PaymentStatus.FAILED)`
- **Source behavior**: Service return `scheduled_for_retry` (retry exhausted), scheduler yang check MAX_TOTAL_RETRIES lalu mark `failed`
- **Cek PLAN1**: Section 10.2 (line 531-533) — "if exceeds MAX_TOTAL_RETRIES → failed" (di RetryScheduler)
- **Kesimpulan**: Source benar (sesuai PLAN1), test outdated
- **Action**: Update test expectasi ke `scheduled_for_retry`, atau pindah ke integration test yang melibatkan scheduler

#### Kasus 3: `http.post` expect 3 args, actual 4 (tambah `timeout`)

- **Test fail**: `expect(http.post).toHaveBeenCalledWith(url, body, { headers })` → actual juga include `timeout: 1800`
- **Source behavior**: Axios `timeout` ditambahkan untuk fix race condition
- **Cek PLAN1**: Section 15 (line 796) — `GATEWAY_TIMEOUT_MS=2000` (cockatiel timeout, bukan axios). Axios timeout adalah implementation detail untuk fix race condition.
- **Kesimpulan**: Source benar (race condition fix valid), test outdated
- **Action**: Update test assertion supaya expect `timeout: 1800`, atau gunakan `expect.objectContaining` untuk matcher yang lebih longgar

---

## 📋 Pre-Refactor Checklist

Sebelum refactor source code yang bisa affect test, check ini:

- [ ] Cari semua test yang meng-assert behavior yang akan diubah
- [ ] Untuk setiap test, cek apakah assertion masih valid setelah refactor
- [ ] Kalau assertion akan invalid, update test dalam commit yang sama (jangan terpisah)
- [ ] Cek mock file — kalau source menambah method baru, mock juga harus di-update
- [ ] Cek integration test — kalau unit test diubah, pastikan integration test masih PASS
- [ ] Run `pnpm test` di root project setelah semua perubahan

---

## 🎯 Rule Detail

### Rule #1: PLAN1 adalah Source of Truth

**Aturan**: Saat ada konflik antara source code dan test, cek PLAN1 (`docs/plan1-cockatiel-retry-failure/PLAN1_Cockatiel_Retry_Failure_Scenario.md`) untuk tentukan mana yang benar.

**Cara pakai**:
1. Identifikasi domain behavior yang konflik
2. Cari section di PLAN1 yang menjelaskan behavior itu
3. Kalau PLAN1 explicit → ikuti PLAN1 (update yang tidak sesuai)
4. Kalau PLAN1 tidak jelas/tidak menyebut → diskusi dengan tim, mungkin update PLAN1 dulu

**Contoh cross-reference**:
- `total_retry_count` increment → PLAN1 section 10.2 (line 529)
- `MAX_TOTAL_RETRIES` check → PLAN1 section 10.2 (line 531-533)
- `Idempotency-Key` format → PLAN1 section 9 (line 440)
- `GATEWAY_TIMEOUT_MS` → PLAN1 section 15 (line 796)
- Scheduler concurrency → PLAN1 section 12 (line 604-610)

---

### Rule #2: Setiap Refactor Behavior WAJIB Update Test

**Aturan**: Saat refactor yang mengubah behavior (bukan hanya implementation detail), WAJIB update test yang meng-assert behavior tersebut **dalam commit yang sama**.

**Definisi "behavior change"**:
- ✅ Pindah logic dari satu class/method ke class/method lain (misal: increment counter dari service ke scheduler)
- ✅ Ubah return value / status flow (misal: return `failed` → `scheduled_for_retry`)
- ✅ Tambah validasi baru yang bisa reject input
- ✅ Tambah field baru di response yang visible ke consumer
- ❌ Ganti nama variable internal (implementation detail)
- ❌ Refactor structure tanpa ubah I/O (misal: extract private method)

**Commit message format**:
```
refactor: move totalRetryCount increment from service to scheduler

Per PLAN1 section 10.2, durable retry count increment belongs to
RetryScheduler, not PaymentsService. Update tests in
payments.service.spec.ts to reflect new behavior.

Refs: docs/plan1-cockatiel-retry-failure/PLAN1_Cockatiel_Retry_Failure_Scenario.md#section-10-2
```

---

### Rule #3: Mock File Parity

**Aturan**: Mock file (`__mocks__/*.ts`) harus maintain parity dengan real module yang di-mock. Setiap export/method di real module harus ada di mock.

**Aturan tambahan**:
- Kalau tambah export baru di real adapter → tambah di mock juga dalam commit yang sama
- Kalau ubah signature method di real adapter → update mock juga
- Mock harus return type yang sesuai dengan real module (atau subset yang cukup untuk test)

**Cara verify parity**:
```bash
# Compare exports dari real vs mock
grep -E "^export " src/policies/cockatiel-adapter.ts | sort
grep -E "^export " __mocks__/cockatiel-adapter.ts | sort
# Diff harus kosong (atau mock = subset yang valid dari real)
```

**Contoh bug yang dicegah**:
- Real: `export { retry, ExponentialBackoff, DelegateBackoff, ... }`
- Mock: `export { retry, ExponentialBackoff /* DelegateBackoff missing! */, ... }`
- Result: 9 tests fail dengan `TypeError: DelegateBackoff is not a constructor`
- Fix: tambah `DelegateBackoff` mock class + export

---

### Rule #4: Test Isolation & No Skip Without Documentation

**Aturan**: Jangan skip/disable test tanpa dokumentasi yang jelas.

**Yang dilarang**:
```typescript
// ❌ DILARANG: skip tanpa alasan
it.skip('should retry on failure', async () => { ... });

// ❌ DILARANG: comment assertion
it('should retry on failure', async () => {
  // expect(result.attempts).toBe(3);  // commented out
});

// ❌ DILARANG: disable test suite
describe.skip('RetrySchedulerService', () => { ... });
```

**Yang diperbolehkan**:
```typescript
// ✅ OK: skip dengan TODO + issue link
// TODO(fix): flaky test, see issue #123
// Expected behavior: retry happens 3 times
// Actual: timing-dependent, fails ~10% of runs
it.skip('should retry on failure', async () => { ... });

// ✅ OK: skip dengan reason yang documented di PR/commit
it.skip('should retry on failure (skip: cockatiel mock race condition, tracked in PR #456)', async () => { ... });
```

---

### Rule #5: Run Full Test Suite Sebelum Commit

**Aturan**: Setiap commit yang ubah source code WAJIB run `pnpm test` di root project SEBELUM commit.

**Kenapa root project, bukan hanya package yang diubah?**

- Mock file di `packages/resilience/__mocks__/` dipakai oleh `apps/payment-api` tests
- Perubahan di `packages/resilience` bisa affect tests di `apps/payment-api`
- Perubahan di adapter bisa break test yang pakai adapter (mock atau real)

**Script**:
```bash
# Auto-build resilience + run all tests
pnpm test

# Skip build (kalau yakin resilience dist sudah up-to-date)
pnpm test:fast

# Test per package (untuk debugging)
pnpm --filter @retry-failure/resilience test
pnpm --filter payment-api test
```

---

## 🔧 Mock Maintenance Checklist

Saat menulis atau update mock file, check ini:

- [ ] Mock file punya header comment yang menjelaskan: kapan dipakai, kenapa ada, apa yang di-mock
- [ ] Setiap export di real module ada di mock (parity check)
- [ ] Method signatures di mock match dengan real module
- [ ] Return types di mock compatible dengan real module (atau subset yang cukup)
- [ ] Mock tidak depend on real module (harus standalone)
- [ ] Kalau mock punya state internal (misal: MockCircuitBreaker.state), dokumentasikan lifecycle-nya

**Contoh header mock file**:
```typescript
/**
 * Manual mock untuk cockatiel-adapter (yang wrap ESM-only cockatiel v4).
 *
 * Mock ini menyediakan implementasi minimal yang cukup untuk test composition.ts.
 * Bukan replacement untuk integration test - untuk itu pakai tsx runtime
 * (lihat SANDBOX_NOTES.md "Sanity check").
 *
 * Parity: must export same names as src/policies/cockatiel-adapter.ts.
 * Saat tambah export di real adapter, update mock juga (Rule #3).
 */
```

---

## 📊 Test Coverage Tiers

Proyek ini punya 3 tier test:

| Tier | Purpose | Speed | Mock? | Example |
|---|---|---|---|---|
| **Unit test** | Test logic satu class/function dalam isolation | Cepat (<3s) | Ya (mock dependencies) | `payments.service.spec.ts` |
| **Integration test** | Test beberapa class bekerja sama | Sedang (<30s) | Partial (mock external) | `retry-scheduler.service.spec.ts` (scheduler + service + repo mock) |
| **E2E test** | Test full system end-to-end | Lambat (>60s) | Tidak (real DB + real gateway) | `tests/e2e/*.e2e-spec.ts` |

**Aturan distribusi**:
- 70% unit test (cepat, banyak, specific)
- 20% integration test (test antar-module interactions)
- 10% E2E test (test critical user flows)

**Kalau test fail di tier tertentu**:
- Unit test fail → kemungkinan logic salah di satu class
- Integration test fail → kemungkinan antar-module interaction salah
- E2E test fail → kemungkinan system-level issue (config, port, DB, dll)

---

## 🚨 Common Pitfalls & How to Avoid

### Pitfall 1: "Test jadi rusak setelah refactor, saya skip dulu"

**Salah**:
```typescript
it.skip('should increment totalRetryCount', ...);  // ❌ skip tanpa alasan
```

**Benar**:
```typescript
// TODO(fix-scheduler-refactor): update test to expect totalRetryCount=0
// karena increment pindah ke scheduler (PLAN1 section 10.2)
// Tracked in: TASK-test-sync-failures.md
it.skip('should increment totalRetryCount', ...);
```

---

### Pitfall 2: "Mock tidak perlu update, kan cuma test file"

**Salah**: Tambah method baru di real adapter, lupa update mock → test fail dengan `TypeError: X is not a function`.

**Benar**: Setiap tambah export/method di real adapter, update mock dalam commit yang sama.

---

### Pitfall 3: "Saya cuma ubah implementation, test tidak perlu di-run"

**Salah**: Refactor internal logic, tidak run test, ternyata break integration test.

**Benar**: Selalu run `pnpm test` setelah ubah kode, walau "cuma implementation detail".

---

### Pitfall 4: "Test fail, saya update test supaya PASS"

**Salah**: Langsung update assertion supaya match actual behavior, tanpa cek apakah behavior benar.

**Benar**: Ikuti decision framework di section "Decision Framework" — cek PLAN1 dulu sebelum update test.

---

### Pitfall 5: "Saya run test hanya di package yang saya ubah"

**Salah**: Ubah `packages/resilience`, hanya run `pnpm --filter @retry-failure/resilience test`, ternyata break test di `apps/payment-api` yang pakai mock file.

**Benar**: Run `pnpm test` di root project — catch cross-package regressions.

---

## 📚 Referensi

- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — development rules umum (root project, termasuk Rule #5: update scenario diagram kalau ubah test)
- [`docs/plan1-cockatiel-retry-failure/skenario/README.md`](./plan1-cockatiel-retry-failure/skenario/README.md) — **index file semua scenario diagrams** (Mermaid diagrams untuk test yang kompleks: retry-scheduler, idempotency, resilient-adapter, composition)
- [`docs/plan1-cockatiel-retry-failure/tasks/TASK-16-test-scenario-diagrams.md`](./plan1-cockatiel-retry-failure/tasks/TASK-16-test-scenario-diagrams.md) — task plan yang create scenario diagrams (post-plan documentation)
- [`docs/plan1-cockatiel-retry-failure/tasks/TASK-test-sync-failures.md`](./plan1-cockatiel-retry-failure/tasks/TASK-test-sync-failures.md) — bug analysis 7 failures yang inspire dokumen ini
- [`docs/plan1-cockatiel-retry-failure/PLAN1_Cockatiel_Retry_Failure_Scenario.md`](./plan1-cockatiel-retry-failure/PLAN1_Cockatiel_Retry_Failure_Scenario.md) — source of truth domain logic
- [`docs/plan1-cockatiel-retry-failure/e2e-results.md`](./plan1-cockatiel-retry-failure/e2e-results.md) — hasil E2E test + 20 bug history
- [`docs/SANDBOX_NOTES.md`](./SANDBOX_NOTES.md) — sandbox environment notes (testing-related)

---

## 📝 Update History

| Tanggal | Perubahan | Alasan |
|---|---|---|
| 2026-09-19 | Initial creation | Setelah insiden 7 test failures yang tidak terdeteksi lintas commit (DelegateBackoff mock missing + 6 out-of-sync tests dengan PLAN1) |
| 2026-09-19 | Tambah cross-link ke `docs/plan1-cockatiel-retry-failure/skenario/README.md` + `docs/plan1-cockatiel-retry-failure/tasks/TASK-16-test-scenario-diagrams.md` | Saat draft TASK-16 (test scenario diagrams) — visual diagrams untuk test kompleks jadi referensi pendamping rules ini |

---

**Ingat**: Test bukan beban — test adalah safety net yang menjaga Anda dari regression. Tapi safety net hanya bekerja kalau di-maintain dengan benar. 🪖
