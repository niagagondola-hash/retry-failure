# TASK-07 — Payments Domain Service + State Machine

> **Task ID**: 5
> **Depends on**: 2-a (TASK-02 database / `PaymentRepository`) + 4 (TASK-06 gateway adapter)
> **Estimated effort**: M (~2-3 jam)
> **Plan reference**: Section 7 (Durable Retry) + Section 9 (Idempotency) + Section 10 (Payment API flow) + Section 11 (Persistence)

---

## Goal

Mengimplementasikan **`PaymentsService`** sebagai NestJS provider (`@Injectable()`) yang menjadi **orchestrator tunggal** untuk lifecycle payment:

```
create (processing)  ──►  execute  ──►  terminal: succeeded | failed | scheduled_for_retry
                                          │
                          scheduled_for_retry  ──►  processing (via scheduler / manual retry)
```

Service ini bertanggung jawab atas:

1. **State machine** — transisi status payment (`processing -> succeeded | failed | scheduled_for_retry`) hanya melalui jalur valid yang didefinisikan di `VALID_TRANSITIONS` map.
2. **Idempotency invariant** (plan section 9.1) — memastikan `actualCharges <= 1` per payment walau `HTTP calls >= 2`. Invariant dipegang oleh gateway mock + `Idempotency-Key = payment.id` (stabil lintas Cockatiel retries, scheduler cycles, dan manual retries). Helper `assertInvariant()` disediakan untuk testing & log.
3. **Durable retry counter** (plan section 7.1) — memisahkan dua counter yang TIDAK boleh dicampur:
   - `attempt_count` = jumlah attempt Cockatiel dalam **satu execution cycle** (direset ke 0 tiap cycle baru).
   - `total_retry_count` = jumlah **scheduler cycles** (durable retry); di-increment hanya saat scheduler (TASK-10) atau manual retry memulai cycle baru.
   - `MAX_TOTAL_RETRIES = 5` = limit atas `total_retry_count`. Bila terlampaui -> status berubah menjadi `failed` + `failureReason = 'max_total_retries_exceeded'`.
4. **Audit port contract** — interface `AuditPort` (`recordAttempt`, `listAttempts`) yang di-satisfy oleh `PrismaAuditService` di TASK-08. Service ini hanya berinteraksi dengan port, bukan impl konkret.
5. **Trace ID per execution cycle** — di-generate via `crypto.randomUUID()` di setiap pemanggilan `executePayment()`, diteruskan ke `AuditPort.recordAttempt` (kolom `trace_id`) dan ke logger. Full OpenTelemetry SDK di TASK-11 (opsional, tidak blocking).

Setelah task ini selesai, TASK-08 (audit impl) dan TASK-09 (controllers) dapat dimulai secara paralel — keduanya hanya mengkonsumsi `PaymentsService` + `AuditPort` yang sudah didefinisikan di sini.

## Scope

**In scope**:

- `apps/payment-api/src/modules/payments/state-machine.ts` — `VALID_TRANSITIONS` map + `assertCanTransition(from, to)` + `isTerminal(status)`.
- `apps/payment-api/src/modules/payments/idempotency.ts` — re-export `deriveIdempotencyKey` dari TASK-06 + `assertInvariant(actualCharges, httpCalls)` helper untuk testing/log.
- `apps/payment-api/src/modules/payments/audit/audit-port.ts` — interface `AuditPort`, `RecordAttemptInput`, `AttemptView`, dan token `AUDIT_PORT`.
- `apps/payment-api/src/modules/payments/payments.service.ts` — `@Injectable()` class dengan methods: `createPayment`, `executePayment`, `manualRetry`, `getById`, `list`.
- `apps/payment-api/src/modules/payments/payments.module.ts` — NestJS module: providers `PaymentsService` + `PaymentRepository` + binding `AUDIT_PORT` ke placeholder (impl konkre diganti TASK-08).
- `apps/payment-api/src/modules/payments/dto/create-payment.dto.ts` — DTO dengan `class-validator` decorators.
- `apps/payment-api/src/modules/payments/index.ts` — barrel export.
- Jest unit tests di `apps/payment-api/test/modules/payments/` (mock `PaymentRepository` + `PaymentGatewayPort` + `AuditPort`).

**Out of scope**:

- NestJS controllers (`POST /payments`, `GET /payments/:id`, dst.) -> **TASK-09**.
- Audit trail persistence impl (`payment_attempts` row write) -> **TASK-08**. Di task ini hanya interface `AuditPort` + binding placeholder `NoopAuditService` agar module bisa boot tanpa TASK-08.
- Durable retry scheduler (polling `findDueRetries`) -> **TASK-10**.
- Metrics emission (pino structured log + prom-client counter) -> **TASK-11**. Service memanggil `logger.debug()` / `logger.info()` saja; hooks penuh di TASK-11.
- OpenTelemetry SDK + Jaeger export -> **TASK-11**. Trace ID di-generate tapi tidak di-export sebagai OTel span.
- HTTP layer (axios, gateway URL, retry policy) -> **TASK-06** (sudah selesai). Service hanya meng-inject `PAYMENT_GATEWAY_PORT`.
- Cockatiel policy composition -> **TASK-05** (sudah selesai).

## State machine (plan section 10.2)

```text
                      createPayment()
                            │
                            ▼
                       processing  ◄────────── scheduled_for_retry
                            │                          ▲
            ┌───────────────┼───────────────┐          │
            │               │               │          │
            ▼               ▼               ▼          │
       succeeded        failed     scheduled_for_retry │
       (terminal)    (terminal)            │           │
                                         │ scheduler cycle (TASK-10)
                                         │ OR manualRetry()
                                         │ -> executePayment(source='manual')
                                         │   (reset attemptCount, do NOT reset totalRetryCount)
                                         │   if totalRetryCount > MAX_TOTAL_RETRIES -> failed
                                         └──────────────────────────────────────────┘

Circuit open (dari ChargeResult.errorCode='circuit_open')  ───►  scheduled_for_retry
Retry exhausted (Cockatiel attempts === RETRY_MAX_ATTEMPTS)  ──►  scheduled_for_retry
Permanent failure (httpStatus 4xx non-429, errorCode='invalid_card') ──►  failed
Success (ChargeResult.status='succeeded')  ──────────────────────►  succeeded
```

### Valid transitions table

| From (`status`)            | To (`status`)              | Trigger                                            | Notes                                                                                                       |
| -------------------------- | -------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `processing`               | `succeeded`                | `ChargeResult.status === 'succeeded'`              | Set `gatewayReference`; terminal.                                                                           |
| `processing`               | `failed`                   | Permanent failure OR `totalRetryCount > MAX`       | Set `failureReason`; terminal. Permanent = `httpStatus` 4xx selain 429, atau `errorCode='invalid_card'`.   |
| `processing`               | `scheduled_for_retry`      | Retry exhausted OR `errorCode === 'circuit_open'`   | Set `next_retry_at = now + delay`; increment `total_retry_count` (kecuali cycle pertama, lihat catatan).   |
| `scheduled_for_retry`      | `processing`              | Scheduler picks due row (TASK-10) OR `manualRetry` | Reset `attempt_count = 0`; **jangan** reset `total_retry_count`. Atomic via `updateMany WHERE status=...`.  |
| `succeeded`                | (none)                     | —                                                  | Terminal. `assertCanTransition('succeeded', *)` throws.                                                    |
| `failed`                   | `processing`               | `manualRetry` only (admin override)                | Reset `attempt_count = 0`; tidak reset `total_retry_count` (counter jujur).                              |
| `failed`                   | (lainnya)                  | —                                                  | Selain `manualRetry`, transisi dari `failed` ditolak.                                                       |

