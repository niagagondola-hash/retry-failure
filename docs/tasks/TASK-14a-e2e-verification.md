# TASK-14a — Manual E2E Verification Guide

> **Task ID**: 14a (parent)
> **Depends on**: TASK-14 (E2E specs created)
> **Purpose**: Memberikan prosedur verifikasi manual per-skenario, supaya kamu tidak hanya percaya "green tick" Jest, tapi bisa **membuktikan** bahwa test benar-benar mengeksekusi alur yang diharapkan — dari input HTTP sampai side-effect di PostgreSQL, metrics, dan gateway mock.

---

## 1. Apakah perlu log ke file dari tiap proses?

**Jawaban: Ya, sangat disarankan.** Tapi tidak perlu mengubah kode aplikasi untuk menulis log sendiri — cukup redirect stdout/stderr saat menjalankan test.

### Kenapa perlu?

| Tanpa log file | Dengan log file |
|---|---|
| Test pass/fail saja — kalau gagal, kamu harus run ulang untuk lihat error | Punya evidence lengkap untuk inspeksi ulang |
| Susah bandingkan run ke-1 vs ke-2 (apa bedanya?) | Bisa `diff` antar run |
| Tidak bisa dilampirkan ke `docs/e2e-evidence/` | Bisa dilampirkan sebagai bukti DoD |

### Cara: gunakan `tee`

```bash
mkdir -p logs/e2e

# Jalankan test + simpan output ke file sekaligus tampilkan ke terminal
cd apps/payment-api
pnpm test:e2e:transient 2>&1 | tee ../logs/e2e/S1-transient-$(date +%s).log
```

### 3 proses yang harus log-nya disimpan

Untuk satu skenario yang dijalankan manual, idealnya simpan log dari **3 sumber**:

1. **payment-api** (port 3001) — untuk lihat Cockatiel retry event, state machine transition, audit write
2. **gateway-mock** (port 3002) — untuk lihat charge request masuk, mode handler, idempotency replay
3. **jest runner** — output assertion pass/fail

```bash
# Terminal 1 — payment-api + log
cd apps/payment-api && PORT=3001 pnpm start:dev 2>&1 | tee ../../logs/e2e/payment-api-$(date +%s).log

cd apps/payment-api; $env:PORT=3001; pnpm start:dev 2>&1 | Tee-Object -FilePath "..\logs\e2e\payment-api-$([DateTimeOffset]::Now.ToUnixTimeSeconds()).log"

# Terminal 2 — gateway-mock + log
cd apps/payment-gateway-mock && PORT=3002 pnpm start:dev 2>&1 | tee ../../logs/e2e/gateway-mock-$(date +%s).log

cd apps/payment-gateway-mock; $env:PORT=3002; pnpm start:dev 2>&1 | Tee-Object -FilePath "..\logs\e2e\gateway-mock-$([DateTimeOffset]::Now.ToUnixTimeSeconds()).log"

# Terminal 3 — jest + log
cd apps/payment-api && pnpm test:e2e:transient 2>&1 | tee ../logs/e2e/S1-transient-$(date +%s).log
```

> Tip: timestamp di nama file (`%s`) supaya log tidak tertimpa antar run.

---

## 2. Arsiptektur Sistem — Visualisasi Umum

Diagram ini menunjukkan **semua komponen yang terlibat** dari input HTTP sampai PostgreSQL. Setiap skenario akan melalui subset jalur yang berbeda — detailnya di file subtask `TASK-14a-<scenario>.md`.

