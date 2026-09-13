# TASK-08 — Attempt Audit Trail (TypeORM AuditService Implementation)

> **Task ID**: 6-a
> **Depends on**: 2-a (TASK-02 database / `PaymentAttemptRepository`) + 5 (TASK-07 PaymentsService — `AuditPort` consumer + `NoopAuditService` placeholder binding)
> **Estimated effort**: S (~1 jam)
> **Plan reference**: Section 11.2 (`payment_attempts` schema) + Section 13.1 (Logging — Trace ID / span ID availability)

---

## Goal

Mengimplementasikan **`AuditPort`** interface yang didefinisikan di TASK-07 (`apps/payment-api/src/modules/payments/audit/audit-port.ts`) dengan **TypeORM-based `AuditService`** yang:

1. **Persist** setiap gateway attempt (sukses maupun gagal) ke tabel `payment_attempts` (TASK-02 entity `PaymentAttempt`) sebagai **satu row per Cockatiel attempt**.
2. **Map `RecordAttemptInput` → `PaymentAttempt` row** secara 1:1 dengan kolom lengkap sesuai plan section 11.2.
3. **Increment `payments.attempt_count` atomic** setiap kali satu row `payment_attempts` ditulis, agar counter di parent row konsisten dengan jumlah attempt yang benar-benar terjadi di cycle berjalan.
4. **List attempts** untuk satu payment, urut `attempt_number ASC`, sebagai `AttemptView[]` (plain object — tidak leak entity TypeORM ke caller).
5. **Handle `circuit_open` case** — saat breaker OPEN, gateway adapter (TASK-06) TIDAK memanggil HTTP, tetapi tetap meng-invoke `onAttempt` callback sekali dengan `breakerState='open'`, `outcome='circuit_open'`, `durationMs=0`. AuditService wajib tetap menulis 1 row untuk kasus ini (traceability requirement — observability plan section 13.1).

Setelah task ini selesai, TASK-09 (controllers) dapat expose `GET /payments/:id` yang meng-embed `attempts: AttemptView[]` di response, dan TASK-10 scheduler dapat memanggil `executePayment(paymentId, { source: 'scheduler' })` dengan audit trail penuh.

## Scope

**In scope**:
- `apps/payment-api/src/modules/audit/audit.service.ts` — `AuditService implements AuditPort` (TypeORM).
- `apps/payment-api/src/modules/audit/audit.module.ts` — NestJS module dengan provider `AuditService` + binding ke token `AUDIT_PORT` (menggantikan `NoopAuditService` placeholder dari TASK-07).
- `apps/payment-api/src/modules/audit/index.ts` — barrel + factory `createAuditService()` (utility untuk test/bootstrap).
- Wire `AuditModule` ke `PaymentsModule` di TASK-07 — hapus provider `{ provide: AUDIT_PORT, useClass: NoopAuditService }` dan ganti dengan `imports: [AuditModule]` (yang men-export `AUDIT_PORT` binding).
- Jest unit tests di `apps/payment-api/test/modules/audit/` (mock `PaymentAttemptRepository` + `PaymentRepository`).
- Smoke test e2e (manual): create payment → verify `payment_attempts` rows via `psql`.

**Out of scope**:
- Trace ID propagation full OpenTelemetry SDK (AsyncLocalStorage + OTel context injection) → **TASK-11**. Di task ini `traceId` hanya diterima dari caller (`PaymentsService.generateTraceId() = crypto.randomUUID()` per execution cycle) dan di-persist sebagai string biasa.
- Metrics emission aktual (`payment_gateway_requests_total`, `retry_attempts_total`, dst.) → **TASK-11**. AuditService tidak meng-import `prom-client`.
- Retention policy / TTL / cleanup job untuk `payment_attempts` (data grows unbounded untuk production) → **di luar scope**; document di TASK-15 sebagai production caveat.
- Schema migration baru (kolom `payment_attempts` sudah dibuat di TASK-02 `0001_init.ts`).
- Per-attempt row-level idempotency (dedup key) — tidak diperlukan karena row ID di-generate oleh PostgreSQL `gen_random_uuid()` dan satu attempt Cockatiel = satu callback = satu row insert.

## Audit fields table (plan section 11.2 — source mapping)

Setiap field di `payment_attempts` diisi dari sumber berikut. Field bertanda `nullable` disimpan sebagai `null` (BUKAN `undefined`) agar konsisten dengan schema PostgreSQL NOT NULL constraint.

