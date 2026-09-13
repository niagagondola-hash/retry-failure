# TASK-09 — Next.js API Routes (Payments + Health + Metrics)

> **Task ID**: 6-b
> **Depends on**: 5 (payments service) + 6-a (audit trail)
> **Estimated effort**: M (~1.5 jam)
> **Plan reference**: Section 10 (Payment API), Section 13 (Observability — metrics endpoint)

---

## Goal

Expose `PaymentsService` (TASK-07) + audit (TASK-08) via Next.js App Router API routes. Endpoint lengkap sesuai plan section 10.1, dengan zod validation dan error response yang konsisten.

## Scope

**In scope**:
- `POST /api/payments` — create + process payment.
- `GET /api/payments?status=` — list/filter.
- `GET /api/payments/:id` — detail + attempts.
- `POST /api/payments/:id/retry` — manual retry.
- `GET /api/health` — DB health.
- `GET /api/metrics` — Prometheus metrics (stub; full registry di TASK-11).
- `src/lib/payments/api/schemas.ts` — zod schemas untuk request/response.
- `src/lib/payments/api/errors.ts` — `HttpError` class + mapper.
- `src/lib/payments/api/responses.ts` — helper `jsonResponse(data, status)`.

**Out of scope**:
- Frontend UI (di TASK-12).
- Metrics actual emission (di TASK-11, di sini cuma expose endpoint + minimal counter).
- CORS handler (Next.js same-origin by default; mini-service akses via XTransformPort).

## Endpoints (plan section 10.1)

| Method | Path | Body / Query | Response |
|---|---|---|---|
| POST | `/api/payments` | `{ orderId, amount, currency? }` | `201 { payment }` |
| GET | `/api/payments` | `?status=processing\|succeeded\|failed\|scheduled_for_retry` | `200 { payments: [...] }` |
| GET | `/api/payments/:id` | — | `200 { payment, attempts: [...] }` |
| POST | `/api/payments/:id/retry` | — | `200 { payment }` |
| GET | `/api/health` | — | `200 { db: 'ok', gateway: 'ok' \| 'down' }` |
| GET | `/api/metrics` | — | `200 text/plain` (Prometheus format) |

## Files to create

- `/home/z/my-project/src/lib/payments/api/schemas.ts` — zod schemas.
- `/home/z/my-project/src/lib/payments/api/errors.ts` — `HttpError` + handler.
- `/home/z/my-project/src/lib/payments/api/responses.ts` — response helpers.
- `/home/z/my-project/src/lib/payments/api/service-instance.ts` — singleton `getPaymentsService()` (handle Next.js hot reload).
- `/home/z/my-project/src/app/api/payments/route.ts` — POST + GET.
- `/home/z/my-project/src/app/api/payments/[id]/route.ts` — GET detail.
- `/home/z/my-project/src/app/api/payments/[id]/retry/route.ts` — POST retry.
- `/home/z/my-project/src/app/api/health/route.ts` — GET.
- `/home/z/my-project/src/app/api/metrics/route.ts` — GET (Prometheus text).

## Implementation steps

1. `api/schemas.ts`:
   ```ts
   import { z } from 'zod';
   export const createPaymentSchema = z.object({
     orderId: z.string().min(1).max(64),
     amount: z.number().positive().max(1_000_000),
     currency: z.string().length(3).default('IDR'),
   });
   export const listPaymentsSchema = z.object({
     status: z.enum(['processing', 'succeeded', 'failed', 'scheduled_for_retry']).optional(),
   });
   ```
2. `api/errors.ts`:
   ```ts
   export class HttpError extends Error {
     constructor(public status: number, public code: string, message: string) { super(message); }
   }
   export function errorHandler(err: unknown): Response {
     if (err instanceof HttpError) return jsonResponse({ error: err.code, message: err.message }, err.status);
     if (err instanceof z.ZodError) return jsonResponse({ error: 'validation_error', issues: err.issues }, 400);
     console.error('Unhandled:', err);
     return jsonResponse({ error: 'internal_error', message: 'Unexpected error' }, 500);
   }
   ```
3. `api/responses.ts`:
   ```ts
   export function jsonResponse(data: unknown, status = 200, headers: Record<string,string> = {}): Response {
     return new Response(JSON.stringify(data), {
       status, headers: { 'Content-Type': 'application/json', ...headers },
     });
   }
   ```
4. `api/service-instance.ts`:
   ```ts
   import { createPaymentsService, type PaymentsService } from '@/lib/payments';
   const globalForPayments = globalThis as unknown as { __paymentsService?: PaymentsService };
   export function getPaymentsService(): PaymentsService {
     if (!globalForPayments.__paymentsService) {
       globalForPayments.__paymentsService = createPaymentsService();
     }
     return globalForPayments.__paymentsService;
   }
   ```
5. `route.ts` files — pakai pattern:
   ```ts
   import { NextRequest } from 'next/server';
   import { getPaymentsService } from '@/lib/payments/api/service-instance';
   import { createPaymentSchema } from '@/lib/payments/api/schemas';
   import { errorHandler, jsonResponse } from '@/lib/payments/api/errors';

   export async function POST(req: NextRequest) {
     try {
       const body = await req.json();
       const input = createPaymentSchema.parse(body);
       const svc = getPaymentsService();
       const payment = await svc.createPayment(input);
       return jsonResponse({ payment }, 201);
     } catch (err) {
       return errorHandler(err);
     }
   }
   ```
