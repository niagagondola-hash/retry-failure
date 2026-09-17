# TASK-10 - Durable Retry Scheduler (@nestjs/schedule)

> **Task ID**: 7
> **Depends on**: 6-b (TASK-09 API Routes - `ScheduleModule.forRoot()` sudah di-import di `app.module.ts`, `PaymentsService` + `PaymentRepository` sudah tersedia via `PaymentsModule`)
> **Estimated effort**: M (~2-3 jam)
> **Plan reference**: Section 7 (Durable Retry) + Section 12 (Scheduler) + Section 15 (Configuration)

---

## Goal

Mengimplementasikan **durable retry scheduler** sebagai NestJS provider di dalam `payment-api` (bukan proses terpisah) menggunakan `@nestjs/schedule` (`SchedulerRegistry` + decorator `@Interval`/`setInterval`). Scheduler melakukan **polling DB** untuk payment ber-status `scheduled_for_retry` yang `next_retry_at <= now`, lalu memicu `executePayment(paymentId, { source: 'scheduler' })` **via direct service injection** ke `PaymentsService` - bukan via HTTP - karena scheduler dan `PaymentsService` berada di NestJS process yang sama, sehingga circuit breaker Cockatiel singleton (TASK-05) tetap konsisten lintas call path.

Loop:

```text
scheduled_for_retry  ──►  (next_retry_at <= NOW())  ──►  RetrySchedulerService.poll()
                                                                       │
                                                                       ▼
                                              paymentsService.executePayment(id, { source: 'scheduler' })
                                                                       │
                                                                       ▼
                                              new Cockatiel execution cycle (attempt_count reset to 0)
                                                                       │
                                                                       ▼
                                              processing -> succeeded | failed | scheduled_for_retry
```

Setelah task ini selesai, **durable retry loop end-to-end** berfungsi tanpa intervensi manual - payment yang gagal transient akan dipulihkan oleh scheduler, dan `MAX_TOTAL_RETRIES` mengakhiri payment menjadi `failed` setelah cycle terlampaui (plan scenario 6 + 7).

## Scope

**In scope**:

- `apps/payment-api/src/modules/retry-scheduler/retry-scheduler.service.ts` - `@Injectable()` `RetrySchedulerService` dengan method `poll()` yang dipanggil via `@nestjs/schedule` interval config-driven.
- `apps/payment-api/src/modules/retry-scheduler/retry-scheduler.module.ts` - NestJS module yang men-declare + men-export `RetrySchedulerService`.
- `apps/payment-api/src/modules/retry-scheduler/index.ts` - barrel re-export.
- (Opsional) `apps/payment-api/src/modules/retry-scheduler/retry-scheduler.controller.ts` - `GET /scheduler-health` endpoint untuk operasional stats.
- Wire `RetrySchedulerModule` ke `app.module.ts` (modify file dari TASK-09).
- Stats operasional (`lastPollAt`, `processedCount`, `errorCount`, `lastError`) yang diekspos via `RetrySchedulerService.getStats()`.
- Jest unit test di `apps/payment-api/test/modules/retry-scheduler/retry-scheduler.service.spec.ts` (mock `PaymentsService` + `PaymentRepository` + `SchedulerRegistry`).

**Out of scope** (plan section 19 + 20.2):

- **Distributed lock scheduler** (`SELECT ... FOR UPDATE SKIP LOCKED`, Redlock, dst.) - scheduler versi ini single-instance only.
- **Kafka / RabbitMQ / Redis queue** - bukan mekanisme durable retry di task ini.
- **Distributed circuit breaker state** - breaker Cockatiel in-memory per instance (plan section 20.1).
- **Multi-instance horizontal scaling** - production evolution, document di TASK-15.
- **Config reload hot** - bila `SCHEDULER_INTERVAL_MS` berubah, service butuh restart (`ConfigService` tidak re-read env). Document di TASK-15.
- **Total deadline / retry budget kompleks** (plan section 19) - `MAX_TOTAL_RETRIES` di task ini adalah counter sederhana, tidak ada budget duration.
- **Backoff strategy switch runtime** - strategy di-fix di code (`constant`); env `SCHEDULER_BACKOFF_STRATEGY=exponential` adalah future evolution, di-document saja.
- **Outbox pattern / transactional outbox** - scheduler baca langsung dari tabel `payments`, tidak ada event table perantara.

## Configuration

Dari plan section 12 + 15:

| Env var | Default | Type | Deskripsi | Di-read oleh |
|---|---|---|---|---|
| `SCHEDULER_INTERVAL_MS` | `5000` | int (ms) | Berapa sering scheduler poll DB. Default 5 detik. | `RetrySchedulerService` |
| `MAX_TOTAL_RETRIES` | `5` | int | Limit atas `total_retry_count`. Setelah terlampaui -> `failed`. **Guard logic 100% di `PaymentsService` (TASK-07), bukan scheduler.** | `PaymentsService` (TASK-07 - primary); `RetrySchedulerService` (hanya untuk log "approaching limit") |
| `SCHEDULER_BATCH_SIZE` | `50` | int | Maksimum payment yang di-pick per poll cycle. Default sama dengan `LIMIT 50` di poller query. | `RetrySchedulerService` |
| `SCHEDULER_BASE_DELAY_MS` | `10000` | int (ms) | Base delay untuk `next_retry_at` saat transisi `processing -> scheduled_for_retry`. Default 2× `SCHEDULER_INTERVAL_MS` (= 10s) untuk demo. | `PaymentsService` (TASK-07) |

Semua dibaca via `ConfigService.get<number>('SCHEDULER_INTERVAL_MS', 5000)` di constructor `RetrySchedulerService`. `MAX_TOTAL_RETRIES` + `SCHEDULER_BASE_DELAY_MS` sudah di-wire di `PaymentsService` (TASK-07) - tidak ada duplikasi logic.

> **Catatan `MAX_TOTAL_RETRIES` di scheduler**: di-inject ke `RetrySchedulerService` constructor HANYA untuk logging purpose (agar scheduler bisa log "approaching limit" bila `total_retry_count >= MAX - 1`). **Tidak ada if-check di scheduler** - guard tetap di `PaymentsService.applyOutcome()`.

## Poller query (plan section 12)

Query SQL equivalent (di TASK-02 `PaymentRepository.findDueRetries`):

```sql
SELECT *
FROM payments
WHERE status = 'scheduled_for_retry'
  AND next_retry_at <= NOW()
ORDER BY next_retry_at ASC
LIMIT 50;
```

TypeORM implementation sudah ada di TASK-02:

```ts
async findDueRetries(now: Date, limit = 50): Promise<Payment[]> {
  return this.repo.createQueryBuilder('p')
    .where('p.status = :status', { status: PaymentStatus.SCHEDULED_FOR_RETRY })
    .andWhere('p.next_retry_at <= :now', { now })
    .orderBy('p.next_retry_at', 'ASC')
    .limit(limit)
    .getMany();
}
```

