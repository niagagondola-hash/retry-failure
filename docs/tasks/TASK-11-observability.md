# TASK-11 — Observability: nestjs-pino + prom-client + OpenTelemetry

> **Task ID**: 8
> **Depends on**: 3 (TASK-05 Cockatiel resilience — `executeWithResilience` + `onFailure` / `onBreak` / `onReset` hooks), 5 (TASK-07 payments service — `PaymentsService.executePayment` lifecycle + `crypto.randomUUID()` traceId placeholder)
> **Estimated effort**: M (~3-4 jam)
> **Plan reference**: Section 13 (Observability — 13.1 Logging, 13.2 Metrics, 13.3 Tracing) + Section 22 (Definition of Done)

---

## Goal

Mengimplementasikan tiga pilar observability yang dibutuhkan plan section 13 + 22:

1. **Structured JSON logging** via `nestjs-pino` + `pino` (dan `pino-pretty` untuk dev) — log event payment lifecycle (start/finish, attempt, retry scheduled, breaker state change, scheduler poll, idempotency replay, gateway failure mode) selalu membawa field `traceId`.
2. **Prometheus metrics** via `prom-client` (default `Registry` singleton) — 7 metric persis sesuai plan section 13.2 (Counter / Gauge / Histogram) dengan label **low-cardinality only** (TIDAK ada `payment_id`, `order_id`, `trace_id`, atau raw `error_message` sebagai label).
3. **Trace context via `AsyncLocalStorage`** — `withTrace()` / `getTraceId()` / `getTraceContext()` membawa satu `traceId` lintas async boundary (Cockatiel internal `await`, axios, TypeORM query, scheduler callback). `traceId` di-persist ke `payment_attempts.trace_id` (kolom sudah dibuat di TASK-02, sudah diisi oleh `AuditService` di TASK-08 via `input.traceId`) — di task ini sumber `traceId` dialihkan dari `crypto.randomUUID()` ad-hoc menjadi trace context dari `AsyncLocalStorage`, sehingga `PaymentsService`, `AuditService`, controller log, dan gateway log semua berbagi `traceId` yang sama dalam satu execution cycle.

Wire pilar-pilar tersebut ke **semua layer** yang sudah ada: gateway HTTP adapter, ResilientPaymentGateway (retry + breaker hooks), `PaymentsService` (lifecycle logs + `payments_current_status` gauge delta), `AuditService` (fallback read `traceId` dari context bila caller tidak supply), controllers (`api_request` log line), scheduler mini-service (structured stdout JSON). Endpoint `/metrics` (stub dari TASK-09) diganti dengan registry penuh.

> **Simplified OTel** — plan section 13.3 menyebut full OpenTelemetry SDK + Jaeger export. Untuk demo ini, trace ID di-generate custom (`crypto.randomUUID()`) + di-propagate via `AsyncLocalStorage` saja — cukup untuk korelasi log + `payment_attempts.trace_id`. Full OTel SDK (`@opentelemetry/sdk-node` + OTLP exporter ke Jaeger) disebut sebagai **optional extension** di section Notes.

## Scope

**In scope**:
- `apps/payment-api/src/modules/observability/logger.module.ts` — `LoggerModule.forRootAsync(...)` setup `nestjs-pino` dengan `pino-pretty` untuk dev, JSON for production.
- `apps/payment-api/src/modules/observability/logger.service.ts` — wrapper tipis (atau langsung inject `PinoLogger`) — disediakan agar service lain tidak depend langsung ke `nestjs-pino` API.
- `apps/payment-api/src/modules/observability/metrics.service.ts` — `@Injectable()` `MetricsService` dengan default `prom-client.Registry` singleton + 7 metric + method increment/observe per-event.
- `apps/payment-api/src/modules/observability/trace-context.ts` — `AsyncLocalStorage<TraceContext>` + `withTrace()` / `getTraceId()` / `getTraceContext()` helpers.
- `apps/payment-api/src/modules/observability/index.ts` — barrel.
- Modify `apps/payment-api/src/modules/gateway/http-adapter.ts` — time `charge()`, observe `payment_gateway_request_duration_seconds` histogram + increment `payment_gateway_requests_total` counter (+ `gateway_idempotent_replays_total` saat `replayed=true`).
- Modify `apps/payment-api/src/modules/gateway/resilient-adapter.ts` — invoke metrics on outcome (retry `onFailure` / `onSuccess` → `retry_attempts_total`, breaker `onBreak` / `onReset` / `onActivate` → `circuit_breaker_state` gauge).
- Modify `packages/resilience/src/policies/composition.ts` (atau di consumer site) — wire `retryPolicy.onFailure` / `onSuccess` + `breakerPolicy.onBreak` / `onReset` / `onActivate` hooks ke `MetricsService` callbacks (bila belum di-wire di TASK-05).
- Modify `apps/payment-api/src/modules/payments/payments.service.ts` — lifecycle logs (`payment_start`, `payment_finish`, `attempt_start`, `attempt_finish`, `retry_scheduled`, `permanent_failure`), timing `payment_processing_duration_seconds` histogram, delta `payments_current_status` gauge pada state transitions, replace `crypto.randomUUID()` traceId dengan `getTraceId() ?? randomUUID()` + wrap `executePayment` di `withTrace()` bila context belum ada.
- Modify `apps/payment-api/src/modules/audit/audit.service.ts` — fallback `input.traceId ?? getTraceId()` saat membentuk `RecordAttemptInput`.
- Modify `apps/payment-api/src/modules/metrics/metrics.module.ts` + `metrics.controller.ts` — ganti stub registry dari TASK-09 dengan real `MetricsService.register`; set `Content-Type: register.contentType`.
- Modify `apps/payment-api/src/modules/payments/payments.controller.ts` — log `api_request` line (`{ method, path, traceId }`).
- Modify `apps/payment-api/src/app.module.ts` — import `LoggerModule` + `ObservabilityModule` (atau enough that `MetricsService` + `TraceContext` bisa di-inject di seluruh module yang butuh).
- Modify `apps/payment-api/src/main.ts` — `app.useLogger(app.get(Logger))` agar `nestjs-pino` jadi logger default (override default NestJS `ConsoleLogger`).
- Scheduler mini-service (`apps/payment-gateway-mock` atau `payment-api` scheduler) — structured stdout JSON log via `console.log(JSON.stringify(...))` untuk `scheduler_poll` event.

**Out of scope**:
- **Full OTel SDK + Jaeger export** — trace ID via `AsyncLocalStorage` + `payment_attempts.trace_id` sudah cukup untuk demo. Bila user mau full OTel (auto-instrumentations + OTLP exporter + Jaeger UI provisioning), buat task terpisah (mis. `TASK-11b-otel-sdk.md`).
- **Grafana dashboard JSON provisioning** — provisioning dashboard via `grafana/provisioning/dashboards/*.json` + Prometheus datasource. Sample PromQL queries disediakan sebagai text di TASK-15 documentation (bukan file JSON yang di-provision).
- **Log aggregation (Loki / ELK / Datadog)** — pino log dikirim ke stdout (prod) atau pino-pretty (dev) saja. Piping stdout ke Loki/Fluentd adalah koncerna deploy, bukan kode.
- **Alertmanager rules / Prometheus recording rules** — production concern, document di TASK-15 caveats.
- **Custom pino transports** (e.g. pino-mysql untuk log-to-DB, pino-cloud-transport) — tidak dipakai.
- **Histogram bucket tuning per-SLO dengan load test** — bucket default `prom-client` + manual buckets dipakai. Tuning berbasis real SLO dilakukan post-launch (production concern).
- **Vue / Next.js frontend mengonsumsi `/metrics` langsung** — `/metrics` adalah Prometheus exposition text (bukan JSON). Frontend konsumsi metrics via API `/api/metrics-summary` (opsional, terpisah) atau via Prometheus + Grafana. Tercatat di TASK-12 + TASK-13.

---

## Metrics table (plan section 13.2)

Tujuh metric yang dibuat di `MetricsService`. **Anti-pattern yang dijauhi**: TIDAK ada label high-cardinality (`payment_id`, `order_id`, `trace_id`, raw `error_message`) — data tersebut hanya sebagai **log field** (pino), bukan metric label. Rationale: cardinality explosion di Prometheus TSDB → OOM.