| Column | Type | Source di `RecordAttemptInput` / turunan |
|---|---|---|
| `id` | uuid PK | Auto-generate via `@PrimaryGeneratedColumn('uuid')` (PostgreSQL `gen_random_uuid()`). Tidak diisi dari input. |
| `payment_id` | uuid FK | `input.paymentId` (langsung dari `GatewayAttemptContext.paymentId`). |
| `attempt_number` | int | `input.attemptNumber` (1-based, counter per payment execution cycle — di-increment Cockatiel per attempt). |
| `outcome` | enum | `input.outcome` (`AttemptOutcome` enum: `success` \| `retryable_failure` \| `permanent_failure` \| `timeout` \| `circuit_open`). |
| `http_status` | int, nullable | `input.httpStatus ?? null`. `null` bila network error (no HTTP response) atau breaker OPEN (tidak ada call terjadi). |
| `error_code` | varchar, nullable | `input.errorCode ?? null`. Dari gateway body `error_code` ATAU network `err.code` (mis. `ECONNREFUSED`, `ETIMEDOUT`) — sudah dinormalisasi di adapter TASK-06. |
| `error_message` | varchar, nullable | `input.errorMessage ?? null`. Dari gateway body `message` ATAU `err.message` (network error). |
| `delay_before_next_ms` | int, nullable | `input.delayBeforeNextMs ?? null`. Sumber: classifier `Retry-After` parsing (TASK-04) → `ChargeResult.retryAfterMs` ATAU Cockatiel backoff delay yang dihitung untuk attempt berikutnya (dipass via `onAttempt` callback context). `null` bila attempt terakhir (tidak ada delay). |
| `breaker_state` | varchar(12) | `input.breakerState` (`'closed'` \| `'open'` \| `'half_open'`). Lookup sync via `getBreakerState(dependencyName)` dari `@retry-failure/resilience` breaker-store (TASK-05) — diisi adapter saat attempt dijalankan. |
| `duration_ms` | int | `input.durationMs` = `finishedAt.getTime() - startedAt.getTime()`. Untuk `circuit_open` case: `0` (tidak ada call terjadi). |
| `trace_id` | char(32), nullable | `input.traceId ?? null`. UUID v4 string (32 hex char tanpa dash — atau 36 dengan dash, tergantung impl; **decision: simpan sebagai string 36-char dengan dash** untuk simplicity, kolom `varchar(36)` di entity — TODO update TASK-02 bila perlu). Di-generate sekali per execution cycle di `PaymentsService.executePayment()` via `crypto.randomUUID()`. |
| `idempotency_key` | varchar(64) | `input.idempotencyKey` = `deriveIdempotencyKey(paymentId)` = `paymentId` as-is (TASK-06). Stable lintas Cockatiel retries + scheduler cycles + manual retries. |
| `gateway_reference` | varchar(64), nullable | `input.gatewayReference ?? null`. Dari gateway response body `gateway_reference` pada success. `null` untuk failure/timeout/circuit_open. |
| `replayed` | boolean | `input.replayed`. Dari `ChargeResult.replayed` (gateway-side truth — passthrough dari gateway mock idempotency store, TASK-03). Disimpan sebagai kolom boolean (TAMBAHAN terhadap plan section 11.2 original schema — TODO update entity TASK-02 bila belum ada; bila tidak, simpan sebagai `error_code='replayed:true'` workaround — preferred: tambah kolom `replayed boolean default false` via migration `0002_*`). |
| `created_at` | timestamp(3) | Auto via `@CreateDateColumn()` — tidak diisi dari input. |

> **Catatan `replayed` column**: plan section 11.2 asli TIDAK memuat kolom `replayed`. Tapi `RecordAttemptInput` (TASK-07) memilikinya (sumber `ChargeResult.replayed`). **Decision**: tambah kolom `replayed boolean default false` di entity `PaymentAttempt` TASK-02 (atau via migration `0002_add_replayed_column.ts` bila entity sudah di-deploy tanpa kolom ini). Document deviation di TASK-15 production caveats.

## Files to create

Semua path absolut di monorepo:

- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/audit/audit.service.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/audit/audit.module.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/audit/index.ts`

File yang di-modify (di TASK-07 — wire AuditModule):

- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/payments/payments.module.ts` — hapus provider `{ provide: AUDIT_PORT, useClass: NoopAuditService }`, tambah `imports: [AuditModule]`.

File yang mungkin perlu di-modify (bila `replayed` column belum ada di entity TASK-02):

- `/home/z/my-project/retry-failure/apps/payment-api/src/database/entities/payment-attempt.entity.ts` — tambah `@Column({ type: 'boolean', default: false }) replayed: boolean;`.
- `/home/z/my-project/retry-failure/apps/payment-api/src/database/migrations/0002_add_replayed_column.ts` — migration baru (opsional bila schema belum di-deploy).

## Implementation steps

### 1. `audit/audit.service.ts` — TypeORM AuditService

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentAttempt } from '../../database/entities/payment-attempt.entity';
import { Payment } from '../../database/entities/payment.entity';
import { PaymentRepository } from '../../database/repositories/payment.repository';
import { AttemptOutcome } from '../../database/entities/enums';
import {
  type AuditPort,
  type AttemptView,
  type RecordAttemptInput,
} from '../payments/audit/audit-port';