> **Catatan penambahan `total_retry_count`**: counter di-increment **saat transisi `processing -> scheduled_for_retry`** (yaitu ketika satu execution cycle gagal dan dijadwalkan ulang). Saat `scheduled_for_retry -> processing` (start of new cycle), counter **tidak** di-increment (sudah dihitung di cycle sebelumnya). Bila `total_retry_count + 1 > MAX_TOTAL_RETRIES` saat hendak transisi ke `scheduled_for_retry`, maka service **tidak** menjadwalkan retry — langsung transisi `processing -> failed` dengan `failureReason='max_total_retries_exceeded'`.

## Idempotency invariant (plan section 9.1)

```text
Untuk satu payment:
    actualCharges <= 1
walaupun
    HTTP calls >= 2
```

Invariant dipegang oleh lapisan berikut (bukan oleh service ini secara langsung):

1. **Gateway mock** (TASK-03) — in-memory `Map<Idempotency-Key, ChargeResult>`. Bila key sama dipakai ulang, gateway mengembalikan `replayed: true` dengan hasil original (tidak melakukan charge kedua kali).
2. **HTTP adapter** (TASK-06) — selalu mengirim header `Idempotency-Key: <payment.id>` (via `deriveIdempotencyKey(paymentId)` yang return `paymentId` as-is).
3. **`PaymentsService`** — menggunakan `payment.id` yang sama (UUID stabil) sebagai key untuk seluruh attempt dalam satu execution cycle **dan** lintas scheduler cycles **dan** lintas manual retries. Tidak ada transformasi.

Helper di `idempotency.ts`:

```ts
/**
 * Verifikasi invariant plan section 9.1.
 * Dipanggil di test (assertion) dan di log debug (observability).
 * TIDAK meng-throw — caller yang memutuskan apa yang dilakukan bila violated.
 *
 * @returns true jika invariant terpenuhi (actualCharges <= 1).
 */
export function assertInvariant(actualCharges: number, httpCalls: number): boolean {
  return actualCharges <= 1;
}
```

> Invariant yang sebenarnya diuji di E2E scenario 4 (`succeed-but-drop-response`) — TASK-14. Di task ini hanya disediakan helper; service tidak meng-enforce (tidak bisa, karena tidak tahu `actualCharges` — itu gateway-side truth yang dilihat via `replayed: true`).

## Durable retry counter (plan section 7.1)

```text
RETRY_MAX_ATTEMPTS = 3   ── Cockatiel, dalam satu execution cycle
MAX_TOTAL_RETRIES  = 5   ── scheduler, lintas execution cycles
```

| Counter              | Lingkup                   | Kapan di-reset         | Kapan di-increment                                            | Di mana disimpan        |
| -------------------- | ------------------------- | ----------------------- | ------------------------------------------------------------- | ----------------------- |
| `attempt_count`      | Satu execution cycle      | Start tiap cycle (`executePayment`) | Tidak (di-update oleh callback `onAttempt` — nilai akhir = `attempts` Cockatiel) | `payments.attempt_count` |
| `total_retry_count`  | Lintas scheduler cycles   | **Tidak pernah** di-reset (kecuali `manualRetry` tidak reset juga) | Saat transisi `processing -> scheduled_for_retry` (cycle gagal) | `payments.total_retry_count` |

**Lima aturan penting yang TIDAK boleh dilanggar**:

