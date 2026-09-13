# TASK-11 — Observability: Structured Logging + Prometheus Metrics

> **Task ID**: 8
> **Depends on**: 3 (cockatiel policies) + 5 (payments service)
> **Estimated effort**: M (~1.5 jam)
> **Plan reference**: Section 13 (Observability), Section 22 (Definition of Done — metrics + trace ID)

---

## Goal

Implementasi structured JSON logging (pino) dan Prometheus metrics (prom-client). Plug ke seluruh layer: gateway adapter, cockatiel policies, payments service, audit, API routes, scheduler. Trace ID per execution cycle disimpan di `payment_attempts.trace_id` + terlihat di log line.

## Scope

**In scope**:
- `src/lib/observability/logger.ts` — pino logger dengan trace context.
- `src/lib/observability/metrics.ts` — prom-client registry + semua metric di plan section 13.2.
- `src/lib/observability/trace.ts` — `withTrace<T>(fn)` AsyncLocalStorage-based, generate `traceId`.
- Plug ke:
  - Cockatiel `onFailure` / `onSuccess` hooks (TASK-05).
  - `HttpPaymentGateway` request/response logging (TASK-06).
  - `PaymentsService` lifecycle events (TASK-07).
  - `PrismaAuditService` (TASK-08) — pass `traceId` dari active context.
  - API routes (TASK-09) — request log line.
  - `/api/metrics` route — expose `register.metrics()`.
- Scheduler mini-service: structured stdout log.

**Out of scope**:
- OpenTelemetry SDK + Jaeger export (simplified; trace ID cukup untuk demo). Bila user minta full OTel, jadi task tambahan.
- Grafana dashboard provisioning file (out-of-scope untuk env ini; document sample queries di TASK-14).
- Log aggregation (Loki/ELK) — out-of-scope.

## Metrics (plan section 13.2)

| Metric | Type | Labels | Source |
|---|---|---|---|
| `payment_gateway_requests_total` | Counter | outcome, http_status | HttpPaymentGateway |
| `retry_attempts_total` | Counter | outcome, payment_status | Cockatiel onFailure + service |
| `circuit_breaker_state` | Gauge | service | breaker-store onStateChange |
| `payments_current_status` | Gauge | status | service on state transition |
| `payment_gateway_request_duration_seconds` | Histogram | (none) | HttpPaymentGateway timing |
| `payment_processing_duration_seconds` | Histogram | (none) | PaymentsService.createPayment timing |
| `gateway_idempotent_replays_total` | Counter | (none) | HttpPaymentGateway on `replayed: true` |

> **Anti-pattern**: JANGAN pakai label high-cardinality (`payment_id`, `order_id`, `trace_id`, raw error message).

## Logging events (plan section 13.1)

- payment start/finish
- attempt start/finish
- retry scheduled
- retry delay (delay_before_next_ms)
- permanent failure
- breaker state change (closed/open/half_open)
- scheduler poll (di scheduler mini-service)
- idempotency replay
- gateway failure mode (saat PUT /admin/config di gateway mock — log via dashboard)

Log line harus include `traceId` bila ada (dari AsyncLocalStorage).

## Files to create / modify

- `/home/z/my-project/src/lib/observability/logger.ts`
- `/home/z/my-project/src/lib/observability/metrics.ts`
- `/home/z/my-project/src/lib/observability/trace.ts`
- `/home/z/my-project/src/lib/observability/index.ts`
- Modify:
  - `src/lib/payments/resilience/composition.ts` — invoke metrics + log di hooks.
  - `src/lib/payments/gateway/http-adapter.ts` — time call, emit histogram + counter.
  - `src/lib/payments/service.ts` — lifecycle logs + gauge update.
  - `src/lib/payments/audit/prisma-audit.ts` — read `traceId` from AsyncLocalStorage.
  - `src/app/api/metrics/route.ts` — finalize to use real registry.
  - `src/app/api/payments/route.ts` — request log line.

## Implementation steps