/**
 * TypeORM-based AuditPort implementation (TASK-08).
 *
 * Persists setiap Cockatiel attempt ke `payment_attempts` table (1 row per attempt)
 * + atomic increment `payments.attempt_count`.
 *
 * TIDAK boleh throw ke caller — AuditPort contract (TASK-07) menjamin audit
 * failure tidak break payment flow. Internal error ditangkap + di-log.
 */
@Injectable()
export class AuditService implements AuditPort {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(PaymentAttempt)
    private readonly attemptRepo: Repository<PaymentAttempt>,
    private readonly payments: PaymentRepository,
  ) {}

  /**
   * Persist satu attempt row + atomic increment attempt_count di parent payment.
   *
   * Two-step write (non-transactional):
   *   1. INSERT payment_attempts (single source of truth per-attempt).
   *   2. UPDATE payments SET attempt_count = attempt_count + 1 WHERE id = paymentId.
   *
   * Step 2 atomic via TypeORM query builder `.update().set({ attemptCount: () => 'attempt_count + 1' })`
   * — PostgreSQL native atomic increment (no read-modify-write race).
   *
   * Bila step 2 gagal (mis. payment row deleted concurrently), log warning + lanjut.
   * Attempt row tetap tersimpan (auditability > counter consistency untuk edge case ini).
   */
  async recordAttempt(input: RecordAttemptInput): Promise<void> {
    try {
      // 1. INSERT row ke payment_attempts
      const row = this.attemptRepo.create({
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
        replayed: input.replayed,
      });
      await this.attemptRepo.save(row);

      // 2. Atomic increment attempt_count di parent payment
      //    TypeORM .update() with raw SQL expression — atomic di PostgreSQL level.
      await this.attemptRepo.manager
        .createQueryBuilder()
        .update(Payment)
        .set({ attemptCount: () => 'attempt_count + 1' })
        .where('id = :id', { id: input.paymentId })
        .execute();
    } catch (err) {
      // AuditPort contract: TIDAK boleh throw ke caller.
      // PaymentsService.attachAuditCallback() juga sudah wrap try/catch,
      // tapi double-guard di sini agar impl swapping tidak menyebabkan regression.
      this.logger.error(
        {
          err,
          paymentId: input.paymentId,
          attemptNumber: input.attemptNumber,
          outcome: input.outcome,
        },
        'AuditService.recordAttempt failed — swallowing to preserve payment flow',
      );
    }
  }

  /**
   * List attempts untuk satu payment, urut by attempt_number ASC.
   *
   * Dipakai oleh PaymentsService.getById(id) untuk GET /payments/:id response
   * (TASK-09). Map ke AttemptView (plain object, no TypeORM metadata leak).
   */
  async listAttempts(paymentId: string): Promise<AttemptView[]> {
    const rows = await this.attemptRepo.find({
      where: { paymentId },
      order: { attemptNumber: 'ASC' },
    });
    return rows.map((r) => this.toView(r));
  }

  private toView(r: PaymentAttempt): AttemptView {
    return {
      id: r.id,
      paymentId: r.paymentId,
      attemptNumber: r.attemptNumber,
      outcome: r.outcome,
      httpStatus: r.httpStatus,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      delayBeforeNextMs: r.delayBeforeNextMs,
      breakerState: r.breakerState,
      durationMs: r.durationMs,
      traceId: r.traceId,
      idempotencyKey: r.idempotencyKey,
      gatewayReference: r.gatewayReference,
      replayed: r.replayed,
      createdAt: r.createdAt,
    };
  }
}
```

**Catatan penting**:
- `attemptRepo.save(row)` memakai instance yang dibuat via `attemptRepo.create()` — TypeORM akan INSERT (bukan UPDATE) karena PK `id` belum di-set (PostgreSQL `gen_random_uuid()` mengisi default).
- `attempt_count` increment dilakukan via raw SQL expression `() => 'attempt_count + 1'` di query builder — ini IDIOMATIC TypeORM 0.3 untuk atomic increment (tidak ada race condition dengan concurrent audit callback).
- Bila ingin kedua write atomic dalam satu transaction, wrap dengan `attemptRepo.manager.transaction(async (em) => { ... })`. **Decision**: tidak pakai transaction — dua write independent, dan bila step 2 gagal, audit row tetap tersimpan (auditability prioritas). Document trade-off di Notes.

### 2. `audit/audit.module.ts` — NestJS module

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentAttempt } from '../../database/entities/payment-attempt.entity';
import { PaymentRepository } from '../../database/repositories/payment.repository';
import { AUDIT_PORT } from '../payments/audit/audit-port';
import { AuditService } from './audit.service';

/**
 * AuditModule — exports AUDIT_PORT binding ke AuditService (menggantikan
 * NoopAuditService placeholder dari TASK-07 PaymentsModule).
 *
 * PaymentsModule.imports([AuditModule]) → AUDIT_PORT token resolve ke AuditService.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PaymentAttempt])],
  providers: [
    AuditService,
    PaymentRepository, // re-provide supaya AuditService bisa inject
    { provide: AUDIT_PORT, useExisting: AuditService },
  ],
  exports: [AUDIT_PORT, AuditService],
})
export class AuditModule {}
```

