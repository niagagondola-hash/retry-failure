# TASK-07 — Payments Domain Service + State Machine

> **Task ID**: 5
> **Depends on**: 2-a (database), 4 (gateway adapter)
> **Estimated effort**: M (~1.5 jam)
> **Plan reference**: Section 7 (Durable Retry), Section 9 (Idempotency), Section 10 (Payment API flow), Section 11 (Persistence)

---

## Goal

Implementasi `PaymentsService` sebagai business orchestration layer. Bertanggung jawab atas payment lifecycle: create → execute → succeeded/failed/scheduled_for_retry, idempotency invariant, dan durable retry counter.

## Scope

**In scope**:
- `src/lib/payments/repository.ts` — `PrismaPaymentsRepository` (CRUD payments + atomic state transitions).
- `src/lib/payments/state-machine.ts` — valid transition map.
- `src/lib/payments/service.ts` — `PaymentsService` (createPayment, executePayment, manualRetry, getById, list).
- `src/lib/payments/idempotency.ts` — invariant helper (`actualCharges <= 1`).
- Wiring: `PaymentsService` depends on `PaymentGatewayPort` (TASK-06) + `AuditPort` (interface, impl di TASK-08) + `PaymentsRepository`.

**Out of scope**:
- API route handlers (di TASK-09).
- Audit trail persistence implementasi (di TASK-08, di sini cuma interface).
- Scheduler logic (di TASK-10).
- Metrics (di TASK-11).

## State machine (plan section 10.2)

```text
processing
   ├──→ succeeded                  (gateway success)
   ├──→ failed                      (permanent failure / MAX_TOTAL_RETRIES exceeded)
   └──→ scheduled_for_retry         (retry exhausted OR circuit open)
                                      │
                                      ↓ (scheduler picks up, TASK-10)
                                   processing (durable retry)
                                      │
                                      ├──→ succeeded
                                      ├──→ failed  (MAX_TOTAL_RETRIES exceeded)
                                      └──→ scheduled_for_retry (increment totalRetryCount)
```

Valid transitions:
- `processing → succeeded | failed | scheduled_for_retry`
- `scheduled_for_retry → processing` (by scheduler / manual retry)
- `succeeded → ` (terminal, no retry)
- `failed → ` (terminal; manual retry bisa re-open ke `processing` via `manualRetry`)

## Idempotency invariant (plan section 9.1)

```text
Untuk satu payment:
  actualCharges <= 1
  HTTP calls >= 2 (pada scenario response loss) tetap OK karena gateway replay
```

Verified via gateway `replayed: true` pada attempt ke-2. Invariant dipegang oleh gateway mock + `Idempotency-Key` yang stabil = `payment.id`.

## Durable retry counter (plan section 7.1)

```text
attempt_count          = attempts dalam satu execution cycle (Cockatiel)
total_retry_count      = scheduler cycles (durable)
MAX_TOTAL_RETRIES = 5  = batas total_retry_count
```

Keduanya tidak boleh dicampur.

## Files to create / modify

- `/home/z/my-project/src/lib/payments/repository.ts`
- `/home/z/my-project/src/lib/payments/state-machine.ts`
- `/home/z/my-project/src/lib/payments/idempotency.ts`
- `/home/z/my-project/src/lib/payments/audit/audit-port.ts` — interface only (impl di TASK-08).
- `/home/z/my-project/src/lib/payments/service.ts`
- `/home/z/my-project/src/lib/payments/index.ts` — barrel + factory `createPaymentsService()`.

## Implementation steps

1. `audit/audit-port.ts`:
   ```ts
   export interface AuditPort {
     recordAttempt(input: RecordAttemptInput): Promise<void>;
     listAttempts(paymentId: string): Promise<AttemptView[]>;
   }
   export interface RecordAttemptInput {
     paymentId: string;
     attemptNumber: number;
     outcome: AttemptOutcome;
     httpStatus?: number;
     errorCode?: string;
     errorMessage?: string;
     delayBeforeNextMs?: number;
     breakerState: BreakerState;
     durationMs: number;
     traceId?: string;
     idempotencyKey: string;
     gatewayReference?: string;
   }
   ```
2. `repository.ts`:
   - `PrismaPaymentsRepository` dengan methods: `create`, `findById`, `list(filter)`, `updateStatus(id, status, patch)`, `findDueRetries(now, limit)`, `incrementTotalRetry(id)`.
   - Atomic transitions: `updateStatus` memakai `updateMany` dengan `where: { id, status: expectedFrom }` agar tidak overwrite kalau race.
3. `state-machine.ts`:
   - `const VALID_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]>`.
   - `assertCanTransition(from, to): void` — throw kalau invalid.
4. `idempotency.ts`:
   - `deriveKey(paymentId): string` — re-export dari TASK-06 helper (single source of truth).
   - `assertInvariant(actualCharges, httpCalls): void` — untuk testing/logging.
