# TASK-08 — Attempt Audit Trail (AuditPort + Prisma Implementation)

> **Task ID**: 6-a
> **Depends on**: 2-a (database) + 5 (payments service — interface consumer)
> **Can run in parallel with**: TASK-09 (after both done, integrate)
> **Estimated effort**: S (~45 min)
> **Plan reference**: Section 11.2 (payment_attempts), Section 13.1 (audit events)

---

## Goal

Implementasi `AuditPort` interface yang sudah didefinisikan di TASK-07. Persist setiap gateway attempt ke tabel `PaymentAttempt` (Prisma) dengan semua field yang dipersyaratkan plan section 11.2.

## Scope

**In scope**:
- `src/lib/payments/audit/prisma-audit.ts` — `PrismaAuditService implements AuditPort`.
- `src/lib/payments/audit/index.ts` — barrel + factory.
- Mapping dari `RecordAttemptInput` (TASK-07) → Prisma `PaymentAttempt` row.
- `listAttempts(paymentId)` → return `AttemptView[]` (via `db-helpers.toAttemptView` dari TASK-02).

**Out of scope**:
- Trace ID propagation (full OTel di TASK-11, di sini cuma simpan `traceId` field jika ada).
- Metrics emission (di TASK-11).
- Cleanup / retention policy (out-of-scope per plan).

## Audit fields (plan section 11.2)

| Column | Source |
|---|---|
| `attempt_number` | counter per payment execution cycle (1-based) |
| `outcome` | `success` / `retryable_failure` / `permanent_failure` / `timeout` / `circuit_open` |
| `http_status` | dari gateway response (atau null jika network error) |
| `error_code` | dari gateway body `error_code` atau network `err.code` |
| `error_message` | dari gateway body `message` atau `err.message` |
| `delay_before_next_ms` | delay yang digunakan Cockatiel untuk attempt berikutnya |
| `breaker_state` | `closed` / `open` / `half_open` saat attempt |
| `duration_ms` | waktu eksekusi attempt (dari sebelum call sampai response/error) |
| `trace_id` | UUID per execution cycle |
| `idempotency_key` | `deriveIdempotencyKey(paymentId)` |
| `gateway_reference` | dari gateway response saat success |

## Files to create / modify

- `/home/z/my-project/src/lib/payments/audit/prisma-audit.ts`
- `/home/z/my-project/src/lib/payments/audit/index.ts`
- (opsional) `/home/z/my-project/src/lib/payments/audit/types.ts` jika butuh tipe tambahan.

## Implementation steps

1. `prisma-audit.ts`:
   ```ts
   import { db } from '@/lib/db';
   import type { AuditPort, RecordAttemptInput } from './audit-port';
   import type { AttemptView } from '../types';
   import { toAttemptView } from '../db-helpers';

   export class PrismaAuditService implements AuditPort {
     constructor(private prisma = db) {}

     async recordAttempt(input: RecordAttemptInput): Promise<void> {
       await this.prisma.paymentAttempt.create({
         data: {
           paymentId: input.paymentId,
           attemptNumber: input.attemptNumber,
           outcome: input.outcome,
           httpStatus: input.httpStatus ?? null,
           errorCode: input.errorCode ?? null,
           errorMessage: input.errorMessage ?? null,
           delayBeforeNextMs: input.delayBeforeNextMs ?? null,
           breakerState: input.breakerState,
           durationMs: input.durationMs,
           traceId: input.traceId ?? null,
           idempotencyKey: input.idempotencyKey,
           gatewayReference: input.gatewayReference ?? null,
         },
       });
       // Juga bump payments.attempt_count (atomic via update)
       await this.prisma.payment.update({
         where: { id: input.paymentId },
         data: { attemptCount: { increment: 1 } },
       });
     }

     async listAttempts(paymentId: string): Promise<AttemptView[]> {
       const rows = await this.prisma.paymentAttempt.findMany({
         where: { paymentId },
         orderBy: { attemptNumber: 'asc' },
       });
       return rows.map(toAttemptView);
     }
   }
   ```
2. `index.ts`:
   ```ts
   export { PrismaAuditService } from './prisma-audit';
   export type { AuditPort, RecordAttemptInput } from './audit-port';
   export function createAuditService() {
     return new PrismaAuditService();
   }
   ```