1. `logger.ts`:
   ```ts
   import pino from 'pino';
   export const logger = pino({
     level: process.env.LOG_LEVEL ?? 'info',
     ...(process.env.NODE_ENV !== 'production' && { transport: { target: 'pino-pretty', options: { colorize: true } } }),
   });
   export type Logger = typeof logger;
   ```
2. `trace.ts`:
   ```ts
   import { AsyncLocalStorage } from 'node:async_hooks';
   interface TraceContext { traceId: string; paymentId?: string; }
   const als = new AsyncLocalStorage<TraceContext>();
   export function withTrace<T>(fn: () => Promise<T>, opts?: { paymentId?: string }): Promise<T> {
     const traceId = crypto.randomUUID();
     return als.run({ traceId, ...opts }, fn);
   }
   export function getTraceContext(): TraceContext | undefined { return als.getStore(); }
   export function getTraceId(): string | undefined { return als.getStore()?.traceId; }
   ```
3. `metrics.ts`:
   ```ts
   import { Registry, Counter, Gauge, Histogram } from 'prom-client';
   export const register = new Registry();
   register.setDefaultLabels({ app: 'payment-api' });

   export const gatewayRequestsTotal = new Counter({
     name: 'payment_gateway_requests_total', help: 'Gateway requests total',
     registers: [register], labelNames: ['outcome', 'http_status'],
   });
   export const retryAttemptsTotal = new Counter({
     name: 'retry_attempts_total', help: 'Cockatiel retry attempts total',
     registers: [register], labelNames: ['outcome', 'payment_status'],
   });
   export const circuitBreakerState = new Gauge({
     name: 'circuit_breaker_state', help: 'Circuit breaker state (0=closed,1=open,2=half_open)',
     registers: [register], labelNames: ['service'],
   });
   export const paymentsCurrentStatus = new Gauge({
     name: 'payments_current_status', help: 'Payments count by status',
     registers: [register], labelNames: ['status'],
   });
   export const gatewayRequestDurationSeconds = new Histogram({
     name: 'payment_gateway_request_duration_seconds', help: 'Gateway HTTP duration',
     registers: [register], buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
   });
   export const paymentProcessingDurationSeconds = new Histogram({
     name: 'payment_processing_duration_seconds', help: 'Payment processing duration',
     registers: [register], buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
   });
   export const gatewayIdempotentReplaysTotal = new Counter({
     name: 'gateway_idempotent_replays_total', help: 'Gateway idempotent replays',
     registers: [register],
   });
   ```
4. Plug metrics di `HttpPaymentGateway.charge()`:
   - Timing: `const start = performance.now(); ... gatewayRequestDurationSeconds.observe((end-start)/1000);`
   - Counter: `gatewayRequestsTotal.inc({ outcome: result.status === 'succeeded' ? 'success' : 'failure', http_status: String(result.httpStatus) });`
   - Replay: `if (result.replayed) gatewayIdempotentReplaysTotal.inc();`
5. Plug di `ResilientPaymentGateway` / `executeWithResilience`:
   - `retryPolicy.onFailure` → `retryAttemptsTotal.inc({ outcome: 'failure', payment_status: 'n/a' });`
   - `retryPolicy.onSuccess` → `retryAttemptsTotal.inc({ outcome: 'success', payment_status: 'n/a' });`
   - Breaker `onStateChange(newState)` → `circuitBreakerState.set({ service: 'payment-gateway' }, newState === 'closed' ? 0 : newState === 'open' ? 1 : 2);`
6. Plug di `PaymentsService`:
   - `paymentProcessingDurationSeconds` timing di `createPayment`.
   - `paymentsCurrentStatus.set({ status: newStatus }, await repo.countByStatus(newStatus))` on each transition (atau simpler: `inc`/`dec` delta).
   - Lifecycle logs: `logger.info({ traceId, paymentId, event: 'payment_start' }, '...')`.
7. Plug di `PrismaAuditService.recordAttempt`:
   - `const traceId = input.traceId ?? getTraceId();` then persist.
8. `/api/metrics/route.ts`:
   ```ts
   import { register } from '@/lib/observability/metrics';
   export async function GET() {
     return new Response(await register.metrics(), {
       headers: { 'Content-Type': register.contentType },
     });
   }
   ```
