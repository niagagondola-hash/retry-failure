# TASK-13 — E2E Scenarios via Agent Browser

> **Task ID**: 10
> **Depends on**: 7 (scheduler) + 8 (observability) + 9 (frontend dashboard)
> **Estimated effort**: M (~1.5 jam)
> **Plan reference**: Section 14.2 (E2E scenarios), Section 17 (Demonstration), Section 22 (Definition of Done)

---

## Goal

Verifikasi end-to-end 7 scenario dari plan section 14.2 + 5 demo dari section 17 menggunakan **Agent Browser** (per skill `agent-browser`). Hasil: tabel pass/fail + evidence (screenshot/log snippet) di `docs/e2e-results.md`.

## Scope

**In scope**:
- Jalankan Agent Browser untuk navigate, click, assert.
- Eksekusi 7 scenario (plan section 14.2):
  1. Transient failure (`fail-first-n=2`)
  2. Permanent failure (`client-error`)
  3. Circuit breaker (`always-timeout`)
  4. Anti double-charge (`succeed-but-drop-response`) — hero
  5. Retry-After (`rate-limited`)
  6. Durable scheduler retry
  7. Total retry exhaustion
- For each: verifikasi di DB (`payment_attempts`), metrics, dan log.
- Document hasil di `/home/z/my-project/docs/e2e-results.md`.
- Bila ada failure → root cause + perbaiki di task terkait (loop back).

**Out of scope**:
- Performance/load testing (out-of-scope per plan section 19).
- Distributed/multi-instance test (single-instance demo).

## Pre-conditions

- TASK-01..12 selesai.
- Services berjalan:
  - `bun run dev` (Next.js, port 3000)
  - `mini-services/payment-gateway-mock` (port 3001)
  - `mini-services/retry-scheduler` (port 3002)
- DB bersih atau minimal: tidak ada payment `processing` yang hanging.

## Scenarios & expected results

### Scenario 1 — Transient failure (plan 14.2 #1)
- Setup: gateway mode `fail-first-n`, n=2.
- Action: POST `/api/payments` with `{ orderId: 'E2E-1-<ts>', amount: 100 }`.
- Expected:
  - `payment.status === 'succeeded'`
  - `payment.attemptCount === 3`
  - `payment_attempts`: 3 rows (outcome: `retryable_failure`, `retryable_failure`, `success`)

### Scenario 2 — Permanent failure (plan 14.2 #2)
- Setup: gateway mode `client-error`.
- Action: POST `/api/payments` with `{ orderId: 'E2E-2-<ts>', amount: 100 }`.
- Expected:
  - `payment.status === 'failed'`
  - `payment.attemptCount === 1`
  - `payment.failureReason` contains `'invalid_card'`
  - `payment_attempts`: 1 row (outcome: `permanent_failure`)

### Scenario 3 — Circuit breaker (plan 14.2 #3)
- Setup: gateway mode `always-timeout`, `BREAKER_FAILURE_THRESHOLD=3`.
- Action: POST 3 payments (will all fail → breaker OPEN). POST 4th payment.
- Expected:
  - First 3 payments: `scheduled_for_retry` (retry exhausted), breaker state transition `closed → open`.
  - 4th payment: status `scheduled_for_retry` dengan `errorCode: 'circuit_open'` di attempt pertama.
  - Metrics: `circuit_breaker_state{service="payment-gateway"} === 1`.

### Scenario 4 — Anti double-charge (plan 14.2 #4, hero)
- Setup: gateway mode `succeed-but-drop-response`.
- Action: POST payment. Wait for retry.
- Expected:
  - `payment.status === 'succeeded'`
  - `payment_attempts`: ≥2 rows; attempt #2 has `gatewayReference` set AND `replayed === true` (per gateway stats).
  - `GET /admin/stats?XTransformPort=3001` → `actualCharges === 1` (verify via gateway mock stats).
  - `gateway_idempotent_replays_total` metric incremented.

### Scenario 5 — Retry-After (plan 14.2 #5)
- Setup: gateway mode `rate-limited`, `retryAfterSeconds=3`.
- Action: POST payment. Measure timestamps.
- Expected:
  - `payment.status === 'failed'` OR `scheduled_for_retry` (because rate-limited keeps failing — depends on config; for demo, after retry exhausted → scheduled).
  - `payment_attempts.delay_before_next_ms >= 3000` for attempts that got 429.
  - Time between attempt #1 finish and attempt #2 start ≥ 3000ms (verify via `created_at` delta).

### Scenario 6 — Durable scheduler retry (plan 14.2 #6)
- Setup: gateway mode `server-error` initially.
- Action: POST payment → status `scheduled_for_retry` (Cockatiel exhausted). Wait. Switch gateway to `always-success`. Wait ≤ `SCHEDULER_INTERVAL_MS + buffer`.
- Expected:
  - Scheduler polls (check `/tmp/scheduler.log`).
  - After gateway switch: scheduler calls `POST /api/payments/:id/retry`.
  - Payment transitions `scheduled_for_retry → processing → succeeded`.
  - `payment.totalRetryCount === 1`.