Scheduler memanggil:

```ts
const due = await this.payments.findDueRetries(new Date(), this.batchSize);
```

Index `idx_payments_status` + `idx_payments_next_retry_at` (TASK-02) menjadikan query ini index-only scan dengan filter composite - performant hingga jutaan rows di state `scheduled_for_retry`.

## Concurrency semantics (plan section 12 + 20.2)

> **Scheduler versi ini ditujukan untuk single-instance `payment-api`.**

1. **No distributed lock** - bila ada 2+ instance `payment-api` berjalan (mis. Kubernetes multi-replica), kemungkinan dua instance mem-pick payment yang sama di poll cycle yang sama. `PaymentsService.atomicUpdateStatus(paymentId, previousStatus, patch)` (TASK-07) menggunakan `WHERE status = expectedFrom` clause yang atomic di PostgreSQL row-level, sehingga hanya satu instance yang berhasil transit `scheduled_for_retry -> processing`. Instance kedua mendapat `switched = false` -> melempar `BadRequestException('Payment X status changed concurrently')`. Scheduler menangkap error ini di try/catch per-payment dan melanjutkan ke payment berikutnya - tidak crash.

2. **Future production evolution** (document di TASK-15):
   - **PostgreSQL `FOR UPDATE SKIP LOCKED`** - query builder `.setLock('pessimistic_write', undefined, { skipLocked: true })` agar setiap instance mem-pick row yang belum di-lock instance lain. Native PostgreSQL feature.
   - **External queue** (Kafka / RabbitMQ / Redis Streams) - produksi event `payment.scheduled_for_retry` ke topic, consumer group meng-handle deduplikasi.
   - **Distributed scheduler** (BullMQ, Agenda, Temporal) - out-of-process worker dengan built-in locking + retry semantics.

3. **Cockatiel breaker singleton** - karena scheduler dan `PaymentsService` berada di process yang sama, `breakerStore` (TASK-05) shared. Saat scheduler memicu `executePayment`, Cockatiel retry/breaker policy tetap konsisten dengan call dari `POST /payments` API. Bila scheduler adalah proses terpisah (opsi alternatif yang DITOLAK di plan rev 2), breaker akan punya state terpisah dan tidak koheren.

## Files to create

Semua path absolut di monorepo:

- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/retry-scheduler/retry-scheduler.service.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/retry-scheduler/retry-scheduler.module.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/retry-scheduler/index.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/retry-scheduler/retry-scheduler.controller.ts` (opsional - endpoint `/scheduler-health`)

File yang di-modify:

- `/home/z/my-project/retry-failure/apps/payment-api/src/app.module.ts` - import `RetrySchedulerModule` (sebelumnya `ScheduleModule.forRoot()` sudah ada dari TASK-09; sekarang tambah `RetrySchedulerModule` setelahnya).

Test file:

- `/home/z/my-project/retry-failure/apps/payment-api/test/modules/retry-scheduler/retry-scheduler.service.spec.ts`

## Implementation steps

### 1. `retry-scheduler/retry-scheduler.service.ts`

```ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PaymentsService } from '../payments/payments.service';
import { PaymentRepository } from '../../database/repositories/payment.repository';
import { Payment } from '../../database/entities/payment.entity';

/**
 * Default interval bila env SCHEDULER_INTERVAL_MS tidak diset.
 * Harus berupa literal angka karena dipakai sebagai argumen decorator @Interval
 * (TypeScript decorator di-evaluate saat class declaration, sebelum instance
 * constructor berjalan - tidak bisa baca instance field).
 */
const DEFAULT_INTERVAL_MS = 5000;
const INTERVAL_NAME = 'retry-scheduler-poll';

/**
 * Durable retry scheduler (plan section 12).
 *
 * Single-instance only - bukan distributed scheduler.
 *
 * Menggunakan @nestjs/schedule SchedulerRegistry agar interval config-driven
 * (decorator @Interval sendiri tidak menerima value dari ConfigService).
 */
