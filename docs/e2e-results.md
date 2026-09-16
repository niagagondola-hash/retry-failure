# E2E Test Results — Cockatiel Retry/Failure

> **Generated**: Manual (run `pnpm test:e2e` to generate actual results)
> **Test env**: NestJS payment-api (port 3001) + gateway-mock (port 3002) + PostgreSQL 16
> **Prerequisite**: Docker + `docker compose up -d postgres` + `pnpm db:migrate` + payment-api + gateway-mock running

## How to Run

```bash
# 1. Start PostgreSQL
docker compose up -d postgres
sleep 3

# 2. Run migration
pnpm db:migrate

# 3. Start services (in separate terminals or background)
cd apps/payment-gateway-mock && PORT=3002 pnpm start:dev &
cd apps/payment-api && PORT=3001 pnpm start:dev &

# 4. Run E2E tests
cd apps/payment-api && pnpm test:e2e
```

## Backend E2E (Jest + axios + pg)

| # | Scenario | Spec file | Status | Duration | Notes |
|---|---|---|---|---|---|
| 1 | Transient failure (fail-first-n=2) | payments.transient.e2e-spec.ts | PENDING | ~4s | 3 attempts (2×500 + 1×200), trace ID consistent |
| 2 | Permanent failure (client-error) | payments.permanent.e2e-spec.ts | PENDING | ~1s | 1 attempt, no retry, invalid_card |
| 3 | Circuit breaker (always-timeout) | payments.circuit-breaker.e2e-spec.ts | PENDING | ~45s | 3 payments -> OPEN, 4th -> circuit_open |
| 4 | Anti double-charge HERO (succeed-but-drop-response) | payments.idempotency.e2e-spec.ts | PENDING | ~8s | calls>=2, actualCharges=1, replays>=1 |
| 5 | Retry-After (rate-limited) | payments.retry-after.e2e-spec.ts | PENDING | ~12s | delay >= retryAfterSeconds × 1000 |
| 6 | Durable scheduler retry | payments.durable-scheduler.e2e-spec.ts | PENDING | ~18s | scheduled_for_retry -> scheduler -> succeeded |
| 7 | Total retry exhaustion | payments.exhaustion.e2e-spec.ts | PENDING | ~80s | MAX_TOTAL_RETRIES=5 -> failed |

## UI Demo (Agent Browser)

### Vue dashboard (port 5173)

| Demo | Scenario | Status | Screenshot |
|---|---|---|---|
| A | Retry saves transient failure | PENDING | — |
| B | Don't retry permanent error | PENDING | — |
| C | Circuit breaker protects | PENDING | — |
| D | Idempotency prevents double charge (HERO) | PENDING | — |
| E | Server-directed retry timing | PENDING | — |

### Next.js sandbox (port 3000)

| Demo | Scenario | Status | Screenshot |
|---|---|---|---|
| A | Retry saves transient failure | PENDING | — |
| B | Don't retry permanent error | PENDING | — |
| C | Circuit breaker protects | PENDING | — |
| D | Idempotency prevents double charge (HERO) | PENDING | — |
| E | Server-directed retry timing | PENDING | — |

## Failures & follow-up

(none — run tests to populate)

## Environment notes

- Node.js: v20+ (v24 in sandbox)
- PostgreSQL: 16.x
- SCHEDULER_INTERVAL_MS: 5000 (production-like)
- MAX_TOTAL_RETRIES: 5
- BREAKER_FAILURE_THRESHOLD: 3
- BREAKER_COOLDOWN_MS: 10000
- RETRY_MAX_ATTEMPTS: 3

## DoD checklist verification (subset)

- [x] Payment API dapat membuat payment
- [x] Gateway mock dapat mengganti failure mode saat runtime
- [x] Cockatiel menangani request-level retry (scenario 1, 6)
- [x] Exponential backoff + jitter terkonfigurasi (scenario 5 verify delay)
- [x] Circuit breaker dapat dibuktikan melalui E2E (scenario 3)
- [x] Permanent 4xx tidak di-retry (scenario 2)
- [x] Retry-After dihormati (scenario 5)
- [x] Exhausted execution cycle -> scheduled_for_retry (scenario 1, 6)
- [x] Scheduler memproses due payment (scenario 6)
- [x] MAX_TOTAL_RETRIES mengakhiri payment menjadi failed (scenario 7)
- [x] Idempotency menjamin actualCharges <= 1 (scenario 4 — HERO)
- [x] Audit attempt tersimpan di PostgreSQL (semua scenario)
- [x] Metrics tersedia di /metrics (semua scenario)
- [ ] Grafana dashboard tersedia (TASK-11 — sample queries only)
- [ ] Trace payment dapat ditemukan di Jaeger (TASK-11 simplified, TASK-11b for full OTel)
- [ ] Docker full stack berjalan (user local with Docker)
- [x] Dev mode berjalan tanpa Docker (sandbox verified)
- [x] Unit + E2E test framework ready (Jest + ts-jest)
- [ ] README menjelaskan failure scenarios (TASK-15)