6. `/api/payments/[id]/retry/route.ts`:
   ```ts
   export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
     const { id } = await ctx.params;
     const payment = await svc.manualRetry(id);
     return jsonResponse({ payment });
   }
   ```
7. `/api/health/route.ts`:
   - Cek DB: `await db.$queryRaw\`SELECT 1\``.
   - Cek gateway: HEAD `http://localhost:3001/admin/config` (timeout 1s).
   - Return `{ db: 'ok'|'down', gateway: 'ok'|'down', timestamp }`.
8. `/api/metrics/route.ts`:
   - Stub: import `register` dari `@/lib/observability/metrics` (akan dibuat di TASK-11). Untuk sementara, bila belum ada, return basic counter text.
   - `return new Response(await register.metrics(), { headers: { 'Content-Type': register.contentType } });`

## Acceptance criteria

- [ ] `POST /api/payments -d '{"orderId":"X","amount":100}'` returns `201 { payment: {...} }`.
- [ ] Zod validation: body tanpa `orderId` → `400 { error: 'validation_error', issues: [...] }`.
- [ ] `GET /api/payments?status=failed` returns filtered list.
- [ ] `GET /api/payments/<id>` returns `{ payment, attempts }`.
- [ ] `POST /api/payments/<id>/retry` on `failed` payment → returns updated payment (status `processing` or terminal).
- [ ] `POST /api/payments/<id>/retry` on `succeeded` → `409 { error: 'invalid_state' }`.
- [ ] `GET /api/health` returns `{ db: 'ok', gateway: 'ok'|'down' }`.
- [ ] `GET /api/metrics` returns `text/plain` Prometheus format.
- [ ] `bun run lint` bersih.
- [ ] `bunx tsc --noEmit` bersih.
- [ ] Dev server (`bun run dev`) tidak crash saat route dipanggil; cek `dev.log`.

## Useful commands (run after completing this task)

```bash
# 0. Pastikan gateway mock + db siap
cd /home/z/my-project/mini-services/payment-gateway-mock && bun run dev > /tmp/gateway.log 2>&1 &
sleep 2
bun run db:push && bun run db:generate
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"always-success"}'

# 1. Lint & typecheck
bun run lint
bunx tsc --noEmit

# 2. Start dev server (background)
bun run dev > /tmp/next-dev.log 2>&1 &
sleep 5
tail -n 20 /home/z/my-project/dev.log

# 3. Test create payment
curl -s -X POST http://localhost:3000/api/payments \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"API-1","amount":1500,"currency":"IDR"}' | jq .

# 4. Test list
curl -s "http://localhost:3000/api/payments?status=succeeded" | jq .

# 5. Test detail (use ID from step 3)
PAYMENT_ID=$(curl -s "http://localhost:3000/api/payments" | jq -r '.payments[0].id')
curl -s "http://localhost:3000/api/payments/$PAYMENT_ID" | jq .

# 6. Test manual retry (first set gateway to always-success, then create+retry a failed one)
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"client-error"}'
FAILED_ID=$(curl -s -X POST http://localhost:3000/api/payments -H 'Content-Type: application/json' -d '{"orderId":"API-2","amount":200}' | jq -r '.payment.id')
curl -s "http://localhost:3000/api/payments/$FAILED_ID" | jq .
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"always-success"}'
curl -s -X POST "http://localhost:3000/api/payments/$FAILED_ID/retry" | jq .

# 7. Test validation error
curl -s -X POST http://localhost:3000/api/payments \
  -H 'Content-Type: application/json' \
  -d '{"amount":100}'  # missing orderId
# expected: 400 validation_error

# 8. Test health
curl -s http://localhost:3000/api/health | jq .

# 9. Test metrics (stub OK)
curl -s http://localhost:3000/api/metrics

# 10. Restart scheduler reference (untuk konfirmasi route accessible)
# (TASK-10 akan pakai POST /api/payments/:id/retry)

# 11. Cek dev log untuk error
tail -n 50 /home/z/my-project/dev.log
```

## Notes

- **Singleton service**: `getPaymentsService()` di `globalThis` agar survive hot reload. Penting karena Cockatiel breaker singleton juga harus survive.
- **Error format**: konsisten `{ error: string, message?: string, issues?: zodIssue[] }`.
- **No CORS needed**: API dipanggil same-origin dari Next.js page (`/api/...`). Mini-service scheduler akan call langsung via `http://localhost:3000` (server-to-server).
- **Logging**: setiap request log line `[api] POST /api/payments 201 42ms`. Full structured logging di TASK-11.
- **Manual retry state guard**: hanya `failed` dan `scheduled_for_retry` yang boleh di-retry manual. `succeeded` → `409`.
- **Idempotency**: API ini TIDAK menerima `Idempotency-Key` dari client — di-derive dari `payment.id` internal. Sesuai plan section 9 yang menyebut key = `payment.id`.
- Setelah task ini selesai, TASK-10 (scheduler) bisa trigger retry via HTTP, dan TASK-12 (frontend) bisa render data.