@Injectable()
export class RetrySchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RetrySchedulerService.name);
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly maxTotalRetries: number;

  // Stats operasional - di-expose via getStats() untuk /scheduler-health atau fold ke /health.
  private lastPollAt: Date | null = null;
  private processedCount = 0;
  private errorCount = 0;
  private lastError: string | null = null;
  private running = false;

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly payments: PaymentRepository,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    this.intervalMs = this.config.get<number>('SCHEDULER_INTERVAL_MS', DEFAULT_INTERVAL_MS);
    this.batchSize = this.config.get<number>('SCHEDULER_BATCH_SIZE', 50);
    // Hanya untuk logging "approaching limit" - guard logic ada di PaymentsService (TASK-07).
    this.maxTotalRetries = this.config.get<number>('MAX_TOTAL_RETRIES', 5);
  }

  /**
   * Pada application bootstrap: register interval config-driven via SchedulerRegistry.
   *
   * Pendekatan: setInterval + schedulerRegistry.addInterval.
   * TIDAK memakai decorator @Interval(N) karena argumen N harus literal angka
   * dan tidak bisa baca dari ConfigService. Document pilihan di task file.
   *
   * Mengapa onApplicationBootstrap (bukan onModuleInit):
   *   - Semua module (PaymentsModule, DatabaseModule, dst.) sudah ter-init ->
   *     dependencies siap dipanggil.
   *   - ScheduleModule.forRoot() dari @nestjs/schedule juga sudah register
   *     SchedulerRegistry ke container.
   */
  async onApplicationBootstrap(): Promise<void> {
    // Safety: bila interval dengan nama yang sama sudah terdaftar (mis. HMR reload),
    // hapus dulu untuk hindari double-trigger.
    try {
      this.schedulerRegistry.deleteInterval(INTERVAL_NAME);
    } catch {
      // Interval tidak ada - normal first run, ignore.
    }

    const intervalRef = setInterval(() => {
      void this.poll().catch((err: unknown) => {
        // Safety net - poll() sendiri sudah try/catch per-payment,
        // tapi bila ada error di luar try (mis. bug regressi), jangan biarkan
        // unhandled promise rejection crash process.
        this.logger.error({ err }, '[scheduler] poll crashed (uncaught)');
        this.errorCount += 1;
        this.lastError = err instanceof Error ? err.message : String(err);
      });
    }, this.intervalMs);
    this.schedulerRegistry.addInterval(INTERVAL_NAME, intervalRef);

    this.logger.log(
      `Scheduler started: intervalMs=${this.intervalMs}, batchSize=${this.batchSize}, maxTotalRetries=${this.maxTotalRetries}`,
    );
  }

  /**
   * Poll DB untuk payment yang due untuk retry, lalu trigger executePayment per payment.
   *
   * Kontrak:
   *   - Tidak throw - semua error di try/catch + log.
   *   - Tidak crash bila satu payment error - lanjut ke payment berikutnya.
   *   - Idempotent - bila poll ter-trigger 2x cepat (race), atomicUpdateStatus di
   *     PaymentsService menangani concurrency (poll kedua dapat status changed error
   *     -> di-catch + log + continue).
   */
  async poll(): Promise<void> {
    // Re-entrancy guard: bila poll sebelumnya masih jalan (interval lebih cepat dari
    // eksekusi), skip cycle ini. Tidak queue - cycle berikutnya akan tetap pick
    // payment yang belum diproses.
    if (this.running) {
      this.logger.debug('Poll already running - skip cycle');
      return;
    }
    this.running = true;
    this.lastPollAt = new Date();

    try {
      const due = await this.payments.findDueRetries(new Date(), this.batchSize);

      if (due.length === 0) {
        this.logger.debug('No due payments - idle');
        return;
      }

      this.logger.log(`[scheduler] picked ${due.length} payment(s) due for retry`);

      for (const payment of due) {
        await this.processOne(payment);
      }
    } catch (err) {
      // Error di level findDueRetries (mis. DB down) - log, increment errorCount,
      // tetap tidak throw agar setInterval loop tidak crash.
      this.errorCount += 1;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.logger.error({ err }, '[scheduler] poll failed at query stage');
    } finally {
      this.running = false;
    }
  }

  private async processOne(payment: Payment): Promise<void> {
    const paymentId = payment.id;
    const totalRetryCount = payment.totalRetryCount;

    try {
      this.logger.log(
        { paymentId, totalRetryCount, nextRetryAt: payment.nextRetryAt },
        '[scheduler] picked paymentId',
      );

      // Direct service injection - NOT HTTP. Same NestJS process, breaker singleton konsisten.
      const updated = await this.paymentsService.executePayment(paymentId, {
        source: 'scheduler',
      });

      this.processedCount += 1;

      // Approaching-limit log (operational hint - tidak ada guard di scheduler).
      if (updated.totalRetryCount >= this.maxTotalRetries - 1 && updated.status === 'scheduled_for_retry') {
        this.logger.warn(
          { paymentId, totalRetryCount: updated.totalRetryCount, max: this.maxTotalRetries },
          '[scheduler] payment approaching MAX_TOTAL_RETRIES - next failure will mark as failed',
        );
      }

      this.logger.log(
        { paymentId, newStatus: updated.status, totalRetryCount: updated.totalRetryCount },
        `[scheduler] processed, result: status=${updated.status}`,
      );
    } catch (err) {
      this.errorCount += 1;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { paymentId, err: this.lastError },
        '[scheduler] error processing payment - continue to next',
      );
      // JANGAN re-throw - lanjut ke payment berikutnya di for-loop.
    }
  }

  /**
   * Snapshot stats untuk endpoint /scheduler-health atau fold ke /health.
   */
  getStats(): {
    status: 'running' | 'idle';
    lastPollAt: Date | null;
    processedCount: number;
    errorCount: number;
    lastError: string | null;
    intervalMs: number;
    batchSize: number;
    maxTotalRetries: number;
  } {
    return {
      status: this.running ? 'running' : 'idle',
      lastPollAt: this.lastPollAt,
      processedCount: this.processedCount,
      errorCount: this.errorCount,
      lastError: this.lastError,
      intervalMs: this.intervalMs,
      batchSize: this.batchSize,
      maxTotalRetries: this.maxTotalRetries,
    };
  }
}
```

### 2. Catatan pendekatan interval - pilihan `SchedulerRegistry.addInterval`

`@nestjs/schedule` decorator `@Interval(ms)` **mensyaratkan argumen literal angka** - tidak bisa baca `this.config.get('SCHEDULER_INTERVAL_MS')` karena TypeScript decorator di-evaluate saat class declaration, sebelum instance constructor berjalan.

Tiga opsi yang dipertimbangkan:

| Opsi | Kelebihan | Kekurangan | Decision |
|---|---|---|---|
| (a) `@Interval(5000)` literal, tidak dynamic | Sederhana, idiomatic NestJS | Tidak bisa override via env tanpa code change - violates plan section 15 | ❌ Tidak sesuai plan |
| (b) `@Interval('retry-scheduler-poll', 5000)` placeholder + `deleteInterval`/`addInterval` di `onApplicationBootstrap` | Idiomatic + dynamic | Placeholder 5000 harus konsisten dengan default; double-trigger risk bila `deleteInterval` gagal | ⚠️ Backup |
| (c) Skip decorator; `setInterval` + `SchedulerRegistry.addInterval` di `onApplicationBootstrap` | Paling eksplisit, no placeholder, no double-trigger risk | Tidak idiomatic - `@nestjs/schedule` decorator engine tidak tahu tentang interval ini (tapi tetap ter-track via `SchedulerRegistry.getIntervals()`) | ✅ **Dipilih** |

Implementasi di atas memakai opsi (c): langsung `setInterval` di `onApplicationBootstrap` + `SchedulerRegistry.addInterval(INTERVAL_NAME, intervalRef)`. Lebih clean, tidak ada placeholder decorator, tidak ada double-trigger risk. `SchedulerRegistry` tetap dipakai agar:

- Interval ter-track dan bisa di-inspect via `schedulerRegistry.getIntervals()`.
- Bisa di-clean-up saat module destroy bila diperlukan (tidak di-implement di task ini - process exit akan clear otomatis).
- Konsisten dengan API @nestjs/schedule (`SchedulerRegistry` adalah public API, bukan internal).

> **Alternatif (b)**: bila ingin tetap pakai decorator (lebih idiomatic NestJS), uncomment baris `@Interval(INTERVAL_NAME, DEFAULT_INTERVAL_MS)` decorator di atas method `poll()` DAN uncomment blok `try { deleteInterval(INTERVAL_NAME) } catch {}` di `onApplicationBootstrap`. Pastikan `ScheduleModule.forRoot()` sudah di-import (sudah, dari TASK-09). Decorator akan register interval default 5000ms saat bootstrap, lalu `onApplicationBootstrap` akan hapus + register ulang dengan config-driven ms.

> **Alternatif (a)**: bila `SCHEDULER_INTERVAL_MS` selalu = 5000 di deployment (acceptable untuk demo fixed), bisa pakai `@Interval(5000)` literal langsung tanpa `SchedulerRegistry` dance. Tapi tidak recommended - env override adalah contract di plan section 15.

### 3. `retry-scheduler/retry-scheduler.module.ts`

```ts
import { Module } from '@nestjs/common';
import { RetrySchedulerService } from './retry-scheduler.service';
import { RetrySchedulerController } from './retry-scheduler.controller';

