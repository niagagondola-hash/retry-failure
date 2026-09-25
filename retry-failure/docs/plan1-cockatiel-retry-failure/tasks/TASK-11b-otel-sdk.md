# TASK-11b - Full OpenTelemetry SDK + Jaeger Export (Extension)

> **Task ID**: 8b
> **Depends on**: 8 (TASK-11 - pino logger + prom-client metrics + AsyncLocalStorage trace context sudah jalan)
> **Estimated effort**: M (~2-3 jam)
> **Plan reference**: Section 13.3 (Tracing) + Section 22 (DoD - "Trace payment dapat ditemukan di Jaeger")
> **Prerequisite**: Docker tersedia untuk full verification (Jaeger UI). Sandbox Z.ai (no Docker) hanya bisa verify IS_OTEL=false fallback.

> **Kondisional (penting dibaca)**:
> - **Sandbox (no Docker)**: IS_OTEL=false default → SDK tidak start, fallback AsyncLocalStorage (TASK-11 simplified). Tidak ada Jaeger export, tidak ada ECONNREFUSED spam. Behavior sama dengan sebelum TASK-11b.
> - **Local Docker**: set IS_OTEL=true di .env + `docker compose up -d jaeger` → full OTel SDK aktif + Jaeger export + cross-service span tree (payment-api + gateway-mock).
> - **Test env**: NODE_ENV=test → SDK skip init (test pakai mock, tidak butuh Jaeger).
>
> **Revision history**:
> - v1 (2026-09-13): Initial creation — instrument gateway mock untuk demo cross-service span tree.
> - v2 (2026-09-20): Revisi remove gateway mock instrumentation (gateway external di production). Scope di-trim ke payment-api only.
> - **v3 (2026-09-20, current)**: Kembali ke v1 scope (instrument gateway mock) untuk demo cross-service span tree, TAPI preserve v2 conditional notes (sandbox IS_OTEL=false default + local Docker verification). User memutuskan butuh demo cross-service span tree.

---

## Goal

Mengaktifkan full OpenTelemetry SDK + Jaeger export dengan **flip env `IS_OTEL=true`**. TASK-11 sudah menyediakan `IS_OTEL` toggle di `trace-context.ts` - TASK-11b hanya perlu:

1. **Install OTel dependencies** - `@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations-node` + `@opentelemetry/exporter-trace-otlp-http` + `@opentelemetry/api` + `@opentelemetry/resources` + `@opentelemetry/semantic-conventions`.
2. **Buat `apps/payment-api/src/otel.ts`** - OTel SDK initialization (load sebelum NestJS bootstrap). File ini cek `process.env.IS_OTEL === 'true'` -> start SDK + OTLP exporter ke Jaeger.
3. **Import `./otel` di `main.ts`** - baris pertama, sebelum `NestFactory.create()`.
4. **(Opsional) Custom span di `payments.service.ts`** - create span `payment.processing` via OTel API untuk span tree visualization.
5. **(Opsional) Gateway mock instrument** - receive `traceparent` header + create child span.
6. **Set `IS_OTEL=true` di `.env`** - flip toggle. `getTraceId()` di `trace-context.ts` otomatis baca dari OTel active span.

**trace-context.ts TIDAK perlu di-modify** - TASK-11 sudah implementasi `IS_OTEL` toggle dengan lazy import + fallback ALS.

### Yang TIDAK Dilakukan TASK-11b

- Tidak modify `trace-context.ts` (sudah ada `IS_OTEL` toggle dari TASK-11).
- Tidak modify pino logger (tetap dari TASK-11).
- Tidak modify prom-client metrics (tetap dari TASK-11).
- Tidak modify `/metrics` endpoint (tetap dari TASK-11).

Setelah task ini selesai, plan section 13.3 + DoD item "Trace payment dapat ditemukan di Jaeger" tercapai penuh.

---

## Scope

**In scope**:
- `apps/payment-api/src/otel.ts` - OTel SDK initialization (load sebelum NestJS bootstrap). Cek `IS_OTEL=true` -> start SDK.
- `apps/payment-api/src/main.ts` - tambah `import './otel'` di baris pertama.
- `apps/payment-api/package.json` - tambah OTel dependencies.
- `apps/payment-api/src/modules/payments/payments.service.ts` - (opsional) create custom span `payment.processing` via OTel API.
- `apps/payment-gateway-mock/src/otel.ts` + `main.ts` - (opsional) instrument gateway mock.
- `.env.example` + `.env.sandbox.example` - tambah `IS_OTEL=false` default.
- `docker-compose.yml` - verify Jaeger service sudah ada (sudah, dari TASK-01).

