# TASK-06 - PaymentGatewayPort + HTTP Adapter + Resilient Adapter

> **Task ID**: 4
> **Depends on**: 2-a (TASK-02 database) + 2-b (TASK-03 gateway mock) + 3 (TASK-05 cockatiel resilience)
> **Estimated effort**: M (~2-3 jam)
> **Plan reference**: Section 2.2 (dependency flow), Section 5 (resilience architecture), Section 6 (Retry-After), Section 9 (Idempotency)

---

## Goal

Mendefinisikan **boundary contract** antara business layer (PaymentsService di TASK-07) dan dependency eksternal (`payment-gateway-mock` di port 3002) melalui interface `PaymentGatewayPort`, lalu menyediakan dua implementasi yang dapat di-swap via NestJS DI:

1. **`HttpPaymentGateway`** - adapter axios (`@nestjs/axios`) yang mengirim `POST /v1/charges` ke gateway mock dengan header `Idempotency-Key: <payment.id>` + `Content-Type: application/json`, menormalisasi axios error maupun response non-2xx menjadi `ChargeResult` (status `succeeded`/`failed`), serta meneruskan `replayed`, `gateway_reference`, `error_code`, `retry_after` dari body/header gateway.
2. **`ResilientPaymentGateway`** - decorator (wrapping adapter) yang membungkus `inner.charge(req)` dengan `executeWithResilience` dari `@retry-failure/resilience` (TASK-05). Outcome Cockatiel (`exhausted`, `breakerTripped`, `result`, `attempts`) dipetakan kembali menjadi `ChargeResult` dengan informasi yang cukup untuk audit & state machine.

Adapter ini juga menyediakan **hook callback `onAttempt`** yang dipanggil setiap attempt (sukses maupun gagal) sehingga TASK-07 (PaymentsService) dan TASK-08 (PrismaAuditService) dapat merekam per-attempt audit trail tanpa mengotori adapter dengan import Prisma.

Setelah task ini selesai, TASK-07 cukup `inject PAYMENT_GATEWAY_PORT` dan memanggil `gateway.charge(req)` - tidak ada import Cockatiel, axios, atau gateway URL di business layer.

## Scope

**In scope**:
- `apps/payment-api/src/modules/gateway/types.ts` - `ChargeRequest`, `ChargeResult`, `PaymentGatewayMode` (informative), `GatewayAttemptContext`.
- `apps/payment-api/src/modules/gateway/port.ts` - `interface PaymentGatewayPort { charge(req: ChargeRequest): Promise<ChargeResult> }` + token `PAYMENT_GATEWAY_PORT`.
- `apps/payment-api/src/modules/gateway/idempotency-key.ts` - `deriveIdempotencyKey(paymentId: string): string`.
- `apps/payment-api/src/modules/gateway/http-adapter.ts` - `HttpPaymentGateway implements PaymentGatewayPort` (provider NestJS, inject `HttpService` dari `@nestjs/axios` + `ConfigService`).
- `apps/payment-api/src/modules/gateway/resilient-adapter.ts` - `ResilientPaymentGateway implements PaymentGatewayPort` (inject `inner: PaymentGatewayPort`, `ResilienceConfig`, `dependencyName`).
- `apps/payment-api/src/modules/gateway/index.ts` - barrel export.
- `apps/payment-api/src/modules/gateway/gateway.module.ts` - NestJS module: providers + export `PAYMENT_GATEWAY_PORT` bound ke instance `ResilientPaymentGateway`.
- Jest unit tests di `apps/payment-api/test/modules/gateway/` (mock `HttpService`).

**Out of scope**:
- Payments service orchestration, state machine, idempotency invariant (`actualCharges <= 1` enforcement) -> TASK-07.
- Audit trail persistence (`payment_attempts` table write) -> TASK-08.
- Metrics emission (pino log + prom-client counter increment) -> TASK-11. Adapter hanya menyediakan hook `onAttempt`; emit dilakukan consumer.
- Durable retry scheduler -> TASK-10.
- Gateway mock itu sendiri -> TASK-03 (sudah selesai, dependency).
- Cockatiel policy composition -> TASK-05 (sudah selesai, dependency).
- Multi-tenant / multi-region gateway selection -> out of scope (single endpoint only).

## Dependency flow (plan section 2.2)

```text
PaymentsService (TASK-07)
      │
      │ inject PAYMENT_GATEWAY_PORT
      ▼
PaymentGatewayPort (interface)
      │
      │ bound to instance by gateway.module.ts
      ▼
ResilientPaymentGateway (decorator)
      │   ├── reads ResilienceConfig (from ConfigService / env)
      │   ├── dependencyName = 'payment-gateway'
      │   └── invokes executeWithResilience()
      │
      ▼
executeWithResilience  ─────► Cockatiel: wrap(breaker, retry, timeout)
(TASK-05)             ─────► Server-directed backoff (Retry-After override)
      │
      │ per-attempt callback (onAttempt)
      ▼
HttpPaymentGateway.charge(req)   ← inner: PaymentGatewayPort
      │   ├── POST {GATEWAY_MOCK_URL}/v1/charges
      │   ├── Header: Idempotency-Key: <deriveIdempotencyKey(paymentId)>
      │   ├── Header: Content-Type: application/json
      │   ├── Body: { amount, currency, order_id }
      │   └── normalizes axios error / non-2xx -> ChargeResult
      │
      ▼
payment-gateway-mock (NestJS app, port 3002)   ← TASK-03
      │   ├── in-memory idempotency store (Map<key, ChargeResult>)
      │   ├── 8 failure modes (runtime-switchable via /admin/config)
      │   └── returns: 200 | 400 | 429 (+Retry-After) | 500 | 503 | drop
```