| # | Metric name | Type | Labels | Source (increment/observe site) |
|---|---|---|---|---|
| 1 | `payment_gateway_requests_total` | Counter | `outcome` (`success` \| `failure`), `http_status` (string HTTP status code, e.g. `"200"`, `"503"`, `"timeout"`, `"breaker_open"`) | `HttpPaymentGateway.charge()` setelah axios resolve/reject |
| 2 | `retry_attempts_total` | Counter | `outcome` (`success` \| `failure`), `payment_status` (string status payment saat attempt tsb — `processing`, `scheduled_for_retry`, atau `n/a` bila tidak diketahui) | `retryPolicy.onFailure` + `retryPolicy.onSuccess` hooks di `ResilientPaymentGateway` composition |
| 3 | `circuit_breaker_state` | Gauge | `service` (string nama dependency, e.g. `"payment-gateway"`) | `breakerPolicy.onBreak` (=1), `onReset` (=0), `onActivate` (=2) hooks. Convention: 0=CLOSED, 1=OPEN, 2=HALF_OPEN |
| 4 | `payments_current_status` | Gauge | `status` (`processing`, `succeeded`, `failed`, `scheduled_for_retry`) | `PaymentsService` — delta inc/dec saat transisi status (inc new status, dec old status) |
| 5 | `payment_gateway_request_duration_seconds` | Histogram | (none) | `HttpPaymentGateway.charge()` — observe `(end - start) / 1000` |
| 6 | `payment_processing_duration_seconds` | Histogram | (none) | `PaymentsService.executePayment()` — observe total cycle duration dari `payment_start` ke `payment_finish` (termasuk retry) |
| 7 | `gateway_idempotent_replays_total` | Counter | (none) | `HttpPaymentGateway.charge()` saat `result.replayed === true` |

**Histogram buckets** (chosen per SLO demo, bukan default `prom-client`):

```ts
// payment_gateway_request_duration_seconds
buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]  // gateway mock target: p95 < 1s, timeout 2s

// payment_processing_duration_seconds
buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120]  // total cycle incl. retries (3 attempts × max 2s timeout + backoff)
```

**Anti-pattern checklist** (yang harus TIDAK ada di code review):

- [ ] `trace_id` sebagai label → MUST NOT. `traceId` hanya sebagai pino log field.
- [ ] `payment_id` / `order_id` sebagai label → MUST NOT. Hanya sebagai log field + persisted di `payment_attempts`.
- [ ] Raw `error_message` sebagai label → MUST NOT. Hanya `error_code` (low-cardinality enum) yang boleh jadi label bila diperlukan — di task ini TIDAK dipakai sebagai label (cuma `outcome`).
- [ ] Membuat `new Registry()` per metric → MUST NOT. Pakai default `Registry` (`prom-client.register` atau instance singleton yang di-share).

---

## Logging events (plan section 13.1)

Setiap log line via `PinoLogger` (atau `console.log(JSON.stringify(...))` di mini-service yang tidak NestJS) WAJIB membawa field `traceId`. Format pino standard:

```json
{"level":30,"time":1718054400000,"traceId":"a1b2c3d4-...","paymentId":"...","event":"payment_start","msg":"payment processing started"}
```

| Event | Level | Field tambahan | Emit site |
|---|---|---|---|
| `payment_start` | info | `paymentId`, `orderId`, `amount`, `currency`, `source` (`api` \| `scheduler` \| `manual_retry`) | `PaymentsService.createPayment()` / `executePayment()` entry |
| `payment_finish` | info | `paymentId`, `finalStatus`, `attemptCount`, `totalRetryCount`, `durationMs` | `PaymentsService.executePayment()` exit |
| `attempt_start` | info | `paymentId`, `attemptNumber`, `traceId` | `attachAuditCallback` (TASK-07) sebelum `gateway.charge()` |
| `attempt_finish` | info | `paymentId`, `attemptNumber`, `outcome`, `httpStatus`, `replayed`, `durationMs` | audit callback setelah `gateway.charge()` resolve |
| `retry_scheduled` | warn | `paymentId`, `totalRetryCount`, `nextRetryAt`, `delayBeforeNextMs`, `failureReason` | `PaymentsService.applyOutcome()` saat transisi `processing → scheduled_for_retry` |
| `retry_delay` | info | `paymentId`, `attemptNumber`, `delayBeforeNextMs` | `retryPolicy.onFailure` hook (Cockatiel) — log delay sebelum next attempt |
| `permanent_failure` | error | `paymentId`, `failureReason`, `errorCode`, `attemptCount` | `PaymentsService.applyOutcome()` saat transisi `processing → failed` |
| `breaker_state_change` | warn | `service`, `newState` (`open` \| `closed` \| `half_open`), `previousState` | `breakerPolicy.onBreak` / `onReset` / `onActivate` hooks |
| `scheduler_poll` | info | `cycleId`, `dueCount`, `processedCount`, `errorCount`, `durationMs` | `RetrySchedulerService.poll()` exit |
| `idempotency_replay` | warn | `paymentId`, `idempotencyKey`, `attemptNumber` | `HttpPaymentGateway.charge()` saat `result.replayed === true` |
| `gateway_failure_mode` | warn | `mode`, `paymentId?` | `HttpPaymentGateway.charge()` saat non-2xx response (mode didapat dari header gateway `X-Gateway-Mode` bila ada) |
| `api_request` | info | `method`, `path`, `traceId` | `PaymentsController` (interceptor / per-handler log) |
| `api_response` | info | `method`, `path`, `statusCode`, `durationMs`, `traceId` | `PaymentsController` exit |

> `traceId` field disuntik otomatis oleh pino mixin (lihat Implementation step 1 — `pinoHttp: { mixin: () => ({ traceId: getTraceId() }) }`).

---

## Files to create/modify

**Create** (di `/home/z/my-project/retry-failure/apps/payment-api/src/modules/observability/`):

- `logger.module.ts` — `LoggerModule` (wrapper untuk `LoggerModule.forRootAsync`).
- `logger.service.ts` — `ObservabilityLogger` wrapper (opsional — bila ingin hide `nestjs-pino` API dari consumer).
- `metrics.service.ts` — `MetricsService` (`@Injectable()` dengan `Registry` + 7 metric + method `incGatewayRequest`, `observeGatewayDuration`, `incReplay`, `incRetryAttempt`, `setBreakerState`, `incPaymentStatus` / `decPaymentStatus`, `observeProcessingDuration`).
- `trace-context.ts` — `AsyncLocalStorage<TraceContext>`, `withTrace()`, `getTraceId()`, `getTraceContext()`.
- `observability.module.ts` — `@Module({ providers: [MetricsService], exports: [MetricsService] })` (logger module di-import terpisah via `LoggerModule.forRootAsync`).
- `index.ts` — barrel.

**Modify**:

- `apps/payment-api/src/main.ts` — `app.useLogger(app.get(Logger))`.
- `apps/payment-api/src/app.module.ts` — import `LoggerModule` + `ObservabilityModule`.
- `apps/payment-api/src/modules/gateway/http-adapter.ts` — inject `MetricsService` + `PinoLogger`. Time `charge()`, observe histogram + counter. Detect `replayed=true` → inc replay counter.
- `apps/payment-api/src/modules/gateway/resilient-adapter.ts` — inject `MetricsService` + `PinoLogger`. Wire `retryPolicy.onFailure` / `onSuccess` + `breakerPolicy.onBreak` / `onReset` / `onActivate` ke metrics callbacks (bila belum di TASK-05/06).
- `apps/payment-api/src/modules/payments/payments.service.ts` — inject `MetricsService` + `PinoLogger`. Lifecycle logs. `payments_current_status` delta on transition. `payment_processing_duration_seconds` histogram. Replace `crypto.randomUUID()` traceId dengan `getTraceId() ?? randomUUID()` + `withTrace()` wrap.
- `apps/payment-api/src/modules/audit/audit.service.ts` — fallback `input.traceId ?? getTraceId()` di `recordAttempt()`.
- `apps/payment-api/src/modules/metrics/metrics.module.ts` — ganti stub registry dari TASK-09 dengan real `MetricsService` registry.
- `apps/payment-api/src/modules/metrics/metrics.controller.ts` — `Content-Type: metricsService.register.contentType`, return `metricsService.register.metrics()`.
- `apps/payment-api/src/modules/payments/payments.controller.ts` — `api_request` log line per handler (atau via interceptor global).
- `apps/payment-api/src/modules/retry-scheduler/retry-scheduler.service.ts` (TASK-10) — `scheduler_poll` log line exit + (opsional) metrics `scheduler_poll_total` (bila ingin tambahan — tidak wajib dalam plan section 13.2 yang asli 7 metric).