9. `/api/payments/route.ts`:
   - Add request log: `logger.info({ method: 'POST', path: '/api/payments', traceId }, 'api_request');`
10. Scheduler mini-service: pakai `console.log(JSON.stringify({ ts, event, ... }))` (Bun stdout sudah JSON-friendly). Tidak perlu pino di mini-service.

## Acceptance criteria

- [ ] `curl http://localhost:3000/api/metrics` returns text dengan semua 7 metric di atas.
- [ ] Setelah create 1 payment successful → `payment_gateway_requests_total{outcome="success",http_status="200"}` increment.
- [ ] Setelah retry exhausted → `retry_attempts_total{outcome="failure",...}` reflects attempt count.
- [ ] Setelah breaker open (3 failures) → `circuit_breaker_state{service="payment-gateway"}` set ke `1`.
- [ ] Setelah replay (succeed-but-drop-response mode) → `gateway_idempotent_replays_total` increment.
- [ ] `payments_current_status{status="succeeded"}` reflects count of succeeded payments.
- [ ] Log line mengandung `traceId` field (cek stdout atau dev.log).
- [ ] `payment_attempts.trace_id` terisi dengan trace ID yang sama untuk seluruh attempts dalam satu execution cycle.
- [ ] `bun run lint` bersih.
- [ ] `bunx tsc --noEmit` bersih.

## Useful commands (run after completing this task)

```bash
# 0. Start gateway mock + dev server
cd /home/z/my-project/mini-services/payment-gateway-mock && bun run dev > /tmp/gateway.log 2>&1 &
sleep 1
bun run dev > /tmp/next-dev.log 2>&1 &
sleep 5

# 1. Lint & typecheck
bun run lint
bunx tsc --noEmit

# 2. Reset gateway mode
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"fail-first-n","n":2}'

# 3. Create payment (triggers retries + metrics)
curl -s -X POST http://localhost:3000/api/payments \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"OBS-1","amount":100}' | jq .

# 4. Inspect metrics
curl -s http://localhost:3000/api/metrics | grep -E 'payment_gateway_requests_total|retry_attempts_total|payment_processing_duration|payments_current_status'

# 5. Inspect logs (structured JSON)
tail -n 50 /home/z/my-project/dev.log | grep -E '"event"|payment_start|attempt_finish'

# 6. Inspect payment_attempts with trace_id
sqlite3 /home/z/my-project/db/custom.db \
  "SELECT attempt_number, outcome, trace_id, duration_ms FROM PaymentAttempt WHERE paymentId IN (SELECT id FROM Payment WHERE orderId='OBS-1') ORDER BY attempt_number;"

# 7. Trigger breaker OPEN (always-timeout)
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"always-timeout","timeoutMs":10000}'
for i in 1 2 3; do
  curl -s -X POST http://localhost:3000/api/payments -H 'Content-Type: application/json' -d "{\"orderId\":\"OBS-BREAK-$i\",\"amount\":50}" > /dev/null
done
curl -s http://localhost:3000/api/metrics | grep circuit_breaker_state
# expected: circuit_breaker_state{service="payment-gateway"} 1

# 8. Reset
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"always-success"}'
```

## Notes

- **AsyncLocalStorage** untuk trace context bekerja lintas async boundary (Cockatiel internal await, axios, prisma). Tested di Next.js server runtime.
- **Prom-client default registry**: jangan create new registry per metric — pakai shared `register` instance.
- **pino-pretty**: dev-only transport. Production pakai raw JSON (lebih murah).
- **Histogram buckets**: pilih berdasarkan SLO. Untuk gateway call (biasanya 100ms-5s), buckets di atas OK.
- **No high-cardinality labels**: trace_id, payment_id, order_id, error_message — JANGAN jadi label. Log aja (pino).
- **OpenTelemetry**: skip untuk sekarang (env constraint). Trace ID kita generate sendiri + persist di `payment_attempts`. Bila user minta full OTel + Jaeger, jadi task tambahan setelah TASK-14.
- Setelah task ini selesai, TASK-12 (frontend) bisa pakai `/api/metrics` untuk render snapshot.