1. Cockatiel retry **TIDAK** menambah `total_retry_count`. Cockatiel hanya menambah `attempt_count` dalam cycle yang sama.
2. Scheduler cycle (TASK-10) **di-increment** `total_retry_count` saat memulai cycle baru dari `scheduled_for_retry` (setelah transisi sukses `scheduled_for_retry -> processing`). Tidak — koreksi: counter di-increment **saat transisi `processing -> scheduled_for_retry`**, yaitu saat cycle gagal dan dijadwalkan ulang. Saat scheduler baru saja start cycle, counter tidak di-increment lagi (sudah dihitung).
3. `manualRetry()` **TIDAK** mereset `total_retry_count`. Counter jujur menggambarkan berapa kali payment ini sudah dijadwalkan ulang.
4. Bila `total_retry_count + 1 > MAX_TOTAL_RETRIES` (default 5) -> service tidak menjadwalkan retry, langsung transisi `processing -> failed` + `failureReason = 'max_total_retries_exceeded'`.
5. `attempt_count` di-reset ke 0 di awal setiap `executePayment()` call (karena Cockatiel mulai dari attempt #1 lagi di setiap cycle baru).

## Files to create

- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/payments/state-machine.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/payments/idempotency.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/payments/audit/audit-port.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/payments/payments.service.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/payments/payments.module.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/payments/dto/create-payment.dto.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/payments/index.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/test/modules/payments/state-machine.spec.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/test/modules/payments/idempotency.spec.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/test/modules/payments/payments.service.spec.ts`

## Implementation steps

### 1. `audit/audit-port.ts` — interface (impl di TASK-08)

```ts
import type { AttemptOutcome } from '../../../database/entities/enums';

/**
 * Token DI untuk AuditPort. Default binding: NoopAuditService (placeholder).
 * TASK-08 akan meng-override binding ke PrismaAuditService.
 */
export const AUDIT_PORT = Symbol('AUDIT_PORT');

/**
 * Payload untuk menulis satu row payment_attempts (plan section 11.2).
 * Semua kolom yang TIDAK optional WAJIB diisi — task-08 schema NOT NULL.
 */
export interface RecordAttemptInput {
  paymentId: string;
  attemptNumber: number;            // 1-based, Cockatiel attempt dalam execution cycle
  outcome: AttemptOutcome;          // success | retryable_failure | permanent_failure | timeout | circuit_open
  httpStatus?: number | null;       // null bila network error / breaker trip (no HTTP)
  errorCode?: string | null;
  errorMessage?: string | null;
  delayBeforeNextMs?: number | null; // diisi dari ChargeResult.retryAfterMs atau backoff Cockatiel
  breakerState: 'closed' | 'open' | 'half_open';
  durationMs: number;                // finishedAt - startedAt
  traceId?: string | null;          // crypto.randomUUID() per execution cycle
  idempotencyKey: string;           // = paymentId (deriveIdempotencyKey)
  gatewayReference?: string | null; // dari ChargeResult.gatewayReference
  replayed: boolean;                // dari ChargeResult.replayed (gateway-side truth)
}

/**
 * View untuk read-side (GET /payments/:id).
 * Field sama dengan entity PaymentAttempt (TASK-02), tapi plain object.
 */
export interface AttemptView {
  id: string;
  paymentId: string;
  attemptNumber: number;
  outcome: AttemptOutcome;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  delayBeforeNextMs: number | null;
  breakerState: string;
  durationMs: number;
  traceId: string | null;
  idempotencyKey: string;
  gatewayReference: string | null;
  replayed: boolean;
  createdAt: Date;
}

/**
 * Port yang di-satisfy oleh PrismaAuditService (TASK-08).
 * Service memanggil recordAttempt per-attempt via onAttempt callback (TASK-06).
 */
export interface AuditPort {
  /** Persist satu attempt row. TIDAK boleh throw — wrap internal error di try/catch. */
  recordAttempt(input: RecordAttemptInput): Promise<void>;
  /** List attempts untuk satu payment, urut by attempt_number ASC. */
  listAttempts(paymentId: string): Promise<AttemptView[]>;
}

/**
 * Default placeholder — di-inject bila TASK-08 belum di-wire.
 * Berguna untuk menjalankan service di test / dev tanpa DB.
 */
export class NoopAuditService implements AuditPort {
  async recordAttempt(_input: RecordAttemptInput): Promise<void> {
    /* no-op */
  }
  async listAttempts(_paymentId: string): Promise<AttemptView[]> {
    return [];
  }
}
```

### 2. `state-machine.ts` — valid transition map

```ts
import { PaymentStatus } from '../../database/entities/enums';

/**
 * Valid forward transitions. Key = from-status, value = set of allowed to-statuses.
 * Plan section 10.2.
 */
export const VALID_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  [PaymentStatus.PROCESSING]: [
    PaymentStatus.SUCCEEDED,
    PaymentStatus.FAILED,
    PaymentStatus.SCHEDULED_FOR_RETRY,
  ],
  [PaymentStatus.SCHEDULED_FOR_RETRY]: [
    PaymentStatus.PROCESSING, // scheduler / manual retry start new cycle
    PaymentStatus.FAILED,     // manualRetry bila totalRetryCount > MAX (defensive)
  ],
  [PaymentStatus.FAILED]: [
    PaymentStatus.PROCESSING, // manualRetry only (admin override)
  ],
  [PaymentStatus.SUCCEEDED]: [], // terminal — no transitions
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: PaymentStatus,
    public readonly to: PaymentStatus,
  ) {
    super(`Invalid status transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function isTerminal(status: PaymentStatus): boolean {
  return status === PaymentStatus.SUCCEEDED || status === PaymentStatus.FAILED;
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  const allowed = VALID_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

export function assertCanTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}
```

### 3. `idempotency.ts` — re-export + invariant helper

```ts
/**
 * Re-export deriveIdempotencyKey dari TASK-06 — service tidak boleh
 * re-implement (single source of truth).
 */
export { deriveIdempotencyKey } from '../gateway/idempotency-key';

/**
 * Verifikasi invariant plan section 9.1: actualCharges <= 1 walau HTTP calls >= 2.
 *
 * @returns true bila invariant terpenuhi.
 *
 * Catatan: service TIDAK memanggil ini di runtime (tidak punya visibilitas
 * actualCharges — itu gateway-side truth via replayed:true). Helper disediakan
 * untuk:
 *   - test assertion di TASK-14 scenario 4 (succeed-but-drop-response),
 *   - observability hook di TASK-11 bila ingin log warning saat violated.
 */
export function assertInvariant(actualCharges: number, httpCalls: number): boolean {
  return actualCharges <= 1;
}
```

### 4. `dto/create-payment.dto.ts` — class-validator

```ts
import { IsString, IsNumber, MinLength, MaxLength, IsPositive, Max, Length, IsIn } from 'class-validator';

const SUPPORTED_CURRENCIES = ['IDR', 'USD', 'SGD', 'EUR'] as const;

export class CreatePaymentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  orderId!: string;

  /**
   * Di DTO pakai number (ergonomic API). Di service dikonversi ke
   * string 2-desimal sebelum persist ke PostgreSQL `numeric(12,2)`
   * (lihat PaymentsService.formatAmount).
   */
  @IsNumber({ maxDecimalDigits: 2 })
  @IsPositive()
  @Max(1_000_000)
  amount!: number;

  @IsString()
  @Length(3, 3)
  @IsIn(SUPPORTED_CURRENCIES as unknown as string[])
  currency: string = 'IDR';
}
```

### 5. `payments.service.ts` — orchestration

```ts
import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PaymentRepository } from '../../database/repositories/payment.repository';
import { Payment, PaymentStatus } from '../../database/entities';
import { AttemptOutcome } from '../../database/entities/enums';
import {
  PAYMENT_GATEWAY_PORT,
  type PaymentGatewayPort,
  type AttemptObservable,
  type GatewayAttemptContext,
  type ChargeResult,
} from '../gateway';
import { deriveIdempotencyKey } from '../gateway/idempotency-key';
import { AUDIT_PORT, type AuditPort, type RecordAttemptInput, type AttemptView } from './audit/audit-port';
import { assertCanTransition, isTerminal } from './state-machine';
import type { CreatePaymentDto } from './dto/create-payment.dto';

export interface ExecuteOptions {
  source: 'api' | 'scheduler' | 'manual';
}

export interface PaymentView {
  id: string;
  orderId: string;
  amount: string; // numeric string
  currency: string;
  status: PaymentStatus;
  gatewayReference: string | null;
  attemptCount: number;
  totalRetryCount: number;
  nextRetryAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentDetail extends PaymentView {
  attempts: AttemptView[];
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly maxTotalRetries: number;
  private readonly schedulerBaseDelayMs: number;

  constructor(
    private readonly payments: PaymentRepository,
    @Inject(PAYMENT_GATEWAY_PORT) private readonly gateway: PaymentGatewayPort,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    config: ConfigService,
  ) {
    this.maxTotalRetries = config.get<number>('MAX_TOTAL_RETRIES', 5);
    this.schedulerBaseDelayMs = config.get<number>('SCHEDULER_BASE_DELAY_MS', 30_000);
  }

  /**
   * POST /payments flow (plan section 10.2):
   *   1. validate (DTO via controller — TASK-09)
   *   2. create row status=processing
   *   3. executePayment(source='api')
   *   4. return view (terminal atau processing-bila-async-decided-future)
   */
  async createPayment(input: CreatePaymentDto): Promise<PaymentView> {
    const amountStr = this.formatAmount(input.amount);
    const payment = await this.payments.create({
      orderId: input.orderId,
      amount: amountStr,
      currency: input.currency,
      status: PaymentStatus.PROCESSING,
      attemptCount: 0,
      totalRetryCount: 0,
      gatewayReference: null,
      nextRetryAt: null,
      failureReason: null,
    });
    this.logger.log({ paymentId: payment.id, orderId: payment.orderId }, 'payment created');

    // Execute synchronously — controller (TASK-09) blocking HTTP request sampai terminal.
    const updated = await this.executePayment(payment.id, { source: 'api' });
    return this.toView(updated);
  }

  /**
   * Jalankan satu execution cycle (plan section 7.1 + 10.2):
   *   - atomic set status=processing, reset attempt_count=0
   *   - generate traceId per cycle
   *   - wire onAttempt callback -> audit.recordAttempt
   *   - call gateway.charge(req)
   *   - map ChargeResult -> status transition + side-effects
   *
   * Dipanggil dari:
   *   - createPayment (source='api')
   *   - manualRetry (source='manual')
   *   - scheduler (TASK-10, source='scheduler')
   */
  async executePayment(paymentId: string, options: ExecuteOptions): Promise<Payment> {
    const payment = await this.payments.findById(paymentId);
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);

    // Atomic transition: whatever current status -> processing.
    // (untuk source='api' status sudah processing; untuk source='scheduler'/'manual'
    //  status sebelumnya = scheduled_for_retry atau failed).
    const previousStatus = payment.status;
    assertCanTransition(previousStatus, PaymentStatus.PROCESSING);

    const switched = await this.payments.atomicUpdateStatus(paymentId, previousStatus, {
      status: PaymentStatus.PROCESSING,
      attemptCount: 0,
      failureReason: null,
      // catatan: totalRetryCount, gatewayReference, nextRetryAt TIDAK direset di sini.
    });
    if (!switched) {
      // Race condition: status berubah sebelum kita lock. Throw agar caller retry.
      throw new BadRequestException(`Payment ${paymentId} status changed concurrently`);
    }

    const traceId = randomUUID();
    const idempotencyKey = deriveIdempotencyKey(paymentId);

    // Wire audit callback — per-attempt write via gateway adapter hook (option A).
    // Lihat Notes untuk trade-off option A vs B.
    this.attachAuditCallback(traceId, idempotencyKey);

    const startedAt = Date.now();
    let result: ChargeResult;
    try {
      result = await this.gateway.charge({
        paymentId,
        orderId: payment.orderId,
        amount: payment.amount,
        currency: payment.currency,
      });
    } catch (err) {
      // Seharusnya tidak terjadi — adapter mengembalikan ChargeResult bahkan untuk error.
      // Tapi bila throw (mis. programming error), tangkap sebagai unexpected failure.
      this.logger.error({ paymentId, err }, 'gateway.charge threw unexpectedly');
      result = {
        status: 'failed',
        replayed: false,
        errorCode: 'unexpected_exception',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
    const durationMs = Date.now() - startedAt;

    return this.applyOutcome(paymentId, result, { traceId, idempotencyKey, durationMs, source: options.source });
  }

  /**
   * Map ChargeResult -> status transition + persist side-effects.
   * Semua transisi di sini atomic via atomicUpdateStatus(paymentId, PROCESSING, patch).
   */
  private async applyOutcome(
    paymentId: string,
    result: ChargeResult,
    ctx: { traceId: string; idempotencyKey: string; durationMs: number; source: string },
  ): Promise<Payment> {
    // 1. Permanent failure (4xx non-429) -> failed
    if (this.isPermanentFailure(result)) {
      await this.atomicTransition(paymentId, PaymentStatus.FAILED, {
        failureReason: result.errorMessage ?? result.errorCode ?? 'permanent_failure',
        // audit: juga tulis attempt terakhir via onAttempt (sudah dipanggil adapter)
      });
      this.logger.warn({ paymentId, errorCode: result.errorCode }, 'payment permanent failure -> failed');
      return (await this.payments.findById(paymentId))!;
    }

    // 2. Success -> succeeded + gatewayReference
    if (result.status === 'succeeded') {
      await this.atomicTransition(paymentId, PaymentStatus.SUCCEEDED, {
        gatewayReference: result.gatewayReference ?? null,
      });
      this.logger.log({ paymentId, gatewayReference: result.gatewayReference }, 'payment succeeded');
      return (await this.payments.findById(paymentId))!;
    }

    // 3. Circuit open -> scheduled_for_retry (tidak increment counter — circuit bukan cycle gagal baru)
    //    Catatan: sebenarnya circuit_open juga mengindikasikan cycle gagal; keputusan:
    //    di-increment totalRetryCount juga (cycle gagal karena breaker).
    //    Bila totalRetryCount + 1 > MAX -> failed.
    // 4. Retry exhausted (attempts === RETRY_MAX_ATTEMPTS, status='failed') -> scheduled_for_retry
    //    Bila totalRetryCount + 1 > MAX -> failed.
    if (result.errorCode === 'circuit_open' || result.attempts !== undefined) {
      const current = (await this.payments.findById(paymentId))!;
      const nextTotal = current.totalRetryCount + 1;
      if (nextTotal > this.maxTotalRetries) {
        await this.atomicTransition(paymentId, PaymentStatus.FAILED, {
          failureReason: 'max_total_retries_exceeded',
        });
        this.logger.warn({ paymentId, totalRetryCount: current.totalRetryCount }, 'max_total_retries_exceeded -> failed');
        return (await this.payments.findById(paymentId))!;
      }
      const delayMs = result.retryAfterMs ?? this.schedulerBaseDelayMs;
      const nextRetryAt = new Date(Date.now() + delayMs);
      await this.atomicTransition(paymentId, PaymentStatus.SCHEDULED_FOR_RETRY, {
        totalRetryCount: nextTotal,
        nextRetryAt,
        failureReason: result.errorMessage ?? result.errorCode ?? 'retry_exhausted',
      });
      this.logger.log(
        { paymentId, nextRetryAt, totalRetryCount: nextTotal, source: ctx.source },
        'payment scheduled for retry',
      );
      return (await this.payments.findById(paymentId))!;
    }

    // 5. Fallback — seharusnya tidak tercapai. Treat sebagai failed untuk safety.
    await this.atomicTransition(paymentId, PaymentStatus.FAILED, {
      failureReason: result.errorMessage ?? 'unknown_charge_result',
    });
    this.logger.error({ paymentId, result }, 'unknown charge result mapping — fallback to failed');
    return (await this.payments.findById(paymentId))!;
  }

  /**
   * Manual retry — admin override dari terminal state (failed) atau scheduled_for_retry.
   * - attempt_count direset (cycle baru)
   * - total_retry_count TIDAK direset (counter jujur)
   * - jalankan executePayment(source='manual')
   */
  async manualRetry(paymentId: string): Promise<PaymentView> {
    const payment = await this.payments.findById(paymentId);
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);
    if (payment.status !== PaymentStatus.FAILED && payment.status !== PaymentStatus.SCHEDULED_FOR_RETRY) {
      throw new BadRequestException(`Cannot manualRetry from status=${payment.status}`);
    }
    const updated = await this.executePayment(paymentId, { source: 'manual' });
    return this.toView(updated);
  }

  async getById(id: string): Promise<PaymentDetail> {
    const payment = await this.payments.findById(id);
    if (!payment) throw new NotFoundException(`Payment ${id} not found`);
    const attempts = await this.audit.listAttempts(id);
    return { ...this.toView(payment), attempts };
  }

  async list(filter: { status?: PaymentStatus } = {}): Promise<PaymentView[]> {
    const payments = await this.payments.list(filter);
    return payments.map((p) => this.toView(p));
  }

  // --- helpers ---

  private isPermanentFailure(result: ChargeResult): boolean {
    if (result.status === 'succeeded') return false;
    const code = result.errorCode;
    if (code === 'invalid_card' || code === 'insufficient_funds' || code === 'expired_card') return true;
    const http = result.httpStatus;
    if (http !== undefined && http >= 400 && http < 500 && http !== 429 && http !== 408) return true;
    return false;
  }

  private async atomicTransition(
    paymentId: string,
    to: PaymentStatus,
    patch: Partial<Payment>,
  ): Promise<void> {
    const ok = await this.payments.atomicUpdateStatus(paymentId, PaymentStatus.PROCESSING, {
      ...patch,
      status: to,
    });
    if (!ok) {
      // Status bukan processing lagi — concurrent execution. Throw agar caller tahu.
      throw new BadRequestException(
        `Cannot transition payment ${paymentId} to ${to}: status no longer processing (concurrent execution)`,
      );
    }
  }

  /**
   * Wire callback onAttempt ke ResilientPaymentGateway (TASK-06).
   * Option A (preferred): adapter yang invoke audit.recordAttempt — service cukup
   *   set callback sekali per execution cycle.
   * Bila adapter tidak mendukung AttemptObservable (mis. di test mock), audit tidak
   *   ter-write — service tetap berfungsi tanpa audit trail (graceful degradation).
   */
  private attachAuditCallback(traceId: string, idempotencyKey: string): void {
    const observable = this.gateway as unknown as Partial<AttemptObservable>;
    if (typeof observable.setOnAttempt !== 'function') return;
    observable.setOnAttempt(async (ctx: GatewayAttemptContext) => {
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
      try {
        await this.audit.recordAttempt(input);
      } catch (err) {
        // Audit failure TIDAK boleh break payment flow. Log + continue.
        this.logger.error({ err, paymentId: ctx.paymentId, attemptNumber: ctx.attemptNumber }, 'audit.recordAttempt failed');
      }
    });
  }

  private classifyOutcome(result: ChargeResult, breakerState?: string): AttemptOutcome {
    if (result.status === 'succeeded') return 'success' as AttemptOutcome;
    if (breakerState === 'OPEN' || result.errorCode === 'circuit_open') return 'circuit_open' as AttemptOutcome;
    if (this.isPermanentFailure(result)) return 'permanent_failure' as AttemptOutcome;
    if (result.errorCode === 'ETIMEDOUT' || result.errorCode === 'ECONNABORTED') return 'timeout' as AttemptOutcome;
    return 'retryable_failure' as AttemptOutcome;
  }

  private formatAmount(amount: number): string {
    return amount.toFixed(2); // "10000.00" — PostgreSQL numeric(12,2)
  }

  private toView(p: Payment): PaymentView {
    return {
      id: p.id,
      orderId: p.orderId,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      gatewayReference: p.gatewayReference,
      attemptCount: p.attemptCount,
      totalRetryCount: p.totalRetryCount,
      nextRetryAt: p.nextRetryAt,
      failureReason: p.failureReason,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
```

### 6. `payments.module.ts` — NestJS wiring

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../../database/entities';
import { PaymentRepository } from '../../database/repositories/payment.repository';
import { GatewayModule } from '../gateway';
import { PaymentsService } from './payments.service';
import { AUDIT_PORT, NoopAuditService } from './audit/audit-port';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment]),
    GatewayModule, // exports PAYMENT_GATEWAY_PORT
  ],
  providers: [
    PaymentRepository,
    PaymentsService,
    // Default binding: placeholder. TASK-08 akan override ke PrismaAuditService
    // dengan menghapus provider ini atau meng-override di task-08.module.ts.
    { provide: AUDIT_PORT, useClass: NoopAuditService },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
```

### 7. `index.ts` — barrel

```ts
export * from './state-machine';
export * from './idempotency';
export * from './audit/audit-port';
export * from './payments.service';
export * from './payments.module';
export * from './dto/create-payment.dto';
```

### 8. Jest tests

#### `state-machine.spec.ts`
- `canTransition(PROCESSING, SUCCEEDED)` -> true.
- `canTransition(PROCESSING, FAILED)` -> true.
- `canTransition(PROCESSING, SCHEDULED_FOR_RETRY)` -> true.
- `canTransition(SCHEDULED_FOR_RETRY, PROCESSING)` -> true.
- `canTransition(SUCCEEDED, PROCESSING)` -> false (terminal).
- `canTransition(FAILED, PROCESSING)` -> true (manualRetry).
- `canTransition(FAILED, SUCCEEDED)` -> false (must go through processing).
- `assertCanTransition(SUCCEEDED, FAILED)` throws `InvalidTransitionError`.
- `isTerminal(SUCCEEDED)` -> true; `isTerminal(FAILED)` -> true; `isTerminal(PROCESSING)` -> false; `isTerminal(SCHEDULED_FOR_RETRY)` -> false.

#### `idempotency.spec.ts`
- `deriveIdempotencyKey('pay_123')` -> `'pay_123'` (re-export behavior sama TASK-06).
- `deriveIdempotencyKey('')` -> throw.
- `assertInvariant(1, 5)` -> true (1 charge, 5 calls — invariant hold).
- `assertInvariant(2, 5)` -> false (invariant violated).
- `assertInvariant(0, 0)` -> true.

#### `payments.service.spec.ts`
- **Setup**: mock `PaymentRepository` (jest), mock `PaymentGatewayPort` (jest), mock `AuditPort` (jest), `ConfigService` with `MAX_TOTAL_RETRIES=5`, `SCHEDULER_BASE_DELAY_MS=30000`.
- **createPayment always-success**: gateway.charge returns `{ status: 'succeeded', gatewayReference: 'gw_1', replayed: false, attempts: 1 }`. Result: payment saved with `status=succeeded`, `gatewayReference='gw_1'`, `attemptCount` not changed by service (audit callback not invoked in mock unless set). `totalRetryCount=0`.
- **createPayment client-error**: gateway.charge returns `{ status: 'failed', httpStatus: 400, errorCode: 'invalid_card', replayed: false, attempts: 1 }`. Result: `status=failed`, `failureReason` set, `totalRetryCount=0`.
- **createPayment fail-first-n=2 RETRY_MAX_ATTEMPTS=3**: mock adapter retries internally (mock gateway.charge returns success on call ke-3, dengan `attempts: 3`). Result: `status=succeeded`, `gatewayReference` set.
- **createPayment server-error (always 500)**: gateway.charge returns `{ status: 'failed', httpStatus: 500, replayed: false, attempts: 3 }`. Result: `status=scheduled_for_retry`, `totalRetryCount=1`, `nextRetryAt` ≈ now + 30s, `failureReason` set.
- **manualRetry from scheduled_for_retry**: payment mock awal `status=scheduled_for_retry, totalRetryCount=2`. Call `manualRetry()`. Result: executePayment dijalankan, `attemptCount` reset via atomic update. `totalRetryCount` TIDAK direset (tetap 2) sebelum increment.
- **manualRetry from succeeded**: throw `BadRequestException`.
- **executePayment MAX_TOTAL_RETRIES exceeded**: payment dengan `totalRetryCount=5` (sama dengan MAX), call `executePayment` yang gagal. Result: `status=failed`, `failureReason='max_total_retries_exceeded'`. `totalRetryCount` tidak di-increment ke 6.
- **getById**: mock `payments.findById` + `audit.listAttempts` returns 2 attempts. Result: `PaymentDetail` dengan `attempts.length === 2`.
- **list dengan filter status**: `payments.list({ status: 'scheduled_for_retry' })` dipanggil dengan benar.
- **Idempotency**: dua call `createPayment` dengan `orderId` yang sama -> repository.create throw unique constraint (mock). Service propagates error (tidak double-create).
- **Audit callback graceful degradation**: `audit.recordAttempt` throw -> service tetap lanjut (tidak propagate). Verifikasi via spy: `gateway.charge` tetap selesai.
- **Trace ID**: tiap call `executePayment` generate UUID baru. Verifikasi via mock: `audit.recordAttempt` dipanggil dengan `traceId` berbeda untuk dua cycle berbeda payment.

## Acceptance criteria

- [ ] `state-machine.ts` mengekspor `VALID_TRANSITIONS`, `canTransition`, `assertCanTransition`, `isTerminal`, `InvalidTransitionError`.
- [ ] `canTransition` mengembalikan true/false sesuai tabel valid transitions; `assertCanTransition` throw `InvalidTransitionError` untuk transisi invalid.
- [ ] `idempotency.ts` re-export `deriveIdempotencyKey` dari TASK-06 + `assertInvariant(actualCharges, httpCalls): boolean`.
- [ ] `audit/audit-port.ts` mengekspor `AuditPort` interface, `RecordAttemptInput` (semua field plan section 11.2), `AttemptView`, `AUDIT_PORT` token, dan `NoopAuditService` placeholder.
- [ ] `dto/create-payment.dto.ts` memakai `class-validator`: `orderId IsString MinLength(1) MaxLength(64)`, `amount IsNumber IsPositive Max(1_000_000) maxDecimalDigits=2`, `currency Length(3,3) default 'IDR'`.
- [ ] `payments.service.ts` meng-inject: `PaymentRepository`, `PAYMENT_GATEWAY_PORT`, `AUDIT_PORT`, `ConfigService`.
- [ ] `createPayment(input)` membuat row `status=processing` -> panggil `executePayment(source='api')` -> return `PaymentView` dengan status terminal (`succeeded` / `failed` / `scheduled_for_retry`).
- [ ] `executePayment(paymentId, { source })` atomic transisi `* -> processing` via `atomicUpdateStatus(paymentId, previousStatus, { status: processing, attemptCount: 0 })`; reset `attempt_count=0`; TIDAK reset `total_retry_count`; generate `traceId = crypto.randomUUID()`.
- [ ] `executePayment` wire callback `onAttempt` ke adapter (option A) -> memanggil `audit.recordAttempt` per-attempt dengan field lengkap (`attemptNumber`, `outcome`, `httpStatus`, `errorCode`, `errorMessage`, `delayBeforeNextMs`, `breakerState`, `durationMs`, `traceId`, `idempotencyKey`, `gatewayReference`, `replayed`).
- [ ] Permanent failure (4xx non-429 / `errorCode='invalid_card'`) -> `status=failed` + `failureReason` di-set; `totalRetryCount` tidak berubah.
- [ ] Retry exhausted (attempts === maxAttempts, `status='failed'`) -> `status=scheduled_for_retry`, `totalRetryCount` di-increment, `nextRetryAt = now + delay` (delay = `retryAfterMs` bila ada, else `SCHEDULER_BASE_DELAY_MS`).
- [ ] Circuit open (`errorCode='circuit_open'`) -> `status=scheduled_for_retry` (counter juga di-increment).
- [ ] Bila `totalRetryCount + 1 > MAX_TOTAL_RETRIES` (default 5) -> transisi `processing -> failed` + `failureReason='max_total_retries_exceeded'`. Tidak menjadwalkan retry.
- [ ] `manualRetry(paymentId)` hanya boleh dipanggil dari status `failed` atau `scheduled_for_retry`; dari status lain -> throw `BadRequestException`. Reset `attempt_count=0`; TIDAK reset `total_retry_count`.
- [ ] `getById(id)` return `PaymentDetail` dengan `attempts` dari `audit.listAttempts(id)`.
- [ ] `list({ status? })` meneruskan filter ke `PaymentRepository.list`.
- [ ] Semua transisi status pakai `atomicUpdateStatus(paymentId, expectedFrom, patch)` (atomic via `UPDATE ... WHERE id=? AND status=?`).
- [ ] `NoopAuditService` di-bind sebagai default `AUDIT_PORT` — module bisa boot tanpa TASK-08.
- [ ] `PaymentsModule` exports `PaymentsService`. Import `GatewayModule` (untuk `PAYMENT_GATEWAY_PORT`) + `TypeOrmModule.forFeature([Payment])`.
- [ ] Tidak ada import `axios`, `cockatiel`, atau `@prisma/client` di seluruh `modules/payments/` (kecuali TypeORM repository yang sudah di-task-02).
- [ ] `attempt_count` di-reset oleh service (bukan Cockatiel). `total_retry_count` di-increment hanya oleh service (scheduler TASK-10 memanggil `executePayment(source='scheduler')` — service yang increment).
- [ ] `pnpm --filter payment-api typecheck` lulus.
- [ ] `pnpm --filter payment-api lint` lulus.
- [ ] `pnpm --filter payment-api test` (Jest) lulus untuk `state-machine.spec.ts`, `idempotency.spec.ts`, `payments.service.spec.ts`.

## Useful commands (run after completing this task)

### Pre-flight Check

> **WAJIB BACA**: sebelum menjalankan command di bawah, cek kondisi lingkungan Anda via [`SANDBOX_NOTES.md`](./SANDBOX_NOTES.md) section 1 (Pre-flight Check).
>
> Ringkasan keyword:
> - `pnpm --version` ada -> KONDISI LOCAL. Tidak ada -> KONDISI SANDBOX -> jalankan `corepack enable pnpm && corepack prepare pnpm@9.12.0 --activate` dulu.
> - `docker --version` ada -> KONDISI LOCAL. Tidak ada -> KONDISI SANDBOX -> butuh external PostgreSQL atau skip DB-dependent commands.
> - `curl -s http://localhost:3000` sibuk -> KONDISI SANDBOX -> payment-api pakai PORT=3001, gateway-mock pakai PORT=3002. Bebas -> KONDISI LOCAL -> payment-api pakai PORT=3000, gateway-mock pakai PORT=3001.

Command di bawah ditulis dengan dua varian bila perlu (LOCAL / SANDBOX). Pilih salah satu sesuai kondisi.

---

### 1. Start gateway mock (dependency TASK-03 — port kondisional)

```bash
# KONDISI LOCAL (gateway-mock default port 3001):
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock
PORT=3001 pnpm start:dev > /tmp/gateway-mock.log 2>&1 &
sleep 5
tail -n 20 /tmp/gateway-mock.log
# Expected: "payment-gateway-mock listening on :3001"

# KONDISI SANDBOX (port 3001 dipakai payment-api -> gateway-mock geser ke 3002):
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock
PORT=3002 pnpm start:dev > /tmp/gateway-mock.log 2>&1 &
sleep 5
tail -n 20 /tmp/gateway-mock.log
# Expected: "payment-gateway-mock listening on :3002"
```

> Konvensi env var: `GW_PORT="${GW_PORT:-3001}"` default LOCAL; set `GW_PORT=3002` untuk SANDBOX.

### 2. Pastikan DB migration applied (dependency TASK-02)

```bash
# KONDISI LOCAL (Docker tersedia):
cd /home/z/my-project/retry-failure
docker compose up -d postgres
sleep 5
docker compose ps postgres

cd /home/z/my-project/retry-failure/apps/payment-api
pnpm db:migrate

# Verify schema via docker exec
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml exec postgres \
  psql -U retry_failure -d retry_failure -c '\dt'

# KONDISI SANDBOX (Docker tidak tersedia):
# Opsi A — external PostgreSQL instance tersedia (set DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME di .env):
cd /home/z/my-project/retry-failure/apps/payment-api
# Edit .env terlebih dahulu: DB_HOST=..., DB_PORT=..., dst.
pnpm db:migrate

# Verify schema via psql di host (bila tersedia):
psql "$DATABASE_URL" -c '\dt'
# atau via Node script bila psql CLI tidak tersedia:
pnpm exec ts-node -e "
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const t = await c.query(\"SELECT table_name FROM information_schema.tables WHERE table_schema='public'\");
console.log(t.rows);
await c.end();
"

# Opsi B — tidak ada PostgreSQL sama sekali: skip migration, gunakan NoopAuditService / mock repository.
# Document caveat di TASK-15 production caveats. E2E service test di step 5 akan fail; jalankan unit test saja (step 4).
```

### 3. Start payment-api (port kondisional)

```bash
# KONDISI LOCAL (port 3000 bebas):
cd /home/z/my-project/retry-failure/apps/payment-api
PORT=3000 pnpm start:dev > /tmp/payment-api.log 2>&1 &
sleep 8
tail -n 30 /tmp/payment-api.log
# Expected: "Nest application successfully started" + listening on :3000

# KONDISI SANDBOX (port 3000 dipakai Next.js preview -> payment-api geser ke 3001):
cd /home/z/my-project/retry-failure/apps/payment-api
PORT=3001 pnpm start:dev > /tmp/payment-api.log 2>&1 &
sleep 8
tail -n 30 /tmp/payment-api.log
# Expected: "Nest application successfully started" + listening on :3001
```

> Konvensi env var: `API_PORT="${API_PORT:-3000}"` default LOCAL; set `API_PORT=3001` untuk SANDBOX.

### 4. Lint & typecheck

```bash
cd /home/z/my-project/retry-failure
pnpm --filter payment-api typecheck
pnpm --filter payment-api lint
pnpm --filter payment-api test
```

### 5. Quick E2E service test via ts-node (gateway mock + DB harus sudah jalan — port kondisional)

Simpan sebagai `/tmp/smoke-payments-service.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import axios from 'axios';
import { PaymentsModule } from '../../apps/payment-api/src/modules/payments/payments.module';
import { PaymentsService } from '../../apps/payment-api/src/modules/payments/payments.service';
import { DatabaseModule } from '../../apps/payment-api/src/database/database.module';

// Baca gateway URL dari env. Default LOCAL (port 3001); untuk SANDBOX set GATEWAY_URL=http://localhost:3002
// sebelum invoke ts-node (lihat command block di bawah script ini).
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, PaymentsModule],
})
class SmokeModule {}

async function setGatewayMode(mode: string, extra: Record<string, unknown> = {}): Promise<void> {
  await axios.put(`${GATEWAY_URL}/admin/config`, { mode, ...extra });
}

async function run(label: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n=== ${label} ===`);
  try {
    await fn();
  } catch (err) {
    console.error('  ERROR:', (err as Error).message);
  }
}

