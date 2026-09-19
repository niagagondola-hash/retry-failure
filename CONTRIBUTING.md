# CONTRIBUTING — Development Rules

> **Wajib dibaca sebelum mulai ngoding di proyek ini.**
> Aturan ini didirikan setelah insiden 7 test failures yang tidak terdeteksi lintas commit (lihat [docs/tasks/TASK-test-sync-failures.md](docs/tasks/TASK-test-sync-failures.md)).

> 📋 **Untuk rule khusus test maintenance + decision framework saat source vs test conflict**, lihat juga: [docs/TEST_MAINTENANCE_RULES.md](docs/TEST_MAINTENANCE_RULES.md)

---

## 🎯 Rule #1 (WAJIB): Test Setiap Perubahan Kode

> **Setiap commit yang mengubah source code WAJIB run `pnpm test` di root project SEBELUM commit.**

### Mengapa?

- Source code berubah tapi test tidak di-update → test fail tanpa terdeteksi
- Bug fix di satu package bisa break test di package lain (cross-package regression)
- Mock file (untuk testing) bisa out-of-sync dengan real adapter — test jadi misleading

### Cara Pakai

```bash
# Setelah selesai ubah kode, SEBELUM commit:
cd /home/z/my-project/retry-failure
pnpm test

# Kalau semua PASS → aman commit
# Kalau ada FAIL → fix dulu, jangan commit kondisi broken
```

### Rule Tambahan

1. **Jangan skip test dengan `.skip` tanpa dokumentasi**
   - Kalau harus skip, tambahkan comment: `// TODO(fix): reason + issue link`
2. **Jangan disable assertions**
   - Kalau assertion fail, investigate root cause, jangan di-comment
3. **Update test kalau behavior source sengaja berubah**
   - Tulis commit message yang jelas: "refactor: move totalRetryCount increment from service to scheduler (update tests)"
4. **Run full test suite, bukan hanya package yang diubah**
   - Mock file di `packages/resilience/__mocks__/` dipakai oleh `apps/payment-api` tests
   - Perubahan mock bisa affect tests di package lain

---

## 🎯 Rule #2 (WAJIB): Build Resilience Package Sebelum Test/App

> **Sebelum run `pnpm test` atau `pnpm dev`, pastikan `@retry-failure/resilience` sudah di-build.**

```bash
# Build ulang setelah ubah resilience package:
pnpm --filter @retry-failure/resilience build

# Atau pakai script dev yang sudah include build:
pnpm dev   # = build resilience + parallel start semua apps
```

### Mengapa?

`apps/payment-api` import dari `@retry-failure/resilience` (workspace package). Kalau `dist/` tidak ada atau outdated, TypeScript compiler akan error `Cannot find module '@retry-failure/resilience'`.

---

## 🎯 Rule #3 (RECOMMENDED): Test Isolation dengan Mocks

> **Mock file di `__mocks__/` harus maintain parity dengan real adapter API.**

### Aturan

1. **Setiap method/class yang di-export dari real adapter** → **harus juga di-export dari mock**
2. **Setiap signature change di real adapter** → **update mock juga**
3. **Comment di mock file harus menjelaskan kapan mock dipakai** (e.g., "Hanya saat `pnpm test`, bukan production")

### Contoh Bug yang Dicegah

```typescript
// REAL: src/policies/cockatiel-adapter.ts
export { retry, ExponentialBackoff, DelegateBackoff, ... };

// MOCK: __mocks__/cockatiel-adapter.ts
// ❌ BUG: lupa export DelegateBackoff
export { retry, ExponentialBackoff /* DelegateBackoff missing! */, ... };

// Test fail dengan error: "TypeError: DelegateBackoff is not a constructor"
// Padahal real adapter-nya OK. Mock out-of-sync.
```

### Pencegahan

- Saat tambah export baru di real adapter, **check mock file juga**
- Run `pnpm test` setelah tambah export, sebelum commit

---

## 🎯 Rule #4 (WAJIB): Update Test Saat Refactor Behavior

> **Saat refactor yang mengubah behavior (misal: pindah increment counter dari service ke scheduler), WAJIB update test yang meng-assert behavior tersebut.**