```mermaid
flowchart TB
    subgraph TEST["Jest Runner (test:e2e)"]
        T1[helpers/payments.ts<br/>createPayment]
        T2[helpers/gateway.ts<br/>setGatewayMode]
        T3[helpers/metrics.ts<br/>getMetric]
        T4[helpers/db.ts<br/>queryAttempts]
    end

    subgraph API["payment-api (NestJS :3001)"]
        C1[PaymentsController<br/>POST /payments]
        C2[MetricsController<br/>GET /metrics]
        S1[PaymentsService<br/>state machine]
        S2[RetryScheduler<br/>@nestjs/schedule]
        GA1[HttpGatewayAdapter<br/>axios]
        GA2[ResilientPaymentGateway<br/>wraps GA1]
        RB[Cockatiel policies<br/>retry + timeout + breaker]
        AS[AuditService<br/>write payment_attempts]
        MS[MetricsService<br/>prom-client]
        TC[TraceContext<br/>AsyncLocalStorage]
    end

    subgraph GW["payment-gateway-mock (NestJS :3002)"]
        GC1[ChargesController<br/>POST /v1/charges]
        GC2[AdminController<br/>PUT /admin/config<br/>GET /admin/stats]
        MH[ModeHandler<br/>8 modes]
        MS2[MockState<br/>counters + idempotency store]
    end

    subgraph DB["PostgreSQL"]
        P[(payments)]
        PA[(payment_attempts)]
    end

    subgraph PROM["Prometheus text"]
        M[/metrics endpoint<br/>counters + gauges/]
    end

    T1 -->|POST /payments| C1
    T2 -->|PUT /admin/config| GC2
    T3 -->|GET /metrics| C2
    T4 -->|SELECT direct| PA

    C1 --> S1
    S1 -->|charge via port| GA2
    GA2 --> RB
    RB --> GA1
    GA1 -->|POST /v1/charges| GC1
    GC1 --> MH
    MH --> MS2

    S1 -->|record attempt| AS
    AS --> PA
    S1 -->|update status| P

    S1 -->|inc counter| MS
    MS --> M
    GA2 -->|breaker state gauge| MS

    S2 -->|@Cron every SCHEDULER_INTERVAL_MS| S1
    S2 -->|select next_retry_at <= now()| P

    style TEST fill:#fef9c3,stroke:#a16207
    style API fill:#dcfce7,stroke:#15803d
    style GW fill:#fee2e2,stroke:#b91c1c
    style DB fill:#e0e7ff,stroke:#4338ca
    style PROM fill:#f3e8ff,stroke:#7e22ce
```

---

## 3. Lapisan Verifikasi — 5 Lapis Bukan 1

**Jangan hanya lihat "Tests: 1 passed"**. Untuk membuktikan test benar-benar menguji skenario, verifikasi di **5 lapis**:

| Lapis | Apa yang dicek | Sumber data |
|---|---|---|
| **L1: HTTP response** | Status & body sesuai ekspektasi | Jest assertion (otomatis) |
| **L2: DB state** | `payments.status`, `payment_attempts` count & outcome | `queryAttempts` / `queryPayment` helper |
| **L3: Metrics counter** | Counter naik sesuai jumlah event | `getMetric` helper → `/metrics` |
| **L4: Gateway mock stats** | `actualChargesCount`, `requestCount` (untuk idempotensi) | `getGatewayStats` → `/admin/stats` |
| **L5: Log Cocaktiel** | Retry event, breaker state transition, audit write | `logs/e2e/payment-api-*.log` |

Untuk setiap skenario, file subtask `TASK-14a-<scenario>.md` akan menjelaskan **persis nilai ekspektasi** di setiap lapis.

---

## 4. Indeks Subtask Per-Skenario

| # | Skenario | File subtask | File test |
|---|---|---|---|
| 1 | Transient failure (fail-first-n=2) | [TASK-14a-transient.md](./TASK-14a-transient.md) | `payments.transient.e2e-spec.ts` |
| 2 | Permanent failure (client-error) | [TASK-14a-permanent.md](./TASK-14a-permanent.md) | `payments.permanent.e2e-spec.ts` |
| 3 | Circuit breaker (always-timeout) | [TASK-14a-circuit-breaker.md](./TASK-14a-circuit-breaker.md) | `payments.circuit-breaker.e2e-spec.ts` |
| 4 | Anti double-charge HERO (succeed-but-drop-response) | [TASK-14a-idempotency.md](./TASK-14a-idempotency.md) | `payments.idempotency.e2e-spec.ts` |
| 5 | Retry-After (rate-limited) | [TASK-14a-retry-after.md](./TASK-14a-retry-after.md) | `payments.retry-after.e2e-spec.ts` |
| 6 | Durable scheduler retry | [TASK-14a-durable-scheduler.md](./TASK-14a-durable-scheduler.md) | `payments.durable-scheduler.e2e-spec.ts` |
| 7 | Total retry exhaustion | [TASK-14a-exhaustion.md](./TASK-14a-exhaustion.md) | `payments.exhaustion.e2e-spec.ts` |