---

## Implementation steps

### 1. Install dependencies

Bila belum diinstall di TASK-01, tambahkan ke `apps/payment-api/package.json`:

```json
{
  "dependencies": {
    "nestjs-pino": "^4.0.0",
    "pino": "^9.0.0",
    "pino-pretty": "^11.0.0",
    "prom-client": "^15.0.0"
  }
}
```

```bash
cd /home/z/my-project/retry-failure && pnpm install
```

### 2. `observability/trace-context.ts`

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface TraceContext {
  traceId: string;
  paymentId?: string;
  source?: 'api' | 'scheduler' | 'manual_retry';
}

const als = new AsyncLocalStorage<TraceContext>();

/**
 * Run `fn` inside a new trace context. Bila traceId tidak di-supply via opts,
 * generate UUID v4 baru.
 *
 * Bila context sudah ada di AsyncLocalStorage (e.g. request sudah di-wrap
 * middleware), gunakan context yang ada — jangan overwrite.
 */
export function withTrace<T>(
  fn: () => Promise<T> | T,
  opts: { traceId?: string; paymentId?: string; source?: TraceContext['source'] } = {},
): Promise<T> | T {
  const existing = als.getStore();
  if (existing) {
    // Context already set — propagate (don't nest new context).
    return fn();
  }
  const ctx: TraceContext = {
    traceId: opts.traceId ?? randomUUID(),
    paymentId: opts.paymentId,
    source: opts.source,
  };
  return als.run(ctx, fn);
}

export function getTraceId(): string | undefined {
  return als.getStore()?.traceId;
}

export function getTraceContext(): TraceContext | undefined {
  return als.getStore();
}

export function setTracePaymentId(paymentId: string): void {
  const store = als.getStore();
  if (store) {
    store.paymentId = paymentId;
  }
  // Bila tidak ada store, no-op — caller harus panggil withTrace() dulu.
}
```

> AsyncLocalStorage bekerja lintas async boundary (Cockatiel internal `await`, axios, TypeORM query, scheduler callback). Tidak perlu manual propagation.

### 3. `observability/logger.module.ts`

```ts
import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { getTraceId } from './trace-context';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        pinoHttp: {
          level: cfg.get<string>('LOG_LEVEL') ?? 'info',
          // Inject traceId ke setiap log line automatically.
          mixin: () => {
            const traceId = getTraceId();
            return traceId ? { traceId } : {};
          },
          // Auto-logging HTTP requests via pino-http.
          autoLogging: {
            ignore: (req) => req.url === '/metrics' || req.url === '/health',
          },
          // Dev: pretty print. Prod: newline-delimited JSON ke stdout.
          transport:
            cfg.get<string>('NODE_ENV') !== 'production'
              ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
              : undefined,
          // Redact sensitive fields (credit card, etc.) — bila ada.
          redact: ['req.headers.authorization', 'req.body.cardNumber'],
        },
      }),
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
```

### 4. `observability/logger.service.ts` (wrapper opsional)

```ts
import { Injectable } from '@nestjs/common';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';

/**
 * Wrapper tipis di atas PinoLogger. Konsumen service lain (PaymentsService,
 * AuditService, dst.) inject ObservabilityLogger — bila masa depan mau ganti
 * implementasi logger (mis. ke OTel SDK logger), cukup ubah file ini.
 */
@Injectable()
export class ObservabilityLogger {
  constructor(@InjectPinoLogger('app') private readonly logger: PinoLogger) {}

  info(obj: Record<string, unknown>, msg?: string): void {
    this.logger.info(obj, msg);
  }
  warn(obj: Record<string, unknown>, msg?: string): void {
    this.logger.warn(obj, msg);
  }
  error(obj: Record<string, unknown>, msg?: string): void {
    this.logger.error(obj, msg);
  }
  debug(obj: Record<string, unknown>, msg?: string): void {
    this.logger.debug(obj, msg);
  }
}
```

> Bila tim memilih inject `PinoLogger` langsung di consumer (lebih idiomatis), file ini boleh di-skip. Decision: **provide both** — consumer boleh pilih.

### 5. `observability/metrics.service.ts`

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  public readonly registry: Registry;

  // 1. payment_gateway_requests_total
  public readonly gatewayRequestsTotal: Counter<string>;
  // 2. retry_attempts_total
  public readonly retryAttemptsTotal: Counter<string>;
  // 3. circuit_breaker_state
  public readonly circuitBreakerState: Gauge<string>;
  // 4. payments_current_status
  public readonly paymentsCurrentStatus: Gauge<string>;
  // 5. payment_gateway_request_duration_seconds
  public readonly gatewayRequestDurationSeconds: Histogram<string>;
  // 6. payment_processing_duration_seconds
  public readonly paymentProcessingDurationSeconds: Histogram<string>;
  // 7. gateway_idempotent_replays_total
  public readonly gatewayIdempotentReplaysTotal: Counter<string>;

  constructor() {
    // Default registry singleton — jangan buat Registry baru.
    this.registry = new Registry();

    this.gatewayRequestsTotal = new Counter({
      name: 'payment_gateway_requests_total',
      help: 'Total HTTP requests ke payment gateway mock, by outcome + HTTP status.',
      labelNames: ['outcome', 'http_status'],
      registers: [this.registry],
    });

    this.retryAttemptsTotal = new Counter({
      name: 'retry_attempts_total',
      help: 'Cockatiel retry attempts, by outcome + payment status saat attempt.',
      labelNames: ['outcome', 'payment_status'],
      registers: [this.registry],
    });

    this.circuitBreakerState = new Gauge({
      name: 'circuit_breaker_state',
      help: 'Circuit breaker state: 0=CLOSED, 1=OPEN, 2=HALF_OPEN.',
      labelNames: ['service'],
      registers: [this.registry],
    });

    this.paymentsCurrentStatus = new Gauge({
      name: 'payments_current_status',
      help: 'Jumlah payment aktif per status.',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.gatewayRequestDurationSeconds = new Histogram({
      name: 'payment_gateway_request_duration_seconds',
      help: 'Duration HTTP call ke gateway mock (single attempt).',
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    this.paymentProcessingDurationSeconds = new Histogram({
      name: 'payment_processing_duration_seconds',
      help: 'Duration total payment processing cycle (incl. retries).',
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
      registers: [this.registry],
    });

    this.gatewayIdempotentReplaysTotal = new Counter({
      name: 'gateway_idempotent_replays_total',
      help: 'Total idempotent replays detected (response.replayed === true).',
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    // Collect Node.js process metrics (event loop, heap, GC, etc.).
    collectDefaultMetrics({ register: this.registry });
    // Init breaker state gauge (CLOSED = 0).
    this.circuitBreakerState.set({ service: 'payment-gateway' }, 0);
  }

  // --- Convenience methods ---

  incGatewayRequest(outcome: 'success' | 'failure', httpStatus: string | number): void {
    this.gatewayRequestsTotal.inc({
      outcome,
      http_status: String(httpStatus),
    });
  }

  observeGatewayDuration(durationMs: number): void {
    this.gatewayRequestDurationSeconds.observe(durationMs / 1000);
  }

  incReplay(): void {
    this.gatewayIdempotentReplaysTotal.inc();
  }

  incRetryAttempt(outcome: 'success' | 'failure', paymentStatus: string): void {
    this.retryAttemptsTotal.inc({ outcome, payment_status: paymentStatus });
  }

  setBreakerState(state: 'closed' | 'open' | 'half_open'): void {
    this.circuitBreakerState.set(
      { service: 'payment-gateway' },
      state === 'closed' ? 0 : state === 'open' ? 1 : 2,
    );
  }

  incPaymentStatus(status: string): void {
    this.paymentsCurrentStatus.inc({ status });
  }

  decPaymentStatus(status: string): void {
    this.paymentsCurrentStatus.dec({ status });
  }

  observeProcessingDuration(durationMs: number): void {
    this.paymentProcessingDurationSeconds.observe(durationMs / 1000);
  }

  async metrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
```