**Catatan**:
- `PaymentRepository` di-provide di sini (re-provide) karena `AuditService` membutuhkannya untuk atomic increment. Bila `PaymentRepository` sudah di-provide secara global (mis. via `DatabaseModule`), import saja dari sana — hindari duplicate provider. **Alternative clean**: pindahkan `PaymentRepository` provider ke `DatabaseModule` (`@Global()`) di TASK-02 — maka tidak perlu re-provide di sini.
- `useExisting` (bukan `useClass`) agar satu instance `AuditService` di-share antara token `AUDIT_PORT` dan consumer yang langsung inject `AuditService` (jika ada di test).

### 3. `audit/index.ts` — barrel + factory

```ts
export * from './audit.service';
export * from './audit.module';

import { Repository } from 'typeorm';
import { PaymentAttempt } from '../../database/entities/payment-attempt.entity';
import { PaymentRepository } from '../../database/repositories/payment.repository';
import { AuditService } from './audit.service';

/**
 * Factory utility untuk membuat AuditService tanpa DI (mis. di test, smoke script,
 * atau standalone CLI). Tidak dipakai di runtime NestJS (DI handle instantiation).
 *
 * @example
 * ```ts
 * const audit = createAuditService(attemptRepo, paymentRepo);
 * await audit.recordAttempt({ ... });
 * ```
 */
export function createAuditService(
  attemptRepo: Repository<PaymentAttempt>,
  payments: PaymentRepository,
): AuditService {
  return new AuditService(attemptRepo, payments);
}
```

### 4. Wire ke `PaymentsModule` (TASK-07 — modify)

Update `apps/payment-api/src/modules/payments/payments.module.ts`:

```ts
// BEFORE (TASK-07 — placeholder)
@Module({
  imports: [
    TypeOrmModule.forFeature([Payment]),
    GatewayModule,
  ],
  providers: [
    PaymentRepository,
    PaymentsService,
    { provide: AUDIT_PORT, useClass: NoopAuditService }, // ← hapus ini
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}

// AFTER (TASK-08 — real binding)
@Module({
  imports: [
    TypeOrmModule.forFeature([Payment]),
    GatewayModule,
    AuditModule, // ← tambah ini — men-export AUDIT_PORT binding ke AuditService
  ],
  providers: [
    PaymentRepository,
    PaymentsService,
    // AUDIT_PORT binding sekarang di-provide oleh AuditModule (useExisting AuditService)
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
```

**Catatan**: `NoopAuditService` tetap di-export dari `audit-port.ts` (untuk unit test PaymentsService yang ingin isolasi dari DB). Tidak di-bind sebagai default provider di `PaymentsModule` lagi.

### 5. Jest tests — `test/modules/audit/audit.service.spec.ts`

```ts
describe('AuditService', () => {
  // Setup: mock Repository<PaymentAttempt> + mock PaymentRepository
  //   - attemptRepo.create() → returns plain object (passthrough)
  //   - attemptRepo.save() → resolves, captures arg
  //   - attemptRepo.manager.createQueryBuilder() → chain mock (.update/.set/.where/.execute)
  //   - attemptRepo.find() → returns array (configurable per-test)
  //   - payments.atomicUpdateStatus / increment — not called (we use query builder directly)

  // Test cases:
  // 1. recordAttempt happy path: input lengkap → attemptRepo.save dipanggil dengan
  //    row yang sesuai (semua field ter-map); query builder update dipanggil dengan
  //    paymentId yang benar; tidak throw.
  // 2. recordAttempt dengan nullable fields (httpStatus=undefined, errorCode=undefined,
  //    errorMessage=undefined, delayBeforeNextMs=undefined, traceId=undefined,
  //    gatewayReference=undefined) → row yang di-save memiliki null (BUKAN undefined)
  //    di field tersebut.
  // 3. recordAttempt circuit_open case: outcome='circuit_open', durationMs=0,
  //    breakerState='open', httpStatus=null → row tetap ter-save (sumber truth).
  // 4. recordAttempt bila attemptRepo.save throw (mis. DB down) → AuditService
  //    menangkap error, log, TIDAK re-throw ke caller. Spy logger.error dipanggil.
  // 5. recordAttempt bila increment query throw → row attempt tetap tersimpan
  //    (step 1 sudah commit), error di-log, tidak re-throw.
  // 6. listAttempts: attemptRepo.find dipanggil dengan order attemptNumber ASC;
  //    return AttemptView[] dengan field mapping benar.
  // 7. listAttempts untuk paymentId yang tidak punya attempts → return [].
});
```

### 6. (Optional) Migration `0002_add_replayed_column.ts`