5. `service.ts`:
   ```ts
   export class PaymentsService {
     constructor(
       private repo: PaymentsRepository,
       private gateway: PaymentGatewayPort,
       private audit: AuditPort,
       private config: { maxTotalRetries: number; schedulerBaseDelayMs: number },
     ) {}

     async createPayment(input: CreatePaymentInput): Promise<PaymentView> {
       // 1. Create payment with status='processing'
       // 2. Call executePayment (immediate execution cycle)
       // 3. Return view
     }

     async executePayment(paymentId: string, options?: { source: 'api' | 'scheduler' | 'manual' }): Promise<PaymentView> {
       // 1. Set status='processing' (atomic)
       // 2. Call gateway.charge(...)
       // 3. For each Cockatiel attempt (tracked via gateway adapter callback OR audit), record audit attempt.
       //    (Alternative: gateway adapter emits per-attempt events → service records audit.)
       // 4. Map ChargeResult → status transition
       //    - succeeded → status='succeeded', gatewayReference set
       //    - failed permanent → status='failed', failureReason set
       //    - failed retryable + exhausted → schedule_for_retry (next_retry_at = now + delay), increment totalRetryCount
       //    - failed circuit_open → schedule_for_retry
       // 5. If totalRetryCount > MAX_TOTAL_RETRIES → status='failed'
       // 6. Return updated view
     }

     async manualRetry(paymentId: string): Promise<PaymentView> {
       // 1. Assert status in ['failed', 'scheduled_for_retry']
       // 2. Reset attempt_count, do NOT reset totalRetryCount
       // 3. executePayment(paymentId, { source: 'manual' })
     }

     async getById(id: string): Promise<PaymentView & { attempts: AttemptView[] }>
     async list(filter: { status?: PaymentStatus }): Promise<PaymentView[]>
   }
   ```
6. `index.ts`:
   - Factory `createPaymentsService()` yang wire `PrismaPaymentsRepository` + `createPaymentGateway(config)` + `audit` (passed in or default).
   - Export singleton getter (Next.js hot reload: use `globalThis.__paymentsService`).

## Acceptance criteria

- [ ] `createPayment({ orderId: 'ORD-1', amount: 100, currency: 'IDR' })` → row Payment dibuat, status terminal (`succeeded`/`failed`/`scheduled_for_retry`) saat return.
- [ ] `getById(id)` mengembalikan payment + attempts list.
- [ ] `list({ status: 'failed' })` filter benar.
- [ ] Permanent failure (gateway `client-error`) → status=`failed`, attempt_count=1, failureReason set.
- [ ] Transient failure then success (`fail-first-n=2`, `RETRY_MAX_ATTEMPTS=3`) → status=`succeeded`, attempt_count=3.
- [ ] Retry exhaustion (`server-error` mode) → status=`scheduled_for_retry`, totalRetryCount=0 (pertama), next_retry_at set.
- [ ] `manualRetry(id)` pada status=`failed` → reset attempt_count=0, status kembali `processing` atau terminal baru.
- [ ] `totalRetryCount` increment hanya via scheduler / manual retry path, BUKAN via Cockatiel attempts.
- [ ] Idempotency: untuk satu payment, tidak ada double-charge (gateway replay dikenali → status=succeeded tanpa charge baru).
- [ ] `bun run lint` bersih.
- [ ] `bunx tsc --noEmit` bersih.

## Useful commands (run after completing this task)

```bash
# 0. Pastikan gateway mock jalan
cd /home/z/my-project/mini-services/payment-gateway-mock && bun run dev > /tmp/gateway.log 2>&1 &
sleep 2
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"always-success"}'

# 1. DB push (jika belum)
bun run db:push && bun run db:generate

# 2. Lint & typecheck
bun run lint
bunx tsc --noEmit

# 3. Quick E2E service test (always-success)
bun -e '
import { createPaymentsService } from "./src/lib/payments";
const svc = createPaymentsService();
const p = await svc.createPayment({ orderId: "ORD-1", amount: 100, currency: "IDR" });
console.log("created:", p);
const detail = await svc.getById(p.id);
console.log("detail attempts:", detail.attempts);
'

# 4. Test permanent failure
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"client-error"}'
bun -e '
import { createPaymentsService } from "./src/lib/payments";
const svc = createPaymentsService();
const p = await svc.createPayment({ orderId: "ORD-2", amount: 200, currency: "IDR" });
console.log("permanent failure:", p);  // expected: status=failed, attempts=1
'

# 5. Test transient → success
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"fail-first-n","n":2}'
bun -e '
import { createPaymentsService } from "./src/lib/payments";
const svc = createPaymentsService();
const p = await svc.createPayment({ orderId: "ORD-3", amount: 300, currency: "IDR" });
console.log("transient retry success:", p);  // expected: succeeded, attempt_count=3
'

# 6. Test retry exhaustion
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"server-error"}'
bun -e '
import { createPaymentsService } from "./src/lib/payments";
const svc = createPaymentsService();
const p = await svc.createPayment({ orderId: "ORD-4", amount: 400, currency: "IDR" });
console.log("exhausted:", p);  // expected: scheduled_for_retry, attempt_count=3, totalRetryCount=0
'

# 7. Reset
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"always-success"}'
```

## Notes

- **Per-attempt audit**: Cockatiel `retryPolicy.onFailure` callback adalah tempat terbaik untuk record attempt. Pilihan implementasi:
  - **Option A** (preferred): gateway adapter invoke `audit.recordAttempt` via callback prop. Setiap Cockatiel retry → audit record.
  - **Option B**: service pass `onAttempt` callback ke `executeWithResilience`.
  - Pilih satu dan konsisten. Note di code comment.
- **Atomic transition**: gunakan `db.payment.updateMany({ where: { id, status: 'processing' }, data: { status: 'succeeded' } })` agar tidak overwrite jika race (misal scheduler + manual retry bersamaan).
- **Idempotency invariant test**: di TASK-13 scenario 4, verifikasi `actualCharges=1` meski `calls>=2`. Di sini, gateway mock sudah handle replay — service hanya pass-through `replayed` field.
- **Trace ID**: untuk demo, generate `crypto.randomUUID()` per payment execution cycle, pass ke gateway sebagai header `traceparent` (OTel style) atau `x-trace-id` custom. Audit record.simpan. Full OTel di TASK-11 opsional.
- Setelah task ini selesai, TASK-08 (audit impl) + TASK-09 (API routes) bisa mulai.