**Sifat penting**:
- `PaymentsService` **tidak tahu** tentang Cockatiel, axios, atau port 3002. Hanya tahu `PaymentGatewayPort`.
- `HttpPaymentGateway` **tidak tahu** tentang retry/breaker. Hanya tahu HTTP request/response + idempotency header.
- `ResilientPaymentGateway` **tidak tahu** detail HTTP. Hanya tahu bahwa `inner.charge()` dapat throw atau return `ChargeResult`.
- **Server-side only**: `HttpPaymentGateway` memanggil `http://localhost:3002` langsung (bukan via Caddy `?XTransformPort=3002`). Caddy hanya untuk klien browser (Next.js sandbox / Vue dashboard). Lihat Notes.

## Files to create

- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/gateway/types.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/gateway/port.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/gateway/idempotency-key.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/gateway/http-adapter.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/gateway/resilient-adapter.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/gateway/index.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/modules/gateway/gateway.module.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/test/modules/gateway/http-adapter.spec.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/test/modules/gateway/resilient-adapter.spec.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/test/modules/gateway/idempotency-key.spec.ts`

## Implementation steps

### 1. `types.ts`

```ts
/**
 * Request yang dikirim business layer (PaymentsService) ke gateway.
 * `amount` memakai string untuk presisi numerik (PostgreSQL `numeric`, plan section 11).
 * Converter ke string dilakukan di PaymentsService (TASK-07) - tidak di sini.
 */
export interface ChargeRequest {
  paymentId: string;     // UUID payment (di-derive jadi Idempotency-Key)
  orderId: string;       // foreign-key ke order, diteruskan ke gateway body
  amount: string;        // decimal string, e.g. "10000.00"
  currency: string;     // ISO 4217, e.g. "IDR"
}

export type ChargeStatus = 'succeeded' | 'failed';

/**
 * Hasil normalized gateway call. Baik success maupun failure dikembalikan
 * sebagai value (tidak throw) - agar ResilientPaymentGateway / PaymentsService
 * dapat membedakan "gateway error yang retryable" vs "permanent client error"
 * tanpa try/catch berlapis.
 */
export interface ChargeResult {
  status: ChargeStatus;
  httpStatus?: number;             // status code HTTP dari gateway (mis. 200, 400, 429, 500, 503)
  gatewayReference?: string;      // body.gateway_reference - hadir jika status='succeeded'
  replayed: boolean;              // body.replayed === true (gateway sudah pernah capture key ini)
  errorCode?: string;             // body.error_code (mis. 'invalid_card', 'circuit_open', 'rate_limited')
  errorMessage?: string;          // body.message atau err.message
  retryAfterMs?: number;          // header retry-after yang sudah diparse menjadi ms
  attempts?: number;              // jumlah attempt Cockatiel (diisi ResilientPaymentGateway)
}

/**
 * Konteks yang dilewatkan ke callback onAttempt - cukup untuk audit trail
 * PaymentAttempt (TASK-08) tanpa membocorkan internal Cockatiel/axios.
 */
export interface GatewayAttemptContext {
  paymentId: string;
  attemptNumber: number;          // 1-based
  startedAt: Date;
  finishedAt: Date;
  result: ChargeResult;
  breakerState?: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

export type OnAttemptCallback = (ctx: GatewayAttemptContext) => void | Promise<void>;
```

### 2. `port.ts`

```ts
import type { ChargeRequest, ChargeResult, OnAttemptCallback } from './types';

export const PAYMENT_GATEWAY_PORT = Symbol('PAYMENT_GATEWAY_PORT');

export interface PaymentGatewayPort {
  charge(req: ChargeRequest): Promise<ChargeResult>;
}

/**
 * Optional capability - tidak semua adapter memilikinya.
 * ResilientPaymentGateway mengimplementasikan ini.
 */
export interface AttemptObservable {
  setOnAttempt(cb: OnAttemptCallback): void;
}
```

### 3. `idempotency-key.ts`

Per plan section 9: `Idempotency-Key = <payment.id>`. Tidak ada hashing - key stabil sepanjang:
- initial request,
- Cockatiel retry attempts (same execution cycle),
- scheduler retry cycle (durable retry, TASK-10),
- manual retry (`POST /payments/:id/retry`).

```ts
/**
 * Derive Idempotency-Key dari payment ID.
 * Plan section 9: key = payment.id as-is (no hash).
 * Stabil lintas retry attempt + scheduler cycle + manual retry.
 */
export function deriveIdempotencyKey(paymentId: string): string {
  if (!paymentId || paymentId.trim() === '') {
    throw new Error('paymentId is required to derive Idempotency-Key');
  }
  // Returning as-is - tidak ada transformasi. Bila future perlu prefix
  // (mis. 'pay_...'), ubah di sini saja, bukan di konsumen.
  return paymentId;
}
```

### 4. `http-adapter.ts`

```ts
import { Injectable, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { AxiosError, AxiosResponse } from 'axios';
import { PaymentGatewayPort } from './port';
import { ChargeRequest, ChargeResult } from './types';
import { deriveIdempotencyKey } from './idempotency-key';

@Injectable()
export class HttpPaymentGateway implements PaymentGatewayPort {
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpService,
    configService: ConfigService,
  ) {
    // GATEWAY_MOCK_URL di-set di apps/payment-api/src/config/ (TASK-01).
    // Default 'http://localhost:3002' - server-to-server, bypass Caddy.
    this.baseUrl = configService.get<string>('GATEWAY_MOCK_URL', 'http://localhost:3002');
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const idempotencyKey = deriveIdempotencyKey(req.paymentId);
    const url = `${this.baseUrl}/v1/charges`;

    try {
      const response: AxiosResponse = await firstValueFrom(
        this.http.post(
          url,
          {
            amount: req.amount,
            currency: req.currency,
            order_id: req.orderId,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': idempotencyKey,
              // 'User-Agent': 'payment-api/1.0',  // optional, untuk audit gateway
            },
            // timeout axios sengaja TIDAK di-set di sini - Cockatiel `timeout`
            // policy (TASK-05) yang membatasi per-attempt via AbortController
            // atau signal cancellation. Bila axios dipakai tanpa Cockatiel
            // (mis. di test), set `timeout: 5000` di sini.
          },
        ),
      );

      return this.mapSuccess(response, idempotencyKey);
    } catch (err) {
      return this.mapError(err as AxiosError);
    }
  }

