# TASK-09 - NestJS Controllers (Payments + Health + Metrics)

> **Task ID**: 6-b
> **Depends on**: 5 (TASK-07 PaymentsService) + 6-a (TASK-08 AuditModule - `AUDIT_PORT` binding sudah real, bukan NoopAuditService)
> **Estimated effort**: M (~2-3 jam)
> **Plan reference**: Section 10 (Payment API - endpoint table + flow) + Section 13 (Observability - `/metrics` endpoint + Prometheus)

---

## Goal

Meng-expose **`PaymentsService`** (TASK-07) + **`AuditPort`** (TASK-08) melalui **NestJS HTTP controllers** dengan kontrak REST yang sesuai plan section 10.1, plus dua endpoint operasional (`/health` + `/metrics`) yang menjadi dasar observability TASK-11 + deployment smoke test.

Tujuan utama:

1. **REST API lengkap** untuk lifecycle payment - `POST /payments` (create + process sync), `GET /payments` (list/filter), `GET /payments/:id` (detail + attempt history), `POST /payments/:id/retry` (manual retry dengan state guard).
2. **Swagger / OpenAPI documentation** otomatis via `@nestjs/swagger` (`@ApiTags`, `@ApiOperation`, `@ApiResponse`, `@ApiProperty` di DTO). UI tersedia di `GET /docs`.
3. **class-validator + class-transformer** DTOs untuk request validation (menggantikan zod yang dipakai di plan rev 1). Validation pipe global dengan `whitelist: true` + `forbidNonWhitelisted: true` + `transform: true`.
4. **Health endpoint** - `GET /health` mengembalikan `{ db: 'ok'|'down', gateway: 'ok'|'down', timestamp }` dengan timeout 1 detik per check. Dipakai untuk Docker readiness/liveness probe dan Caddy upstream check.
5. **Metrics endpoint** - `GET /metrics` mengembalikan Prometheus exposition format (`text/plain; version=0.0.4`). Di task ini hanya stub registry (satu `Counter` sederhana); registry penuh dengan 7 metrics (plan section 13.2) di-wire di TASK-11.
6. **Error handling konsisten** - pakai NestJS built-in exceptions: `BadRequestException` (400) untuk validation error, `NotFoundException` (404) untuk missing payment, `ConflictException` (409) untuk invalid state transitions (mis. retry pada `succeeded`). Response body mengikuti format `{ error: { code, message, details? } }` via default exception filter (tidak perlu custom filter di task ini).

Setelah task ini selesai:

- **TASK-10** (scheduler) dapat memicu retry via HTTP call ke `POST /payments/:id/retry` (atau langsung ke `PaymentsService.manualRetry()` - scheduler pilih yang lebih murah).
- **TASK-12** (Next.js sandbox preview) dan **TASK-13** (Vue+PrimeVue dashboard) dapat mengonsumsi data dari `GET /payments` + `GET /payments/:id`.
- **TASK-14** (E2E scenarios) dapat menjalankan scenario 1–7 via `supertest` melawan app NestJS yang berjalan (boleh dengan DB test terpisah).

## Scope

**In scope**:

- `apps/payment-api/src/modules/payments/payments.controller.ts` - `@Controller('payments')` dengan 4 route: `POST /`, `GET /`, `GET /:id`, `POST /:id/retry`.
- `apps/payment-api/src/modules/payments/dto/payment-response.dto.ts` - `PaymentResponseDto`, `PaymentDetailResponseDto`, `ListPaymentsResponseDto`, `RetryPaymentResponseDto` (response shapes untuk Swagger).
- `apps/payment-api/src/modules/payments/dto/list-payments-query.dto.ts` - `ListPaymentsQueryDto` (filter `status`, optional `limit` + `offset`).
- `apps/payment-api/src/modules/payments/dto/create-payment.dto.ts` - **REUSE dari TASK-07** (sudah ada - hanya tambahkan `@ApiProperty` decorators bila belum).
- `apps/payment-api/src/modules/health/health.controller.ts` - `@Controller('health')` dengan `GET /`.
- `apps/payment-api/src/modules/health/health.service.ts` - DB ping (`SELECT 1`) + gateway ping (axios HEAD ke `http://localhost:3002/admin/config`).
- `apps/payment-api/src/modules/health/health.module.ts` - NestJS module.
- `apps/payment-api/src/modules/metrics/metrics.controller.ts` - `@Controller('metrics')` dengan `GET /` returning `register.metrics()`.
- `apps/payment-api/src/modules/metrics/metrics.module.ts` - stub registry (satu `Counter`), real registry di TASK-11.
- `apps/payment-api/src/app.module.ts` - wire semua modul: `ConfigModule`, `DatabaseModule`, `GatewayModule`, `PaymentsModule`, `AuditModule`, `MetricsModule`, `HealthModule`, `ScheduleModule.forRoot()` (prepare untuk TASK-10).
- `apps/payment-api/src/main.ts` - bootstrap: `ValidationPipe` global, CORS, `SwaggerModule.setup('docs', ...)`, listen port 3001 (dari `PORT` env).
- Jest unit tests di `apps/payment-api/test/modules/payments/payments.controller.spec.ts` (mock `PaymentsService`).
- Jest unit tests di `apps/payment-api/test/modules/health/health.controller.spec.ts` (mock `HealthService`).

**Out of scope**:

- **Frontend UI** (Vue dashboard + Next.js sandbox) -> **TASK-12 + TASK-13**. Controller hanya menyediakan JSON; rendering di task frontend.
- **Metrics emission aktual** (`payment_gateway_requests_total`, `retry_attempts_total`, dst. + integration ke `PaymentsService` / gateway adapter) -> **TASK-11**. Di task ini `/metrics` endpoint sudah exist + return valid Prometheus text, tapi counter hanya satu stub (`http_requests_total`) - TASK-11 akan mengganti registry dengan yang penuh.
- **Auth / RBAC** (admin token untuk `POST /payments/:id/retry`) -> di luar scope plan rev 2. Di task ini endpoint retry terbuka. Document production caveat di TASK-15.
- **Idempotency-Key dari client** - plan section 9.1 menyatakan key di-derived dari `payment.id` internal (bukan dari client header). Di task ini `POST /payments` TIDAK menerima header `Idempotency-Key`; service yang generate UUID payment + derive key.
- **Pagination total count** - `GET /payments` mengembalikan `limit` + `offset` + `payments: [...]` tanpa `total`. Count query expensive di PostgreSQL bila tidak perlu; frontend tidak memerlukan total page count untuk demo (TASK-12/13 infinite scroll atau load-more). Document di TASK-15 bila production butuh.
- **Custom exception filter** - NestJS default exception filter sudah cukup untuk task ini. Custom filter untuk format error response konsisten -> opsional, boleh ditambah di TASK-11 bila metrics need structured error code.
- **Rate limiting / throttling** -> di luar scope (production caveat TASK-15).
- **Versioning** (`/v1/payments`) -> tidak dipakai di plan rev 2; endpoint langsung di root.

## Endpoints (plan section 10.1)

| Method | Path | Status | Fungsi | Response shape |
|---|---|---|---|---|
| POST | `/payments` | 201 | Create + process payment (synchronous - `PaymentsService.createPayment()` + `executePayment()`). | `{ payment: PaymentView }` |
| GET | `/payments?status=&limit=&offset=` | 200 | List/filter payments. `status` opsional ( salah satu: `processing` \| `succeeded` \| `failed` \| `scheduled_for_retry`). `limit` default 50, max 200. `offset` default 0. | `{ payments: PaymentView[], limit: number, offset: number }` |
| GET | `/payments/:id` | 200 / 404 | Detail + attempt history. 404 bila `id` tidak ditemukan. | `{ payment: PaymentView, attempts: AttemptView[] }` |
| POST | `/payments/:id/retry` | 200 / 404 / 409 | Manual retry. 404 bila missing. **409 Conflict** bila status = `succeeded` (terminal) atau transisi tidak valid (mis. retry pada `processing`). | `{ payment: PaymentView }` |
| GET | `/health` | 200 (selalu - body berisi status detail) | DB health + gateway health. | `{ db: 'ok'\|'down', gateway: 'ok'\|'down', timestamp: string }` |
| GET | `/metrics` | 200 | Prometheus exposition format. Content-Type: `text/plain; version=0.0.4; charset=utf-8`. | Prometheus text |
| GET | `/docs` | 200 | Swagger UI HTML. | HTML |

### Error response shape (default NestJS HttpException -> JSON)

```json
{
  "statusCode": 409,
  "message": "Payment is in terminal state 'succeeded' - retry not allowed",
  "error": "Conflict"
}
```

> Bila ingin `{ error: { code, message, details? } }` format konsisten, tambahkan custom `ExceptionFilter` global di `main.ts` (opsional, tidak blocking untuk task ini -TASK-11 boleh tambah).

## Files to create/modify

Semua path absolut di monorepo:

### Create baru

- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/payments/payments.controller.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/payments/dto/payment-response.dto.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/payments/dto/list-payments-query.dto.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/health/health.controller.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/health/health.service.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/health/health.module.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/health/index.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/metrics/metrics.controller.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/metrics/metrics.module.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/metrics/index.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/test/modules/payments/payments.controller.spec.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/test/modules/health/health.controller.spec.ts`

### Modify

- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/payments/payments.module.ts` - tambahkan `controllers: [PaymentsController]` + export.
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/payments/dto/create-payment.dto.ts` - tambahkan `@ApiProperty()` decorators (bila belum ada dari TASK-07).
- `/home/z/my-project/retry-failure/apps/payment-api/src/app.module.ts` - wire semua modul baru.
- `/home/z/my-project/retry-failure/apps/payment-api/src/main.ts` - Swagger + ValidationPipe + CORS.

## Implementation steps

### 1. `payments/dto/payment-response.dto.ts` - response shapes untuk Swagger

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttemptView } from '../audit/audit-port';
import { PaymentStatus } from '../../../database/entities/enums';

/**
 * View untuk satu payment (GET /payments, POST /payments, POST /payments/:id/retry).
 * Field sama dengan entity Payment (TASK-02), tapi plain object - tidak leak TypeORM metadata.
 */
export class PaymentResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'ORD-12345' })
  orderId: string;

  @ApiProperty({ example: 150000.0 })
  amount: number;

  @ApiProperty({ example: 'IDR' })
  currency: string;

  @ApiProperty({ enum: ['processing', 'succeeded', 'failed', 'scheduled_for_retry'] })
  status: PaymentStatus;

  @ApiPropertyOptional({ example: 'GW-REF-98765', nullable: true })
  gatewayReference?: string | null;

  @ApiProperty({ example: 3 })
  attemptCount: number;

  @ApiProperty({ example: 1 })
  totalRetryCount: number;

  @ApiPropertyOptional({ example: '2025-01-15T10:30:00.000Z', nullable: true })
  nextRetryAt?: Date | null;

  @ApiPropertyOptional({ example: 'max_total_retries_exceeded', nullable: true })
  failureReason?: string | null;

  @ApiProperty({ example: '2025-01-15T10:25:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2025-01-15T10:25:05.000Z' })
  updatedAt: Date;
}

/**
 * Response GET /payments/:id - embed attempts.
 */
export class PaymentDetailResponseDto {
  @ApiProperty({ type: PaymentResponseDto })
  payment: PaymentResponseDto;

  @ApiProperty({
    type: 'array',
    description: 'Attempt history urut attemptNumber ASC (TASK-08 AuditPort.listAttempts).',
  })
  attempts: AttemptView[];
}

/**
 * Response GET /payments - list dengan limit/offset echo.
 */
export class ListPaymentsResponseDto {
  @ApiProperty({ type: 'array', items: PaymentResponseDto })
  payments: PaymentResponseDto[];

  @ApiProperty({ example: 50 })
  limit: number;

  @ApiProperty({ example: 0 })
  offset: number;
}

/**
 * Response POST /payments dan POST /payments/:id/retry (sama shape).
 */
export class CreatePaymentResponseDto {
  @ApiProperty({ type: PaymentResponseDto })
  payment: PaymentResponseDto;
}

export class RetryPaymentResponseDto {
  @ApiProperty({ type: PaymentResponseDto })
  payment: PaymentResponseDto;
}
```