/**
 * Module yang men-declare RetrySchedulerService.
 *
 * ScheduleModule.forRoot() sudah di-import di app.module.ts (TASK-09) -
 * tidak perlu re-import di sini (singleton SchedulerRegistry sudah tersedia).
 *
 * PaymentsModule harus tersedia di container - bila TIDAK @Global(),
 * tambah `imports: [PaymentsModule]` di bawah ini.
 */
@Module({
  imports: [],
  controllers: [RetrySchedulerController],
  providers: [RetrySchedulerService],
  exports: [RetrySchedulerService],
})
export class RetrySchedulerModule {}
```

> **Catatan DI**: bila `PaymentsModule` TIDAK global, `RetrySchedulerModule` perlu `imports: [PaymentsModule]`. Bila `PaymentsModule` di-set `@Global()` (recommended - see TASK-07/09 notes), tidak perlu import eksplisit. Implementation code di atas mengasumsikan `PaymentsModule` global - bila tidak, tambah `imports: [PaymentsModule]`.

### 4. `retry-scheduler/retry-scheduler.controller.ts` - endpoint opsional `/scheduler-health`

```ts
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RetrySchedulerService } from './retry-scheduler.service';

/**
 * GET /scheduler-health - operasional stats scheduler.
 *
 * Dipisah dari /health (TASK-09) untuk separation of concerns:
 *   - /health       -> dependency health (DB + gateway) untuk readiness probe.
 *   - /scheduler-health -> scheduler runtime stats untuk ops dashboard.
 */
@ApiTags('scheduler')
@Controller('scheduler-health')
export class RetrySchedulerController {
  constructor(private readonly scheduler: RetrySchedulerService) {}

  @Get()
  @ApiOperation({ summary: 'Scheduler operational stats (lastPollAt, processedCount, errorCount, ...)' })
  stats() {
    return this.scheduler.getStats();
  }
}
```

Response shape (200 OK):

```json
{
  "status": "idle",
  "lastPollAt": "2025-01-15T08:30:00.123Z",
  "processedCount": 12,
  "errorCount": 0,
  "lastError": null,
  "intervalMs": 5000,
  "batchSize": 50,
  "maxTotalRetries": 5
}
```

> **Alternatif fold ke `/health`**: bila ingin satu endpoint, modify `HealthService.check()` di TASK-09 untuk inject `RetrySchedulerService` + tambah field `scheduler` di response. Trade-off: `HealthModule` jadi tergantung `RetrySchedulerModule` (cyclic risk bila `RetrySchedulerModule` import `HealthModule` - tidak di task ini, jadi OK). **Decision**: opsi endpoint terpisah (`/scheduler-health`) - separation of concerns lebih clean.

### 5. `retry-scheduler/index.ts` - barrel

```ts
export * from './retry-scheduler.service';
export * from './retry-scheduler.controller';
export * from './retry-scheduler.module';
```

### 6. Modify `app.module.ts` (TASK-09 file)

Tambah `RetrySchedulerModule` ke imports:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AuditModule } from './modules/audit/audit.module';
import { HealthModule } from './modules/health/health.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { RetrySchedulerModule } from './modules/retry-scheduler/retry-scheduler.module';  // ← tambah

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    DatabaseModule,
    GatewayModule,
    PaymentsModule,
    AuditModule,
    HealthModule,
    MetricsModule,
    // ScheduleModule HARUS sebelum RetrySchedulerModule - SchedulerRegistry
    // harus tersedia saat RetrySchedulerService.onApplicationBootstrap() berjalan.
    ScheduleModule.forRoot(),
    RetrySchedulerModule,  // ← tambah
  ],
})
export class AppModule {}
```

> Urutan import: `ScheduleModule.forRoot()` **HARUS** sebelum `RetrySchedulerModule` agar `SchedulerRegistry` provider tersedia saat `RetrySchedulerService.onApplicationBootstrap()` berjalan. NestJS memproses module imports secara berurutan; urutan di atas sudah benar.

### 7. Jest unit tests - `test/modules/retry-scheduler/retry-scheduler.service.spec.ts`

```ts
describe('RetrySchedulerService', () => {
  // Setup: mock PaymentsService, PaymentRepository, ConfigService, SchedulerRegistry
  //   - paymentsService.executePayment -> resolves to fake Payment object
  //   - payments.findDueRetries -> returns array (configurable per-test)
  //   - config.get -> returns 5000 (interval), 50 (batchSize), 5 (maxTotalRetries)
  //   - schedulerRegistry.addInterval / deleteInterval -> jest.fn()

  // Test cases:
  // 1. onApplicationBootstrap:
  //    a. schedulerRegistry.deleteInterval('retry-scheduler-poll') dipanggil (or di-ignore bila throw).
  //    b. schedulerRegistry.addInterval('retry-scheduler-poll', <setInterval ref>) dipanggil.
  //    c. Logger.log terpanggil dengan "Scheduler started: intervalMs=5000, batchSize=50, maxTotalRetries=5".
  // 2. poll() happy path:
  //    a. findDueRetries return 2 due payments.
  //    b. paymentsService.executePayment dipanggil 2x dengan source='scheduler'.
  //    c. processedCount increment 2.
  //    d. lastPollAt di-set.
  //    e. Tidak throw.
  // 3. poll() no due payments:
  //    a. findDueRetries return [].
  //    b. executePayment tidak dipanggil.
  //    c. Logger.debug "No due payments - idle".
  // 4. poll() satu payment error:
  //    a. Payment pertama: executePayment throw BadRequestException (concurrent change).
  //    b. errorCount increment 1, lastError set.
  //    c. Payment kedua tetap diproses (executePayment dipanggil 2x).
  //    d. Tidak re-throw.
  // 5. poll() findDueRetries throw (DB down):
  //    a. errorCount increment, lastError set ke DB error message.
  //    b. Logger.error "poll failed at query stage" terpanggil.
  //    c. Tidak throw ke setInterval callback.
  //    d. running di-reset ke false di finally.
  // 6. poll() re-entrancy:
  //    a. Mock running=true (simulate poll sebelumnya belum selesai).
  //    b. poll() return early - "Poll already running - skip cycle".
  //    c. findDueRetries tidak dipanggil.
  // 7. getStats():
  //    a. Return snapshot { status, lastPollAt, processedCount, errorCount, lastError, intervalMs, batchSize, maxTotalRetries }.
  //    b. status='running' bila this.running=true, 'idle' sebaliknya.
  // 8. interval config-driven:
  //    a. config.get('SCHEDULER_INTERVAL_MS') return 10000 (10s).
  //    b. setInterval di onApplicationBootstrap dipanggil dengan 10000ms (bukan default 5000).
  // 9. approaching-limit log:
  //    a. Mock payment dengan totalRetryCount=4 (max=5) dan executePayment return
  //       status='scheduled_for_retry', totalRetryCount=4.
  //    b. Logger.warn "payment approaching MAX_TOTAL_RETRIES" terpanggil.
});
```