### 6. `observability/observability.module.ts`

```ts
import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { ObservabilityLogger } from './logger.service';

@Module({
  providers: [MetricsService, ObservabilityLogger],
  exports: [MetricsService, ObservabilityLogger],
})
export class ObservabilityModule {}
```

### 7. `observability/index.ts`

```ts
export * from './logger.module';
export * from './logger.service';
export * from './metrics.service';
export * from './observability.module';
export * from './trace-context';
```

### 8. Wire to `HttpPaymentGateway.charge()`

Di `apps/payment-api/src/modules/gateway/http-adapter.ts` (TASK-06):

```ts
@Injectable()
export class HttpPaymentGateway implements PaymentGatewayPort {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    @InjectPinoLogger('HttpPaymentGateway') private readonly logger: PinoLogger,
  ) {}

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const start = performance.now();
    const traceId = getTraceId();
    try {
      const response = await this.http.axiosRef.post(
        `${this.config.get('GATEWAY_BASE_URL')}/v1/charges`,
        { amount: req.amount, currency: req.currency, order_id: req.orderId },
        { headers: { 'Idempotency-Key': req.paymentId, 'Content-Type': 'application/json' }, timeout: 2000 },
      );
      const end = performance.now();
      this.metrics.observeGatewayDuration(end - start);
      this.metrics.incGatewayRequest('success', response.status);

      const result: ChargeResult = {
        status: response.data.status === 'succeeded' ? 'succeeded' : 'failed',
        httpStatus: response.status,
        replayed: response.data.replayed === true,
        gatewayReference: response.data.gateway_reference,
        errorCode: response.data.error_code,
        retryAfter: response.data.retry_after,
        attempts: 1,
      };

      if (result.replayed) {
        this.metrics.incReplay();
        this.logger.warn({ paymentId: req.paymentId, traceId, idempotencyKey: req.paymentId, event: 'idempotency_replay' }, 'idempotency replay detected');
      }
      this.logger.info({ paymentId: req.paymentId, traceId, httpStatus: result.httpStatus, replayed: result.replayed, durationMs: end - start, event: 'attempt_finish' }, 'gateway charge succeeded');
      return result;
    } catch (err) {
      const end = performance.now();
      this.metrics.observeGatewayDuration(end - start);
      const httpStatus = err.response?.status ?? (err.code === 'ECONNABORTED' ? 'timeout' : 'network_error');
      this.metrics.incGatewayRequest('failure', httpStatus);
      this.logger.warn({ paymentId: req.paymentId, traceId, httpStatus, errorCode: err.code, event: 'attempt_finish' }, 'gateway charge failed');
      // ... map err → ChargeResult (existing TASK-06 logic) ...
      return mappedFailureResult;
    }
  }
}
```

### 9. Wire to `ResilientPaymentGateway` + resilience composition

Di `apps/payment-api/src/modules/gateway/resilient-adapter.ts` (TASK-06):

```ts
@Injectable()
export class ResilientPaymentGateway implements PaymentGatewayPort {
  private readonly retryPolicy: RetryPolicy;
  private readonly breakerPolicy: CircuitBreakerPolicy;
  private readonly composed: Policy;

  constructor(
    @Inject(PAYMENT_GATEWAY_PORT) private readonly inner: PaymentGatewayPort,
    private readonly metrics: MetricsService,
    @InjectPinoLogger('ResilientPaymentGateway') private readonly logger: PinoLogger,
    config: ResilienceConfig,
  ) {
    this.retryPolicy = buildRetryPolicy(config.retry);
    this.breakerPolicy = buildBreakerPolicy(config.breaker);

    // Wire Cockatiel hooks → MetricsService + logger.
    this.retryPolicy.onFailure((event) => {
      const paymentStatus = getTraceContext()?.source === 'scheduler' ? 'scheduled_for_retry' : 'processing';
      this.metrics.incRetryAttempt('failure', paymentStatus);
      this.logger.warn({
        traceId: getTraceId(),
        attemptNumber: event.attempt,
        delayBeforeNextMs: event.delay?.totalMs,
        event: 'retry_delay',
      }, 'cockatiel retry onFailure — delay before next attempt');
    });
    this.retryPolicy.onSuccess((event) => {
      this.metrics.incRetryAttempt('success', 'n/a');
    });

    let prevState: 'closed' | 'open' | 'half_open' = 'closed';
    this.breakerPolicy.onBreak(() => {
      this.metrics.setBreakerState('open');
      this.logger.warn({ service: 'payment-gateway', newState: 'open', previousState: prevState, event: 'breaker_state_change' }, 'circuit breaker OPEN');
      prevState = 'open';
    });
    this.breakerPolicy.onReset(() => {
      this.metrics.setBreakerState('closed');
      this.logger.warn({ service: 'payment-gateway', newState: 'closed', previousState: prevState, event: 'breaker_state_change' }, 'circuit breaker CLOSED');
      prevState = 'closed';
    });
    this.breakerPolicy.onActivate(() => {
      this.metrics.setBreakerState('half_open');
      this.logger.warn({ service: 'payment-gateway', newState: 'half_open', previousState: prevState, event: 'breaker_state_change' }, 'circuit breaker HALF_OPEN');
      prevState = 'half_open';
    });

    const timeoutPolicy = buildTimeoutPolicy(config.timeout);
    this.composed = wrap(this.breakerPolicy, this.retryPolicy, timeoutPolicy);
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    return withTrace(async () => {
      const outcome = await executeWithResilience({
        dependencyName: 'payment-gateway',
        fn: () => this.inner.charge(req),
        composed: this.composed,
      });
      // Map outcome → ChargeResult (existing TASK-06 logic).
      return mapOutcome(outcome);
    }, { paymentId: req.paymentId });
  }
}
```

### 10. Wire to `PaymentsService` (lifecycle logs + status gauge delta + processing histogram)

Di `apps/payment-api/src/modules/payments/payments.service.ts` (TASK-07):