### 2. `payments/dto/list-payments-query.dto.ts` - query filter

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaymentStatus } from '../../../database/entities/enums';

/**
 * Query parameters untuk GET /payments?status=&limit=&offset=
 */
export class ListPaymentsQueryDto {
  @ApiPropertyOptional({
    enum: ['processing', 'succeeded', 'failed', 'scheduled_for_retry'],
    description: 'Filter by status. Bila omitted -> semua status.',
  })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
```

> Catatan: `@Type(() => Number)` dari `class-transformer` mengubah query string `?limit=50` (string) menjadi `number`. Ini bekerja sama dengan `transform: true` di global `ValidationPipe`.

### 3. `payments/payments.controller.ts` - REST controller

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import {
  CreatePaymentResponseDto,
  ListPaymentsResponseDto,
  PaymentDetailResponseDto,
  PaymentResponseDto,
  RetryPaymentResponseDto,
} from './dto/payment-response.dto';
import { InvalidTransitionError } from './state-machine';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * Create + process payment (synchronous).
   *
   * Flow (plan section 10.2):
   *   validate -> create(processing) -> executePayment() -> terminal: succeeded | failed | scheduled_for_retry
   *
   * Response 201 walaupun final status bukan 'succeeded' - endpoint ini
   * tetap mengembalikan payment yang sudah dieksekusi (mis. status='scheduled_for_retry').
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create + process payment (sync)' })
  @ApiResponse({ status: 201, type: CreatePaymentResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error (missing orderId, invalid amount, dst.)' })
  async create(@Body() dto: CreatePaymentDto): Promise<CreatePaymentResponseDto> {
    const payment = await this.payments.createPayment(dto);
    return { payment: this.toResponse(payment) };
  }

  /**
   * List / filter payments by status.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List payments (optional filter by status)' })
  @ApiQuery({ name: 'status', required: false, enum: ['processing', 'succeeded', 'failed', 'scheduled_for_retry'] })
  @ApiResponse({ status: 200, type: ListPaymentsResponseDto })
  async list(@Query() query: ListPaymentsQueryDto): Promise<ListPaymentsResponseDto> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const rows = await this.payments.list({
      status: query.status,
      limit,
      offset,
    });
    return {
      payments: rows.map((r) => this.toResponse(r)),
      limit,
      offset,
    };
  }

  /**
   * Detail + attempt history.
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get payment detail + attempt history' })
  @ApiResponse({ status: 200, type: PaymentDetailResponseDto })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async getById(@Param('id') id: string): Promise<PaymentDetailResponseDto> {
    const result = await this.payments.getById(id);
    if (!result) {
      throw new NotFoundException(`Payment ${id} not found`);
    }
    return {
      payment: this.toResponse(result.payment),
      attempts: result.attempts,
    };
  }

  /**
   * Manual retry - only allowed bila status = 'failed' atau 'scheduled_for_retry'.
   *
   * State guard (plan section 10.2 - manualRetry transition):
   *   - 'failed'                -> processing (admin override)
   *   - 'scheduled_for_retry'   -> processing (early retry - tidak tunggu scheduler)
   *   - 'processing'            -> 409 (sudah berjalan)
   *   - 'succeeded'             -> 409 (terminal - tidak bisa retry)
   *
   * Bila PaymentsService.manualRetry() throw InvalidTransitionError ->
   * map ke 409 ConflictException.
   */
  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manual retry (failed / scheduled_for_retry only)' })
  @ApiResponse({ status: 200, type: RetryPaymentResponseDto })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  @ApiResponse({ status: 409, description: 'Invalid state transition (succeeded / processing)' })
  async retry(@Param('id') id: string): Promise<RetryPaymentResponseDto> {
    try {
      const payment = await this.payments.manualRetry(id);
      return { payment: this.toResponse(payment) };
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        throw new ConflictException(
          `Payment is in state '${err.from}' - retry not allowed (terminal or in-progress)`,
        );
      }
      // Re-throw unknown errors ( akan jadi 500 InternalServerError via default filter)
      throw err;
    }
  }

  /**
   * Map entity Payment (TASK-02) -> PaymentResponseDto (plain object).
   * Hindari leak TypeORM metadata (mis. instance methods, __entity).
   */
  private toResponse(p: any): PaymentResponseDto {
    return {
      id: p.id,
      orderId: p.orderId,
      amount: Number(p.amount),
      currency: p.currency,
      status: p.status,
      gatewayReference: p.gatewayReference ?? null,
      attemptCount: p.attemptCount,
      totalRetryCount: p.totalRetryCount,
      nextRetryAt: p.nextRetryAt ?? null,
      failureReason: p.failureReason ?? null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
```

> Catatan: `PaymentsService.list()` di TASK-07 diasumsikan menerima `{ status?, limit, offset }` argumen. Bila signature di TASK-07 berbeda (mis. terpisah `listAll()` vs `listByStatus(status)`), sesuaikan - gunakan overload atau union arg.

### 4. `payments/payments.module.ts` - tambah controllers

```ts
// BEFORE (TASK-07/08)
@Module({
  imports: [TypeOrmModule.forFeature([Payment]), GatewayModule, AuditModule],
  providers: [PaymentRepository, PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}

// AFTER (TASK-09)
@Module({
  imports: [TypeOrmModule.forFeature([Payment]), GatewayModule, AuditModule],
  controllers: [PaymentsController],           // ← tambahkan
  providers: [PaymentRepository, PaymentsService],
  exports: [PaymentsService, PaymentsController], // ← export controller agar AppModule bisa pakai
})
export class PaymentsModule {}
```

### 5. `health/health.service.ts` - DB + gateway ping

```ts
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import axios from 'axios';

/**
 * Health checker dengan timeout pendek (1 detik per check) -
 * untuk Docker readiness probe / Caddy upstream check.
 *
 * TIDAK boleh blocking lebih dari 2 detik total (DB + gateway sequential).
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Ping DB via `SELECT 1` dengan timeout 1 detik.
   * Bila DB down / unreachable -> return 'down' (tidak throw).
   */
  async checkDb(): Promise<'ok' | 'down'> {
    try {
      await this.dataSource.query('SELECT 1');
      return 'ok';
    } catch (err) {
      this.logger.warn({ err }, 'DB health check failed');
      return 'down';
    }
  }

  /**
   * Ping gateway mock via HEAD http://localhost:3002/admin/config (timeout 1 detik).
   * Bila gateway down / unreachable -> return 'down' (tidak throw).
   *
   * URL gateway dibootstrap dari env GATEWAY_URL (default http://localhost:3002).
   */
  async checkGateway(): Promise<'ok' | 'down'> {
    const gatewayUrl = process.env.GATEWAY_URL ?? 'http://localhost:3002';
    try {
      await axios.head(`${gatewayUrl}/admin/config`, { timeout: 1000 });
      return 'ok';
    } catch (err) {
      this.logger.warn({ err }, 'Gateway health check failed');
      return 'down';
    }
  }

  /**
   * Composite check - keduanya (DB + gateway) sequential.
   * Total time worst case = 2 detik (bila keduanya down).
   */
  async check(): Promise<{
    db: 'ok' | 'down';
    gateway: 'ok' | 'down';
    timestamp: string;
  }> {
    const [db, gateway] = await Promise.all([this.checkDb(), this.checkGateway()]);
    return {
      db,
      gateway,
      timestamp: new Date().toISOString(),
    };
  }
}
```

### 6. `health/health.controller.ts`

```ts
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Health endpoint - selalu return 200 (body berisi detail status).
   *
   * Docker readiness/liveness probe:
   *   - 200 + db='ok' + gateway='ok' -> healthy
   *   - 200 + db='down' atau gateway='down' -> degraded (ops memutuskan)
   *
   * Bila ingin 503 saat db='down', tambahkan logika:
   *   `@HttpCode(res.db === 'ok' ? 200 : 503)` - tapi NestJS decorator
   *   statis tidak bisa dynamic berdasarkan body. Solusi: pakai `@Res()`
   *   manual injection (lihat alternative di bawah).
   */
  @Get()
  @ApiOperation({ summary: 'DB + gateway health' })
  async check() {
    return this.health.check();
  }
}
```

> **Alternative dengan dynamic status code** (opsional):

```ts
import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';

@Get()
async check(@Res() res: Response) {
  const result = await this.health.check();
  const status = result.db === 'ok' && result.gateway === 'ok' ? 200 : 503;
  res.status(status).json(result);
}
```

### 7. `health/health.module.ts`

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
```

### 8. `health/index.ts`

```ts
export * from './health.controller';
export * from './health.service';
export * from './health.module';
```

### 9. `metrics/metrics.controller.ts` - Prometheus endpoint (stub)

```ts
import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Registry } from 'prom-client';
import { METRICS_REGISTRY } from './metrics.module';