### Aturan

1. Identifikasi semua test yang meng-assert behavior yang akan diubah
2. Update test assertion supaya match dengan behavior baru
3. Kalau behavior baru belum jelas benar/salah, **diskusi dulu** jangan langsung update test
4. Commit message harus menjelaskan: "refactor X from A to B (update tests in Y, Z)"

### Contoh

```typescript
// BEFORE (service.ts):
async executePayment(...) {
  payment.totalRetryCount += 1;  // increment di service
  // ... execute ...
  return { ...payment };
}

// AFTER (refactor — pindah increment ke scheduler):
async executePayment(...) {
  // ❌ Tidak increment lagi — increment di scheduler.processOne()
  // ... execute ...
  return { ...payment };
}

// Test yang HARUS di-update:
// tests/payments.service.spec.ts
// ❌ expect(result.totalRetryCount).toBe(1);  // OLD — would fail
// ✅ expect(result.totalRetryCount).toBe(0);  // NEW — increment di scheduler
```

---

## 📋 Pre-Commit Checklist

Sebelum `git commit`, pastikan:

- [ ] `pnpm test` PASS di root project (tidak hanya satu package)
- [ ] `pnpm --filter @retry-failure/resilience build` sukses
- [ ] Tidak ada test yang di-`.skip` tanpa dokumentasi
- [ ] Tidak ada assertion yang di-comment
- [ ] Kalau source behavior berubah, test sudah di-update
- [ ] Kalau tambah export baru di adapter, mock juga di-update
- [ ] Commit message menjelaskan perubahan + impact ke test

---

## 🛠 Commands Reference

```bash
# Build
pnpm --filter @retry-failure/resilience build
pnpm build                              # build semua packages

# Test
pnpm test                               # run semua test di semua package
pnpm --filter @retry-failure/resilience test
pnpm --filter payment-api test

# Test E2E (membutuhkan backend berjalan)
pnpm test:e2e                           # run semua E2E test

# Dev (auto-build resilience + start semua apps)
pnpm dev

# Lint
pnpm lint                               # lint semua packages
pnpm --filter @retry-failure/resilience lint

# Typecheck
pnpm typecheck                          # typecheck semua packages
```

---

## 📚 Referensi

- [docs/TEST_MAINTENANCE_RULES.md](docs/TEST_MAINTENANCE_RULES.md) — **rule khusus test maintenance** + decision framework saat source vs test conflict + mock parity checklist + common pitfalls
- [docs/tasks/TASK-test-sync-failures.md](docs/tasks/TASK-test-sync-failures.md) — catatan lengkap 7 failures yang inspire rule ini
- [docs/PLAN1_Cockatiel_Retry_Failure_Scenario.md](docs/PLAN1_Cockatiel_Retry_Failure_Scenario.md) — **source of truth domain logic** — saat konflik source vs test, cek PLAN1
- [docs/e2e-results.md](docs/e2e-results.md) — hasil E2E test + bug history (20 bug)
- [docs/tasks/SANDBOX_NOTES.md](docs/tasks/SANDBOX_NOTES.md) — sandbox environment notes

---

## 🚨 Insiden Yang Dicegah Rule Ini

| Insiden | Root Cause | Rule Pencegah |
|---|---|---|
| 9 tests fail `DelegateBackoff is not a constructor` | Mock lupa export `DelegateBackoff` | Rule #3 — mock parity |
| 3 tests fail `executePayment` not called | Mock repo tidak implement `atomicUpdateStatus` (source ditambah commit refaktor) | Rule #4 — update test saat refactor |
| 3 tests fail `totalRetryCount` expect 1 got 0 | Increment pindah dari service ke scheduler, test tidak update | Rule #4 — update test saat refactor |
| 1 test fail `http.post` extra `timeout` field | Bug fix race condition tambah `timeout` ke axios, test tidak update assertion | Rule #1 + #4 — test setelah ubah + update test saat refactor |

---

**Ingat**: Test bukan beban — test adalah safety net. Setiap kali Anda skip test, Anda naik motor tanpa helm. 🪖