```ts
async createPayment(input: CreatePaymentInput): Promise<Payment> {
  return withTrace(async () => {
    const payment = await this.payments.create({ ...input, status: 'processing' });
    setTracePaymentId(payment.id);
    this.metrics.incPaymentStatus('processing');
    this.logger.info({
      traceId: getTraceId(),
      paymentId: payment.id,
      orderId: payment.orderId,
      amount: payment.amount,
      currency: payment.currency,
      source: 'api',
      event: 'payment_start',
    }, 'payment processing started');
    const start = performance.now();
    try {
      const result = await this.executePayment(payment.id, { source: 'api' });
      const durationMs = performance.now() - start;
      this.metrics.observeProcessingDuration(durationMs);
      this.logger.info({
        traceId: getTraceId(),
        paymentId: payment.id,
        finalStatus: result.status,
        attemptCount: result.attemptCount,
        totalRetryCount: result.totalRetryCount,
        durationMs,
        event: 'payment_finish',
      }, 'payment processing finished');
      return result;
    } catch (err) {
      const durationMs = performance.now() - start;
      this.metrics.observeProcessingDuration(durationMs);
      throw err;
    }
  });
}

private async applyOutcome(paymentId: string, result: ResilienceOutcome<ChargeResult>): Promise<Payment> {
  const current = await this.payments.findById(paymentId);
  if (!current) throw new NotFoundException('Payment not found');

  if (result.kind === 'success' && result.value.status === 'succeeded') {
    await this.atomicTransition(paymentId, 'succeeded', { gatewayReference: result.value.gatewayReference });
    this.metrics.decPaymentStatus('processing');
    this.metrics.incPaymentStatus('succeeded');
    return (await this.payments.findById(paymentId))!;
  }

  if (result.kind === 'exhausted' || result.value.status === 'failed') {
    const nextTotal = current.totalRetryCount + 1;
    if (nextTotal > this.maxTotalRetries) {
      await this.atomicTransition(paymentId, 'failed', { failureReason: 'max_total_retries_exceeded' });
      this.metrics.decPaymentStatus('processing');
      this.metrics.incPaymentStatus('failed');
      this.logger.error({ traceId: getTraceId(), paymentId, failureReason: 'max_total_retries_exceeded', attemptCount: current.attemptCount, event: 'permanent_failure' }, 'payment permanently failed');
      return (await this.payments.findById(paymentId))!;
    }
    const delayMs = result.value.retryAfter ?? this.schedulerBaseDelayMs;
    const nextRetryAt = new Date(Date.now() + delayMs);
    await this.atomicTransition(paymentId, 'scheduled_for_retry', { totalRetryCount: nextTotal, nextRetryAt, failureReason: result.value.errorCode ?? 'retry_exhausted' });
    this.metrics.decPaymentStatus('processing');
    this.metrics.incPaymentStatus('scheduled_for_retry');
    this.logger.warn({
      traceId: getTraceId(),
      paymentId,
      totalRetryCount: nextTotal,
      nextRetryAt,
      delayBeforeNextMs: delayMs,
      failureReason: result.value.errorCode,
      event: 'retry_scheduled',
    }, 'payment scheduled for retry');
    return (await this.payments.findById(paymentId))!;
  }

  // breakerTripped case
  await this.atomicTransition(paymentId, 'scheduled_for_retry', { totalRetryCount: current.totalRetryCount + 1, failureReason: 'breaker_open' });
  this.metrics.decPaymentStatus('processing');
  this.metrics.incPaymentStatus('scheduled_for_retry');
  return (await this.payments.findById(paymentId))!;
}
```

> `traceId` field: sudah di-generate oleh `withTrace()` di entry point. Bila `PaymentsService.executePayment()` dipanggil dari scheduler (TASK-10), `RetrySchedulerService` wajib wrap call ke `withTrace({ source: 'scheduler' })` — di TASK-10 sudah disebut, di task ini tambahkan wrap di `executePayment` site bila context belum ada (defensive).

### 11. Wire to `AuditService` — fallback read `traceId` dari AsyncLocalStorage

Di `apps/payment-api/src/modules/audit/audit.service.ts` (TASK-08):

```ts
async recordAttempt(input: RecordAttemptInput): Promise<void> {
  const traceId = input.traceId ?? getTraceId() ?? null;  // ← fallback ke AsyncLocalStorage
  await this.attemptRepo.insert({
    paymentId: input.paymentId,
    attemptNumber: input.attemptNumber,
    outcome: input.outcome,
    httpStatus: input.httpStatus ?? null,
    breakerState: input.breakerState ?? null,
    durationMs: input.durationMs ?? null,
    replayed: input.replayed ?? false,
    gatewayReference: input.gatewayReference ?? null,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    delayBeforeNextMs: input.delayBeforeNextMs ?? null,
    traceId,  // ← persisted ke payment_attempts.trace_id
    createdAt: new Date(),
  });
  await this.paymentsRepo.increment({ id: input.paymentId }, 'attemptCount', 1);
}
```

### 12. Finalize `/metrics` route

Di `apps/payment-api/src/modules/metrics/metrics.controller.ts` (TASK-09):

```ts
@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Prometheus metrics endpoint (7 metrics + default process metrics).' })
  async metrics(): Promise<string> {
    return this.metricsService.metrics();
  }
}
```

Di `apps/payment-api/src/modules/metrics/metrics.module.ts`:

```ts
@Module({
  imports: [ObservabilityModule],
  controllers: [MetricsController],
})
export class MetricsModule {}
```

> Response Content-Type: NestJS mengirim `text/plain` by default untuk `string` return. Untuk eksplisit:

```ts
@Header('Content-Type', 'application/openmetrics-text; version=1.0.0; charset=utf-8')
```

atau manual:

```ts
@Get()
async metrics(@Res() res: Response): Promise<void> {
  const body = await this.metricsService.metrics();
  res.set('Content-Type', this.metricsService.contentType).send(body);
}
```

### 13. `payments.controller.ts` — `api_request` log line

Di `apps/payment-api/src/modules/payments/payments.controller.ts` (TASK-09):

```ts
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    @InjectPinoLogger('PaymentsController') private readonly logger: PinoLogger,
  ) {}

  @Post()
  async create(@Body() dto: CreatePaymentDto, @Req() req: Request): Promise<{ payment: PaymentView }> {
    this.logger.info({ method: 'POST', path: '/payments', traceId: getTraceId() }, 'api_request');
    const payment = await withTrace(() => this.payments.createPayment(dto), { source: 'api' });
    return { payment: toView(payment) };
  }

  // ... other handlers (getById, list, retry) — log api_request line masing-masing.
}
```

> Alternative: implementasi global interceptor `LoggingInterceptor` yang log `api_request` + `api_response` untuk semua controller — bila mau DRY. Tapi untuk demo, per-handler log cukup.

### 14. Scheduler mini-service — structured stdout JSON

Di `apps/payment-api/src/modules/retry-scheduler/retry-scheduler.service.ts` (TASK-10):

```ts
private async poll(): Promise<void> {
  const cycleId = randomUUID();
  const start = performance.now();
  let processedCount = 0;
  let dueCount = 0;
  try {
    const due = await this.payments.findDueRetries(this.batchSize);
    dueCount = due.length;
    for (const payment of due) {
      try {
        await withTrace(() => this.payments.executePayment(payment.id, { source: 'scheduler' }), { paymentId: payment.id, source: 'scheduler' });
        processedCount++;
      } catch (err) {
        this.logger.warn({ cycleId, traceId: getTraceId(), paymentId: payment.id, error: err.message, event: 'scheduler_payment_error' }, 'scheduler payment failed');
      }
    }
  } catch (err) {
    this.logger.error({ cycleId, error: err.message, event: 'scheduler_poll_error' }, 'scheduler poll failed');
    this.errorCount++;
    this.lastError = err.message;
  } finally {
    const durationMs = performance.now() - start;
    this.logger.info({ cycleId, dueCount, processedCount, errorCount: this.errorCount, durationMs, event: 'scheduler_poll' }, 'scheduler poll completed');
  }
}
```

### 15. `app.module.ts` wire-up

```ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: configSchema }),
    LoggerModule,                       // ← nestjs-pino
    DatabaseModule,
    GatewayModule,
    PaymentsModule,
    AuditModule,
    ObservabilityModule,               // ← MetricsService + ObservabilityLogger
    MetricsModule,                     // ← uses ObservabilityModule's MetricsService
    HealthModule,
    ScheduleModule.forRoot(),
  ],
})
export class AppModule {}
```

Di `main.ts`:

```ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));  // ← override default ConsoleLogger
  app.setGlobalPrefix('api');
  app.enableCors({ origin: ['http://localhost:3000', 'http://localhost:5173'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(3001);
}
bootstrap();
```

### 16. (Optional extension) Full OTel SDK + Jaeger export

Bila di masa depan user ingin full OpenTelemetry SDK + Jaeger UI:

```bash
pnpm --filter payment-api add @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http
```

Buat `apps/payment-api/src/otel.ts` (load sebelum NestJS bootstrap):

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getResource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'payment-api',
  }),
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
```

Lalu `node --import otel.js dist/main.js`. Trace context di-propagate via HTTP headers `traceparent` otomatis oleh auto-instrumentations. `getTraceId()` di `trace-context.ts` diganti dengan `trace.getSpan(context.active())?.spanContext().traceId`. Jaeger UI di `http://localhost:16686`.

> **Decision untuk task ini**: TIDAK implement full OTel SDK. Cukup `AsyncLocalStorage` + `crypto.randomUUID()`. OTel disebut sebagai optional future evolution — document di TASK-15 production caveats.

---

## Acceptance criteria