(async () => {
  const app = await NestFactory.create(SmokeModule, { logger: ['error', 'warn'] });
  const svc = app.get(PaymentsService);

  await run('always-success (should succeed on attempt 1)', async () => {
    await setGatewayMode('always-success');
    const p = await svc.createPayment({ orderId: `smoke-success-${Date.now()}`, amount: 10000, currency: 'IDR' });
    console.log('  ->', JSON.stringify({ status: p.status, gatewayReference: p.gatewayReference, totalRetryCount: p.totalRetryCount }));
  });

  await run('client-error (should fail permanently)', async () => {
    await setGatewayMode('client-error');
    const p = await svc.createPayment({ orderId: `smoke-client-${Date.now()}`, amount: 10000, currency: 'IDR' });
    console.log('  ->', JSON.stringify({ status: p.status, failureReason: p.failureReason, totalRetryCount: p.totalRetryCount }));
  });

  await run('fail-first-n=2 RETRY_MAX_ATTEMPTS=3 (should succeed after 3 attempts)', async () => {
    await setGatewayMode('fail-first-n', { n: 2 });
    const p = await svc.createPayment({ orderId: `smoke-ffn-${Date.now()}`, amount: 10000, currency: 'IDR' });
    console.log('  ->', JSON.stringify({ status: p.status, gatewayReference: p.gatewayReference }));
  });

  await run('server-error (should schedule_for_retry)', async () => {
    await setGatewayMode('server-error');
    const p = await svc.createPayment({ orderId: `smoke-server-${Date.now()}`, amount: 10000, currency: 'IDR' });
    console.log('  ->', JSON.stringify({ status: p.status, failureReason: p.failureReason, totalRetryCount: p.totalRetryCount, nextRetryAt: p.nextRetryAt }));
  });

  await run('getById returns attempts list', async () => {
    await setGatewayMode('always-success');
    const created = await svc.createPayment({ orderId: `smoke-detail-${Date.now()}`, amount: 5000, currency: 'IDR' });
    const detail = await svc.getById(created.id);
    console.log('  ->', JSON.stringify({ status: detail.status, attemptsCount: detail.attempts.length }));
  });

  await run('list filter by status', async () => {
    const succeeded = await svc.list({ status: 'succeeded' as never });
    console.log('  ->', JSON.stringify({ count: succeeded.length }));
  });

  // Reset ke always-success
  await setGatewayMode('always-success');
  console.log('\nGateway reset to always-success.');
  await app.close();
})();
```

Jalankan:

```bash
cd /home/z/my-project/retry-failure