---

## 5. Cara Run Test Per-File (Ringkasan)

Setelah update `package.json` (lihat bawah), 3 cara bisa dipakai:

### Cara A — pakai named script (paling mudah)
```bash
cd apps/payment-api
pnpm test:e2e:transient
```

### Cara B — pakai generic script + pattern
```bash
cd apps/payment-api
pnpm test:e2e:file payments.transient
```
(`jest` akan match `payments.transient` sebagai path-pattern.)

### Cara C — pakai jest langsung
```bash
cd apps/payment-api
pnpm exec jest --config ./tests/e2e/jest-e2e.json --runInBand tests/e2e/payments.transient.e2e-spec.ts
```

### Dengan output ke file log
```bash
mkdir -p logs/e2e
pnpm test:e2e:transient 2>&1 | tee logs/e2e/S1-transient-$(date +%s).log
```

### Run hanya 1 `it()` block dalam file
```bash
pnpm exec jest --config ./tests/e2e/jest-e2e.json --runInBand \
  --testNamePattern="3 payments" \
  tests/e2e/payments.circuit-breaker.e2e-spec.ts
```

---

## 6. Named scripts yang ditambahkan ke `apps/payment-api/package.json`

```jsonc
"scripts": {
  // ... existing scripts ...

  // Run all e2e (existing)
  "test:e2e": "jest --config ./tests/e2e/jest-e2e.json --runInBand",

  // Run e2e by path pattern (generic)
  "test:e2e:file": "jest --config ./tests/e2e/jest-e2e.json --runInBand",

  // Run each scenario directly
  "test:e2e:transient":         "jest --config ./tests/e2e/jest-e2e.json --runInBand tests/e2e/payments.transient.e2e-spec.ts",
  "test:e2e:permanent":         "jest --config ./tests/e2e/jest-e2e.json --runInBand tests/e2e/payments.permanent.e2e-spec.ts",
  "test:e2e:circuit-breaker":   "jest --config ./tests/e2e/jest-e2e.json --runInBand tests/e2e/payments.circuit-breaker.e2e-spec.ts",
  "test:e2e:idempotency":       "jest --config ./tests/e2e/jest-e2e.json --runInBand tests/e2e/payments.idempotency.e2e-spec.ts",
  "test:e2e:retry-after":       "jest --config ./tests/e2e/jest-e2e.json --runInBand tests/e2e/payments.retry-after.e2e-spec.ts",
  "test:e2e:durable-scheduler": "jest --config ./tests/e2e/jest-e2e.json --runInBand tests/e2e/payments.durable-scheduler.e2e-spec.ts",
  "test:e2e:exhaustion":        "jest --config ./tests/e2e/jest-e2e.json --runInBand tests/e2e/payments.exhaustion.e2e-spec.ts"
}
```

---

## 7. Checklist pra-run (wajib sebelum test bisa jalan)

```
☐ PostgreSQL running (docker compose up -d postgres)
☐ pnpm db:migrate sudah dijalankan sekali
☐ payment-api berjalan di :3001 (cek: curl http://localhost:3001/health)
☐ gateway-mock berjalan di :3002 (cek: curl http://localhost:3002/admin/config)
☐ package @retry-failure/resilience sudah build (pnpm build:resilience)
☐ Untuk skenario 3 & 5: gateway mock dalam mode "always-success" sebelum test mulai
☐ Untuk skenario 6: SCHEDULER_INTERVAL_MS=5000 diset di env payment-api
```

Jika salah satu hilang, test akan fail dengan error yang **bukan menunjukkan masalah test**, tapi masalah infrastruktur. Jangan dipaksakan — perbaiki dulu.