- [ ] `curl -sS http://localhost:3001/metrics` mengembalikan text dengan **semua 7 metric** (`payment_gateway_requests_total`, `retry_attempts_total`, `circuit_breaker_state`, `payments_current_status`, `payment_gateway_request_duration_seconds`, `payment_processing_duration_seconds`, `gateway_idempotent_replays_total`) + default process metrics (`process_cpu_*`, `nodejs_*`).
- [ ] Setelah 1 successful payment (gateway mode `always-success`):
  ```text
  payment_gateway_requests_total{outcome="success",http_status="200"} 1
  payment_gateway_request_duration_seconds_bucket{le="0.5"} 1
  payment_processing_duration_seconds_bucket{le="1"} 1
  payments_current_status{status="succeeded"} 1
  ```
- [ ] Setelah retry exhausted (gateway mode `server-error`, 3 Cockatiel attempts):
  ```text
  retry_attempts_total{outcome="failure",payment_status="processing"} 3
  payment_gateway_requests_total{outcome="failure",http_status="500"} 3
  payments_current_status{status="scheduled_for_retry"} 1
  ```
- [ ] Setelah circuit breaker OPEN (gateway mode `always-timeout`, 3 payments berturut-turut — 3 consecutive failures trigger `ConsecutiveBreaker({ threshold: 3 })`):
  ```text
  circuit_breaker_state{service="payment-gateway"} 1
  ```
  Log line:
  ```json
  {"level":40,"event":"breaker_state_change","service":"payment-gateway","newState":"open","previousState":"closed","traceId":"..."}
  ```
- [ ] Setelah idempotency replay (gateway mode `succeed-but-drop-response` — request kedua untuk payment yang sama):
  ```text
  gateway_idempotent_replays_total 1
  ```
  Log line `idempotency_replay` muncul dengan `traceId` field.
- [ ] `payments_current_status` gauge mencerminkan jumlah payment aktif per status. Setelah 5 payments (3 succeeded, 1 failed, 1 scheduled_for_retry):
  ```text
  payments_current_status{status="succeeded"} 3
  payments_current_status{status="failed"} 1
  payments_current_status{status="scheduled_for_retry"} 1
  payments_current_status{status="processing"} 0
  ```
- [ ] Setiap log line payment lifecycle (`payment_start`, `payment_finish`, `attempt_start`, `attempt_finish`, `retry_scheduled`, `permanent_failure`, `breaker_state_change`, `scheduler_poll`, `idempotency_replay`, `api_request`) memuat field `traceId` (string UUID v4).
- [ ] `payment_attempts.trace_id` diisi dengan **trace ID yang sama** untuk semua attempt dalam satu execution cycle (e.g. 3 Cockatiel attempts → 3 rows dengan `trace_id` identik). Verifiable via:
  ```sql
  SELECT payment_id, attempt_number, outcome, trace_id, created_at
  FROM payment_attempts
  WHERE payment_id = '<uuid>'
  ORDER BY created_at ASC;
  -- Expected: trace_id kolom identik untuk 3 rows dalam cycle yang sama.
  ```
- [ ] Trace ID berbeda antar execution cycle (scheduler re-trigger atau manual retry) — verifiable via query di atas (cycle berbeda → `trace_id` berbeda).
- [ ] TIDAK ada label high-cardinality (`payment_id`, `order_id`, `trace_id`, raw `error_message`) di metric apapun — grep `/metrics` output untuk memverifikasi hanya label low-cardinality yang muncul.
- [ ] `pnpm --filter payment-api typecheck` → **lulus tanpa error**.
- [ ] `pnpm --filter payment-api lint` → **lulus tanpa error**.
- [ ] Dev mode (`pnpm --filter payment-api start:dev`) — log di console ter-format pino-pretty (colorized, readable) di dev. Bila `NODE_ENV=production` di-set → log newline-delimited JSON ke stdout.
- [ ] Endpoint `/health` dan `/metrics` tidak di-log oleh pino auto-logging (supaya tidak spam log saat Prometheus scrape `/metrics` setiap 15s).

---

## Useful commands (run after completing this task)

### Pre-flight Check

> **WAJIB BACA**: sebelum menjalankan command di bawah, cek kondisi lingkungan Anda via [`SANDBOX_NOTES.md`](./SANDBOX_NOTES.md) section 1 (Pre-flight Check).
>
> Ringkasan keyword:
> - `pnpm --version` ada → KONDISI LOCAL. Tidak ada → KONDISI SANDBOX → jalankan `corepack enable pnpm && corepack prepare pnpm@9.12.0 --activate` dulu.
> - `docker --version` ada → KONDISI LOCAL. Tidak ada → KONDISI SANDBOX → butuh external PostgreSQL atau skip DB-dependent commands.
> - `curl -s http://localhost:3000` sibuk → KONDISI SANDBOX → payment-api pakai PORT=3001, gateway-mock pakai PORT=3002, Next.js preview sudah otomatis jalan di 3000. Bebas → KONDISI LOCAL → payment-api pakai PORT=3000, gateway-mock pakai PORT=3001, Next.js di-start manual di 3000.

Command di bawah ditulis dengan dua varian bila perlu (LOCAL / SANDBOX). Pilih salah satu sesuai kondisi.

---