Bila entity `PaymentAttempt` di TASK-02 belum memiliki kolom `replayed`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReplayedColumn1700000000002 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE payment_attempts ADD COLUMN replayed boolean NOT NULL DEFAULT false`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE payment_attempts DROP COLUMN replayed`);
  }
}
```

Bila kolom `replayed` sudah ada di entity TASK-02 (recommended — update TASK-02 file di revision ini), skip migration ini.

## Integration with PaymentsService (TASK-07)

`PaymentsService` sudah wire `onAttempt` callback di method `attachAuditCallback()` (TASK-07 step 5). AuditService hanya perlu menerima payload yang sudah dipersiapkan — tidak ada perubahan di `PaymentsService` selain binding DI.

Namun ada beberapa hal yang perlu diperhatikan / di-update di TASK-07 setelah TASK-08 selesai:

1. **Trace ID generation** — `PaymentsService.executePayment()` sudah memanggil `const traceId = randomUUID();` (TASK-07 step 5). AuditService menerima traceId via `RecordAttemptInput.traceId` dan men-persist-nya ke kolom `trace_id`. **Tidak ada perubahan** — hanya konfirmasi bahwa field ini ter-flow end-to-end.

2. **Reset `attempt_count=0` saat start cycle** — `PaymentsService.executePayment()` sudah melakukan ini via `atomicUpdateStatus(paymentId, previousStatus, { status: PROCESSING, attemptCount: 0 })`. Setelah reset, setiap `recordAttempt()` akan increment kembali dari 0 → 1 → 2 → ... Sesuai dengan Cockatiel `attemptNumber` (1-based).

3. **`onAttempt` callback payload** — TASK-07 `attachAuditCallback()` sudah membangun `RecordAttemptInput` lengkap dari `GatewayAttemptContext`:
   ```ts
   const input: RecordAttemptInput = {
     paymentId: ctx.paymentId,
     attemptNumber: ctx.attemptNumber,
     outcome: this.classifyOutcome(ctx.result, ctx.breakerState),
     httpStatus: ctx.result.httpStatus ?? null,
     errorCode: ctx.result.errorCode ?? null,
     errorMessage: ctx.result.errorMessage ?? null,
     delayBeforeNextMs: ctx.result.retryAfterMs ?? null,
     breakerState: (ctx.breakerState ?? 'CLOSED').toLowerCase() as 'closed' | 'open' | 'half_open',
     durationMs: ctx.finishedAt.getTime() - ctx.startedAt.getTime(),
     traceId,
     idempotencyKey,
     gatewayReference: ctx.result.gatewayReference ?? null,
     replayed: ctx.result.replayed,
   };
   await this.audit.recordAttempt(input);
   ```
   AuditService hanya menerima dan persist — tidak ada transformasi tambahan.

4. **Circuit open case** — saat breaker OPEN, ResilientPaymentGateway (TASK-06) tidak memanggil HTTP, tetapi tetap meng-invoke `onAttempt` callback sekali dengan payload minimal:
   ```ts
   {
     paymentId,
     attemptNumber: 1, // atau angka cycle berikutnya — tapi biasanya 1 karena cycle baru dimulai
     result: { status: 'failed', errorCode: 'circuit_open', errorMessage: 'breaker open' },
     breakerState: 'OPEN',
     startedAt: now,
     finishedAt: now, // duration = 0
   }
   ```
   `PaymentsService.classifyOutcome()` akan return `'circuit_open'`, dan `attachAuditCallback` akan set `durationMs = 0`, `httpStatus = null`, `gatewayReference = null`. AuditService tetap menulis 1 row → observability plan section 13.1 (event: "breaker state change" / "circuit open") terpenuhi.

5. **Error handling contract** — `PaymentsService.attachAuditCallback()` sudah wrap `audit.recordAttempt(input)` dalam try/catch:
   ```ts
   try {
     await this.audit.recordAttempt(input);
   } catch (err) {
     this.logger.error({ err, paymentId: ctx.paymentId, attemptNumber: ctx.attemptNumber }, 'audit.recordAttempt failed');
   }
   ```
   AuditService menghormati contract ini dengan double-guard (try/catch internal di `recordAttempt`). Defense in depth — bila ada bug di AuditService yang menyebabkan throw, payment flow tetap jalan.

## Acceptance criteria

- [ ] `audit.service.ts` mengekspor `AuditService implements AuditPort` dengan method `recordAttempt(input: RecordAttemptInput): Promise<void>` dan `listAttempts(paymentId: string): Promise<AttemptView[]>`.
- [ ] `recordAttempt` persist row ke `payment_attempts` dengan semua field ter-map sesuai tabel di section "Audit fields table" di atas.
- [ ] `recordAttempt` atomic increment `payments.attempt_count` via TypeORM query builder (`attempt_count + 1` raw SQL expression) — TIDAK read-modify-write.
- [ ] Field nullable (`httpStatus`, `errorCode`, `errorMessage`, `delayBeforeNextMs`, `traceId`, `gatewayReference`) disimpan sebagai `null` (BUKAN `undefined`) bila input `undefined`.
- [ ] `listAttempts(paymentId)` return `AttemptView[]` urut `attempt_number ASC`; bila tidak ada attempt return `[]`.
- [ ] `circuit_open` case tetap menghasilkan 1 row audit dengan `outcome='circuit_open'`, `durationMs=0`, `breakerState='open'`, `httpStatus=null`.
- [ ] AuditService **tidak throw** ke caller (PaymentsService) bila internal error (DB down, constraint violation, dst.) — error di-log via `Logger.error`.
- [ ] `audit.module.ts` mengekspor `AuditModule` dengan provider `AuditService` + binding `{ provide: AUDIT_PORT, useExisting: AuditService }`; men-export `AUDIT_PORT` token.
- [ ] `PaymentsModule` (TASK-07) sudah di-update: hapus provider `{ provide: AUDIT_PORT, useClass: NoopAuditService }`, tambah `imports: [AuditModule]`. Module tetap bisa di-bootstrap tanpa error DI.
- [ ] `NoopAuditService` tetap diekspor dari `audit-port.ts` (untuk unit test isolation).
- [ ] End-to-end smoke test: `POST /payments` (setelah TASK-09 controllers ready) menghasilkan ≥ 1 row di `payment_attempts` per payment. Bila gateway success first try → 1 row. Bila retry 3x lalu success → 3 rows.
- [ ] `pnpm --filter payment-api typecheck` lulus.
- [ ] `pnpm --filter payment-api lint` lulus.
- [ ] Jest unit tests `audit.service.spec.ts` lulus semua test cases (happy path, nullable fields, circuit_open, error swallowing, listAttempts).

## Useful commands (run after completing this task)

### Pre-flight Check

> **WAJIB BACA**: sebelum menjalankan command di bawah, cek kondisi lingkungan Anda via [`SANDBOX_NOTES.md`](./SANDBOX_NOTES.md) section 1 (Pre-flight Check).
>
> Ringkasan keyword:
> - `pnpm --version` ada → KONDISI LOCAL. Tidak ada → KONDISI SANDBOX → jalankan `corepack enable pnpm && corepack prepare pnpm@9.12.0 --activate` dulu.
> - `docker --version` ada → KONDISI LOCAL. Tidak ada → KONDISI SANDBOX → butuh external PostgreSQL atau skip DB-dependent commands.
> - `curl -s http://localhost:3000` sibuk → KONDISI SANDBOX → payment-api pakai PORT=3001, gateway-mock pakai PORT=3002. Bebas → KONDISI LOCAL → payment-api pakai PORT=3000, gateway-mock pakai PORT=3001.

