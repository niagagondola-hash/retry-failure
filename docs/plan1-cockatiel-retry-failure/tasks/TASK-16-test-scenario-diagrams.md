# TASK-16 - Test Scenario Diagrams

> **Task ID**: 16
> **Depends on**: TASK-15 (Documentation, Demo Guide & Production Caveats) — TASK-15 boleh paralel, tapi sebaiknya selesai dulu supaya TASK-15 business docs tidak terganggu
> **Estimated effort**: M (~3-4 jam — 4 scenario files + 1 index, ~16 Mermaid diagrams total)
> **Plan reference**: Tidak ada di PLAN1 asli — ini adalah post-plan documentation (extension)
> **Created after**: Insiden 7 test failures yang sulit dipahami tanpa visual flow (lihat [`TASK-test-sync-failures.md`](./TASK-test-sync-failures.md))

---

## Goal

Menyusun **diagram visual Mermaid** untuk skenario test yang kompleks, agar tim dan developer baru dapat memahami flow test dengan cepat tanpa harus baca ratusan baris kode test.

**Target audience**: Tim developer yang maintain test (internal engineering), BUKAN stakeholder business. TASK-15 fokus business docs, TASK-16 fokus engineering docs.

**Output**: Folder `docs/skenario/` dengan 1 file Markdown per spec module (prioritas awal 4 file), berisi diagram Mermaid + narasi detailed per describe block.

---

## Scope

### In scope (prioritas awal — 4 files)

| Priority | Spec File | Scenario File Output | Diagrams Est. | Complexity |
|---|---|---|---|---|
| 1 | `apps/payment-api/tests/modules/retry-scheduler/retry-scheduler.service.spec.ts` | `docs/skenario/retry-scheduler-service-scenario.md` | ~4 | High |
| 2 | `apps/payment-api/tests/modules/payments/idempotency.spec.ts` | `docs/skenario/idempotency-scenario.md` | ~3 | Medium (pure functions) |
| 3 | `apps/payment-api/tests/modules/gateway/resilient-adapter.spec.ts` | `docs/skenario/resilient-adapter-scenario.md` | ~5 | High |
| 4 | `packages/resilience/tests/policies/composition.spec.ts` | `docs/skenario/composition-scenario.md` | ~6 | High |

Plus 1 index file: `docs/skenario/README.md`.

### Out of scope

- **E2E tests** — sudah terdokumentasi di [`TASK-14-e2e-scenarios.md`](./TASK-14-e2e-scenarios.md) + [`docs/e2e-results.md`](../e2e-results.md)
- **Simple pure-function tests** (audit.service, classifier, retry-after, idempotency-key, payments.controller, state-machine) — terlalu sederhana untuk perlu diagram
- **TASK-15 business docs** — separate task, jangan campur
- **Implementation code changes** — TASK-16 murni dokumentasi visual
- **Automation/CI** — diagram di-update manual sesuai [CONTRIBUTING.md](../../../CONTRIBUTING.md) rule
- **Non-Mermaid format** (PNG/SVG/Excalidraw) — Mermaid saja supaya render native di GitHub/VS Code

---

## Files to create

### Files to create (5)

1. **`docs/skenario/README.md`** — index file, list semua scenario diagrams + conventions + cara tambah diagram baru
2. **`docs/skenario/retry-scheduler-service-scenario.md`** — diagrams for `retry-scheduler.service.spec.ts`
3. **`docs/skenario/idempotency-scenario.md`** — diagrams for `idempotency.spec.ts`
4. **`docs/skenario/resilient-adapter-scenario.md`** — diagrams for `resilient-adapter.spec.ts`
5. **`docs/skenario/composition-scenario.md`** — diagrams for `composition.spec.ts`

### Files to modify (3)

1. **`CONTRIBUTING.md`** (root) — tambah Rule #5: "Update scenario diagram kalau ubah test yang sudah ada diagram-nya"
2. **`docs/TEST_MAINTENANCE_RULES.md`** — tambah cross-link ke `docs/skenario/README.md` di section "Referensi"
3. **`docs/tasks/README.md`** — tambah section "7. Test Scenario Diagrams (post-plan)" dengan link ke `docs/skenario/README.md` + TASK-16

---

