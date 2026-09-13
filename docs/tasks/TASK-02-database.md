# TASK-02 — Prisma Schema (payments + payment_attempts)

> **Task ID**: 2-a
> **Depends on**: 1 (scaffolding)
> **Can run in parallel with**: TASK-03, TASK-04
> **Estimated effort**: S (~30 min)
> **Plan reference**: Section 11 (Persistence), Section 15 (Configuration)

---

## Goal

Mendefinisikan model Prisma `Payment` dan `PaymentAttempt` sesuai plan section 11, dengan adaptasi untuk SQLite. Mempersiapkan enum types TypeScript yang dipakai lintas aplikasi.

## Scope

**In scope**:
- Tambah model `Payment` dan `PaymentAttempt` di `prisma/schema.prisma`.
- Buat `src/lib/payments/types.ts` dengan TypeScript enums / union types untuk `PaymentStatus`, `AttemptOutcome`, `BreakerState`.
- Run `bun run db:push` dan `bun run db:generate`.
- Buat factory helper `src/lib/payments/db-helpers.ts` untuk mapping Prisma row ↔ domain object.

**Out of scope**:
- Repository implementation (di TASK-07 / TASK-08).
- Migration files (pakai `db:push` untuk demo; production akan pakai `prisma migrate`).
- User & Post model yang sudah ada — biarkan.

## Adaptation notes (SQLite constraints)

| Plan column | SQLite adaptation |
|---|---|
| `enum status` | `String` + validator di app layer (`PaymentStatus` union) |
| `datetime(3)` (ms precision) | `DateTime` (Prisma → ISO 8601 string di SQLite, second precision OK untuk demo) |
| `decimal(12,2)` | `Decimal` (Prisma → numeric di SQLite) |
| `char(36) PK` | `String @id @default(cuid())` (cuid lebih pendek tapi unik) |
| Foreign key + index | Prisma handle otomatis via `@relation` |

> **Catatan**: SQLite tidak punya native ENUM atau ms-precision datetime. Untuk demo ini acceptable. Catatan adaptasi ditulis di TASK-14.

## Files to create / modify

- `/home/z/my-project/prisma/schema.prisma` — tambah 2 model.
- `/home/z/my-project/src/lib/payments/types.ts` — enums/unions + DTOs.
- `/home/z/my-project/src/lib/payments/db-helpers.ts` — mapping helpers.

## Implementation steps

1. Edit `prisma/schema.prisma`:
   - Pertahankan model `User` & `Post` yang ada.
   - Tambah model `Payment`:
     ```prisma
     model Payment {
       id              String    @id @default(cuid())
       orderId         String    @unique
       amount          Decimal
       currency        String    @default("IDR")
       status          String    // PaymentStatus enum (string)
       gatewayReference String?  // map: gateway_reference
       attemptCount    Int       @default(0)
       totalRetryCount Int       @default(0)
       nextRetryAt     DateTime?
       failureReason   String?
       createdAt       DateTime  @default(now())
       updatedAt       DateTime  @updatedAt
       attempts        PaymentAttempt[]
       @@index([status])
       @@index([nextRetryAt])
     }
     ```
   - Tambah model `PaymentAttempt`:
     ```prisma
     model PaymentAttempt {
       id                String   @id @default(cuid())
       paymentId         String
       attemptNumber     Int
       outcome           String   // AttemptOutcome enum (string)
       httpStatus        Int?
       errorCode         String?
       errorMessage      String?
       delayBeforeNextMs Int?
       breakerState      String   // BreakerState enum (string)
       durationMs        Int
       traceId           String?
       idempotencyKey    String
       gatewayReference  String?
       createdAt         DateTime @default(now())
       payment           Payment  @relation(fields: [paymentId], references: [id], onDelete: Cascade)
       @@index([paymentId])
       @@index([idempotencyKey])
     }
     ```
2. Tulis `src/lib/payments/types.ts`:
   ```ts
   export const PaymentStatus = {
     PROCESSING: 'processing',
     SUCCEEDED: 'succeeded',
     FAILED: 'failed',
     SCHEDULED_FOR_RETRY: 'scheduled_for_retry',
   } as const;
   export type PaymentStatus = typeof PaymentStatus[keyof typeof PaymentStatus];

   export const AttemptOutcome = {
     SUCCESS: 'success',
     RETRYABLE_FAILURE: 'retryable_failure',
     PERMANENT_FAILURE: 'permanent_failure',
     TIMEOUT: 'timeout',
     CIRCUIT_OPEN: 'circuit_open',
   } as const;
   export type AttemptOutcome = typeof AttemptOutcome[keyof typeof AttemptOutcome];

   export const BreakerState = {
     CLOSED: 'closed',
     OPEN: 'open',
     HALF_OPEN: 'half_open',
   } as const;
   export type BreakerState = typeof BreakerState[keyof typeof BreakerState];
   ```
   Tambah juga DTOs: `CreatePaymentInput`, `PaymentView`, `AttemptView`.
3. Tulis `src/lib/payments/db-helpers.ts`:
   - `toPaymentView(row): PaymentView` — mapping snake_case plan → camelCase + type cast.
   - `toAttemptView(row): AttemptView`.
4. Run `bun run db:push` (akan prompt konfirmasi — pakai `--accept-data-loss` jika aman).
5. Run `bun run db:generate`.

## Acceptance criteria

- [ ] `prisma/schema.prisma` memuat model `Payment` & `PaymentAttempt` dengan relasi + index.
- [ ] `bun run db:push` berhasil; cek `db/custom.db` berisi tabel baru (`sqlite3 db/custom.db ".tables"`).
- [ ] `bun run db:generate` berhasil; Prisma Client mengetahui model baru.
- [ ] `src/lib/payments/types.ts` mengekspor 3 union types + DTOs.
- [ ] `src/lib/payments/db-helpers.ts` mengekspor `toPaymentView` & `toAttemptView`.
- [ ] `bun run lint` bersih.
- [ ] `bunx tsc --noEmit` bersih.

## Useful commands (run after completing this task)

```bash
# 1. Push schema ke SQLite (accept data loss OK karena dev)
bun run db:push

# 2. Regenerate Prisma Client
bun run db:generate

# 3. Verifikasi tabel ada (sqlite3 CLI)
sqlite3 /home/z/my-project/db/custom.db ".tables"
sqlite3 /home/z/my-project/db/custom.db ".schema Payment"
sqlite3 /home/z/my-project/db/custom.db ".schema PaymentAttempt"

# 4. Lint & typecheck
bun run lint
bunx tsc --noEmit
```

## Notes

- Tabel `User` & `Post` yang lama biarkan tetap ada (tidak diganggu).
- Jika `db:push` komplain soal data loss, aman untuk di-accept karena dev environment.
- Setelah task ini selesai, TASK-06 (gateway adapter) & TASK-07 (payments service) bisa pakai `db.payment.findMany(...)` langsung.
- Untuk datetime ms precision (plan pakai `datetime(3)`): SQLite tidak mendukung. Acceptable untuk demo. Production caveat di TASK-14.