### Scenario 7 — Total retry exhaustion (plan 14.2 #7)
- Setup: gateway mode `server-error` persistent. `MAX_TOTAL_RETRIES=5`, `SCHEDULER_INTERVAL_MS=5000`.
- Action: POST payment. Wait ~30s (6+ cycles).
- Expected:
  - Payment status `failed` after `totalRetryCount >= 5`.
  - `payment.failureReason` indicates `max_total_retries_exceeded`.
  - Scheduler no longer picks this payment (status no longer `scheduled_for_retry`).

## Files to create

- `/home/z/my-project/docs/e2e-results.md` — table with scenario, status, evidence, notes.

## Implementation steps

1. Pastikan semua services berjalan. Verifikasi via:
   ```bash
   curl -s http://localhost:3000/api/health | jq .
   curl -s http://localhost:3001/admin/config | jq .
   curl -s http://localhost:3002/ | jq .
   ```
2. Invoke `Skill(command="agent-browser")` untuk load Agent Browser instructions.
3. Untuk setiap scenario:
   a. Reset state: `curl -X PUT .../admin/config -d '{"mode":"always-success"}'`, wait 1s.
   b. Set target mode.
   c. Either:
      - **Programmatic**: drive via curl + verify DB/metrics directly (faster).
      - **UI-driven**: open `/` in Agent Browser, click Demo Scenario button, wait, verify.
   d. Capture evidence:
      - `payment` JSON (`curl /api/payments/:id`).
      - `payment_attempts` rows (sqlite3 query).
      - Relevant metrics (`curl /api/metrics | grep <metric>`).
      - Screenshot (Agent Browser) untuk UI-driven scenarios.
   e. Mark pass/fail in `docs/e2e-results.md`.
4. Bila ada failure: root cause analysis, fix di task terkait, re-run scenario.

## Acceptance criteria

- [ ] Semua 7 scenario dijalankan (tidak skip).
- [ ] `docs/e2e-results.md` berisi table dengan minimal: scenario, status (PASS/FAIL), evidence (JSON snapshot or screenshot path), notes.
- [ ] Scenario 4 (hero) PASS: `actualCharges=1`, `replays>=1`, `payment.status='succeeded'`.
- [ ] Scenario 5 PASS: `delay_before_next_ms >= retryAfterSeconds*1000`.
- [ ] Scenario 6 PASS: scheduler memproses due payment end-to-end.
- [ ] Scenario 7 PASS: `totalRetryCount >= MAX_TOTAL_RETRIES` sebelum `failed`.
- [ ] Bila ada FAIL: ada root cause note + plan follow-up (bukan task ini).
- [ ] Dev server tidak crash selama seluruh run (cek `dev.log`).
- [ ] Tidak ada error console di Agent Browser snapshot.

## Useful commands (run after completing this task)

```bash
# 0. Pastikan semua service up
curl -sf http://localhost:3000/api/health || echo "payment-api DOWN"
curl -sf http://localhost:3001/admin/config || echo "gateway-mock DOWN"
curl -sf http://localhost:3002/ || echo "scheduler DOWN"

# 1. View e2e results
cat /home/z/my-project/docs/e2e-results.md

# 2. Summary count
grep -c '| PASS |' /home/z/my-project/docs/e2e-results.md
grep -c '| FAIL |' /home/z/my-project/docs/e2e-results.md

# 3. Verify no orphaned processing payments
sqlite3 /home/z/my-project/db/custom.db "SELECT COUNT(*) FROM Payment WHERE status='processing';"
# expected: 0

# 4. Verify final metrics snapshot
curl -s http://localhost:3000/api/metrics | grep -E 'payment_gateway_requests_total|retry_attempts_total|circuit_breaker_state|payments_current_status|gateway_idempotent_replays_total' | head -30

# 5. Cleanup test data (optional)
# sqlite3 /home/z/my-project/db/custom.db "DELETE FROM PaymentAttempt; DELETE FROM Payment WHERE orderId LIKE 'E2E-%';"

# 6. Final dev log check
tail -n 80 /home/z/my-project/dev.log | grep -iE 'error|warn' | head -20
```

## Notes

- **Use Agent Browser** untuk scenario yang melibatkan UI (Demo A–E buttons). Untuk pure API scenarios (1, 2, 5, 6, 7), curl + DB inspection cukup.
- **Hero scenario (4)** wajib PASS. Jika tidak, plan section 22 DoD gagal.
- **Don't reset DB mid-run**: scenario 6 & 7 butuh scheduler cycle; reset DB akan invalidate state.
- **Bila breaker OPEN blocks scenario 1**: ingat breaker singleton survive across requests. Reset dengan: ganti mode ke `always-success`, tunggu `BREAKER_COOLDOWN_MS` (10s), lalu buat 1 payment sukses → breaker pindah ke HALF_OPEN lalu CLOSED.
- **Trace ID verification**: di setiap scenario, cek `payment_attempts.trace_id` — semua attempts dalam satu payment harus punya trace_id yang sama (bila dari satu execution cycle).
- Setelah task ini selesai, TASK-14 (documentation) dapat memakai hasil e2e sebagai evidence di README.