**TIDAK perlu modify** (sudah disiapkan oleh TASK-11):
- ~~`trace-context.ts`~~ - sudah punya `IS_OTEL` toggle + lazy import + fallback ALS dari TASK-11.
- ~~pino logger~~ - tetap dari TASK-11.
- ~~prom-client metrics~~ - tetap dari TASK-11.
- ~~Jest tests~~ - `IS_OTEL=false` di test env, OTel SDK tidak di-load.

**Out of scope**:
- Metrics via OTel (metrics sudah via prom-client dari TASK-11 - tidak double-instrument).
- Logging via OTel (pino sudah handle dari TASK-11 - OTel log API tidak dipakai).
- Gateway mock full instrumentation (opsional - dijelaskan sebagai bonus step, boleh skip).
- Production OTel collector deployment (OTel Collector as separate service) - demo pakai Jaeger all-in-one yang punya built-in OTLP receiver.
- Sampling strategy (always-on sampling untuk demo; production butuh head-based atau tail-based sampling).

---

## What TASK-11 (simplified) already provides

TASK-11 sudah implementasi 3 pilar observability berikut:

| Pilar | TASK-11 (simplified) | TASK-11b (extension) |
|---|---|---|
| **Logging** | `nestjs-pino` + structured JSON + 11 log events + `traceId` field | Tidak diubah (pino tetap) |
| **Metrics** | `prom-client` + 7 metrics + `/metrics` endpoint | Tidak diubah (prom-client tetap) |
| **Tracing** | `AsyncLocalStorage` + `crypto.randomUUID()` + `traceId` di `payment_attempts` | **Upgrade**: OTel SDK + Jaeger export + span tree |

TASK-11b **hanya meng-upgrade tracing**. Logging dan metrics tetap pakai implementasi dari TASK-11.

---

## Architecture: Before (TASK-11) vs After (TASK-11b)

### Before (TASK-11 simplified)

```text
POST /payments
  ↓
PaymentsService.executePayment()
  ├── traceId = crypto.randomUUID()        ← custom, tidak terhubung ke HTTP request
  ├── AsyncLocalStorage.set(traceId)       ← context local saja
  ├── gateway.charge() via Cockatiel
  │     ├── attempt #1 -> audit.recordAttempt({ traceId })
  │     ├── attempt #2 -> audit.recordAttempt({ traceId })
  │     └── attempt #3 -> audit.recordAttempt({ traceId })
  └── traceId persisted di payment_attempts.trace_id

Jaeger UI: (kosong - tidak ada OTel export)
```

### After (TASK-11b full OTel)

```text
POST /payments
  ↓
OTel auto-instrumentation (HTTP server) -> root span "POST /payments"
  ↓
PaymentsService.executePayment()
  ├── custom span "payment.processing" (active span)
  │     traceId = trace.getSpan(context.active()).spanContext().traceId  ← OTel context
  ├── gateway.charge() via Cockatiel
  │     ├── attempt #1 -> axios POST -> auto span "HTTP POST /v1/charges"
  │     │     └── traceparent header di-inject otomatis
  │     ├── attempt #2 -> axios POST -> auto span
  │     └── attempt #3 -> axios POST -> auto span
  ├── audit.recordAttempt({ traceId }) -> pg INSERT -> auto span "pg.query"
  └── traceId = OTel traceId -> persisted di payment_attempts.trace_id

Jaeger UI: http://localhost:16686
  -> cari traceId -> lihat span tree:
    POST /payments (root)
      └── payment.processing
            ├── HTTP POST /v1/charges (attempt #1, error: 500)
            ├── HTTP POST /v1/charges (attempt #2, error: 500)
            ├── HTTP POST /v1/charges (attempt #3, success: 200)
            └── pg.query (INSERT payment_attempts)
```

---

## Docker prerequisites

`docker-compose.yml` sudah punya Jaeger service (dari TASK-01):

```yaml
jaeger:
  image: jaegertracing/all-in-one:1.60
  container_name: retry-failure-jaeger
  environment:
    COLLECTOR_OTLP_ENABLED: 'true'
  ports:
    - '16686:16686'  # Jaeger UI
    - '4318:4318'    # OTLP HTTP
```

**Start Jaeger** (di local dengan Docker):

```bash
cd retry-failure
docker compose up -d jaeger
# Verify: buka http://localhost:16686 -> Jaeger UI
```