### 8. Durable retry counter (plan section 7.1) - kontrak antar task

Dua counter TIDAK boleh dicampur:

| Counter | Lingkup | Di-reset kapan | Di-increment kapan | Owner |
|---|---|---|---|---|
| `attempt_count` | Satu execution cycle (Cockatiel) | Start tiap `executePayment()` call | Setiap Cockatiel attempt via `onAttempt` callback | `PaymentsService` (TASK-07) + `AuditService` (TASK-08) |
| `total_retry_count` | Lintas scheduler cycles | **Tidak pernah** (kecuali `manualRetry` juga tidak reset) | Saat transisi `processing -> scheduled_for_retry` | `PaymentsService.applyOutcome()` (TASK-07) |

Scheduler **tidak** meng-increment counter apapun. Scheduler hanya:

1. **Poll** DB untuk due payments (`status='scheduled_for_retry'` AND `next_retry_at <= now`).
2. **Trigger** `executePayment(paymentId, { source: 'scheduler' })` - ini memulai cycle baru, yang di dalamnya:
   - `assertCanTransition('scheduled_for_retry', 'processing')` ✓
   - `atomicUpdateStatus(... { status: PROCESSING, attemptCount: 0 })` - reset attempt counter.
   - Run Cockatiel policy -> attempts 1..3.
   - Bila gagal -> `applyOutcome` mengecek `totalRetryCount + 1 > MAX_TOTAL_RETRIES`:
     - Bila ya -> transisi `processing -> failed` + `failureReason='max_total_retries_exceeded'`.
     - Bila tidak -> transisi `processing -> scheduled_for_retry` + `totalRetryCount += 1` + `nextRetryAt = now + delay`.

> **Scheduler TIDAK mengecek MAX_TOTAL_RETRIES** - guard logic 100% di `PaymentsService`. Scheduler hanya trigger. Bila payment sudah `failed` (karena MAX exceeded), poller query `WHERE status='scheduled_for_retry'` tidak akan men-pick-nya lagi - tidak perlu special handling di scheduler.

### 9. Backoff strategy untuk `next_retry_at`

**Decision: constant interval** (bukan exponential) untuk demo simplicity.

```ts
// Di PaymentsService.applyOutcome() (TASK-07):
const delayMs = result.retryAfterMs ?? this.schedulerBaseDelayMs;
// schedulerBaseDelayMs = config.get('SCHEDULER_BASE_DELAY_MS', 10_000)  // 2× SCHEDULER_INTERVAL_MS default
const nextRetryAt = new Date(Date.now() + delayMs);
```

| Strategy | Formula | Default value | Use case |
|---|---|---|---|
| `constant` (DIPILIH) | `now + SCHEDULER_BASE_DELAY_MS` | 10_000 ms (10s) | Demo - predictable timing, observable dalam 1 menit |
| `exponential` (future evolution) | `now + SCHEDULER_BASE_DELAY_MS * 2^totalRetryCount` | cap at `SCHEDULER_MAX_DELAY_MS` (60_000 ms) | Production - menghormati backpressure |

**Alasan pilih constant**:

- Dengan `SCHEDULER_INTERVAL_MS=5000` + `SCHEDULER_BASE_DELAY_MS=10000`, scheduler mem-pick payment setiap ~10-15s (delay 10s + poll interval ≤5s). Dalam 1 menit, ada ~5-6 retry cycles. Dengan `MAX_TOTAL_RETRIES=5`, payment akan menjadi `failed` dalam ~60-75s - observable untuk demo interactive (plan scenario 7 verifiable tanpa `sleep 600`).
- Exponential (`10s, 20s, 40s, 80s, 160s`) -> total 5 cycles = 510s = 8.5 menit - terlalu lama untuk demo interactive.
- Production dengan real traffic harus exponential + cap - document di TASK-15 production caveats.

**Server-directed override**: bila gateway mengirim `Retry-After` header (HTTP 429/503), `result.retryAfterMs` akan di-set oleh classifier (TASK-04) dan **meng-override constant value**. Ini sesuai plan section 9 + scenario 5 (rate-limited). Override ini di-handle di `PaymentsService.applyOutcome()` (TASK-07), bukan di scheduler.

**Future evolution** (document di TASK-15): tambah env `SCHEDULER_BACKOFF_STRATEGY=constant|exponential` + `SCHEDULER_MAX_DELAY_MS=60000`. Logic switch di `PaymentsService.applyOutcome()`:

```ts
// Future evolution (TIDAK di task ini - document saja):
const strategy = this.config.get('SCHEDULER_BACKOFF_STRATEGY', 'constant');
let delayMs: number;
if (strategy === 'exponential') {
  const cap = this.config.get<number>('SCHEDULER_MAX_DELAY_MS', 60_000);
  const base = this.schedulerBaseDelayMs;
  delayMs = Math.min(cap, base * Math.pow(2, current.totalRetryCount));
} else {
  delayMs = this.schedulerBaseDelayMs;
}
delayMs = result.retryAfterMs ?? delayMs;
const nextRetryAt = new Date(Date.now() + delayMs);
```

## Acceptance criteria