  private mapSuccess(response: AxiosResponse, _idempotencyKey: string): ChargeResult {
    const status = response.status;
    const body = (response.data ?? {}) as Record<string, unknown>;

    // Gateway mock mengembalikan 200 untuk success (fresh atau replay).
    // Body: { gateway_reference: string, replayed: boolean } | { status, gateway_reference, replayed }
    if (status >= 200 && status < 300) {
      return {
        status: 'succeeded',
        httpStatus: status,
        gatewayReference: typeof body.gateway_reference === 'string' ? body.gateway_reference : undefined,
        replayed: body.replayed === true,
      };
    }

    // Non-2xx yang tidak melempar axios error (jarang, tapi terjadi bila
    // validateStatus default di-override). Treat sebagai failure.
    return {
      status: 'failed',
      httpStatus: status,
      replayed: false,
      errorCode: typeof body.error_code === 'string' ? body.error_code : undefined,
      errorMessage: typeof body.message === 'string' ? body.message : `unexpected status ${status}`,
      retryAfterMs: parseRetryAfterHeader(response.headers?.['retry-after']),
    };
  }

  private mapError(err: AxiosError): ChargeResult {
    // 1. Axios error dengan response (4xx, 5xx)
    if (err.response) {
      const status = err.response.status;
      const body = (err.response.data ?? {}) as Record<string, unknown>;
      return {
        status: 'failed',
        httpStatus: status,
        replayed: body.replayed === true,
        errorCode: typeof body.error_code === 'string' ? body.error_code : undefined,
        errorMessage: typeof body.message === 'string' ? body.message : err.message,
        retryAfterMs: parseRetryAfterHeader(err.response.headers?.['retry-after']),
      };
    }

    // 2. Network error tanpa response (timeout, ECONNREFUSED, ECONNRESET, ETIMEDOUT)
    //    err.code: 'ECONNABORTED' | 'ETIMEDOUT' | 'ECONNREFUSED' | 'ECONNRESET' | 'ENOTFOUND'
    return {
      status: 'failed',
      replayed: false,
      errorCode: err.code ?? 'network_error',
      errorMessage: err.message,
      // Tidak ada Retry-After untuk network error - fallback ke exponential backoff Cockatiel.
    };
  }
}

/**
 * Parse header `Retry-After` (delta-seconds atau HTTP-date) menjadi ms.
 * Delegasikan ke helper yang sudah diuji di TASK-04 (parseRetryAfter).
 */
import { parseRetryAfter } from '@retry-failure/resilience';
function parseRetryAfterHeader(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const ms = parseRetryAfter(String(value));
  return ms ?? undefined;
}
```

> **Catatan axios error shape**: axios v1 melempar `AxiosError` dengan properti `response`, `request`, `code`, `message`, `config`. Cek `err.response` dulu (HTTP non-2xx). Bila tidak ada response (network/timeout), `err.code` menjadi penanda (`ETIMEDOUT`, `ECONNREFUSED`, dst). Adapter **tidak** meng-throw - semua error di-mapped ke `ChargeResult` agar consumer dapat menentukan retryable/permanent via `errorCode`/`httpStatus`.

### 5. `resilient-adapter.ts`

```ts
import { Injectable, Inject, Optional } from '@nestjs/common';
import {
  executeWithResilience,
  type ResilienceConfig,
  type ResilienceOutcome,
} from '@retry-failure/resilience';
import { PaymentGatewayPort, AttemptObservable } from './port';
import { ChargeRequest, ChargeResult, OnAttemptCallback, GatewayAttemptContext } from './types';

export interface ResilientPaymentGatewayOptions {
  inner: PaymentGatewayPort;
  resilienceConfig: ResilienceConfig;
  dependencyName?: string; // default 'payment-gateway'
}

@Injectable()
export class ResilientPaymentGateway implements PaymentGatewayPort, AttemptObservable {
  private readonly inner: PaymentGatewayPort;
  private readonly resilienceConfig: ResilienceConfig;
  private readonly dependencyName: string;
  private onAttempt?: OnAttemptCallback;

  constructor(opts: ResilientPaymentGatewayOptions) {
    this.inner = opts.inner;
    this.resilienceConfig = opts.resilienceConfig;
    this.dependencyName = opts.dependencyName ?? 'payment-gateway';
  }