---

## Files to create / modify

### Create baru

- `/apps/payment-api/src/otel.ts` - OTel SDK init (load sebelum NestJS).
- `/apps/payment-gateway-mock/src/otel.ts` - (opsional) gateway mock OTel init.

### Modify

- `apps/payment-api/src/main.ts` - tambah `import './otel'` di baris pertama.
- `apps/payment-api/package.json` - tambah OTel dependencies.
- `.env.example` + `.env.sandbox.example` - tambah `IS_OTEL=false` default.
- `apps/payment-api/src/modules/payments/payments.service.ts` - (opsional) create custom span `payment.processing`.

### TIDAK perlu modify (sudah disiapkan oleh TASK-11)

- ~~`apps/payment-api/src/modules/observability/trace-context.ts`~~ - sudah punya `IS_OTEL` toggle + lazy import `@opentelemetry/api` + fallback ALS dari TASK-11. Saat `IS_OTEL=true` dan package ter-install, `getTraceId()` otomatis baca dari OTel active span.

---

## Implementation steps

### 1. Install OTel dependencies

```bash
cd 
pnpm --filter payment-api add \
  @opentelemetry/sdk-node \
  @opentelemetry/api \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions

# Opsional: gateway mock juga instrument (untuk span tree cross-service)
pnpm --filter payment-gateway-mock add \
  @opentelemetry/sdk-node \
  @opentelemetry/api \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions
```

### 2. `apps/payment-api/src/otel.ts` - OTel SDK initialization

```ts
/**
 * OpenTelemetry SDK initialization - WAJIB di-import pertama di main.ts
 * SEBELUM NestFactory.create(), agar auto-instrumentations hook terpasang
 * sebelum module system load.
 *
 * Production: export ke OTLP collector (Jaeger all-in-one port 4318).
 * Test: skip init (NODE_ENV=test -> return early, tidak start SDK).
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

// Skip di test environment - tidak butuh Jaeger export
if (process.env.NODE_ENV !== 'test') {
  const exporterUrl = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces';

  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: 'payment-api',
      [SemanticResourceAttributes.SERVICE_VERSION]: '0.1.0',
    }),
    traceExporter: new OTLPTraceExporter({ url: exporterUrl }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable instrumentations yang tidak perlu (reduce overhead)
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();

  // Graceful shutdown - flush pending spans ke Jaeger sebelum process exit
  process.on('SIGTERM', () => {
    sdk
      .shutdown()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
```

### 3. `apps/payment-api/src/main.ts` - import otel.ts sebelum bootstrap

```ts
// WAJIB: import otel.ts pertama - sebelum apapun yang load modules
import './otel';

import { NestFactory } from '@nestjs/core';
// ... rest of existing main.ts (tidak diubah)
```

### 4. trace-context.ts - TIDAK perlu modify

TASK-11 sudah mengimplementasi `IS_OTEL` toggle di `trace-context.ts` dengan:

- `const IS_OTEL = process.env.IS_OTEL === 'true'`
- `getTraceId()` async: bila `IS_OTEL=true`, lazy `await import('@opentelemetry/api')` -> baca active span -> fallback ALS
- `getTraceIdSync()`: sync version untuk pino mixin (tidak support OTel, ALS only)
- `withTrace()`: set ALS context untuk fallback compatibility

Saat TASK-11b dieksekusi:
1. `@opentelemetry/api` ter-install -> `await import('@opentelemetry/api')` sukses
2. `IS_OTEL=true` di `.env` -> `getTraceId()` coba OTel span dulu
3. OTel SDK aktif (via `otel.ts`) -> `trace.getSpan(context.active())` return active span
4. Trace ID = OTel trace ID (sama dengan yang di-export ke Jaeger)

Bila `IS_OTEL=true` TAPI TASK-11b belum dieksekusi (package belum install):
- `await import('@opentelemetry/api')` -> catch (module not found)
- Fallback ALS -> tetap berfungsi (TASK-11 simplified behavior)

**Tidak ada yang perlu diubah di `trace-context.ts`.**

### 5. Modify `payments.service.ts` - create custom span di executePayment