- [ ] `RetrySchedulerModule` ter-import di `app.module.ts` **SETELAH** `ScheduleModule.forRoot()`. Container NestJS boot tanpa error.
- [ ] Saat `payment-api` start, log berikut muncul: `Scheduler started: intervalMs=5000, batchSize=50, maxTotalRetries=5`.
- [ ] Scheduler terdaftar di `SchedulerRegistry.getIntervals()` - `'retry-scheduler-poll'` ada di list.
- [ ] `poll()` terpanggil setiap `SCHEDULER_INTERVAL_MS` (default 5000ms). Verifiable via `processedCount` increment di `getStats()` atau log `[scheduler] picked N payment(s)`.
- [ ] `poll()` dengan tidak ada due payment -> log debug `No due payments - idle`, tidak throw.
- [ ] `poll()` dengan 1+ due payment -> `paymentsService.executePayment(id, {source:'scheduler'})` terpanggil per payment. Log: `[scheduler] picked paymentId` + `[scheduler] processed, result: status=...`.
- [ ] Bila satu payment error (mis. status berubah concurrent oleh manual retry) -> di-log warn + lanjut ke payment berikutnya. Scheduler tidak crash.
- [ ] Bila `findDueRetries` throw (DB down) -> di-log error, `errorCount` increment, `lastError` set. Cycle berikutnya tetap berjalan (running di-reset di `finally`).
- [ ] Payment ber-status `scheduled_for_retry` dengan `next_retry_at <= now` -> di-pick dalam ≤ `SCHEDULER_INTERVAL_MS` + toleransi eksekusi.
- [ ] Payment ber-status `scheduled_for_retry` dengan `next_retry_at > now` -> TIDAK di-pick (filter query).
- [ ] Payment ber-status `failed` (setelah MAX_TOTAL_RETRIES exceeded) -> TIDAK di-pick (filter query - status != 'scheduled_for_retry').
- [ ] Payment ber-status `processing` / `succeeded` -> TIDAK di-pick (filter query).
- [ ] Total retry counter (`payments.total_retry_count`) increment tiap kali scheduler trigger `executePayment` yang berakhir `scheduled_for_retry` lagi. Verifiable via psql.
- [ ] Bila `total_retry_count + 1 > MAX_TOTAL_RETRIES` (default 5) -> `PaymentsService` set `status=failed` + `failureReason='max_total_retries_exceeded'`. Scheduler berhenti mem-pick payment tersebut di cycle berikutnya.
- [ ] Endpoint `GET /scheduler-health` mengembalikan `{ status, lastPollAt, processedCount, errorCount, lastError, intervalMs, batchSize, maxTotalRetries }`.
- [ ] Bila `SCHEDULER_INTERVAL_MS=10000` di env -> setInterval terpakai dengan 10000ms (config-driven terbukti).
- [ ] `pnpm --filter payment-api typecheck` -> **lulus tanpa error**.
- [ ] `pnpm --filter payment-api lint` -> **lulus tanpa error**.
- [ ] Jest unit test `retry-scheduler.service.spec.ts` lulus semua test cases (happy path, no-due, single-payment-error, db-error, re-entrancy, stats, config-driven interval, approaching-limit log).

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

```bash
# 1. Start dependency services (gateway mock + PostgreSQL - port kondisional)
#    Pastikan PostgreSQL jalan + migration sudah di-run.
# KONDISI LOCAL (Docker tersedia - gateway-mock di port 3001):
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml up -d postgres
sleep 3
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml ps postgres
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock && PORT=3001 pnpm start:dev &

# KONDISI SANDBOX (Docker tidak tersedia - gateway-mock di port 3002):
# - Opsi A: connect ke external PostgreSQL instance (set DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME di apps/payment-api/.env).
# - Opsi B: skip scenario 6/7 yang butuh persistence; jalankan unit test (step 5) saja.
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock && PORT=3002 pnpm start:dev &

# 2. Run migration bila belum (sama kedua kondisi - butuh DB connectable)
cd /home/z/my-project/retry-failure/apps/payment-api && pnpm db:migrate

# 3. Start payment-api (port kondisional) - scheduler otomatis aktif via RetrySchedulerModule
# KONDISI LOCAL (port 3000 bebas):
cd /home/z/my-project/retry-failure/apps/payment-api && PORT=3000 pnpm start:dev
# Expected early log:
#   [Nest] LOG [RetrySchedulerService] Scheduler started: intervalMs=5000, batchSize=50, maxTotalRetries=5
#   [Nest] LOG [NestApplication] Nest application successfully started

# KONDISI SANDBOX (port 3000 dipakai Next.js preview -> payment-api geser ke 3001):
cd /home/z/my-project/retry-failure/apps/payment-api && PORT=3001 pnpm start:dev
# Expected early log: same as above + "listening on :3001"

# 4. Typecheck + lint - sama kedua kondisi
cd /home/z/my-project/retry-failure
pnpm --filter payment-api typecheck
pnpm --filter payment-api lint

# 5. Jest unit tests (tidak butuh DB / HTTP server - selalu jalan)
pnpm --filter payment-api test -- --testPathPattern=retry-scheduler.service.spec

# === Env var konvensi (set sekali di sesi shell) ===
# KONDISI LOCAL:  export API_PORT=3000 GW_PORT=3001
# KONDISI SANDBOX: export API_PORT=3001 GW_PORT=3002
API_PORT="${API_PORT:-3000}"  # default 3000 LOCAL; set API_PORT=3001 untuk SANDBOX
GW_PORT="${GW_PORT:-3001}"    # default 3001 LOCAL; set GW_PORT=3002 untuk SANDBOX

# 6. Verify /scheduler-health endpoint
curl -sS "http://localhost:${API_PORT}/scheduler-health" | jq .
# Expected: { "status": "idle", "processedCount": 0, "errorCount": 0, "lastError": null, "intervalMs": 5000, "batchSize": 50, "maxTotalRetries": 5 }

# ============================================================
# Scenario 6 - durable scheduler retry (plan section 14.2 scenario 6)
# ============================================================

# 6a. Set gateway mock mode = server-error -> create payment ->
#     expected: payment jadi scheduled_for_retry setelah Cockatiel exhausted (3 attempts).
curl -sS -X PUT "http://localhost:${GW_PORT}/admin/config" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"server-error"}' | jq .

curl -sS -X POST "http://localhost:${API_PORT}/payments" \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"SCHED-SCENARIO6-001","amount":10000,"currency":"IDR"}' | jq .
# Expected: { "payment": { "status": "scheduled_for_retry", "totalRetryCount": 1, "nextRetryAt": "<10s from now>" } }

# 6b. Switch gateway ke always-success -> scheduler akan pick payment tsb
#     dalam ~10s (SCHEDULER_BASE_DELAY_MS) + 5s (SCHEDULER_INTERVAL_MS poll).
curl -sS -X PUT "http://localhost:${GW_PORT}/admin/config" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"always-success"}' | jq .

# 6c. Tunggu ~15-20 detik (2 scheduler cycles dengan interval=5s), lalu cek payment state.
sleep 20
PAYMENT_ID=$(curl -sS "http://localhost:${API_PORT}/payments?status=succeeded&limit=5" \
  | jq -r '.payments[] | select(.orderId=="SCHED-SCENARIO6-001") | .id' | head -n1)
curl -sS "http://localhost:${API_PORT}/payments/${PAYMENT_ID}" \
  | jq '.payment | {id, status, attemptCount, totalRetryCount, gatewayReference}'
# Expected: status="succeeded", totalRetryCount=1, attemptCount=1
#           (Cockatiel attempt #1 di cycle ke-2 = success), gatewayReference set.

# 6d. Verify scheduler stats - processedCount >= 1, errorCount = 0.
curl -sS "http://localhost:${API_PORT}/scheduler-health" | jq .
# Expected: { "status": "idle", "processedCount": >=1, "errorCount": 0, "lastPollAt": "<recent ISO 8601>" }

# ============================================================
# Scenario 7 - total retry exhaustion (plan section 14.2 scenario 7)
# ============================================================

# 7a. Keep gateway di server-error, create payment baru.
curl -sS -X PUT "http://localhost:${GW_PORT}/admin/config" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"server-error"}' | jq .

curl -sS -X POST "http://localhost:${API_PORT}/payments" \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"SCHED-SCENARIO7-001","amount":20000,"currency":"IDR"}' | jq .
# Expected: status=scheduled_for_retry, totalRetryCount=1

# 7b. Tunggu ~60-80 detik (6 scheduler cycles × ~10s backoff per cycle).
#     Setiap cycle:
#       cycle 1: totalRetryCount 0 -> 1 (processing -> scheduled_for_retry)
#       cycle 2: totalRetryCount 1 -> 2
#       cycle 3: 2 -> 3
#       cycle 4: 3 -> 4
#       cycle 5: 4 -> 5
#       cycle 6: 5 + 1 > 5 (MAX) -> status=failed, failureReason='max_total_retries_exceeded'
sleep 70

# 7c. Cek final state.
PAYMENT_ID=$(curl -sS "http://localhost:${API_PORT}/payments?status=failed&limit=5" \
  | jq -r '.payments[] | select(.orderId=="SCHED-SCENARIO7-001") | .id' | head -n1)
curl -sS "http://localhost:${API_PORT}/payments/${PAYMENT_ID}" \
  | jq '.payment | {id, status, attemptCount, totalRetryCount, failureReason}'
# Expected: status="failed", totalRetryCount=5, failureReason="max_total_retries_exceeded"

# 7d. Verify scheduler stats - processedCount >= 5 (5 scheduler cycles untuk payment ini).
curl -sS "http://localhost:${API_PORT}/scheduler-health" | jq .

# ============================================================
# Verify state transitions via psql
# ============================================================

# 8a. List payments dengan scheduler state
# KONDISI LOCAL (docker exec):
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml exec postgres \
  psql -U retry_failure -d retry_failure -c \
  "SELECT id, order_id, status, attempt_count, total_retry_count,
          next_retry_at, failure_reason, updated_at
   FROM payments
   WHERE order_id LIKE 'SCHED-%'
   ORDER BY created_at DESC;"

# KONDISI SANDBOX (host psql, atau Node script fallback bila psql CLI tidak tersedia):
psql -h localhost -U retry_failure -d retry_failure -c \
  "SELECT id, order_id, status, attempt_count, total_retry_count,
          next_retry_at, failure_reason, updated_at
   FROM payments
   WHERE order_id LIKE 'SCHED-%'
   ORDER BY created_at DESC;"

# 8b. List attempts per scheduler-triggered cycle - verify trace_id sama per cycle,
#     berbeda antar cycle (traceId di-generate per executePayment call di TASK-07).
# KONDISI LOCAL:
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml exec postgres \
  psql -U retry_failure -d retry_failure -c \
  "SELECT payment_id, attempt_number, outcome, breaker_state, trace_id, created_at
   FROM payment_attempts
   WHERE payment_id = (
     SELECT id FROM payments WHERE order_id='SCHED-SCENARIO7-001' LIMIT 1
   )
   ORDER BY created_at ASC;"
# Expected: 6 cycles × 3 attempts = 18 rows. trace_id berbeda antar cycle, sama dalam cycle.

# KONDISI SANDBOX:
psql -h localhost -U retry_failure -d retry_failure -c \
  "SELECT payment_id, attempt_number, outcome, breaker_state, trace_id, created_at
   FROM payment_attempts
   WHERE payment_id = (
     SELECT id FROM payments WHERE order_id='SCHED-SCENARIO7-001' LIMIT 1
   )
   ORDER BY created_at ASC;"

# 8c. Verify scheduler no longer picks failed payment
# KONDISI LOCAL:
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml exec postgres \
  psql -U retry_failure -d retry_failure -c \
  "SELECT COUNT(*) FROM payments
   WHERE status='scheduled_for_retry' AND next_retry_at <= NOW();"
# Expected: 0 bila semua scenario 7 payment sudah failed (atau >0 bila ada scenario 6 lain yang belum selesai).

# KONDISI SANDBOX:
psql -h localhost -U retry_failure -d retry_failure -c \
  "SELECT COUNT(*) FROM payments
   WHERE status='scheduled_for_retry' AND next_retry_at <= NOW();"

# 8d. Verify scheduler registered interval via /scheduler-health (alternative)
curl -sS "http://localhost:${API_PORT}/scheduler-health" | jq '.intervalMs, .batchSize, .maxTotalRetries'

# 9. Reset gateway ke default (always-success) untuk cleanup.
curl -sS -X PUT "http://localhost:${GW_PORT}/admin/config" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"always-success"}' | jq .
```