3. Wire ke `PaymentsService` di TASK-07: update `createPaymentsService()` factory untuk instantiate `PrismaAuditService` dan inject.

## Integration dengan PaymentsService

Saat `PaymentsService.executePayment` dipanggil:

1. Generate `traceId = crypto.randomUUID()` untuk execution cycle ini.
2. Reset `attempt_count = 0` di payment row.
3. Set callback `onAttempt` ke gateway adapter: setiap Cockatiel attempt selesai → invoke `audit.recordAttempt({ paymentId, attemptNumber: n, outcome, ..., traceId })`.
4. Bila Cockatiel tidak invoke callback untuk attempt terakhir (mis. breaker trip tanpa call), record attempt dengan `outcome: 'circuit_open'` dan `duration_ms: 0`.

> Detail wiring di TASK-07 step 5. TASK-08 hanya menyediakan `PrismaAuditService`.

## Acceptance criteria

- [ ] `audit.recordAttempt({ paymentId: 'p1', attemptNumber: 1, outcome: 'retryable_failure', httpStatus: 500, durationMs: 120, breakerState: 'closed', idempotencyKey: 'p1' })` → row `PaymentAttempt` tersimpan.
- [ ] `payments.attemptCount` ter-increment setiap record attempt.
- [ ] `audit.listAttempts('p1')` return list terurut by `attemptNumber` asc.
- [ ] Field nullable (`httpStatus`, `errorCode`, dll.) disimpan sebagai `null` jika tidak diisi (bukan `undefined`).
- [ ] `PaymentsService.createPayment` (TASK-07) sekarang menghasilkan ≥1 audit row per payment.
- [ ] `bun run lint` bersih.
- [ ] `bunx tsc --noEmit` bersih.

## Useful commands (run after completing this task)

```bash
# 1. DB push (pastikan schema PaymentAttempt sudah ada)
bun run db:push && bun run db:generate

# 2. Lint & typecheck
bun run lint
bunx tsc --noEmit

# 3. Pastikan gateway mock jalan
cd /home/z/my-project/mini-services/payment-gateway-mock && bun run dev > /tmp/gateway.log 2>&1 &
sleep 2
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"fail-first-n","n":2}'

# 4. End-to-end: create payment → verify audit rows
bun -e '
import { createPaymentsService } from "./src/lib/payments";
const svc = createPaymentsService();
const p = await svc.createPayment({ orderId: "AUDIT-1", amount: 100, currency: "IDR" });
console.log("payment:", p);

// Cek DB langsung
import { db } from "./src/lib/db";
const attempts = await db.paymentAttempt.findMany({ where: { paymentId: p.id }, orderBy: { attemptNumber: "asc" } });
console.log("attempts:", JSON.stringify(attempts, null, 2));
console.log("attempt count:", attempts.length);
'

# 5. Verify via sqlite3 CLI
sqlite3 /home/z/my-project/db/custom.db "SELECT id, attempt_number, outcome, http_status, breaker_state, duration_ms FROM PaymentAttempt ORDER BY created_at DESC LIMIT 5;"

# 6. Reset gateway
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"always-success"}'
```

## Notes

- **Increment `attemptCount`**: dilakukan via `payment.update({ data: { attemptCount: { increment: 1 } } })` agar atomic. Tidak perlu read-then-write.
- **Reset `attemptCount`** saat scheduler/manual retry: set explicit `attemptCount: 0` di `executePayment` awal (saat status transition ke `processing`).
- **Circuit open case**: bila breaker OPEN, gateway call tidak terjadi. Tetap record 1 audit row dengan `outcome: 'circuit_open'`, `durationMs: 0`, `breakerState: 'open'`. Ini penting agar audit trail mencerminkan keputusan breaker.
- **Delay-before-next**: ambil dari classifier `retryAfterMs` atau dari Cockatiel backoff delay yang baru saja dipakai. Cockatiel `onFailure` callback dapat `delay` info — pass ke audit.
- **Trace ID**: bila belum plug OTel, gunakan `crypto.randomUUID()` per execution cycle. Audit row.simpan kolom `traceId`. Saat TASK-11 plug OTel, ganti dengan active span context trace ID.
- Setelah task ini selesai, TASK-09 (API routes) bisa expose `GET /api/payments/:id` dengan attempts list lengkap.