```ts
import { trace } from '@opentelemetry/api';

// Di dalam executePayment(), setelah atomicUpdateStatus + sebelum gateway.charge():
async executePayment(paymentId: string, options: ExecuteOptions): Promise<Payment> {
  // ... existing code (findById, assertCanTransition, atomicUpdateStatus) ...

  const tracer = trace.getTracer('payment-api');
  const span = tracer.startSpan('payment.processing', {
    attributes: {
      'payment.id': paymentId,
      'payment.order_id': payment.orderId,
      'payment.source': options.source,
    },
  });

  try {
    // Existing: traceId + attachAuditCallback + gateway.charge + applyOutcome
    const result = await context.with(trace.setSpan(context.active(), span), async () => {
      // ... existing executePayment body ...
    });
    return result;
  } catch (err) {
    span.recordException(err);
    span.setStatus({ code: trace.SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
    throw err;
  } finally {
    span.end();
  }
}
```

### 6. (Opsional) `apps/payment-gateway-mock/src/otel.ts` - gateway mock OTel

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

if (process.env.NODE_ENV !== 'test') {
  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: 'payment-gateway-mock',
    }),
    traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
  process.on('SIGTERM', () => sdk.shutdown().then(() => process.exit(0)));
}
```

Lalu di `apps/payment-gateway-mock/src/main.ts`:

```ts
import './otel'; // pertama
import { NestFactory } from '@nestjs/core';
// ... rest
```

Dengan ini, trace context otomatis propagate dari payment-api -> gateway mock via W3C `traceparent` header (di-inject oleh axios auto-instrumentation, di-receive oleh HTTP server auto-instrumentation di gateway mock). Jaeger UI akan menampilkan cross-service span tree.

### 7. Verify docker-compose.yml - Jaeger sudah ada (tidak perlu diubah)

```yaml
jaeger:
  image: jaegertracing/all-in-one:1.60
  container_name: retry-failure-jaeger
  environment:
    COLLECTOR_OTLP_ENABLED: 'true'
  ports:
    - '16686:16686'  # Jaeger UI
    - '4318:4318'    # OTLP HTTP
```

---

## Acceptance criteria

### Setup (wajib)

- [ ] 6 OTel packages ter-install di `apps/payment-api` (lihat `package.json`).
- [ ] 6 OTel packages ter-install di `apps/payment-gateway-mock` (lihat `package.json`).
- [ ] `apps/payment-api/src/otel.ts` dibuat dengan NodeSDK init.
- [ ] `apps/payment-gateway-mock/src/otel.ts` dibuat dengan NodeSDK init.
- [ ] `apps/payment-api/src/main.ts` import `./otel` di baris pertama.
- [ ] `apps/payment-gateway-mock/src/main.ts` import `./otel` di baris pertama.
- [ ] `.env.example` + `.env.sandbox.example` punya `IS_OTEL=false` default + `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces` default.

### Sandbox verification (IS_OTEL=false, no Docker — Z.ai sandbox)

- [ ] `pnpm test` PASS — OTel SDK tidak aktif (NODE_ENV=test skip init).
- [ ] `pnpm typecheck` PASS.
- [ ] `pnpm lint` PASS.
- [ ] `pnpm --filter payment-api start:dev` start tanpa error (IS_OTEL=false, fallback ALS).
- [ ] `pnpm --filter payment-gateway-mock start:dev` start tanpa error.
- [ ] Tidak ada error ECONNREFUSED ke localhost:4318 di log (SDK tidak start karena IS_OTEL=false gating).
- [ ] `POST /payments` dengan gateway mode `always-success` -> payment succeeded (behavior sama dengan TASK-11 simplified).
- [ ] `trace_id` di `payment_attempts` DB = UUID format (36 chars, dari ALS fallback `crypto.randomUUID()`).

### Local Docker verification (IS_OTEL=true, with Docker — local machine)

- [ ] `docker compose up -d jaeger` start Jaeger all-in-one di port 16686 + 4318.
- [ ] Set `IS_OTEL=true` di `apps/payment-api/.env`.
- [ ] `pnpm --filter payment-api start:dev` start payment-api dengan OTel SDK aktif (log: "SDK started" atau tidak ada error).
- [ ] `pnpm --filter payment-gateway-mock start:dev` start gateway-mock dengan OTel SDK aktif.
- [ ] `POST /payments` dengan gateway mode `always-success` -> payment succeeded.
- [ ] Buka `http://localhost:16686` -> Service dropdown ada `payment-api` DAN `payment-gateway-mock`.
- [ ] Cari trace -> lihat span tree (cross-service):
  ```
  POST /payments (root span, payment-api)
    └── payment.processing (custom span, payment.id, payment.order_id, payment.source)
          ├── HTTP POST /v1/charges (attempt #1, payment-api axios span)
          │     └── POST /v1/charges (gateway-mock child span, cross-service!)
          └── pg.query (INSERT payment_attempts, payment-api pg span)
  ```