/**
 * GET /metrics - Prometheus exposition format.
 *
 * Stub: hanya satu Counter `http_requests_total`. Registry penuh
 * dengan 7 metrics (plan section 13.2) di-wire di TASK-11.
 */
@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(
    @InjectMetric('http_requests_total')
    private readonly httpRequests: Counter<string>,
    private readonly registry: Registry, // injected via METRICS_REGISTRY token
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Prometheus metrics endpoint (stub - full registry di TASK-11)' })
  async metrics(): Promise<string> {
    // Increment stub counter untuk membuktikan endpoint writeable.
    this.httpRequests.inc({ route: '/metrics' });
    return this.registry.metrics();
  }
}
```

> Dependency: `@willsoto/nestjs-prometheus` (NestJS-compatible wrapper untuk `prom-client`). Tambahkan di `apps/payment-api/package.json` di TASK-01 atau sekarang bila belum ada.

### 10. `metrics/metrics.module.ts` - stub registry

```ts
import { Module, Provider } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { Registry } from 'prom-client';
import { MetricsController } from './metrics.controller';

/**
 * Token DI untuk default registry (singleton).
 * TASK-11 akan menambahkan semua metrics ke registry ini.
 */
export const METRICS_REGISTRY = 'METRICS_REGISTRY';