```bash
# ============================================================
# 1. Start all services (gateway mock + payment-api + DB)
# ============================================================
# KONDISI LOCAL (Docker tersedia, port 3000 bebas):
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml up -d postgres
sleep 3
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml ps postgres
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock && PORT=3001 pnpm start:dev &
cd /home/z/my-project/retry-failure/apps/payment-api && PORT=3000 pnpm start:dev

# KONDISI SANDBOX (Docker tidak tersedia, port 3000 dipakai Next.js preview):
# - Butuh external PostgreSQL instance (set DB_HOST/DB_PORT/DB_USER/DB_PASS/DB_NAME di apps/payment-api/.env)
# - Atau skip DB-dependent commands (step 5, 8c); inspect via Node script (lihat step 5 varian SANDBOX)
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock && PORT=3002 pnpm start:dev &
cd /home/z/my-project/retry-failure/apps/payment-api && PORT=3001 pnpm start:dev
# Expected early log (pino-pretty colorized):
#   [Nest] LOG [NestApplication] Nest application successfully started
#   INFO (app): api_request traceId=... method=POST path=/payments

# ============================================================
# 2. Typecheck + lint — sama kedua kondisi (asumsi pnpm sudah ter-enable via corepack di SANDBOX)
# ============================================================
cd /home/z/my-project/retry-failure
pnpm --filter payment-api typecheck
pnpm --filter payment-api lint

# ============================================================
# 3. Reset gateway mode → create test payment → inspect /metrics
#    Pola env var: API_PORT default 3000 LOCAL; set API_PORT=3001 untuk SANDBOX.
#                   GW_PORT default 3001 LOCAL; set GW_PORT=3002 untuk SANDBOX.
#    Set sekali di sesi shell:
#      export API_PORT=3000 GW_PORT=3001  (LOCAL)
#      export API_PORT=3001 GW_PORT=3002  (SANDBOX)
# ============================================================
API_PORT="${API_PORT:-3000}"  # default 3000 LOCAL; set API_PORT=3001 untuk SANDBOX
GW_PORT="${GW_PORT:-3001}"    # default 3001 LOCAL; set GW_PORT=3002 untuk SANDBOX

curl -sS -X PUT "http://localhost:${GW_PORT}/admin/config" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"always-success"}' | jq .

curl -sS -X POST "http://localhost:${API_PORT}/payments" \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"OBS-001","amount":10000,"currency":"IDR"}' | jq .

# 3a. /metrics — verify all 7 metrics exist
curl -sS "http://localhost:${API_PORT}/metrics" | grep -E \
  '^(payment_gateway_requests_total|retry_attempts_total|circuit_breaker_state|payments_current_status|payment_gateway_request_duration_seconds|payment_processing_duration_seconds|gateway_idempotent_replays_total)'
# Expected: 7 lines (one per metric name)

# 3b. /metrics — verify specific metric value incremented
curl -sS "http://localhost:${API_PORT}/metrics" | grep 'payment_gateway_requests_total{outcome="success",http_status="200"}'
# Expected: payment_gateway_requests_total{outcome="success",http_status="200"} 1

# ============================================================
# 4. Inspect logs — grep for traceId + event fields (sama kedua kondisi; dev.log ada di parent root)
# ============================================================
# Redirect dev log to file (or set NODE_ENV + tail stdout).
cd /home/z/my-project/retry-failure/apps/payment-api && pnpm start:dev > /tmp/payment-api.log 2>&1 &

# 4a. All payment_start / payment_finish lines
grep '"event":"payment_start"' /tmp/payment-api.log | jq .
grep '"event":"payment_finish"' /tmp/payment-api.log | jq .

# 4b. All breaker_state_change lines
grep '"event":"breaker_state_change"' /tmp/payment-api.log | jq .

# 4c. Verify every lifecycle log has traceId field
grep -E '"event":"(payment_start|payment_finish|attempt_start|attempt_finish|retry_scheduled|permanent_failure|breaker_state_change|scheduler_poll|idempotency_replay|api_request)"' \
  /tmp/payment-api.log | jq -e '.traceId' > /dev/null
# Expected: exit 0 (all lines have traceId)

# ============================================================
# 5. Inspect payment_attempts.trace_id via psql
# ============================================================
# KONDISI LOCAL (Docker tersedia, psql via docker exec):
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml exec postgres \
  psql -U retry_failure -d retry_failure -c \
  "SELECT p.order_id, pa.attempt_number, pa.outcome, pa.trace_id, pa.created_at
   FROM payment_attempts pa
   JOIN payments p ON p.id = pa.payment_id
   WHERE p.order_id LIKE 'OBS-%'
   ORDER BY p.created_at DESC, pa.attempt_number ASC;"
# Expected: attempts dalam satu payment cycle → trace_id identik.
#           Different payment → different trace_id.

# KONDISI SANDBOX (Docker tidak tersedia, psql host atau Node script):
# Opsi A — psql host (bila psql tersedia & external PG connectable):
#   psql -h localhost -U retry_failure -d retry_failure -c \
#     "SELECT p.order_id, pa.attempt_number, pa.outcome, pa.trace_id, pa.created_at
#      FROM payment_attempts pa JOIN payments p ON p.id = pa.payment_id
#      WHERE p.order_id LIKE 'OBS-%' ORDER BY p.created_at DESC, pa.attempt_number ASC;"
# Opsi B — Node script via ts-node (bila psql tidak ada):
#   cd /home/z/my-project/retry-failure/apps/payment-api && pnpm exec ts-node -e "
#     import { Client } from 'pg';
#     const c = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
#       user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME });
#     await c.connect();
#     const r = await c.query(\`SELECT p.order_id, pa.attempt_number, pa.outcome, pa.trace_id, pa.created_at
#       FROM payment_attempts pa JOIN payments p ON p.id = pa.payment_id
#       WHERE p.order_id LIKE 'OBS-%' ORDER BY p.created_at DESC, pa.attempt_number ASC;\`);
#     console.log(r.rows); await c.end();
#   "
# Opsi C — skip bila DB tidak connectable; document caveat di TASK-15.

# ============================================================
# 6. Trigger circuit breaker OPEN test (always-timeout mode)
# ============================================================
curl -sS -X PUT "http://localhost:${GW_PORT}/admin/config" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"always-timeout"}' | jq .

# 6a. Create 3 payments berturut-turut — 3 consecutive failures trigger breaker OPEN.
for i in 1 2 3; do
  curl -sS -X POST "http://localhost:${API_PORT}/payments" \
    -H 'Content-Type: application/json' \
    -d "{\"orderId\":\"OBS-BREAKER-00${i}\",\"amount\":5000,\"currency\":\"IDR\"}" | jq '.payment | {id, status, failureReason}'
done
# Expected: 3rd payment → breaker OPEN, langsung return failure (no HTTP call to gateway).
#           Log: breaker_state_change newState=open.

# 6b. Verify breaker gauge === 1
curl -sS "http://localhost:${API_PORT}/metrics" | grep 'circuit_breaker_state{service="payment-gateway"}'
# Expected: circuit_breaker_state{service="payment-gateway"} 1

# 6c. Wait for half_open (halfOpenAfter: 10s), then switch gateway → success.
sleep 10
curl -sS -X PUT "http://localhost:${GW_PORT}/admin/config" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"always-success"}' | jq .

# 6d. Create 1 more payment → breaker HALF_OPEN → success → CLOSED.
curl -sS -X POST "http://localhost:${API_PORT}/payments" \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"OBS-BREAKER-RECOVER","amount":5000,"currency":"IDR"}' | jq '.payment.status'
# Expected: "succeeded"

# 6e. Verify breaker gauge back to 0
curl -sS "http://localhost:${API_PORT}/metrics" | grep 'circuit_breaker_state{service="payment-gateway"}'
# Expected: circuit_breaker_state{service="payment-gateway"} 0

# ============================================================
# 7. Reset gateway mode (cleanup) — port kondisional via GW_PORT
# ============================================================
curl -sS -X PUT "http://localhost:${GW_PORT}/admin/config" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"always-success"}' | jq .

# ============================================================
# 8. Idempotency replay test (succeed-but-drop-response mode)
# ============================================================
curl -sS -X PUT "http://localhost:${GW_PORT}/admin/config" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"succeed-but-drop-response"}' | jq .

# 8a. Create 1 payment → first attempt: gateway simpan Idempotency-Key, lalu drop response.
#     Cockatiel retry → second attempt: gateway detect Idempotency-Key, return replayed=true.
curl -sS -X POST "http://localhost:${API_PORT}/payments" \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"OBS-REPLAY-001","amount":15000,"currency":"IDR"}' | jq '.payment | {id, status, attemptCount, gatewayReference}'

# 8b. Verify replay counter incremented
curl -sS "http://localhost:${API_PORT}/metrics" | grep 'gateway_idempotent_replays_total'
# Expected: gateway_idempotent_replays_total 1

# 8c. Verify attempt rows: 1 row replayed=true, trace_id sama untuk kedua attempts.
# KONDISI LOCAL (Docker tersedia, psql via docker exec):
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml exec postgres \
  psql -U retry_failure -d retry_failure -c \
  "SELECT attempt_number, outcome, replayed, trace_id
   FROM payment_attempts
   WHERE payment_id = (SELECT id FROM payments WHERE order_id='OBS-REPLAY-001')
   ORDER BY attempt_number ASC;"
# Expected: 2 rows, replayed=true di row 2, trace_id identical.

# KONDISI SANDBOX (Docker tidak tersedia):
#   psql -h localhost -U retry_failure -d retry_failure -c \
#     "SELECT attempt_number, outcome, replayed, trace_id FROM payment_attempts
#      WHERE payment_id = (SELECT id FROM payments WHERE order_id='OBS-REPLAY-001')
#      ORDER BY attempt_number ASC;"
#   Atau via Node script (lihat step 5 varian SANDBOX Opsi B).

# ============================================================
# 9. Reset gateway mode (final cleanup) — port kondisional via GW_PORT
# ============================================================
curl -sS -X PUT "http://localhost:${GW_PORT}/admin/config" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"always-success"}' | jq .
```

---

## Notes

### AsyncLocalStorage works across async boundaries

`AsyncLocalStorage` dari `node:async_hooks` secara native men-propagate context store lintas `await` / `setTimeout` / `setInterval` / `Promise.then` / `process.nextTick` / I/O callbacks (TypeORM `query`, axios `httpRef.post`, Cockatiel internal `retryPolicy.execute`, scheduler `setInterval` callback). Tidak perlu manual propagation via parameter.

**Performance**: ada overhead kecil (~5-10% per async operation bila context aktif). Untuk throughput demo (ratusan RPS), acceptable. Production high-throughput (>10k RPS) → pertimbangkan `AsyncResource` manual atau OTel context.

**Pitfall**: `AsyncLocalStorage` tidak men-propagate lintas `worker_threads` atau child process. Untuk scheduler yang dijalankan via `worker_threads` (bukan kasus kita — scheduler di NestJS process utama), context hilang. Document di TASK-15 bila relevant.

### prom-client default Registry singleton