- [ ] Trace ID di Jaeger = trace ID di `payment_attempts.trace_id` (korelasi terbukti).
- [ ] Scenario `fail-first-n=2` -> span tree menampilkan 3 attempt spans (2 error + 1 success):
  ```
  POST /payments (payment-api)
    └── payment.processing
          ├── HTTP POST /v1/charges (attempt #1, ERROR 500)
          │     └── POST /v1/charges (gateway-mock)
          ├── HTTP POST /v1/charges (attempt #2, ERROR 500)
          │     └── POST /v1/charges (gateway-mock)
          └── HTTP POST /v1/charges (attempt #3, OK 200)
                └── POST /v1/charges (gateway-mock)
  ```
- [ ] Span error menampilkan exception message + stack trace di Jaeger UI (click span -> "Logs" tab).
- [ ] Cross-service span tree visible: payment-api spans punya child span dari payment-gateway-mock (via W3C `traceparent` header propagation).

### Quality gates

- [ ] `pnpm typecheck` + `pnpm lint` lulus.
- [ ] `pnpm test` lulus (OTel SDK tidak aktif di test env - `NODE_ENV=test` skip init).

---

## Useful commands (run after completing this task)

### Pre-flight Check

> **WAJIB**: task ini BUTUH Docker (Jaeger all-in-one). Tidak bisa di-test di sandbox Z.ai (no Docker).
>
> Pastikan Anda di **KONDISI LOCAL** dengan Docker tersedia:
> ```bash
> docker --version
> # ada output version string -> KONDISI LOCAL, lanjutkan
> ```

---

```bash
# 1. Start Jaeger (via docker-compose)
cd 
docker compose up -d jaeger
sleep 3
# Verify: curl http://localhost:16686 -> Jaeger UI HTML

# 2. Start PostgreSQL (butuh untuk payment-api)
docker compose up -d postgres
sleep 3

# 3. Run migration (bila belum)
pnpm db:migrate

# 4. Start gateway mock (with OTel)
cd apps/payment-gateway-mock
PORT=3001 pnpm start:dev > /tmp/gateway-mock.log 2>&1 &
sleep 5

# 5. Start payment-api (with OTel)
cd apps/payment-api
PORT=3000 pnpm start:dev > /tmp/payment-api.log 2>&1 &
sleep 5

# 6. Set gateway mode always-success
curl -X PUT -H 'Content-Type: application/json' \
  http://localhost:3001/admin/config \
  -d '{"mode":"always-success"}'

# 7. Create payment
curl -X POST -H 'Content-Type: application/json' \
  http://localhost:3000/payments \
  -d '{"orderId":"OTEL-1","amount":100,"currency":"IDR"}' | jq .

# 8. Verify trace ID di DB
docker compose exec postgres \
  psql -U retry_failure -d retry_failure \
  -c "SELECT attempt_number, outcome, trace_id FROM payment_attempts ORDER BY created_at DESC LIMIT 5;"

# 9. Buka Jaeger UI
echo "Buka browser: http://localhost:16686"
echo "-> Service dropdown: pilih 'payment-api'"
echo "-> Find Traces: klik 'Find Traces'"
echo "-> Klik trace -> lihat span tree"
echo "-> Verify: trace ID di Jaeger = trace_id di payment_attempts"

# 10. Test fail-first-n=2 (3 attempts -> span tree dengan error spans)
curl -X PUT -H 'Content-Type: application/json' \
  http://localhost:3001/admin/config \
  -d '{"mode":"fail-first-n","n":2}'

curl -X POST -H 'Content-Type: application/json' \
  http://localhost:3000/payments \
  -d '{"orderId":"OTEL-2","amount":100,"currency":"IDR"}' | jq .

# Buka Jaeger UI -> cari trace baru -> span tree:
#   POST /payments
#     └── payment.processing
#           ├── HTTP POST /v1/charges (ERROR 500)
#           ├── HTTP POST /v1/charges (ERROR 500)
#           └── HTTP POST /v1/charges (OK 200)

# 11. Cleanup
pkill -f "nest start"
docker compose down
```

---

## Notes

### Critical implementation notes

- **OTel SDK harus di-import sebelum NestFactory.create()** - auto-instrumentations hook ke Node.js module system (require/import). Bila di-import setelah module system sudah load modules (mis. axios, pg), hook tidak tertangkap -> span tidak dibuat. Pattern: `import './otel'` di baris pertama `main.ts`.