  /** Dipanggil oleh TASK-07 (PaymentsService) untuk merekam audit per-attempt ke TASK-08. */
  setOnAttempt(cb: OnAttemptCallback): void {
    this.onAttempt = cb;
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    let attemptNumber = 0;

    const outcome: ResilienceOutcome<ChargeResult> = await executeWithResilience<ChargeResult>({
      dependencyName: this.dependencyName,
      config: this.resilienceConfig,
      fn: async () => {
        attemptNumber += 1;
        const startedAt = new Date();
        const innerResult = await this.inner.charge(req);
        const finishedAt = new Date();

        // Per-attempt callback (sukses maupun failed ChargeResult).
        // Penting: ChargeResult.status='failed' TIDAK otomatis berarti throw -
        // adapter mengembalikan failed sebagai value. Untuk memicu retry Cockatiel,
        // adapter ini harus me-throw bila result.status==='failed' DAN retryable.
        if (this.onAttempt) {
          await this.onAttempt({
            paymentId: req.paymentId,
            attemptNumber,
            startedAt,
            finishedAt,
            result: innerResult,
            breakerState: outcome?.breakerState, // diinject oleh composition layer jika tersedia
          } as GatewayAttemptContext);
        }

        // Penting: bila ChargeResult.status='failed', lempar sebagai exception
        // agar retry policy Cockatiel dapat menangkap dan mengulang. Bila
        // permanent (mis. errorCode='invalid_card', httpStatus=400), tetap
        // lempar - klasifikasi retryable/permanent dilakukan oleh retry handler
        // (handleAll vs handleWhen - lihat Notes).
        if (innerResult.status === 'failed') {
          throw new GatewayChargeError(innerResult);
        }

        return innerResult;
      },
    });

    return this.mapOutcome(outcome);
  }

  private mapOutcome(outcome: ResilienceOutcome<ChargeResult>): ChargeResult {
    // 1. Success path - Cockatiel mendapat result dari inner.charge
    if (outcome.result) {
      return {
        ...outcome.result,
        attempts: outcome.attempts,
      };
    }

    // 2. Breaker tripped - cepat gagal tanpa menyentuh inner
    if (outcome.breakerTripped) {
      return {
        status: 'failed',
        replayed: false,
        errorCode: 'circuit_open',
        errorMessage: 'circuit breaker open - fast-fail without calling gateway',
        attempts: outcome.attempts,
      };
    }

    // 3. Retry exhausted - inner terus gagal sampai maxAttempts, error terakhir di `outcome.error`
    const lastError = outcome.error;
    let innerResult: ChargeResult | undefined;
    if (lastError instanceof GatewayChargeError) {
      innerResult = lastError.result;
    }

    return {
      status: 'failed',
      httpStatus: innerResult?.httpStatus,
      replayed: innerResult?.replayed ?? false,
      errorCode: innerResult?.errorCode ?? 'retry_exhausted',
      errorMessage: innerResult?.errorMessage ?? 'retry exhausted',
      retryAfterMs: innerResult?.retryAfterMs,
      attempts: outcome.attempts,
    };
  }
}

/**
 * Internal exception untuk membungkus ChargeResult failed agar dapat ditangkap
 * retry policy Cockatiel. Property `result` dipakai untuk audit & extraction
 * Retry-After oleh `ServerDirectedOrExponentialBackoff` (TASK-05).
 */