/**
 * Provider untuk default prom-client Registry - instance tunggal
 * di-share ke seluruh modul (PaymentsService, GatewayAdapter, dst.).
 */
const registryProvider: Provider = {
  provide: METRICS_REGISTRY,
  useFactory: () => {
    // PrometheusModule.makeWithProvider() sudah create default registry;
    // di sini hanya re-export untuk konsistensi inject token.
    const { Registry } = require('prom-client');
    return new Registry();
  },
};

@Module({
  imports: [
    PrometheusModule.register({
      // defaultMetrics: true -> expose Node.js process metrics
      defaultMetrics: { enabled: true },
      // path: '/metrics' di-handle controller manual agar bisa set Content-Type.
      // Bila controller manual dipakai, jangan set `path` di sini (akan konflik).
    }),
  ],
  controllers: [MetricsController],
  providers: [
    registryProvider,
    {
      provide: 'PROMETHEUS_REGISTRY',
      useExisting: METRICS_REGISTRY,
    },
  ],
  exports: [METRICS_REGISTRY, 'PROMETHEUS_REGISTRY'],
})
export class MetricsModule {}
```

> Catatan integrasi: `MetricsController` sebaiknya pakai `inject(PROMETHEUS_REGISTRY)` (string token) atau `InjectMetric` decorator. Pilih satu approach di implementation untuk avoid duplikasi. **Decision**: pakai `@willsoto/nestjs-prometheus` default registry (lihat docs package), controller manual hanya untuk set Content-Type + increment stub counter.

### 11. `metrics/index.ts`

```ts
export * from './metrics.controller';
export * from './metrics.module';
export { METRICS_REGISTRY } from './metrics.module';
```

### 12. `app.module.ts` - wire semua modul

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

@Module({
  imports: [
    // Global config (env vars + Joi validation bila dipakai)
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // Database (TypeORM + entities + migrations)
    DatabaseModule,

    // Gateway adapter (TASK-06) - exports PAYMENT_GATEWAY_PORT
    GatewayModule,

    // Payments domain (TASK-07) + audit (TASK-08)
    PaymentsModule,
    AuditModule,

    // Health + metrics (TASK-09)
    HealthModule,
    MetricsModule,

    // Scheduler (TASK-10) - di-import SEKARANG agar container siap,
    // tapi cron jobs belum terdaftar sampai RetrySchedulerService di-declare
    // di TASK-10. ScheduleModule.forRoot() sendiri tidak men-trigger apa-apa.
    ScheduleModule.forRoot(),
  ],
})
export class AppModule {}
```

> Catatan: `PaymentsModule` sudah export `PaymentsController` (step 4), `HealthModule` + `MetricsModule` masing-masing sudah declare controller di `controllers: []`. Maka `AppModule` tidak perlu `controllers: []` array sendiri - controller otomatis tersedia via NestJS module system.

### 13. `main.ts` - bootstrap dengan Swagger + ValidationPipe + CORS

```ts
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Global ValidationPipe - class-validator + class-transformer
  // whitelist: strip unknown properties (tidak masuk DTO)
  // forbidNonWhitelisted: throw 400 bila ada prop tidak deklarasi di DTO
  // transform: convert string path/query ke tipe yang sesuai (mis. ?limit=50 -> number)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // ClassSerializerInterceptor - honor @Exclude() di DTO (opsional, untuk
  // kasus response yang ingin hide field - tidak dipakai di task ini, tapi
  // disiapkan untuk TASK-11 bila perlu hide internal fields).
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // CORS - allow Vue (5173) + Next.js sandbox (3000).
  // Bila hanya `origin: true`, semua origin di-allow (mirror request origin).
  // Spesifik lebih aman:
  app.enableCors({
    origin: [
      'http://localhost:5173',  // Vue+PrimeVue dashboard (TASK-13)
      'http://localhost:3000',  // Next.js sandbox preview (TASK-12)
      // Sandbox via Caddy - origin akan jadi `https://<sandbox-host>`,
      // tidak bisa di-predict; gunakan function bila perlu allow dynamic.
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  });

  // Swagger / OpenAPI documentation
  const config = new DocumentBuilder()
    .setTitle('Payment API')
    .setDescription(
      'Cockatiel Retry/Failure Scenario - Payment API. ' +
        'Endpoints: POST /payments, GET /payments, GET /payments/:id, ' +
        'POST /payments/:id/retry, GET /health, GET /metrics.',
    )
    .setVersion('1.0.0')
    .addServer('http://localhost:3001', 'Local dev')
    .addServer('https://<sandbox-host>/?XTransformPort=3001', 'Sandbox via Caddy')
    .addTag('payments', 'Payment lifecycle endpoints')
    .addTag('health', 'Health check')
    .addTag('metrics', 'Prometheus metrics')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  // Listen port 3001 (default). Bisa di-override via PORT env.
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  Logger.log(`Payment API running on http://localhost:${port}`, 'Bootstrap');
  Logger.log(`Swagger UI: http://localhost:${port}/docs`, 'Bootstrap');
}