- **IS_OTEL gating di otel.ts (penting)** - File `otel.ts` cek `IS_OTEL === 'true' && NODE_ENV !== 'test'` sebelum start SDK. Ini mencegah:
  - **Sandbox (no Docker)**: IS_OTEL=false default → SDK tidak start → tidak ada ECONNREFUSED spam ke localhost:4318 (Jaeger tidak running di sandbox).
  - **Test env**: NODE_ENV=test → SDK skip init → test pakai mock, tidak butuh Jaeger.
  - **Local Docker**: IS_OTEL=true + Jaeger running → SDK start, full OTel export.

- **NODE_ENV=test skip SDK** - Jest tidak butuh OTel (test pakai mock). `otel.ts` cek `process.env.NODE_ENV !== 'test'` untuk skip init. Test tetap pakai `AsyncLocalStorage` fallback via `getTraceId()`.

- **AsyncLocalStorage tetap dipertahankan** - `getTraceId()` prefer OTel active span, fallback AsyncLocalStorage. Ini untuk backward compatibility dengan TASK-11 code yang pakai `withTrace()`. Bila OTel SDK tidak aktif (test, atau dev tanpa Jaeger), behavior sama dengan TASK-11 simplified.

### Cross-service span tree (v3 scope)

- **Gateway mock instrument untuk demo** - v3 kembali ke v1 scope: instrument gateway mock supaya Jaeger UI menampilkan cross-service span tree (payment-api + payment-gateway-mock). Ini untuk demo purposes — di production, gateway adalah external service yang tidak bisa di-instrument.

- **Traceparent header propagation** - axios auto-instrumentation di payment-api inject W3C `traceparent` header ke setiap HTTP request ke gateway. HTTP server auto-instrumentation di gateway mock receive header tersebut + create child span. Hasilnya: span tree cross-service di Jaeger UI.

- **Production realitas** - Di production, gateway (Stripe, Midtrans, Xendit) adalah external service. Kita tidak punya akses untuk instrument codebase mereka. Span tree di Jaeger akan berhenti di HTTP client span payment-api (tidak ada child span dari gateway). Untuk demo project ini, gateway mock di-instrument supaya bisa lihat full span tree.

### Other notes

- **Sampling** - demo pakai always-on (100% sampling). Production butuh sampling strategy (head-based 10% atau tail-based dengan adaptive sampling). Document di TASK-15 caveats.

- **Performance overhead** - OTel auto-instrumentation add ~5-10% overhead per HTTP call (span create + export). Untuk demo (ratusan RPS), acceptable. Production high-throughput (>10k RPS) -> pertimbangkan sampling atau custom instrumentation (hanya span yang penting).

- **DoD update** - setelah task ini selesai, plan section 22 DoD item "Trace payment dapat ditemukan di Jaeger" -> ✓.

- **TASK-11 tidak perlu di-rerun** - TASK-11b adalah add-on. Bila TASK-11b tidak dieksekusi, TASK-11 simplified tetap berfungsi (trace ID via AsyncLocalStorage, tidak ada Jaeger UI, tapi trace ID di `payment_attempts` + pino log tetap ada).

- **API v2 fix** - @opentelemetry/resources 2.11.0 meng-deprecate `Resource` class. Pakai `resourceFromAttributes()` + `SEMRESATTRS_SERVICE_NAME` (bukan `SemanticResourceAttributes.SERVICE_NAME`).

---

## What this task achieves vs plan section 13.3

| Plan section 13.3 requirement | TASK-11 (simplified) | TASK-11b (this task) |
|---|---|---|
| "satu trace menggambarkan payment journey" | ✅ (trace ID shared via AsyncLocalStorage) | ✅ (span tree di Jaeger UI) |
| "span error memperlihatkan failure" | ❌ (tidak ada span) | ✅ (error spans dengan exception + stack trace) |
| "trace context propagate ke mock" | ❌ (tidak ada traceparent header) | ✅ (W3C traceparent via axios auto-instrumentation) |
| "trace ID dapat dikorelasikan dengan payment_attempts" | ✅ (traceId field di DB) | ✅ (trace ID sama = OTel trace ID = DB trace_id) |
| "Gateway mock juga diinstrument" | ❌ | ✅ (opsional - step 6) |
| DoD: "Trace payment dapat ditemukan di Jaeger" | ❌ | ✅ |