Command di bawah ditulis dengan dua varian bila perlu (LOCAL / SANDBOX). Pilih salah satu sesuai kondisi.

---

```bash
# 1. (Bila entity PaymentAttempt di-update untuk kolom `replayed`) Generate + run migration baru
#    Sama untuk kedua kondisi (asalkan DB dapat diakses — bila SANDBOX tanpa external PG, skip).
cd /home/z/my-project/retry-failure/apps/payment-api
pnpm db:migration:generate src/database/migrations/0002_add_replayed_column
pnpm db:migrate

# 2. Start PostgreSQL (bila belum jalan)
# KONDISI LOCAL (Docker tersedia):
cd /home/z/my-project/retry-failure
docker compose up -d postgres
sleep 5
docker compose ps postgres

# KONDISI SANDBOX (Docker tidak tersedia):
# - Opsi A: connect ke external PostgreSQL instance (set DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME di apps/payment-api/.env).
# - Opsi B: skip integration test, gunakan NoopAuditService untuk dev (audit rows tidak ter-write — Jest unit test tetap jalan).
# Verifikasi koneksi (kedua kondisi):
psql -h localhost -U retry_failure -d retry_failure -c "SELECT 1;" 2>/dev/null || \
  echo "psql tidak tersedia / DB belum connectable — gunakan Node script fallback di step 7"

# 3. Typecheck & lint
cd /home/z/my-project/retry-failure
pnpm --filter payment-api typecheck
pnpm --filter payment-api lint

# 4. Jest unit tests untuk AuditService (tidak butuh DB — pakai mocked repository)
pnpm --filter payment-api test -- --testPathPattern=audit.service.spec

# 5. Start gateway mock + payment-api (di 2 terminal berbeda — port kondisional)
# KONDISI LOCAL:
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock && PORT=3001 pnpm start:dev  # port 3001
cd /home/z/my-project/retry-failure/apps/payment-api && PORT=3000 pnpm start:dev           # port 3000

# KONDISI SANDBOX:
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock && PORT=3002 pnpm start:dev  # port 3002
cd /home/z/my-project/retry-failure/apps/payment-api && PORT=3001 pnpm start:dev            # port 3001

# Konvensi env var: API_PORT="${API_PORT:-3000}" (LOCAL) / API_PORT=3001 (SANDBOX)
#                   GW_PORT="${GW_PORT:-3001}" (LOCAL) / GW_PORT=3002 (SANDBOX)

# 6. End-to-end smoke test (butuh TASK-09 controllers untuk POST /payments).
#    Bila TASK-09 belum siap, skip; bila sudah:
API_PORT="${API_PORT:-3000}"  # default 3000 LOCAL; set API_PORT=3001 untuk SANDBOX
curl -sS -X POST "http://localhost:${API_PORT}/payments" \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"smoke-001","amount":10000,"currency":"IDR"}' | jq .

# 7. Verify audit rows di PostgreSQL (PostgreSQL — bukan SQLite)
# KONDISI LOCAL (docker exec):
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml exec postgres \
  psql -U retry_failure -d retry_failure -c \
  "SELECT id, attempt_number, outcome, http_status, breaker_state, duration_ms, trace_id, replayed
   FROM payment_attempts
   ORDER BY created_at DESC
   LIMIT 5;"

# KONDISI SANDBOX (host psql atau Node script fallback):
psql -h localhost -U retry_failure -d retry_failure -c \
  "SELECT id, attempt_number, outcome, http_status, breaker_state, duration_ms, trace_id, replayed
   FROM payment_attempts
   ORDER BY created_at DESC
   LIMIT 5;"

# Bila psql CLI tidak tersedia di SANDBOX, gunakan Node script:
cd /home/z/my-project/retry-failure/apps/payment-api
pnpm exec ts-node -e "
import { Client } from 'pg';
const c = new Client({ host: 'localhost', port: 5432, user: 'retry_failure', password: 'retry_failure', database: 'retry_failure' });
await c.connect();
const r = await c.query('SELECT id, attempt_number, outcome, http_status, breaker_state, duration_ms, trace_id, replayed FROM payment_attempts ORDER BY created_at DESC LIMIT 5');
console.log(r.rows);
await c.end();
"

# 8. Verify counter di parent payment konsisten dengan jumlah attempts
# KONDISI LOCAL:
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml exec postgres \
  psql -U retry_failure -d retry_failure -c \
  "SELECT p.id, p.order_id, p.status, p.attempt_count,
          (SELECT COUNT(*) FROM payment_attempts a WHERE a.payment_id = p.id) AS actual_rows
   FROM payments p
   ORDER BY p.created_at DESC
   LIMIT 5;"
# Expected: attempt_count === actual_rows untuk payment yang sudah complete cycle.

# KONDISI SANDBOX:
psql -h localhost -U retry_failure -d retry_failure -c \
  "SELECT p.id, p.order_id, p.status, p.attempt_count,
          (SELECT COUNT(*) FROM payment_attempts a WHERE a.payment_id = p.id) AS actual_rows
   FROM payments p
   ORDER BY p.created_at DESC
   LIMIT 5;"

# 9. Verify listAttempts via API (butuh TASK-09 GET /payments/:id)
PAYMENT_ID="<id-dari-step-6>"
API_PORT="${API_PORT:-3000}"
curl -sS "http://localhost:${API_PORT}/payments/${PAYMENT_ID}" | jq '.attempts'

# 10. Trigger circuit_open scenario (set gateway failure mode = 'always_500' via
#     dashboard / admin endpoint TASK-03, lalu create payment berulang sampai
#     breaker trip). Verify audit row dengan outcome='circuit_open' muncul:
# KONDISI LOCAL:
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml exec postgres \
  psql -U retry_failure -d retry_failure -c \
  "SELECT payment_id, attempt_number, outcome, breaker_state, duration_ms
   FROM payment_attempts
   WHERE outcome = 'circuit_open'
   ORDER BY created_at DESC LIMIT 5;"

# KONDISI SANDBOX:
psql -h localhost -U retry_failure -d retry_failure -c \
  "SELECT payment_id, attempt_number, outcome, breaker_state, duration_ms
   FROM payment_attempts
   WHERE outcome = 'circuit_open'
   ORDER BY created_at DESC LIMIT 5;"

# 11. Revert migration (test)
cd /home/z/my-project/retry-failure/apps/payment-api
pnpm db:migrate:revert
pnpm db:migrate  # re-apply
```