## Notes

### Single-instance only (plan section 12 + 20.2 explicit)

Scheduler versi ini **TIDAK** menyediakan distributed lock guarantee. Bila ada 2+ instance `payment-api` berjalan simultan (mis. Kubernetes Deployment `replicas: 2`), kedua instance akan poll DB yang sama di interval yang serupa. Akibatnya:

- **Race condition**: dua instance mem-pick payment yang sama. `PaymentsService.atomicUpdateStatus()` (TASK-07) menangani ini via `WHERE status = expectedFrom` atomic update - hanya satu yang sukses transit `scheduled_for_retry -> processing`. Instance kedua akan dapat `switched = false` -> throw `BadRequestException('Payment X status changed concurrently')` -> scheduler catch + log warn + continue.
- **Tidak crash, tapi waste work**: instance kedua melakukan query + try-execute yang gagal. Untuk throughput rendah demo, acceptable. Production butuh `FOR UPDATE SKIP LOCKED` atau external queue.

Document di TASK-15 production caveats: future evolution - `PostgreSQL SKIP LOCKED`, external queue (Kafka), atau dedicated distributed scheduler (BullMQ / Temporal).

### Scheduler calls PaymentsService directly (not HTTP) - same NestJS process

Mengapa TIDAK via HTTP call ke `POST /payments/:id/retry` (TASK-09 endpoint)?

1. **Cockatiel breaker singleton konsisten** - `breakerStore` (TASK-05) adalah in-memory Map per process. Bila scheduler dan `PaymentsService` berada di process yang sama, state breaker shared. Saat scheduler trigger `executePayment`, breaker policy dan retry counter konsisten dengan call dari `POST /payments` API. Bila scheduler di process terpisah + HTTP call, breaker di scheduler process berbeda state-nya - bisa jadi scheduler selalu open breaker di process-nya padahal API process sudah recovered, atau sebaliknya.
2. **Latency + resource** - HTTP call tambah ~5-50ms latency + 1 TCP connection + JSON serialization. Direct method call ~0.01ms. Untuk scheduler yang mem-pick batch 50 payment per cycle, total overhead 250ms-2.5s - significant.
3. **Error semantics** - HTTP call akan wrap error ke NestJS exception filter -> 500 / 409 response. Scheduler perlu parse response body untuk membedakan `max_total_retries_exceeded` dari `concurrent_change`. Direct call langsung dapat instance `Error` / `BadRequestException` - type-safe.
4. **Trade-off** - coupling scheduler ke `PaymentsService`. Bila `PaymentsService` berubah signature, scheduler ikut berubah. Acceptable untuk monorepo dengan single deployment unit.