# KONDISI LOCAL (gateway-mock port 3001):
GATEWAY_URL=http://localhost:3001 pnpm --filter payment-api exec ts-node /tmp/smoke-payments-service.ts

# KONDISI SANDBOX (gateway-mock port 3002):
GATEWAY_URL=http://localhost:3002 pnpm --filter payment-api exec ts-node /tmp/smoke-payments-service.ts

# Atau pakai pola env var GW_PORT (default 3001 LOCAL, override 3002 SANDBOX):
GW_PORT="${GW_PORT:-3001}" GATEWAY_URL="http://localhost:${GW_PORT}" \
  pnpm --filter payment-api exec ts-node /tmp/smoke-payments-service.ts
```

### 6. Reset gateway mode ke always-success (selalu di akhir)

```bash
GW_PORT="${GW_PORT:-3001}"  # 3001 LOCAL, 3002 SANDBOX

curl -s -X PUT "http://localhost:${GW_PORT}/admin/config" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"always-success","n":0,"probability":0.5,"retryAfterSeconds":10,"timeoutMs":5000}' | jq .

# Cleanup proses
pkill -f "nest start" 2>/dev/null
```

## Notes

- **Per-attempt audit: option A vs B**:
  - **Option A (dipilih)**: gateway adapter (TASK-06) invoke `audit.recordAttempt` via `onAttempt` callback yang di-set oleh `PaymentsService.attachAuditCallback`. Service cukup `gateway.setOnAttempt(cb)` sekali per execution cycle. Audit logic hidup di service (callback closure), adapter tetap framework-agnostic. Trade-off: service harus tahu bahwa gateway instanceof `AttemptObservable` (cast via `as unknown as Partial<AttemptObservable>`).
  - **Option B (alternatif ditolak)**: service meneruskan `onAttempt` ke `executeWithResilience({ fn, onAttempt })` langsung. Tapi itu meng-couple service ke `@retry-failure/resilience` API (TASK-05) — melanggar layering yang sudah dibangun TASK-06 (adapter sebagai boundary). Tidak dipakai.
  - **Graceful degradation**: bila adapter tidak mendukung `AttemptObservable` (mis. di test mock), `attachAuditCallback` no-op. Service tetap berfungsi — hanya tidak ada audit row.

- **Atomic status transition via `updateMany WHERE status=expectedFrom`**: TypeORM `repository.update({ id, status: expectedFrom }, patch)` menghasilkan SQL `UPDATE payments SET ... WHERE id=? AND status=?`. Bila affected rows = 0 -> status sudah berubah (concurrent execution) -> service throw `BadRequestException`. Ini menjamin idempotensi scheduler (TASK-10) — bila dua instance scheduler pick payment yang sama, hanya satu yang berhasil transisi.

- **Counter separation critical**:
  - `attempt_count` di-update oleh callback `onAttempt` dari adapter (nilai akhir = `attempts` Cockatiel). Service hanya reset ke 0 di awal cycle. Bila audit NoopAuditService (placeholder), `attempt_count` row payment tidak ter-update akurat — itu OK untuk dev (TASK-08 akan fix dengan impl konkre).
  - `total_retry_count` di-increment **hanya** oleh `PaymentsService.applyOutcome()` saat transisi `processing -> scheduled_for_retry`. Cockatiel tidak pernah menyentuh counter ini. Scheduler (TASK-10) memanggil `executePayment(source='scheduler')` — service yang increment. Manual retry (TASK-09 controller) memanggil `manualRetry()` — service yang increment (jika cycle gagal lagi).

- **Idempotency test scenario 4** (`succeed-but-drop-response`): tidak diuji di task ini — ada di TASK-14 E2E. Helper `assertInvariant(actualCharges, httpCalls)` disediakan untuk assertion di task itu. Service tidak bisa mengetahui `actualCharges` sendiri (itu gateway-side truth via `replayed: true`); invariant di-enforce oleh gateway mock in-memory store.

- **Trace ID per execution cycle**: `crypto.randomUUID()` di-generate di awal `executePayment()`. Same trace ID untuk semua attempt dalam satu cycle (Cockatiel retries). Berbeda trace ID untuk cycle berbeda (scheduler / manual retry). Full OpenTelemetry SDK (span export ke Jaeger) di TASK-11 — di task ini trace ID hanya disimpan di `payment_attempts.trace_id` (via audit callback) dan di log line.

- **Permanent failure classification**: dilakukan di service (`isPermanentFailure`) berdasarkan `errorCode` + `httpStatus`. Bila TASK-04 classifier sudah ada, sebaiknya service memanggil `classifyError(result)` untuk konsistensi. Untuk sekarang, classification inline dengan tabel:
  - `errorCode` in `['invalid_card', 'insufficient_funds', 'expired_card']` -> permanent.
  - `httpStatus` in `[400, 401, 403, 404, 410, 422]` (4xx non-429, non-408) -> permanent.
  - Lainnya -> retryable.

- **`MAX_TOTAL_RETRIES` dari config**: dibaca via `ConfigService.get<number>('MAX_TOTAL_RETRIES', 5)`. Default 5 sesuai plan section 7.1. Schema validation di TASK-01 (`validation.schema.ts`) — Joi atau zod. Tidak di-hardcode di service.

- **`NoopAuditService` default binding**: module bisa boot tanpa TASK-08. Saat TASK-08 selesai, override dengan `{ provide: AUDIT_PORT, useClass: PrismaAuditService }` di `PaymentsModule` atau di module terpisah yang di-import. Setelah override, `NoopAuditService` tetap diekspor sebagai utility untuk test.

- **`attempt_count` tidak di-increment oleh service**: Cockatiel callback `onAttempt` dijalankan per attempt. Service **bisa** menulis `attempt_count` row payment di callback juga (mis. `payments.atomicUpdateStatus(id, processing, { attemptCount: ctx.attemptNumber })`). Tapi untuk simplicity di task ini, `attempt_count` di row payment diisi akhir dari `ChargeResult.attempts` di `applyOutcome()` — atau bahkan dibiarkan 0 bila tidak ada audit. Decision: `attempt_count` di-update oleh audit impl (TASK-08) via trigger pada `payment_attempts` insert, atau oleh service di callback. Pilih yang lebih sederhana saat TASK-08: update via service di callback `onAttempt`:
  ```ts
  // di attachAuditCallback, sebelum audit.recordAttempt:
  await this.payments.atomicUpdateStatus(ctx.paymentId, PaymentStatus.PROCESSING, {
    attemptCount: ctx.attemptNumber,
  }).catch(() => undefined); // best-effort
  ```
  Tapi ini menambah query per-attempt. Alternative: defer ke akhir cycle — set `attemptCount = result.attempts` di `applyOutcome()`. **Decision untuk TASK-07**: defer — set di `applyOutcome` saja, audit row di `payment_attempts.attempt_number` punya info per-attempt yang lebih akurat.

- **Setelah task ini selesai**: TASK-08 (audit trail impl) dan TASK-09 (controllers) dapat dimulai secara paralel. Keduanya hanya mengkonsumsi `PaymentsService` + `AuditPort` — tidak ada perubahan API breaking yang diharapkan di TASK-07 saat TASK-08/09/10/11 berjalan. TASK-10 scheduler akan memanggil `executePayment(paymentId, { source: 'scheduler' })` setelah poll `PaymentRepository.findDueRetries()`. TASK-11 akan wrap `PaymentsService` dengan OTel span + pino log context via `AsyncLocalStorage`.