export class GatewayChargeError extends Error {
  constructor(public readonly result: ChargeResult) {
    super(result.errorMessage ?? 'gateway charge failed');
    this.name = 'GatewayChargeError';
    // Tandai agar composition layer dapat ekstrak retryAfterMs (lihat TASK-05
    // `extractRetryAfterMs(event)`).
    (this as unknown as { retryAfterMs?: number }).retryAfterMs = result.retryAfterMs;
  }
}
```

### 6. `index.ts`

```ts
export * from './types';
export * from './port';
export * from './idempotency-key';
export * from './http-adapter';
export * from './resilient-adapter';
export * from './gateway.module';
```

### 7. `gateway.module.ts`

```ts
import { Module } from '@nestjs/common';
import { HttpModule, HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { HttpPaymentGateway } from './http-adapter';
import {
  ResilientPaymentGateway,
  type ResilientPaymentGatewayOptions,
} from './resilient-adapter';
import { PAYMENT_GATEWAY_PORT, type PaymentGatewayPort } from './port';
import { DEFAULT_RESILIENCE_CONFIG, type ResilienceConfig } from '@retry-failure/resilience';

@Module({
  imports: [HttpModule],
  providers: [
    // 1. Concrete HTTP adapter - internal to this module.
    {
      provide: HttpPaymentGateway,
      inject: [HttpService, ConfigService],
      useFactory: (http: HttpService, config: ConfigService) =>
        new HttpPaymentGateway(http, config),
    },
    // 2. Resilient decorator - wraps HttpPaymentGateway.
    {
      provide: ResilientPaymentGateway,
      inject: [HttpPaymentGateway, ConfigService],
      useFactory: (
        inner: PaymentGatewayPort,
        config: ConfigService,
      ): ResilientPaymentGateway => {
        const resilienceConfig: ResilienceConfig = {
          ...DEFAULT_RESILIENCE_CONFIG,
          retryMaxAttempts: config.get<number>('RETRY_MAX_ATTEMPTS', DEFAULT_RESILIENCE_CONFIG.retryMaxAttempts),
          retryBaseDelayMs: config.get<number>('RETRY_BASE_DELAY_MS', DEFAULT_RESILIENCE_CONFIG.retryBaseDelayMs),
          retryMaxDelayMs: config.get<number>('RETRY_MAX_DELAY_MS', DEFAULT_RESILIENCE_CONFIG.retryMaxDelayMs),
          retryJitterRatio: config.get<number>('RETRY_JITTER_RATIO', DEFAULT_RESILIENCE_CONFIG.retryJitterRatio),
          gatewayTimeoutMs: config.get<number>('GATEWAY_TIMEOUT_MS', DEFAULT_RESILIENCE_CONFIG.gatewayTimeoutMs),
          breakerFailureThreshold: config.get<number>('BREAKER_FAILURE_THRESHOLD', DEFAULT_RESILIENCE_CONFIG.breakerFailureThreshold),
          breakerCooldownMs: config.get<number>('BREAKER_COOLDOWN_MS', DEFAULT_RESILIENCE_CONFIG.breakerCooldownMs),
        };
        const opts: ResilientPaymentGatewayOptions = {
          inner,
          resilienceConfig,
          dependencyName: 'payment-gateway',
        };
        return new ResilientPaymentGateway(opts);
      },
    },
    // 3. Public token - what consumers inject. Bound to ResilientPaymentGateway instance.
    {
      provide: PAYMENT_GATEWAY_PORT,
      useExisting: ResilientPaymentGateway,
    },
  ],
  exports: [PAYMENT_GATEWAY_PORT],
})
export class GatewayModule {}
```

### 8. Per-attempt callback contract (untuk TASK-07 & TASK-08)

`ResilientPaymentGateway` mengekspos `setOnAttempt(cb: OnAttemptCallback)`. Contract:

| Aspek | Spesifikasi |
|---|---|
| **Pemanggil** | `PaymentsService` (TASK-07) - `gateway.setOnAttempt(this.recordAttempt.bind(this))` di `onModuleInit()`. |
| **Frekuensi** | Dipanggil **tepat sekali per Cockatiel attempt** - baik sukses (status `succeeded`) maupun gagal (status `failed` sebelum throw `GatewayChargeError`). |
| **Async** | Callback dapat return `Promise<void>` - adapter `await` callback sebelum throw ke retry policy. Sinkron OK. |
| **Payload** | `GatewayAttemptContext { paymentId, attemptNumber, startedAt, finishedAt, result, breakerState? }`. |
| **Idempotensi** | Callback TIDAK menjamin exactly-once - bila scheduler (TASK-10) memulai cycle baru untuk payment yang sama, callback dipanggil lagi untuk attempt di cycle tersebut. Audit trail (`payment_attempts` rows) harus dapat menampung ini (1 row per attempt). |
| **Error di callback** | Bila callback throw, exception propagate ke retry policy -> dihitung sebagai attempt failure. Hindari - wrap di try/catch di consumer. |
| **Wiring ke audit** | TASK-07 memakai `ctx.attemptNumber`, `ctx.result.httpStatus`, `ctx.result.errorCode`, `ctx.result.retryAfterMs`, `ctx.result.replayed` untuk menulis `payment_attempts` row via PrismaAuditService (TASK-08). |

### 9. Jest tests

#### `http-adapter.spec.ts`
- `charge()` mengirim POST ke `${baseUrl}/v1/charges` dengan header `Idempotency-Key` = `paymentId` + `Content-Type: application/json`. Verifikasi via mock `HttpService.axiosInstance.post = jest.fn().mockResolvedValue({ status: 200, data: { gateway_reference: 'gw_123', replayed: false } })`.
- 2xx + body `{ gateway_reference, replayed: false }` -> `ChargeResult.status='succeeded'`, `gatewayReference` set, `replayed=false`.
- 2xx + body `{ replayed: true }` -> `replayed=true`.
- 400 `{ error_code: 'invalid_card', message: 'Card number invalid' }` -> `status='failed'`, `httpStatus=400`, `errorCode='invalid_card'`, `errorMessage='Card number invalid'`, `retryAfterMs` undefined.
- 429 + header `Retry-After: 10` -> `status='failed'`, `httpStatus=429`, `retryAfterMs=10000`.
- 500 (no Retry-After) -> `status='failed'`, `httpStatus=500`, `retryAfterMs` undefined.
- Network error (`ECONNREFUSED`, no response) -> `status='failed'`, `errorCode='ECONNREFUSED'`, `errorMessage=err.message`, `httpStatus` undefined.
- `paymentId` kosong -> throw Error('paymentId is required…').

#### `resilient-adapter.spec.ts`
- `charge()` dengan inner mock yang gagal 2x lalu sukses (RETRY_MAX_ATTEMPTS=3) -> result.status='succeeded', attempts=3, onAttempt dipanggil 3 kali dengan attemptNumber=1,2,3.
- `charge()` dengan inner selalu gagal (status='failed', errorCode='server_error') -> result.status='failed', errorCode='server_error' (last attempt), attempts=RETRY_MAX_ATTEMPTS, onAttempt dipanggil 3 kali.
- `charge()` dengan inner mengembalikan `status='failed', errorCode='invalid_card', httpStatus=400` (permanent) -> result.status='failed', errorCode='invalid_card'. Catatan: dengan `handleAll`, Cockatiel tetap me-retry - ini trade-off yang di-dokument-kan. Test assertion: attempts === maxAttempts (bukan 1). Bila pakai `handleWhen` filter, attempts=1.
- Breaker trip: inner selalu gagal dengan `BREAKER_FAILURE_THRESHOLD=2`, panggil 3x. Call ke-3: `errorCode='circuit_open'`, attempts=0 atau 1, onAttempt tidak dipanggil (breaker fast-fail).
- `onAttempt` dipanggil dengan `ctx.result.replayed=true` bila inner mengembalikan replayed (mensimulasikan scenario succeed-but-drop-response).

#### `idempotency-key.spec.ts`
- `deriveIdempotencyKey('pay_123')` -> `'pay_123'` (identity).
- `deriveIdempotencyKey('')` -> throw.
- `deriveIdempotencyKey(undefined as any)` -> throw.

## Acceptance criteria

- [ ] `types.ts` mengekspor `ChargeRequest`, `ChargeResult`, `ChargeStatus`, `GatewayAttemptContext`, `OnAttemptCallback`.
- [ ] `port.ts` mengekspor `PaymentGatewayPort`, `PAYMENT_GATEWAY_PORT` token, `AttemptObservable`.
- [ ] `idempotency-key.ts` mengekspor `deriveIdempotencyKey` - returns paymentId as-is, throw bila empty.
- [ ] `HttpPaymentGateway.charge()` mengirim `POST {GATEWAY_MOCK_URL}/v1/charges` dengan header `Idempotency-Key: <paymentId>` + `Content-Type: application/json`, body `{ amount, currency, order_id }`.
- [ ] Mode `always-success` -> `ChargeResult.status='succeeded'`, `gatewayReference` ter-set, `replayed=false`.
- [ ] Mode `fail-first-n=2` + `RETRY_MAX_ATTEMPTS=3` -> `status='succeeded'` setelah 3 attempts (`attempts=3`), call ke-3 mengembalikan fresh success (`replayed=false`).
- [ ] Mode `client-error` -> `status='failed'`, `httpStatus=400`, `errorCode='invalid_card'`, `attempts=1` (bila pakai `handleWhen` filter) atau `attempts=maxAttempts` (bila `handleAll` - trade-off di-dokument-kan di Notes).
- [ ] Mode `rate-limited` + `Retry-After: 2` -> `status='failed'`, `httpStatus=429`, `retryAfterMs=2000`.
- [ ] Mode `succeed-but-drop-response` + retry -> attempt ke-2 `replayed=true` (gateway sudah capture di attempt pertama yang drop response).
- [ ] Mode `always-timeout` + threshold rendah (`BREAKER_FAILURE_THRESHOLD=3`, `RETRY_MAX_ATTEMPTS=1`) -> setelah 3 cycle gagal, call ke-4 `errorCode='circuit_open'`, `attempts` minimal 0 (breaker fast-fail, inner tidak dipanggil).
- [ ] `ResilientPaymentGateway.setOnAttempt(cb)` -> callback dipanggil sekali per attempt dengan `GatewayAttemptContext` lengkap (`paymentId`, `attemptNumber`, `startedAt`, `finishedAt`, `result`).
- [ ] `GatewayModule` meng-export `PAYMENT_GATEWAY_PORT` yang bound ke instance `ResilientPaymentGateway` (bukan `HttpPaymentGateway` langsung).
- [ ] Tidak ada import `cockatiel`, `axios`, atau `@nestjs/axios` di `resilient-adapter.ts` - semua via `@retry-failure/resilience` + `inner`.
- [ ] Tidak ada import `@prisma/client` / TypeORM di seluruh `modules/gateway/` - adapter tetap framework-agnostic terhadap persistence.
- [ ] `pnpm --filter payment-api typecheck` lulus.
- [ ] `pnpm --filter payment-api lint` lulus.
- [ ] `pnpm --filter payment-api test` (Jest) lulus untuk `http-adapter.spec.ts`, `resilient-adapter.spec.ts`, `idempotency-key.spec.ts`.

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

### 1. Start gateway mock (TASK-03 dependency)

```bash
# KONDISI LOCAL (port 3000 bebas; gateway-mock default 3001):
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock
PORT=3001 pnpm start:dev > /tmp/gateway-mock.log 2>&1 &
sleep 5
tail -n 20 /tmp/gateway-mock.log
# Expected: "payment-gateway-mock listening on :3001"

# KONDISI SANDBOX (port 3000 dipakai Next.js preview -> payment-api geser ke 3001; gateway-mock geser ke 3002):
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock
PORT=3002 pnpm start:dev > /tmp/gateway-mock.log 2>&1 &
sleep 5
tail -n 20 /tmp/gateway-mock.log
# Expected: "payment-gateway-mock listening on :3002"
```

> Variabel lingkungan konvensi: `GW_PORT="${GW_PORT:-3001}"` default LOCAL, set `GW_PORT=3002` untuk SANDBOX. Command curl / ts-node smoke di bawah pakai pola env var supaya tidak duplikat.

### 2. Typecheck & lint

```bash
cd /home/z/my-project/retry-failure
pnpm --filter payment-api typecheck
pnpm --filter payment-api lint
pnpm --filter payment-api test
```

### 3. Quick E2E smoke test via ts-node (gateway mock harus sudah jalan - port kondisional sesuai Pre-flight)

Simpan sebagai `/tmp/smoke-gateway-adapter.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { HttpModule, HttpService } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { HttpPaymentGateway } from '../../apps/payment-api/src/modules/gateway/http-adapter';
import { ResilientPaymentGateway } from '../../apps/payment-api/src/modules/gateway/resilient-adapter';
import { DEFAULT_RESILIENCE_CONFIG } from '@retry-failure/resilience';
import type { ChargeResult } from '../../apps/payment-api/src/modules/gateway/types';

// Baca gateway URL dari env. Default LOCAL (port 3001); untuk SANDBOX set GW_PORT=3002
// sebelum invoke ts-node (lihat command block di bawah script ini).
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';

@Module({
  imports: [HttpModule, ConfigModule.forRoot()],
  providers: [HttpPaymentGateway],
})
class SmokeModule {}

async function smoke(mode: string, expectedDescription: string): Promise<void> {
  const app = await NestFactory.create(SmokeModule);
  const http = app.get(HttpService);
  const config = app.get(ConfigService);
  // Set gateway mode via /admin/config
  await http.put(`${GATEWAY_URL}/admin/config`, { mode }).toPromise();

  const inner = new HttpPaymentGateway(http, config);
  const resilient = new ResilientPaymentGateway({
    inner,
    resilienceConfig: { ...DEFAULT_RESILIENCE_CONFIG, retryMaxAttempts: 3, retryBaseDelayMs: 100, retryMaxDelayMs: 500 },
  });

  resilient.setOnAttempt((ctx) =>
    console.log(`  attempt#${ctx.attemptNumber} status=${ctx.result.status} http=${ctx.result.httpStatus} replayed=${ctx.result.replayed} errorCode=${ctx.result.errorCode}`),
  );

  const result: ChargeResult = await resilient.charge({
    paymentId: `smoke-${mode}-${Date.now()}`,
    orderId: 'order-1',
    amount: '10000.00',
    currency: 'IDR',
  });
  console.log(`MODE=${mode} | ${expectedDescription}`);
  console.log(`  FINAL: status=${result.status} http=${result.httpStatus} replayed=${result.replayed} errorCode=${result.errorCode} attempts=${result.attempts} retryAfterMs=${result.retryAfterMs}`);
  await app.close();
}

(async () => {
  await smoke('always-success', 'should succeed on attempt 1');
  await smoke('fail-first-n', 'mode n=2 - should succeed after 3 attempts (2 failures + 1 success)');
  await smoke('client-error', 'should fail with invalid_card - permanent');
  await smoke('rate-limited', 'should fail with retryAfterMs set from Retry-After header');
  // Reset ke always-success di akhir
  await NestFactory.create(SmokeModule).then(async (app) => {
    await app.get(HttpService).put(`${GATEWAY_URL}/admin/config`, { mode: 'always-success' }).toPromise();
    await app.close();
  });
  console.log('Gateway reset to always-success.');
})();
```

Jalankan:

```bash
cd /home/z/my-project/retry-failure

# KONDISI LOCAL (gateway-mock di port 3001):
GATEWAY_URL=http://localhost:3001 pnpm --filter payment-api exec ts-node /tmp/smoke-gateway-adapter.ts

# KONDISI SANDBOX (gateway-mock di port 3002):
GATEWAY_URL=http://localhost:3002 pnpm --filter payment-api exec ts-node /tmp/smoke-gateway-adapter.ts

# Atau pakai pola env var GW_PORT (default 3001 LOCAL, override 3002 SANDBOX):
GW_PORT="${GW_PORT:-3001}" GATEWAY_URL="http://localhost:${GW_PORT}" \
  pnpm --filter payment-api exec ts-node /tmp/smoke-gateway-adapter.ts
```

### 4. Quick curl-based verification (langsung ke gateway, tanpa adapter)

Pola env var: `GW_PORT="${GW_PORT:-3001}"` default LOCAL; set `GW_PORT=3002` untuk SANDBOX.

```bash
# === Varien explicit (pilih satu) ===

# KONDISI LOCAL (gateway-mock port 3001):
curl -s -X PUT http://localhost:3001/admin/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"always-success"}' | jq .

# KONDISI SANDBOX (gateway-mock port 3002):
curl -s -X PUT http://localhost:3002/admin/config \
  -H 'Content-Type: application/json' \
  -d '{"mode":"always-success"}' | jq .

# === Pola env var (rekomendasi - kurangi duplikasi) ===
# Set GW_PORT sekali di sesi shell, command berikut pakai variabel tsb.
# KONDISI LOCAL: export GW_PORT=3001
# KONDISI SANDBOX: export GW_PORT=3002
GW_PORT="${GW_PORT:-3001}"

# Reset mode ke always-success
curl -s -X PUT "http://localhost:${GW_PORT}/admin/config" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"always-success"}' | jq .