> Plan section 10 implicit: scheduler adalah component internal `payment-api`, bukan service terpisah. HTTP call hanya dipakai bila scheduler benar-benar out-of-process (opsi alternatif yang DITOLAK di plan rev 2).

### MAX_TOTAL_RETRIES check di PaymentsService (bukan scheduler)

Scheduler **TIDAK** mengecek `MAX_TOTAL_RETRIES`. Guard logic 100% di `PaymentsService.applyOutcome()` (TASK-07 step 5):

```ts
const current = (await this.payments.findById(paymentId))!;
const nextTotal = current.totalRetryCount + 1;
if (nextTotal > this.maxTotalRetries) {
  await this.atomicTransition(paymentId, PaymentStatus.FAILED, {
    failureReason: 'max_total_retries_exceeded',
  });
  this.logger.warn({ paymentId, totalRetryCount: current.totalRetryCount }, 'max_total_retries_exceeded -> failed');
  return (await this.payments.findById(paymentId))!;
}
```

Setelah transisi `processing -> failed`, payment tidak lagi match poller query (`WHERE status='scheduled_for_retry'`) - scheduler otomatis berhenti mem-pick payment tersebut di cycle berikutnya. Tidak ada flag `is_exhausted` atau special handling di scheduler.

> `MAX_TOTAL_RETRIES` di-inject ke `RetrySchedulerService` constructor **HANYA** untuk logging purpose - log "approaching limit" bila `total_retry_count >= MAX - 1` (warning operational). **TIDAK ada if-check di scheduler** yang menghentikan pemanggilan `executePayment` - guard tetap di service.

### Backoff strategy - constant chosen for demo

Lihat section "Backoff strategy untuk `next_retry_at`" di atas. Singkatnya:

- **Constant** (`SCHEDULER_BASE_DELAY_MS` = 10s default) -> demo observable dalam 1 menit.
- **Exponential** (future evolution, `SCHEDULER_BACKOFF_STRATEGY=exponential`) -> production.

Server-directed `Retry-After` (HTTP 429/503) meng-override constant/exponential value di `PaymentsService.applyOutcome()` - ini bukan tanggung jawab scheduler, sudah di-wire TASK-07.

### Error handling - scheduler loop tidak crash

`RetrySchedulerService.poll()` dirancang **tidak pernah throw** ke `setInterval` callback. Strategi berlapis:

1. **Re-entrancy guard** - bila `running=true` (poll sebelumnya belum selesai), skip cycle. Tidak queue - cycle berikutnya akan tetap pick payment yang belum diproses (karena `next_retry_at <= now` tetap true).
2. **Per-payment try/catch** - `processOne()` meng-catch error per payment + log warn + continue ke payment berikutnya di for-loop.
3. **Outer try/catch** - bila `findDueRetries` sendiri throw (DB down), log error + increment `errorCount` + set `lastError`. Tidak throw ke `setInterval` callback.
4. **`setInterval` safety net** - `void this.poll().catch(...)` di wrapper `setInterval` callback - bila ada bug di `poll()` yang lolos try/catch (tidak seharusnya terjadi), di-log dan tidak menjadi unhandled promise rejection yang crash process Node.js.

Dengan ini, scheduler **selalu alive** selama process tidak crash. Stats `errorCount` + `lastError` adalah sinyal untuk ops (via `/scheduler-health`) bahwa ada masalah - bukan crash signal.

### `next_retry_at` di-set oleh PaymentsService (bukan scheduler)

Penting: scheduler **tidak** meng-update kolom `next_retry_at`. Update terjadi di `PaymentsService.applyOutcome()` (TASK-07) saat transisi `processing -> scheduled_for_retry`:

```ts
const delayMs = result.retryAfterMs ?? this.schedulerBaseDelayMs;
const nextRetryAt = new Date(Date.now() + delayMs);
await this.atomicTransition(paymentId, PaymentStatus.SCHEDULED_FOR_RETRY, {
  totalRetryCount: nextTotal,
  nextRetryAt,
  failureReason: result.errorMessage ?? result.errorCode ?? 'retry_exhausted',
});
```

Scheduler hanya membaca `next_retry_at` di query `findDueRetries`. Pemisahan tanggung jawab ini menjaga single source of truth - semua transisi status + field payment di-orchestrate oleh `PaymentsService`.

### AsyncLocalStorage trace context (TASK-11 prep)

Di task ini, `PaymentsService.executePayment()` generate `traceId = crypto.randomUUID()` per cycle (TASK-07). Scheduler **tidak** menambah trace context baru - traceId di-share lintas semua attempt dalam satu cycle.

TASK-11 akan mengganti `crypto.randomUUID()` dengan OTel span context yang di-propagate via `AsyncLocalStorage`. Scheduler tidak perlu modifikasi - `AsyncLocalStorage.run(traceContext, () => executePayment(...))` opsional, karena `executePayment` sendiri yang memulai span baru per cycle.

### After this task done - TASK-14 scenarios 6 + 7 verifiable

Setelah TASK-10 selesai, **durable retry loop end-to-end** berfungsi:

- **Scenario 6 (durable scheduler retry)** - payment `scheduled_for_retry` -> due -> scheduler picks -> Cockatiel executes -> success. Verifiable via `useful commands` step 6 di atas.
- **Scenario 7 (total retry exhaustion)** - persistent failure -> scheduler cycles -> `MAX_TOTAL_RETRIES` exceeded -> `failed`. Verifiable via step 7 di atas.

TASK-14 (E2E scenarios) dapat menambah Jest + supertest test cases yang otomatis menjalankan kedua scenario di atas dengan `jest.useFakeTimers()` untuk kontrol waktu (tidak perlu `sleep 70` manual).

TASK-11 (observability) dapat menambahkan metric `scheduler_poll_total{result}` + `scheduler_payment_processed_total{outcome}` ke registry - di-increment di `poll()` dan `processOne()`. Scheduler stats (`processedCount`, `errorCount`) juga bisa di-expose sebagai Prometheus gauge bila diperlukan.

TASK-15 (documentation) WAJIB menambahkan production caveat:

1. Single-instance scheduler limitation (plan section 12 + 20.2).
2. Backoff strategy constant vs exponential trade-off.
3. `MAX_TOTAL_RETRIES` guard di `PaymentsService` (bukan scheduler) - separation of concern.
4. `next_retry_at` set oleh `PaymentsService` (bukan scheduler) - single source of truth.
5. Cockatiel breaker singleton per-process - scheduler + API share state.
6. `@nestjs/schedule` `SchedulerRegistry` approach (bukan `@Interval` literal) - env-driven interval.