## File naming convention

Pattern: `<spec-file-name-without-.spec.ts>-scenario.md` (titik diganti dash)

| Spec File | Scenario File |
|---|---|
| `retry-scheduler.service.spec.ts` | `retry-scheduler-service-scenario.md` |
| `idempotency.spec.ts` | `idempotency-scenario.md` |
| `resilient-adapter.spec.ts` | `resilient-adapter-scenario.md` |
| `composition.spec.ts` | `composition-scenario.md` |

---

## Diagram conventions

### Format: Mix (sesuai konteks)

| Diagram Type | When to Use | Example Use Case |
|---|---|---|
| **Sequence diagram** | Interaksi antar multiple components dengan urutan waktu | scheduler → repo → service → audit |
| **Flowchart** | Decision tree, branching logic tanpa waktu | re-entrancy guard, MAX_TOTAL_RETRIES check |
| **State diagram** | State machine transitions | payment status: processing → succeeded/failed/scheduled_for_retry |

### Level of detail: Per Describe Block (middle detailed)

- 1 diagram per `describe` block (bukan per test case, bukan per file)
- Kalau `describe` block punya 5 test case, 1 diagram gabungan yang cover semua 5 case
- Kalau test case terlalu unik/complex (e.g., re-entrancy guard), boleh diagram terpisah

### Narasi: Lengkap (Opsi C)

Setiap diagram wajib punya section:

1. **Heading** — nama describe block + test case range
2. **Setup** — mock configuration, initial state
3. **Flow** — Mermaid diagram
4. **Key assertions** — bullet list apa yang di-verify
5. **Common pitfalls** — gotchas yang sering bikin test fail
6. **PLAN1 reference** — section + line number (kalau relevan, case-by-case)

### PLAN1 reference: Wajib kalau relevan saja

- Test yang verify domain behavior (scheduler increment, idempotency invariant, breaker state) → wajib cite PLAN1 section
- Test yang pure implementation detail (mock setup, helper functions) → boleh skip PLAN1 reference

---

## Per-module breakdown

### Module 1: retry-scheduler-service-scenario.md

Source spec: `apps/payment-api/tests/modules/retry-scheduler/retry-scheduler.service.spec.ts` (8 tests, 3 describe blocks)

**Diagrams to create (~4)**:

1. **`RetrySchedulerService - poll`** (cover tests #1-#5: idle, process, continue-on-failure, DB-error, re-entrancy)
   - 1 sequence diagram: poll() → findDueRetries → processOne loop → executePayment
   - 1 flowchart: re-entrancy guard decision tree
   - Setup: mock repo with `atomicUpdateStatus: jest.fn(async () => true)`
   - Common pitfalls: extra microtask yield needed karena `atomicUpdateStatus` adalah async hop sebelum `executePayment`
   - PLAN1 reference: Section 10.2 (line 525-533), Section 12 (line 604-610)

2. **`RetrySchedulerService - getStats`** (cover tests #6-#7: initial stats, running status)
   - 1 state diagram: status transition idle ↔ running
   - Simple — pure getter, tidak perlu sequence diagram kompleks
   - PLAN1 reference: tidak relevan (implementation detail)

3. **`RetrySchedulerService - onApplicationBootstrap`** (cover test #8: register interval)
   - 1 sequence diagram: NestJS lifecycle → SchedulerRegistry.addInterval
   - PLAN1 reference: Section 12 (line 586-610)

4. **Bonus: `processOne()` deep dive** (untuk context tests #1-#5)
   - 1 flowchart: MAX_TOTAL_RETRIES check + atomicUpdateStatus + executePayment
   - PLAN1 reference: Section 10.2 (line 529-533)

---

### Module 2: idempotency-scenario.md

Source spec: `apps/payment-api/tests/modules/payments/idempotency.spec.ts` (6 tests, 2 describe blocks)

**Diagrams to create (~3)**:

1. **`deriveIdempotencyKey`** (cover tests #1-#2: returns paymentId, throws on empty/whitespace)
   - 1 flowchart: input validation → return paymentId / throw
   - PLAN1 reference: Section 9 (line 440) — `Idempotency-Key: <payment.id>`

2. **`assertInvariant (plan section 9.1)`** (cover tests #3-#6: actualCharges vs httpCalls combinations)
   - 1 flowchart: decision matrix actualCharges ≤ 1 ∧ httpCalls ≥ 2 → invariant hold/violated
   - 1 truth table (Markdown table, not diagram): all 4 combinations
   - PLAN1 reference: Section 9.1 (line 450-464) — `actualCharges <= 1` walaupun `HTTP calls >= 2`

3. **Bonus: Idempotency end-to-end flow** (cross-reference untuk hero scenario D)
   - 1 sequence diagram: payment create → HTTP attempt 1 (drop response) → HTTP attempt 2 (replay) → actualCharges=1
   - Note: ini di-test di `resilient-adapter.spec.ts` test "passes replayed=true", tapi diagram flow-nya relevant di sini
   - PLAN1 reference: Section 9.2 (line 466+)

---

### Module 3: resilient-adapter-scenario.md

Source spec: `apps/payment-api/tests/modules/gateway/resilient-adapter.spec.ts` (8 tests, 5 describe blocks)

**Diagrams to create (~5)**:

1. **`ResilientPaymentGateway - success path`** (cover tests #1-#2: first attempt success, fail-first-n success)
   - 1 sequence diagram: adapter.charge → executeWithResilience → retry policy → gateway.charge
   - PLAN1 reference: Section 5 (cockatiel composition order)

2. **`ResilientPaymentGateway - retry exhaustion`** (cover tests #3-#4: maxAttempts exhausted, preserves errorCode)
   - 1 sequence diagram: 4 attempts (1 initial + 3 retries) → exhausted → scheduled_for_retry
   - 1 state diagram: payment status transition during retry exhaustion
   - PLAN1 reference: Section 10.1 (retry exhaustion flow)

3. **`ResilientPaymentGateway - onAttempt callback`** (cover tests #5-#6: invoke per attempt, paymentId in context)
   - 1 sequence diagram: onAttempt callback fired after each attempt with context
   - PLAN1 reference: Section 8 (audit trail)

4. **`ResilientPaymentGateway - circuit breaker`** (cover test #7: circuit_open errorCode)
   - 1 state diagram: breaker CLOSED → OPEN → HALF_OPEN → CLOSED transitions
   - 1 sequence diagram: breaker open → fast-fail with circuit_open errorCode
   - PLAN1 reference: Section 5.2 (breaker config)

5. **`ResilientPaymentGateway - replayed flag passthrough`** (cover test #8: passes replayed=true)
   - 1 sequence diagram: gateway.charge returns replayed=true → adapter passes through → service records
   - Cross-link ke idempotency-scenario.md (hero scenario D)
   - PLAN1 reference: Section 9.2 (replay mechanism)

---

### Module 4: composition-scenario.md

Source spec: `packages/resilience/tests/policies/composition.spec.ts` (9 tests, 6 describe blocks)

**Diagrams to create (~6)**:

1. **`executeWithResilience - happy path`** (cover tests #1-#2: first success, fail-first-n success)
   - 1 sequence diagram: caller → executeWithResilience → retry policy → fn()
   - PLAN1 reference: Section 5 (cockatiel composition), Section 6 (retry policy)

2. **`executeWithResilience - retry exhaustion`** (cover tests #3-#4: maxAttempts failed, attemptDetails capture)
   - 1 sequence diagram: 4 fn() calls → all fail → exhausted=true
   - 1 flowchart: maxAttempts counting logic
   - PLAN1 reference: Section 6 (RETRY_MAX_ATTEMPTS semantics)

3. **`executeWithResilience - Retry-After header`** (cover test #5: extract retryAfterMs from 429)
   - 1 sequence diagram: 429 response with Retry-After → DelegateBackoff reads retryAfterMs → delay = max(exponential, retryAfterMs)
   - 1 flowchart: DelegateBackoff decision tree (extract error → check retryAfterMs → compute delay)
   - PLAN1 reference: Section 9.2 (replay + retry-after)

4. **`executeWithResilience - circuit breaker`** (cover tests #6-#7: open after threshold, singleton per dependency)
   - 1 state diagram: breaker state machine (CLOSED/OPEN/HALF_OPEN)
   - 1 flowchart: singleton lookup per dependencyName
   - PLAN1 reference: Section 5.2 (breaker config)

5. **`executeWithResilience - onAttempt callback`** (cover test #8: invoke per attempt failure)
   - 1 sequence diagram: onAttempt fired with attemptDetails after each failure
   - PLAN1 reference: Section 8 (audit trail)

6. **`executeWithResilience - timeout handling`** (cover test #9: timeout as retryable failure)
   - 1 sequence diagram: timeout policy → AbortController → fn() aborts → timeout error classified retryable
   - 1 flowchart: timeout strategy (Aggressive vs Cooperative)
   - PLAN1 reference: Section 5 (timeout policy)

---

## Index file: `docs/skenario/README.md`

Structure:

```markdown
# Test Scenario Diagrams

> Visual diagrams (Mermaid) untuk skenario test yang kompleks.
> Tujuan: memudahkan tim memahami flow test untuk maintenance dan onboarding.

## Available diagrams

| Module | Spec File | Scenario File | Diagrams | Complexity |
|---|---|---|---|---|
| retry-scheduler | retry-scheduler.service.spec.ts | [retry-scheduler-service-scenario.md](./retry-scheduler-service-scenario.md) | ~4 | High |
| idempotency | idempotency.spec.ts | [idempotency-scenario.md](./idempotency-scenario.md) | ~3 | Medium |
| resilient-adapter | resilient-adapter.spec.ts | [resilient-adapter-scenario.md](./resilient-adapter-scenario.md) | ~5 | High |
| composition | composition.spec.ts | [composition-scenario.md](./composition-scenario.md) | ~6 | High |

**Total**: 4 scenario files, ~18 Mermaid diagrams

## Future work (8 spec files lain — belum ada diagram)

Spec files yang belum punya diagram (low complexity, bisa tambah nanti kalau perlu):

- audit.service.spec.ts
- classifier.spec.ts (resilience pkg)
- http-adapter.spec.ts
- idempotency-key.spec.ts
- payments.controller.spec.ts
- payments.service.spec.ts
- retry-after.spec.ts (resilience pkg)
- state-machine.spec.ts

## Conventions

- **Format**: Mermaid (sequence + flowchart + state — mix sesuai konteks)
- **Level of detail**: Per describe block (1 diagram per describe, bukan per test case)
- **Narasi**: Lengkap (setup + flow + assertions + pitfalls + PLAN1 ref jika relevan)
- **File naming**: `<spec-name-without-.spec.ts>-scenario.md` (titik → dash)
- **PLAN1 reference**: Wajib jika test verify domain behavior, optional kalau pure implementation detail

## How to add new diagram

1. Identify spec file with complex scenarios
2. Read tests, identify describe blocks worth diagramming
3. Create `<spec-name>-scenario.md` using [template](#template)
4. Add entry to this index table
5. Cross-link dari CONTRIBUTING.md + TEST_MAINTENANCE_RULES.md kalau diagram menambah rule baru

## Template

\`\`\`markdown
# Scenario: <spec-file-name>

> Source: `<path-to-spec-file>`
> Tests: <N> tests, <M> describe blocks

## <describe-block-name>

### Setup
<mock configuration, initial state>

### Flow

\`\`\`mermaid
<diagram>
\`\`\`

### Key assertions
- <bullet 1>
- <bullet 2>

### Common pitfalls
- <gotcha 1>
- <gotcha 2>

### PLAN1 reference
- Section X.Y (line N-M): <description>
\`\`\`

## Related docs

- [TEST_MAINTENANCE_RULES.md](../../TEST_MAINTENANCE_RULES.md) — rule test maintenance + decision framework
- [TASK-test-sync-failures.md](./tasks/TASK-test-sync-failures.md) — bug analysis yang inspire diagrams ini
- [CONTRIBUTING.md](../../../CONTRIBUTING.md) — development rules (Rule #5: update diagram jika ubah test)
```

---

## Implementation steps

### Step 1 — Setup folder + index

1. Buat folder `docs/skenario/`
2. Buat `docs/skenario/README.md` dengan struktur di atas (index + template)

### Step 2 — Module 1: retry-scheduler-service-scenario.md

- Baca `retry-scheduler.service.spec.ts` (8 tests, 3 describe blocks)
- Buat 4 diagrams:
  - poll() sequence diagram
  - re-entrancy guard flowchart
  - getStats state diagram
  - onApplicationBootstrap sequence diagram
  - Bonus: processOne() flowchart deep dive
- Tulis narasi: setup, flow, assertions, pitfalls, PLAN1 ref

### Step 3 — Module 2: idempotency-scenario.md

- Baca `idempotency.spec.ts` (6 tests, 2 describe blocks)
- Buat 3 diagrams:
  - deriveIdempotencyKey flowchart
  - assertInvariant decision matrix flowchart + truth table
  - Bonus: idempotency end-to-end sequence diagram (cross-ref hero scenario D)
- Tulis narasi

### Step 4 — Module 3: resilient-adapter-scenario.md

- Baca `resilient-adapter.spec.ts` (8 tests, 5 describe blocks)
- Buat 5 diagrams (sesuai breakdown di atas)
- Tulis narasi

### Step 5 — Module 4: composition-scenario.md

- Baca `composition.spec.ts` (9 tests, 6 describe blocks)
- Buat 6 diagrams (sesuai breakdown di atas)
- Tulis narasi

### Step 6 — Cross-link update

1. Update `CONTRIBUTING.md` — tambah Rule #5 (lihat section Maintenance Policy di bawah)
2. Update `docs/TEST_MAINTENANCE_RULES.md` — tambah link ke `docs/skenario/README.md` di section Referensi
3. Update `docs/tasks/README.md` — tambah section "7. Test Scenario Diagrams (post-plan)"

### Step 7 — Verify

1. Cek semua Mermaid diagrams render dengan benar (bisa via VS Code Mermaid preview atau GitHub render)
2. Cek semua cross-links valid (tidak ada broken link)
3. Run `pnpm test` — pastikan tidak ada test yang rusak karena perubahan dokumentasi

---

## Maintenance policy

**Opsi A — Manual** (sesuai klarifikasi #8):

Developer yang ubah test file WAJIB update scenario diagram kalau:

1. Test yang diubah punya diagram di `docs/skenario/<spec-name>-scenario.md`
2. Perubahan affect behavior yang di-diagram-kan (e.g., tambah test case baru, ubah assertion, refactor flow)

**Tidak wajib update kalau**:

- Hanya rename variable internal
- Tambah test case baru di describe block yang sudah punya diagram (cukup tambah bullet point di "Key assertions")
- Perubahan di spec file yang belum punya diagram (lihat "Future work" di index)

**Update CONTRIBUTING.md** — tambah Rule #5:

```markdown
## 🎯 Rule #5 (WAJIB): Update Scenario Diagram kalau Ubah Test

> Kalau Anda ubah test file yang sudah punya scenario diagram di
> `docs/skenario/`, WAJIB update diagram-nya dalam commit yang sama.

### Kapan wajib update diagram
- Ubah assertion yang verify behavior yang di-diagram-kan
- Tambah describe block baru
- Refactor flow yang sudah di-diagram-kan

### Kapan tidak wajib
- Tambah test case di describe block yang sudah punya diagram
  (cukup tambah bullet point di "Key assertions")
- Rename variable internal
- Perubahan di spec file yang belum punya diagram

### Cara update
1. Buka `docs/skenario/<spec-name>-scenario.md`
2. Update diagram yang relevan
3. Update "Key assertions" + "Common pitfalls" kalau perlu
4. Commit bersama perubahan test (jangan terpisah)
```

---

## Acceptance criteria

### Functional

- [ ] `docs/skenario/README.md` ada dengan index table + conventions + template
- [ ] `docs/skenario/retry-scheduler-service-scenario.md` ada dengan ~4 diagrams
- [ ] `docs/skenario/idempotency-scenario.md` ada dengan ~3 diagrams
- [ ] `docs/skenario/resilient-adapter-scenario.md` ada dengan ~5 diagrams
- [ ] `docs/skenario/composition-scenario.md` ada dengan ~6 diagrams
- [ ] Total ~18 Mermaid diagrams yang render di GitHub/VS Code

### Quality

- [ ] Setiap diagram punya narasi lengkap: Setup, Flow, Key assertions, Common pitfalls, PLAN1 reference (jika relevan)
- [ ] Setiap PLAN1 reference mengandung section + line number
- [ ] Tidak ada broken cross-link (semua link antar file valid)
- [ ] Semua Mermaid diagrams render tanpa syntax error

### Documentation

- [ ] `CONTRIBUTING.md` updated dengan Rule #5 (update scenario diagram kalau ubah test)
- [ ] `docs/TEST_MAINTENANCE_RULES.md` updated dengan cross-link ke `docs/skenario/README.md`
- [ ] `docs/tasks/README.md` updated dengan section "7. Test Scenario Diagrams (post-plan)" + link ke TASK-16 + `docs/skenario/README.md`

### Verification

- [ ] `pnpm test` di root project tetap PASS (142/142) — dokumentasi tidak boleh affect test
- [ ] `pnpm lint` PASS (0 errors)
- [ ] `pnpm typecheck` PASS (semua package)

---

## Useful commands (run after completing this task)

```bash
# Verify Mermaid syntax (optional — bisa via VS Code Mermaid extension)
# Buka setiap .md file di docs/skenario/ dan preview Mermaid

# Verify all cross-links valid
cd /home/z/my-project/retry-failure
grep -r "docs/skenario/" --include="*.md" . | grep -v "^Binary" | sort

# Verify test still pass
pnpm test

# Verify lint + typecheck
pnpm lint
pnpm typecheck
```

---

## Notes

### Estimasi effort per module

| Module | Diagrams | Narasi blocks | Est. time |
|---|---|---|---|
| retry-scheduler | 4 | 4 | 60 min |
| idempotency | 3 | 3 | 40 min |
| resilient-adapter | 5 | 5 | 70 min |
| composition | 6 | 6 | 80 min |
| Index + cross-link | - | - | 30 min |
| **Total** | **~18** | **~18** | **~4 jam** |

### Cross-reference

- [`TASK-test-sync-failures.md`](./TASK-test-sync-failures.md) — bug analysis 7 failures yang inspire TASK-16
- [`TEST_MAINTENANCE_RULES.md`](../../TEST_MAINTENANCE_RULES.md) — rule test maintenance + decision framework
- [`CONTRIBUTING.md`](../../../CONTRIBUTING.md) — development rules (Rule #5 akan ditambahkan)
- [`TASK-14-e2e-scenarios.md`](./TASK-14-e2e-scenarios.md) — E2E scenario docs (out of scope TASK-16)
- [`TASK-15-documentation.md`](./TASK-15-documentation.md) — business docs (separate task)

### Future work (post-TASK-16)

Kalau ada spec file lain yang perlu di-diagram-kan (lihat "Future work" di `docs/skenario/README.md`):

1. Audit service (`audit.service.spec.ts`) — kalau audit flow makin kompleks
2. HTTP adapter (`http-adapter.spec.ts`) — kalau axios mapping makin banyak edge cases
3. Payments service (`payments.service.spec.ts`) — kalau manualRetry/state machine makin kompleks
4. State machine (`state-machine.spec.ts`) — kalau transitions makin banyak

Proses tambah diagram baru:

1. Baca spec file target
2. Buat `<spec-name>-scenario.md` di `docs/skenario/`
3. Tambah entry ke index table di `docs/skenario/README.md`
4. Update cross-link kalau perlu

---

## Definition of Done

TASK-16 complete ketika:

1. ✅ 5 file created (1 index + 4 scenario files)
2. ✅ 3 file updated (CONTRIBUTING + TEST_MAINTENANCE_RULES + tasks/README)
3. ✅ ~18 Mermaid diagrams yang render di GitHub
4. ✅ Setiap diagram punya narasi lengkap (Setup + Flow + Assertions + Pitfalls + PLAN1 ref)
5. ✅ `pnpm test` PASS (142/142)
6. ✅ `pnpm lint` + `pnpm typecheck` PASS
7. ✅ Cross-link valid (tidak ada broken link)
8. ✅ Worklog appended ke `/home/z/my-project/worklog.md`

Setelah TASK-16 selesai, plan rev 2 + post-plan documentation complete. Tidak ada task lanjutan yang tertunda (kecuali ada requirement baru dari stakeholder).