bootstrap();
```

## Acceptance criteria

- [ ] `POST /payments` dengan body `{ orderId: 'ORD-001', amount: 150000, currency: 'IDR' }` -> **201 Created** dengan body `{ payment: { id, status: 'succeeded'|'failed'|'scheduled_for_retry', ... } }`.
- [ ] `POST /payments` tanpa `orderId` -> **400 Bad Request** dengan `message` validasi class-validator (`['orderId must be a string']` atau serupa).
- [ ] `POST /payments` dengan `amount: -100` -> **400 Bad Request** (validation error dari `@Min(0)`).
- [ ] `POST /payments` dengan `currency: 'XYZ'` (bukan 3-letter ISO) -> **400 Bad Request** bila DTO mengenakan `@Matches(/^[A-Z]{3}$/)`.
- [ ] `GET /payments` (tanpa query) -> **200 OK** dengan body `{ payments: [...], limit: 50, offset: 0 }`.
- [ ] `GET /payments?status=failed` -> **200 OK** dengan hanya payments ber-status `failed`.
- [ ] `GET /payments?status=invalid_status` -> **400 Bad Request** (enum validation error).
- [ ] `GET /payments?limit=200&offset=100` -> **200 OK** dengan `limit: 200, offset: 100` echo.
- [ ] `GET /payments/:id` dengan id valid -> **200 OK** dengan body `{ payment, attempts: [...] }` di mana `attempts` urut `attemptNumber` ASC.
- [ ] `GET /payments/:id` dengan id tidak ditemukan -> **404 Not Found** dengan message `Payment <id> not found`.
- [ ] `POST /payments/:id/retry` pada payment ber-status `failed` -> **200 OK** dengan `{ payment: { status: 'processing' | 'succeeded' | 'failed' | 'scheduled_for_retry' } }` (hasil eksekusi retry).
- [ ] `POST /payments/:id/retry` pada payment ber-status `scheduled_for_retry` -> **200 OK** (early retry - tidak menunggu scheduler).
- [ ] `POST /payments/:id/retry` pada payment ber-status `succeeded` -> **409 Conflict** dengan message `Payment is in state 'succeeded' - retry not allowed`.
- [ ] `POST /payments/:id/retry` pada payment ber-status `processing` -> **409 Conflict** (sudah berjalan, tidak bisa double-execute).
- [ ] `GET /health` -> **200 OK** dengan body `{ db: 'ok'|'down', gateway: 'ok'|'down', timestamp: '<ISO 8601>' }`. Bila DB up + gateway up -> `{ db: 'ok', gateway: 'ok' }`. Response tidak lebih dari ~2 detik.
- [ ] `GET /metrics` -> **200 OK** dengan Content-Type `text/plain; version=0.0.4; charset=utf-8` dan body mengandung setidaknya satu metric stub (mis. `http_requests_total{route="/metrics"} 1`).
- [ ] `GET /docs` -> **200 OK** dengan HTML Swagger UI. Buka di browser -> semua endpoint tampil dengan tag `payments`, `health`, `metrics`.
- [ ] Swagger "Try it out" untuk `POST /payments` berhasil mengirim request + mendapat 201 response.
- [ ] `pnpm --filter payment-api typecheck` -> **lulus tanpa error**.
- [ ] `pnpm --filter payment-api lint` -> **lulus tanpa error**.
- [ ] Dev server `pnpm --filter payment-api start:dev` -> **jalan tanpa crash**, listen di port 3001, log `Swagger UI: http://localhost:3001/docs`.
- [ ] Jest unit test `payments.controller.spec.ts` lulus (mock PaymentsService, verify mapping DTO + status code).
- [ ] Jest unit test `health.controller.spec.ts` lulus (mock HealthService, verify response shape).

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
# 1. Start dependency services (gateway mock + DB - port kondisional)
#    Pastikan PostgreSQL sudah running (docker atau managed) + env DATABASE_URL ter-set
#    di apps/payment-api/.env
# KONDISI LOCAL (gateway-mock port 3001):
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock && PORT=3001 pnpm start:dev &

# KONDISI SANDBOX (gateway-mock port 3002):
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock && PORT=3002 pnpm start:dev &

# 2. Run migration bila belum (sama kedua kondisi - butuh DB connectable)
cd /home/z/my-project/retry-failure/apps/payment-api && pnpm db:migrate

# 3. Start payment-api dev server (port kondisional)
# KONDISI LOCAL (port 3000 bebas):
cd /home/z/my-project/retry-failure/apps/payment-api && PORT=3000 pnpm start:dev
# Expected log: "Payment API running on http://localhost:3000" + "Swagger UI: http://localhost:3000/docs"

# KONDISI SANDBOX (port 3000 dipakai Next.js preview -> payment-api geser ke 3001):
cd /home/z/my-project/retry-failure/apps/payment-api && PORT=3001 pnpm start:dev
# Expected log: "Payment API running on http://localhost:3001" + "Swagger UI: http://localhost:3001/docs"

# 4. Typecheck + lint - sama kedua kondisi
cd /home/z/my-project/retry-failure && pnpm --filter payment-api typecheck
cd /home/z/my-project/retry-failure && pnpm --filter payment-api lint

# 5. Test endpoints via curl (jalan dari shell lain)
#    Pola env var: API_PORT default 3000 LOCAL; set API_PORT=3001 untuk SANDBOX.
#    Set sekali di sesi shell: export API_PORT=3000  (LOCAL) / export API_PORT=3001  (SANDBOX)
API_PORT="${API_PORT:-3000}"

#    a. POST /payments - create + process
curl -i -X POST "http://localhost:${API_PORT}/payments" \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"ORD-TEST-001","amount":150000,"currency":"IDR"}'
# Expected: HTTP/1.1 201 Created
#           { "payment": { "id":"...", "status":"succeeded"|"failed"|"scheduled_for_retry", ... } }

#    b. POST /payments - validation error (missing orderId)
curl -i -X POST "http://localhost:${API_PORT}/payments" \
  -H 'Content-Type: application/json' \
  -d '{"amount":150000}'
# Expected: HTTP/1.1 400 Bad Request
#           { "statusCode":400, "message":["orderId must be a string"], "error":"Bad Request" }