## Notes

- **Increment `attempt_count` atomic via TypeORM raw SQL expression**: gunakan `.set({ attemptCount: () => 'attempt_count + 1' })` di query builder. JANGAN pakai read-modify-write (`payment.attemptCount += 1; repo.save(payment)`) — race condition antar concurrent audit callback (Cockatiel paralel attempt, atau scheduler + manual retry overlap). PostgreSQL `UPDATE ... SET attempt_count = attempt_count + 1` adalah atomic di row-level (implicit row lock).

- **Reset `attempt_count=0` saat transitioning ke 'processing'**: dilakukan oleh `PaymentsService.executePayment()` via `atomicUpdateStatus(paymentId, previousStatus, { status: PROCESSING, attemptCount: 0 })`. Setelah reset, increment per attempt akan rebuild counter 1 → 2 → ... → N. `attempt_count` di parent row selalu = jumlah attempt di cycle terakhir. Bila perlu history, query `payment_attempts` (bukan `payments.attempt_count`).

- **Circuit open case WAJIB record audit row**: walaupun tidak ada HTTP call terjadi, observability plan section 13.1 mensyaratkan event "breaker state change" / "circuit open" tercatat. AuditService menerima `outcome='circuit_open'` dari `PaymentsService.classifyOutcome()` dan menulis row dengan `durationMs=0`, `httpStatus=null`, `breakerState='open'`. Tanpa row ini, debugging circuit breaker behavior di production menjadi mustahil (no audit trail).