# Manual charge - verifikasi endpoint gateway mock hidup
curl -s -X POST "http://localhost:${GW_PORT}/v1/charges" \
  -H 'Idempotency-Key: manual-test-1' \
  -H 'Content-Type: application/json' \
  -d '{"amount":"10000.00","currency":"IDR","order_id":"order-1"}' | jq .

# Rate-limited mode
curl -s -X PUT "http://localhost:${GW_PORT}/admin/config" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"rate-limited","retryAfterSeconds":2}' | jq .
curl -i -X POST "http://localhost:${GW_PORT}/v1/charges" \
  -H 'Idempotency-Key: manual-test-2' \
  -H 'Content-Type: application/json' \
  -d '{"amount":"10000.00","currency":"IDR","order_id":"order-2"}'

# Reset ulang
curl -s -X PUT "http://localhost:${GW_PORT}/admin/config" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"always-success"}' | jq .
```

### 5. Reset gateway mode ke always-success di akhir (selalu)

```bash
GW_PORT="${GW_PORT:-3001}"  # 3001 LOCAL, 3002 SANDBOX

curl -s -X PUT "http://localhost:${GW_PORT}/admin/config" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"always-success","n":0,"probability":0.5,"retryAfterSeconds":10,"timeoutMs":5000}' | jq .