#    c. GET /payments - list (default limit 50)
curl -i "http://localhost:${API_PORT}/payments"
# Expected: HTTP/1.1 200 OK
#           { "payments":[...], "limit":50, "offset":0 }

#    d. GET /payments?status=failed - filter
curl -i "http://localhost:${API_PORT}/payments?status=failed"
# Expected: HTTP/1.1 200 OK, semua payment berstatus 'failed'

#    e. GET /payments/:id - detail + attempts (ganti <id> dengan ID dari step a)
curl -i "http://localhost:${API_PORT}/payments/<id>"
# Expected: HTTP/1.1 200 OK
#           { "payment":{...}, "attempts":[...] }

#    f. GET /payments/<invalid-id> - 404
curl -i "http://localhost:${API_PORT}/payments/00000000-0000-0000-0000-000000000000"
# Expected: HTTP/1.1 404 Not Found

#    g. POST /payments/:id/retry - manual retry (ganti <id> dengan payment berstatus 'failed')
curl -i -X POST "http://localhost:${API_PORT}/payments/<id>/retry"
# Expected: HTTP/1.1 200 OK bila status='failed'/'scheduled_for_retry'
#           HTTP/1.1 409 Conflict bila status='succeeded'

#    h. GET /health
curl -i "http://localhost:${API_PORT}/health"
# Expected: HTTP/1.1 200 OK
#           { "db":"ok", "gateway":"ok", "timestamp":"2025-..." }

#    i. GET /metrics - Prometheus
curl -i "http://localhost:${API_PORT}/metrics"
# Expected: HTTP/1.1 200 OK
#           Content-Type: text/plain; version=0.0.4; charset=utf-8
#           # HELP http_requests_total ...
#           http_requests_total{route="/metrics"} 1

#    j. GET /docs - Swagger UI HTML
curl -s "http://localhost:${API_PORT}/docs" | head -n 5
# Expected: <!DOCTYPE html><html>... Swagger UI ...

# === Varian explicit (contoh dua-kondisi untuk POST /payments) ===
# KONDISI LOCAL:
#   curl -i -X POST http://localhost:3000/payments \
#     -H 'Content-Type: application/json' \
#     -d '{"orderId":"ORD-TEST-001","amount":150000,"currency":"IDR"}'
# KONDISI SANDBOX:
#   curl -i -X POST http://localhost:3001/payments \
#     -H 'Content-Type: application/json' \
#     -d '{"orderId":"ORD-TEST-001","amount":150000,"currency":"IDR"}'

# === Catatan Caddy (XTransformPort) - HANYA relevan di KONDISI SANDBOX ===
# Di KONDISI SANDBOX, browser client (Next.js preview di port 3000) tidak bisa
# fetch langsung ke payment-api di port 3001 (cross-origin + port tidak exposed
# ke preview panel). Z.ai sandbox menggunakan Caddy gateway yang mem-forward
# request dengan query param ?XTransformPort=NNNN ke port NNNN internal.
# Contoh fetch dari browser di SANDBOX:
#   fetch('/api/payments?XTransformPort=3001')                    # -> payment-api:3001
#   fetch('/admin/config?XTransformPort=3002', { method: 'PUT' })  # -> gateway-mock:3002
# Di KONDISI LOCAL, akses langsung tanpa XTransformPort:
#   fetch('http://localhost:3000/api/payments')                    # -> payment-api:3000
#   fetch('http://localhost:3001/admin/config', { method: 'PUT' }) # -> gateway-mock:3001
# Lihat SANDBOX_NOTES.md section 2.12 untuk detail cross-service fetch.

# 6. Check dev log - pastikan tidak ada unhandled promise rejection
tail -n 100 /home/z/my-project/retry-failure/apps/payment-api/dev.log 2>/dev/null || \
  echo "dev.log path mungkin berbeda - check start:dev script"

# 7. Jest unit tests - sama kedua kondisi (tidak butuh HTTP server)
cd /home/z/my-project/retry-failure && pnpm --filter payment-api test -- \
  test/modules/payments/payments.controller.spec.ts \
  test/modules/health/health.controller.spec.ts
```

## Notes

### NestJS exception handling - semantic mapping

Tabel mapping error -> HTTP status:

| Skenario error | Throw | HTTP Status |
|---|---|---|
| Validation error (DTO `class-validator` fail) | (otomatis oleh `ValidationPipe`) | **400 Bad Request** |
| Payment ID tidak ditemukan di DB | `throw new NotFoundException('Payment X not found')` | **404 Not Found** |
| Manual retry pada status terminal / invalid | `throw new ConflictException('Payment is in state ...')` (setelah catch `InvalidTransitionError` dari service) | **409 Conflict** |
| DB connection error di PaymentsService | (propagate ke default filter) | **500 Internal Server Error** |
| Gateway timeout di PaymentsService | (propagate ke default filter) | **500 Internal Server Error** (bukan 504 - internal failure, bukan gateway-facing API) |
| Unknown error | (propagate ke default filter) | **500 Internal Server Error** |

> Bila ingin 504 untuk gateway timeout di controller level, wrap dengan custom `ExceptionFilter`. **Decision**: tidak dilakukan di task ini - error dari gateway sudah di-handle Cockatiel + service. Bila service melempar error ke controller, itu berarti error sistemik (DB down, deadlock, dst.) -> 500 sesuai.

### CORS allowlist

Origin yang di-allow:

- `http://localhost:5173` -> Vue+PrimeVue dashboard (TASK-13, dev mode).
- `http://localhost:3000` -> Next.js sandbox preview (TASK-12).
- (Opsional) `https://<sandbox-host>` bila ingin expose via Caddy - tambahkan origin di array, atau pakai function:

```ts
app.enableCors({
  origin: (origin, callback) => {
    if (!origin || origin === 'http://localhost:5173' || origin === 'http://localhost:3000') {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  // ...
});
```

> Untuk production bila ingin `credentials: true`, hapus `origin: true` dan set explicit origin list (bukan `*`). Untuk demo task ini, `credentials: false` cukup.

### Swagger DocumentBuilder - server URLs

DocumentBuilder `.addServer()` mendaftarkan server URLs yang muncul di dropdown Swagger UI "Servers":

- `http://localhost:3001` -> local dev default.
- `https://<sandbox-host>/?XTransformPort=3001` -> akses via Caddy dari luar (Next.js sandbox).

User dapat memilih server aktif sebelum klik "Try it out". Bila `XTransformPort` query param dipakai, Swagger perlu konfigurasi tambahan (path-level transformer) - document di TASK-12 bila Next.js sandbox perlu memanggil `/payments?XTransformPort=3001` via relative path.

### Idempotency-Key - client TIDAK mengirim

Plan section 9.1: `Idempotency-Key = payment.id` (UUIDv4 generated internal saat `createPayment()`). Endpoint `POST /payments` TIDAK menerima header `Idempotency-Key` dari client - bila client mengirim header tersebut, di-ignore (tidak ada `@Headers('idempotency-key')` di controller signature).

Implikasi:

- Client TIDAK perlu generate UUID sendiri.
- Client TIDAK bisa melakukan idempotent POST retry (mis. POST 2x dengan orderId sama -> akan membuat 2 row payment dengan orderId unik constraint -> 1 sukses + 1 error 500). **Acceptable untuk demo** - bila client butuh retry, harus GET dulu untuk cek apakah orderId sudah ada (responsibility client). Document di TASK-15 production caveats: idempotent create via `clientRequestId` header -> maps ke orderId lookup.

### Manual retry state guard - detail

`PaymentsService.manualRetry(id)` (TASK-07) hanya menerima payment dengan status:

- `failed` -> reset `attempt_count = 0`, transisi ke `processing`, jalankan `executePayment()`. `total_retry_count` TIDAK direset.
- `scheduled_for_retry` -> transisi ke `processing`, jalankan `executePayment()` (early retry - tidak tunggu `next_retry_at`). `total_retry_count` sudah di-increment saat transisi sebelumnya.

Untuk status lain (`processing`, `succeeded`):

- `processing` -> `assertCanTransition('processing', 'processing')` -> throw `InvalidTransitionError` (self-transition tidak ada di `VALID_TRANSITIONS`). Map ke 409.
- `succeeded` -> `assertCanTransition('succeeded', 'processing')` -> throw (succeeded adalah terminal). Map ke 409.

> **Catatan**: bila `total_retry_count > MAX_TOTAL_RETRIES` saat manual retry, `manualRetry()` akan langsung transisi `processing -> failed` dengan `failureReason='max_total_retries_exceeded'` (di dalam `executePayment()`). Response controller tetap **200 OK** dengan `payment.status='failed'` (retry dijalankan tapi langsung gagal karena limit).

### Why no Idempotency-Key from client - plan reference

Plan section 9.1 menyatakan:

> Invariant dipegang oleh lapisan berikut:
> 1. Gateway mock - in-memory `Map<Idempotency-Key, ChargeResult>`.
> 2. HTTP adapter - selalu mengirim header `Idempotency-Key: <payment.id>`.
> 3. `PaymentsService` - menggunakan `payment.id` yang sama (UUID stabil) sebagai key untuk seluruh attempt dalam satu execution cycle **dan** lintas scheduler cycles **dan** lintas manual retries.

Maka client hanya perlu POST dengan `{ orderId, amount, currency }` - service generate `payment.id` (UUIDv4) sekali, simpan ke DB, dan derive `Idempotency-Key = payment.id` untuk seluruh lifecycle.

### ScheduleModule.forRoot() - preparation TASK-10

`ScheduleModule.forRoot()` dari `@nestjs/schedule` di-import sekarang agar:

1. **Container siap** - TASK-10 hanya perlu declare `RetrySchedulerService` dengan `@Injectable()` + `@Interval(SCHEDULER_INTERVAL_MS)` decorator, tanpa touch `app.module.ts`.
2. **Tidak ada side effect** - `ScheduleModule.forRoot()` sendiri tidak men-trigger apa-apa bila tidak ada method dengan `@Cron` / `@Interval` / `@Timeout`. Safe untuk di-import sebelum TASK-10 implement.

Dependency `@nestjs/schedule` harus ter-install di `apps/payment-api/package.json` - verifikasi dengan `pnpm list @nestjs/schedule` di TASK-01 (atau install bila belum).

### Setelah task ini selesai

- **TASK-10 (scheduler)** dapat dimulai - import `PaymentsModule` di `RetrySchedulerModule`, inject `PaymentsService`, panggil `executePayment(paymentId, { source: 'scheduler' })` di interval poller. Atau alternatif: scheduler HTTP-call `POST /payments/:id/retry` (kurang efficient, tapi decoupled).
- **TASK-11 (observability)** dapat mengganti stub registry di `MetricsModule` dengan registry penuh 7 metrics + integrate ke `PaymentsService` + `GatewayAdapter` + `AuditService` (Counter increments via callback).
- **TASK-12 + TASK-13 (frontends)** dapat fetch data dari `GET /payments` + `GET /payments/:id` dan render. CORS sudah allow origin Vue (5173) + Next.js (3000).
- **TASK-14 (E2E scenarios)** dapat dijalankan via `supertest` melawan `app` (NestJS testing module) - tidak perlu HTTP server jalan. Endpoint contract sudah stabil di task ini.