- **`delay_before_next_ms` sumber**: dari `ChargeResult.retryAfterMs` (server-directed backoff via classifier TASK-04 + Retry-After parsing) ATAU dari Cockatiel backoff delay yang dihitung untuk attempt berikutnya. Di TASK-06 `GatewayAttemptContext`, `result.retryAfterMs` diisi bila `Retry-After` header ada di response 429/503; bila tidak ada, fallback ke Cockatiel exponential backoff delay (dipass via `onFailure` callback Cockatiel). `delayBeforeNextMs` di `RecordAttemptInput` = `result.retryAfterMs ?? <cockatiel-backoff-delay-for-next>`; bila attempt terakhir (sukses atau exhausted), `null`.

- **Trace ID via `crypto.randomUUID()` per execution cycle**: `PaymentsService.executePayment()` memanggil `const traceId = randomUUID()` sekali per cycle, meneruskan ke `attachAuditCallback(traceId, ...)`. Semua attempt dalam satu cycle share `trace_id` yang sama. Full OpenTelemetry SDK (TASK-11) akan mengganti ini dengan span context yang di-propagate via `AsyncLocalStorage` + OTLP export ke Jaeger. Format `trace_id` saat ini: 36-char UUID v4 string (dengan dash). Plan section 11.2 menyebut `char(32)` (tanpa dash) — **decision**: pakai `varchar(36)` dengan dash untuk consistency dengan UUID library; document deviation di TASK-15.

- **Transaction vs non-transaction trade-off**: dua write di `recordAttempt()` (INSERT attempt + UPDATE parent counter) tidak dibungkus transaction. Alasan: (a) bila step 2 gagal, audit row tetap tersimpan — auditability > counter consistency untuk edge case; (b) transaction overhead (BEGIN/COMMIT round-trip) tidak worth untuk operation yang sangat ringan. Bila future perlu strict consistency, wrap dengan `attemptRepo.manager.transaction(async (em) => { ... })`.

- **`useExisting` vs `useClass` binding**: `AuditModule` pakai `{ provide: AUDIT_PORT, useExisting: AuditService }`. Ini memastikan satu instance `AuditService` di-share antara token `AUDIT_PORT` dan consumer langsung `AuditService` (jika ada di test). `useClass` akan instantiate instance baru — tidak diinginkan karena InstanceIdLogger / potential stateful behavior di future.

- **`PaymentRepository` provider placement**: di snippet `audit.module.ts`, `PaymentRepository` di-provide ulang. Bila TASK-02 `DatabaseModule` sudah `@Global()` dan men-export `PaymentRepository` (atau TypeORM `Repository<Payment>` token), hapus dari `AuditModule` providers — import saja dari `DatabaseModule`. Hindari duplicate provider (NestJS akan throw error bila ada). **Decision preferred**: jadikan `PaymentRepository` global via `DatabaseModule` agar module lain (audit, scheduler TASK-10) bisa langsung inject tanpa re-provide.

- **`NoopAuditService` tetap diekspor**: untuk unit test `PaymentsService` (TASK-07 spec), `NoopAuditService` masih dipakai sebagai mock-binding (via `Test.createTestingModule({ providers: [{ provide: AUDIT_PORT, useValue: new NoopAuditService() }] })`). Jangan hapus class ini dari `audit-port.ts`.

- **`replayed` column deviation**: plan section 11.2 tidak memuat kolom `replayed`, tapi `RecordAttemptInput` (TASK-07) memilikinya. **Decision**: tambahkan kolom `replayed boolean default false` ke entity `PaymentAttempt` TASK-02 (atau via migration `0002_add_replayed_column.ts` bila entity sudah di-deploy). Document di TASK-15 sebagai deviation dari plan original dengan justifikasi "idempotency invariant audit clarity" (plan section 9.1).

- **After this task done — TASK-09 (controllers) can proceed**: TASK-09 akan expose `GET /payments/:id` yang meng-embed `attempts: AttemptView[]` (dari `PaymentsService.getById(id)` → `AuditService.listAttempts(id)`). Tidak ada perubahan API breaking yang diharapkan di TASK-08 saat TASK-09/10/11 berjalan. TASK-10 scheduler akan memanggil `executePayment(paymentId, { source: 'scheduler' })` — audit rows untuk scheduler cycles akan otomatis ter-write via callback yang sama. TASK-11 akan menambahkan OTel span context (replace `crypto.randomUUID()` traceId dengan `trace.getSpan(context.active())?.spanContext().traceId`).