`prom-client` v15+ meng-ekspor default `Registry` (`import { register } from 'prom-client'`). Bila metric dibuat tanpa specify `registers: [...]`, otomatis register ke default `register`.

**Decision**: tetap buat instance `Registry` baru di `MetricsService` constructor (`new Registry()`) + specify `registers: [this.registry]` di setiap metric. Rationale:

1. **Isolatable** — bila ingin unit test `MetricsService` tanpa polusi global registry, bisa.
2. **Explicit** — `registers: [this.registry]` memperjelas metric terdaftar di registry mana.
3. **Trade-off**: harus export `MetricsService.register` ke controller `/metrics` — extra injection. Acceptable.

Anti-pattern: jangan buat `new Registry()` per metric — itu akan menyebabkan `/metrics` hanya men-expose 1 metric per registry instance. Selalu pakai **satu registry instance** per process (singleton di `MetricsService`).

### pino-pretty dev-only transport

`pino-pretty` transport bekerja via worker thread — ada overhead. Hanya di-enable bila `NODE_ENV !== 'production'`:

```ts
transport: cfg.get('NODE_ENV') !== 'production'
  ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
  : undefined,
```

Production: log newline-delimited JSON ke stdout — Loki / Fluentd / CloudWatch Logs pick up via stdout pipe.

### Histogram buckets chosen per SLO

Buckets dipilih berdasarkan SLO demo:
- `payment_gateway_request_duration_seconds`: target p95 < 1s, timeout 2s. Buckets `[0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]` — `+Inf` otomatis.
- `payment_processing_duration_seconds`: target p95 < 30s (3 attempts × max 2s timeout + backoff). Buckets `[0.1, 0.5, 1, 2, 5, 10, 30, 60, 120]`.

Production tuning: load test → inspect histogram → adjust buckets. Document di TASK-15.

### NO high-cardinality labels (trace_id, payment_id, order_id as log fields, not metric labels)

Anti-pattern yang harus TIDAK ada di code review:

```ts
// ❌ BAD — cardinality explosion
new Counter({
  name: 'payment_gateway_requests_total',
  labelNames: ['payment_id', 'trace_id', 'error_message'],  // ← !!!
});

// ✅ GOOD — low cardinality
new Counter({
  name: 'payment_gateway_requests_total',
  labelNames: ['outcome', 'http_status'],  // outcome: 2 values, http_status: ~10 values
});
```

`trace_id` (UUID v4 — praktis unlimited), `payment_id` (UUID v4 — unlimited), `order_id` (business identifier — bisa jutaan), raw `error_message` (free text) → semua hanya sebagai **pino log field** + persisted di `payment_attempts`. TIDAK pernah jadi metric label.

### OTel simplified for now (trace ID custom-generated + persisted in payment_attempts)

Plan section 13.3 + 22 menyebut full OTel + Jaeger:

> - Trace payment dapat ditemukan di Jaeger.
> - Docker full stack berjalan (postgres + payment-api + gateway-mock + prometheus + grafana + jaeger).

Untuk demo ini, **trace ID via `AsyncLocalStorage` + `crypto.randomUUID()`** sudah cukup karena:

1. **Trace korelasi** — semua log line + `payment_attempts.trace_id` berbagi `traceId` yang sama dalam satu execution cycle. Investigator bisa grep log by `trace_id` + query `payment_attempts WHERE trace_id = '...'`.
2. **Persistence** — `payment_attempts.trace_id` (varchar(36)) adalah source of truth yang survive process restart. OTel span tidak persist di DB secara default.
3. **Simplicity** — full OTel SDK (`@opentelemetry/sdk-node` + auto-instrumentations + OTLP exporter) tambah ~5MB dependencies + extra config (Jaeger UI port 16686, OTLP HTTP port 4318) + docker-compose service. Untuk demo 1 monorepo, overkill.

**Full OTel SDK is optional future evolution** — bila user mau:

- Install `@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations-node` + `@opentelemetry/exporter-trace-otlp-http`.
- Buat `apps/payment-api/src/otel.ts` (load sebelum NestJS bootstrap via `node --import otel.js dist/main.js`).
- Replace `getTraceId()` impl — baca dari `trace.getSpan(context.active())?.spanContext().traceId` (bukan `AsyncLocalStorage`).
- Add Jaeger service di docker-compose (port 16686 UI, 4318 OTLP HTTP).
- Update DoD checklist (section 22) "Trace payment dapat ditemukan di Jaeger" → ✓.

Document di TASK-15 production caveats: "Full OTel SDK optional extension — lihat TASK-11 section 16 implementation step".

### After this task done — TASK-12 (Next.js) + TASK-13 (Vue) frontends can use `/api/metrics`

`/metrics` (Prometheus exposition text) **bukan JSON** — frontend TIDAK bisa langsung `fetch('/metrics')` lalu `JSON.parse`. Dua opsi:

1. **Backend summary endpoint** (`GET /api/metrics-summary`) yang return JSON `{ gatewayRequests: { success: 10, failure: 3, ... }, breakerState: 'closed', ... }`. Optional — bisa di-task terpisah bila frontend butuh.
2. **Frontend query Prometheus** langsung (`fetch('http://localhost:9090/api/v1/query?query=payment_gateway_requests_total')` — Prometheus HTTP API returns JSON). Lebih production-grade tapi butuh Prometheus running.

Untuk demo TASK-12 + TASK-13, opsi 1 (backend summary endpoint) lebih simple. Tercatat di TASK-12 + TASK-13 bila perlu — tidak blocking TASK-11 selesai.

### ObservabilityModule + MetricsModule separation

`ObservabilityModule` (provider `MetricsService` + `ObservabilityLogger`) di-export dari `apps/payment-api/src/modules/observability/`. `MetricsModule` (TASK-09) hanya berisi controller `/metrics` + import `ObservabilityModule` untuk dapat `MetricsService`. Pemisahan:

- `ObservabilityModule` — providers + exporters (consumed oleh `PaymentsService`, `HttpPaymentGateway`, `ResilientPaymentGateway`, `MetricsController`).
- `MetricsModule` — HTTP exposure layer (`/metrics` endpoint).

Rationale: bila masa depan ingin expose metrics via gRPC / push gateway (bukan HTTP `/metrics`), cukup swap `MetricsModule` — `ObservabilityModule` tetap utuh.

### Logger injection — PinoLogger vs ObservabilityLogger

Dua pilihan:
1. **`@InjectPinoLogger('context-name')` langsung** — idiomatis nestjs-pino, setiap class dapat logger dengan context string sendiri (e.g. `'PaymentsService'`, `'HttpPaymentGateway'`). Pino pretty-print akan tampilkan context di log line.
2. **`ObservabilityLogger` wrapper** — abstract over `PinoLogger`. Lebih portabel bila ganti logger impl.

Decision: **provide both**. Consumer boleh pilih. Recommended: pakai `@InjectPinoLogger('ClassName')` langsung — lebih idiomatis dan tidak menambah indirection.

### After this task done — TASK-14 (E2E scenarios) can assert metrics

TASK-14 (E2E via Jest + supertest) dapat menambah assertions:

```ts
const metrics = await app.inject({ method: 'GET', url: '/metrics' });
expect(metrics.body).toContain('payment_gateway_requests_total{outcome="success",http_status="200"} 1');
expect(metrics.body).toContain('circuit_breaker_state{service="payment-gateway"} 0');
```

Trace ID correlation dapat di-assert via `payment_attempts` query di test database.

TASK-15 (documentation) WAJIB menambahkan production caveat:

1. Full OTel SDK optional extension (section 16 step).
2. Histogram bucket tuning per SLO.
3. No high-cardinality labels (anti-pattern section di atas).
4. `AsyncLocalStorage` overhead (~5-10% per async op).
5. Single registry instance per process (anti-pattern: `new Registry()` per metric).
6. pino-pretty dev-only, JSON to stdout for production.
7. Log aggregation (Loki / ELK / CloudWatch Logs) — deploy concern, not code.
8. Frontend tidak bisa langsung fetch `/metrics` (Prometheus text, bukan JSON) — butuh summary endpoint atau Prometheus query API.