# Cleanup gateway mock process
pkill -f "nest start" 2>/dev/null
```

## Notes

- **Server-side only (bukan via Caddy)**: `HttpPaymentGateway` memanggil `http://localhost:3002` langsung. Caddy (`?XTransformPort=3002`) hanya untuk klien browser - Next.js sandbox (TASK-12) dan Vue dashboard (TASK-13). Backend NestJS punya akses langsung ke port 3002 di localhost; tidak perlu transform. Konfigurasi `GATEWAY_MOCK_URL` default `'http://localhost:3002'`, dapat di-override via env.

- **`GATEWAY_MOCK_URL` dari config**: dibaca via `ConfigService.get<string>('GATEWAY_MOCK_URL')`. Schema validation Joi / zod di TASK-01. Jangan hardcode URL di `HttpPaymentGateway` - selalu via `ConfigService`.

- **Axios error normalization**: axios v1 melempar `AxiosError` dengan struktur:
  - `err.response` - hadir bila server merespons non-2xx (`response.status`, `response.data`, `response.headers`).
  - `err.request` - hadir bila request terkirim tapi tidak ada response (timeout, connection reset).
  - `err.code` - string kode network error: `ECONNABORTED` (axios timeout), `ETIMEDOUT`, `ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND`.
  - `err.message` - human-readable.
  Adapter meng-mapped ketiga kasus ke `ChargeResult` dengan `errorCode` + `errorMessage` yang konsisten. Lihat tabel di bawah.

  | Kasus | `httpStatus` | `errorCode` | `errorMessage` | `retryAfterMs` |
  |---|---|---|---|---|
  | 2xx success | 200 | undefined | undefined | undefined |
  | 400 `invalid_card` | 400 | `invalid_card` | body.message | undefined |
  | 429 + Retry-After | 429 | undefined atau dari body | body.message | parsed ms |
  | 500 (no Retry-After) | 500 | undefined atau dari body | body.message | undefined |
  | Network error (no response) | undefined | `err.code` (mis. ECONNREFUSED) | `err.message` | undefined |

- **`Idempotency-Key = payment.id` (no hash)**: plan section 9 menyebut key = `payment.id` as-is. Tidak ada transformasi (no hash, no prefix). Bila future perlu prefix (mis. `pay_`), ubah hanya di `deriveIdempotencyKey()` - bukan di konsumen. Gateway mock menyimpan by key; replay detection passthrough (adapter hanya meneruskan `body.replayed` dari gateway).

- **Replay detection passthrough**: adapter **tidak** mempertahankan state idempotency lokal. State ada di gateway mock (in-memory `Map<key, ChargeResult>` di TASK-03). Adapter hanya:
  - mengirim `Idempotency-Key` header,
  - membaca `body.replayed` dari response,
  - meneruskan ke `ChargeResult.replayed`.
  Ini menjaga invariant plan section 9.1 (`actualCharges <= 1`) - gateway yang menjadi sumber kebenaran, bukan adapter.

- **`onAttempt` callback contract untuk TASK-07 / TASK-08**: adapter memanggil callback **sekali per Cockatiel attempt** (sukses maupun gagal sebelum throw). Implementasi consumer (PaymentsService) di TASK-07:
  ```ts
  // di PaymentsService.onModuleInit()
  this.gateway.setOnAttempt(async (ctx) => {
    await this.audit.recordAttempt({
      paymentId: ctx.paymentId,
      attemptNumber: ctx.attemptNumber,
      httpStatus: ctx.result.httpStatus,
      errorCode: ctx.result.errorCode,
      errorMessage: ctx.result.errorMessage,
      replayed: ctx.result.replayed,
      retryAfterMs: ctx.result.retryAfterMs,
      startedAt: ctx.startedAt,
      finishedAt: ctx.finishedAt,
    });
  });
  ```
  PrismaAuditService (TASK-08) menulis row ke `payment_attempts`. Satu attempt = satu row. Idempotency row-level tidak diperlukan (row ID di-generate).

- **`handleAll` vs `handleWhen` trade-off**: TASK-05 memakai `handleAll` (menangkap semua exception). Implikasinya untuk adapter ini:
  - **Permanent error (4xx non-429)** tetap di-retry sampai `maxAttempts` - tidak efficient tapi tidak salah (state machine di TASK-07 akan detect non-retryable dari `errorCode`/`httpStatus` dan tidak menjadwalkan durable retry).
  - Bila ingin permanent error **tidak** di-retry sama sekali (idiomatic Cockatiel), TASK-05 dapat beralih ke `handleWhen` dengan predicate yang memeriksa `error.permanent === true`. Untuk itu, `GatewayChargeError` dapat set `error.permanent = true` bila `result.errorCode === 'invalid_card'` atau `result.httpStatus` di range 400-499 (selain 429, 408). **Decision untuk TASK-06**: scaffold `GatewayChargeError` dengan property `permanent: boolean` (default false, set true berdasarkan classifier TASK-04), tetapi **tidak** mengubah `handleAll` di TASK-05. Bila perlu, TASK-05 follow-up mengganti `handleAll` -> `handleWhen`.

- **AsyncLocalStorage trace context**: trace_id (`AsyncLocalStorage`) tidak di-handle di adapter - itu concern TASK-11. Adapter hanya memanggil `inner.charge(req)`; trace_id otomatis ter-propagate via async context bila PaymentsService sudah set di request scope.

- **Axios timeout vs Cockatiel timeout**: jangan set `timeout` di axios config (biarkan undefined). Cockatiel `timeout` policy (TASK-05, `GATEWAY_TIMEOUT_MS=2000`) yang membatasi per-attempt. Bila adapter dipakai tanpa Cockatiel (mis. di test unit dengan mock `HttpService`), set `timeout: 5000` di axios config agar tidak hang. Saat di-production dengan ResilientPaymentGateway, abaikan - biarkan Cockatiel handle.

- **Per-attempt context `breakerState`**: di snippet `resilient-adapter.ts`, `ctx.breakerState` diambil dari `outcome.breakerState` - tapi `outcome` belum tersedia saat callback pertama kali di-invoke (callback terjadi di dalam `fn` Cockatiel, sementara `outcome` baru di-set setelah `executeWithResilience` resolve). Implementasi actual: adapter memeriksa `getBreakerState(this.dependencyName)` langsung dari `@retry-failure/resilience` breaker-store. Ini sync lookup, cheap, dan akurat saat attempt dijalankan. Pastikan import `getBreakerState` di resilient-adapter.

- **Setelah task ini selesai**: TASK-07 (PaymentsService) dapat:
  ```ts
  constructor(@Inject(PAYMENT_GATEWAY_PORT) private gateway: PaymentGatewayPort) {}
  // gateway instanceof ResilientPaymentGateway (via DI binding)
  // bila perlu onAttempt:
  (this.gateway as unknown as AttemptObservable).setOnAttempt(this.recordAttempt.bind(this));
  ```
  Tidak ada perubahan API breaking yang diharapkan di TASK-06 saat TASK-07/08/11 berjalan.
