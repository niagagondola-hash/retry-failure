# TASK-06 — PaymentGatewayPort + HTTP Adapter + Resilient Adapter

> **Task ID**: 4
> **Depends on**: 2-a (database), 2-b (gateway mock), 3 (cockatiel policies), 2-c (classifier)
> **Estimated effort**: M (~1.5 jam)
> **Plan reference**: Section 2.2 (dependency flow), Section 5 (resilience), Section 6 (Retry-After), Section 9 (Idempotency)

---

## Goal

Mendefinisikan `PaymentGatewayPort` interface, implementasi `HttpPaymentGateway` (axios → gateway mock), dan `ResilientPaymentGateway` yang membungkus dengan Cockatiel composition. Sertakan injeksi `Idempotency-Key` dan deteksi replay.

## Scope

**In scope**:
- `src/lib/payments/gateway/port.ts` — interface `PaymentGatewayPort`.
- `src/lib/payments/gateway/types.ts` — DTOs `ChargeRequest`, `ChargeResult`, `ReplayInfo`.
- `src/lib/payments/gateway/http-adapter.ts` — `HttpPaymentGateway` (axios, tanpa resilience).
- `src/lib/payments/gateway/resilient-adapter.ts` — `ResilientPaymentGateway` membungkus dengan `executeWithResilience`.
- `src/lib/payments/gateway/idempotency-key.ts` — helper derive key dari payment.id.
- `src/lib/payments/gateway/index.ts` — barrel + factory `createPaymentGateway(config)`.

**Out of scope**:
- Audit trail persistensi (di TASK-08).
- Payment service orchestration (di TASK-07).
- Metrics emission sebenarnya (di TASK-11, di sini cuma callback stub).

## Dependency flow (plan section 2.2)

```text
PaymentsService (TASK-07)
   ↓
PaymentGatewayPort (interface)
   ↓
ResilientPaymentGateway (this task)
   ↓
executeWithResilience (Cockatiel, TASK-05)
   ↓
HttpPaymentGateway.charge() (axios, this task)
   ↓
payment-gateway-mock (TASK-03) on port 3001
```

## Files to create

- `/home/z/my-project/src/lib/payments/gateway/port.ts`
- `/home/z/my-project/src/lib/payments/gateway/types.ts`
- `/home/z/my-project/src/lib/payments/gateway/http-adapter.ts`
- `/home/z/my-project/src/lib/payments/gateway/resilient-adapter.ts`
- `/home/z/my-project/src/lib/payments/gateway/idempotency-key.ts`
- `/home/z/my-project/src/lib/payments/gateway/index.ts`

## Implementation steps

1. `types.ts`:
   ```ts
   export interface ChargeRequest {
     paymentId: string;
     orderId: string;
     amount: number;          // Decimal as number (demo). Production: string-scale.
     currency: string;
   }
   export interface ChargeResult {
     status: 'succeeded' | 'failed';
     httpStatus: number;
     gatewayReference?: string;
     replayed: boolean;
     errorCode?: string;
     errorMessage?: string;
     retryAfterMs?: number;   // jika ada Retry-After header
   }
   ```
2. `port.ts`:
   ```ts
   export interface PaymentGatewayPort {
     charge(req: ChargeRequest): Promise<ChargeResult>;
   }
   ```
3. `idempotency-key.ts`:
   - `deriveIdempotencyKey(paymentId: string): string` — return `paymentId` as-is (plan section 9).
4. `http-adapter.ts`:
   - `class HttpPaymentGateway implements PaymentGatewayPort`.
   - Konstruktor: `({ baseUrl, axiosInstance?, timeoutMs })`.
   - `charge(req)`:
     - Kirim `POST {baseUrl}/v1/charges` dengan header `Idempotency-Key: <deriveIdempotencyKey(req.paymentId)>` dan `Content-Type: application/json`.
     - Body: `{ amount, currency, order_id }`.
     - Tangkap axios error: normalize jadi `ChargeResult` dengan `status: 'failed'`, `httpStatus`, `errorCode` dari `body.error_code`, `errorMessage` dari `body.message` atau `err.message`, dan `retryAfterMs` dari header `retry-after`.
     - Pada success (2xx): return `status: 'succeeded'`, `gatewayReference: body.gateway_reference`, `replayed: body.replayed === true`.
   - **Server-side only**: base URL = `http://localhost:3001` (server-to-server, tidak melalui Caddy — tidak ada XTransformPort di sini).
5. `resilient-adapter.ts`:
   - `class ResilientPaymentGateway implements PaymentGatewayPort`.
   - Konstruktor: `({ inner: PaymentGatewayPort, resilienceConfig, dependencyName = 'payment-gateway' })`.
   - `charge(req)`:
     - Wrap `inner.charge(req)` dengan `executeWithResilience`.
     - Map outcome ke `ChargeResult`:
       - Success → `ChargeResult` dari inner result.
       - Exhausted → `status: 'failed'`, `errorMessage: 'retry exhausted'`, `retryAfterMs` dari last classifier.
       - `breakerTripped: true` → `status: 'failed'`, `errorMessage: 'circuit open'`, `errorCode: 'circuit_open'`.
       - Permanent failure → `status: 'failed'` dengan classifier info.
     - Sertakan `attempts` info ke caller via optional field di `ChargeResult` (atau return object dengan metadata).
6. `index.ts`: export semua + factory:
   ```ts
   export function createPaymentGateway(config: ResilienceConfig): PaymentGatewayPort {
     const http = new HttpPaymentGateway({ baseUrl: process.env.GATEWAY_URL ?? 'http://localhost:3001', timeoutMs: config.gatewayTimeoutMs });
     return new ResilientPaymentGateway({ inner: http, resilienceConfig: config, dependencyName: 'payment-gateway' });
   }
   ```

## Acceptance criteria

- [ ] `HttpPaymentGateway.charge()` kirim POST dengan header `Idempotency-Key` ke `http://localhost:3001/v1/charges`.
- [ ] Mode `always-success` (gateway mock) → `ChargeResult.status: 'succeeded'`, `gatewayReference` ter-set.
- [ ] Mode `fail-first-n=2` + `RETRY_MAX_ATTEMPTS=3` → setelah 3 attempts, `ChargeResult.status: 'succeeded'` (retried, succeeded on 3rd).
- [ ] Mode `client-error` → `ChargeResult.status: 'failed'`, `errorCode: 'invalid_card'`, **no retry** (attempts=1).
- [ ] Mode `rate-limited` → `ChargeResult.retryAfterMs` ter-set dari header `Retry-After`.
- [ ] Mode `succeed-but-drop-response` + retry → `ChargeResult.replayed: true` pada attempt ke-2.
- [ ] Mode `always-timeout` + threshold rendah → setelah N failure, breaker tripped; next call return `errorCode: 'circuit_open'`.
- [ ] `createPaymentGateway(config)` return instance yang properly wired.
- [ ] `bun run lint` bersih.
- [ ] `bunx tsc --noEmit` bersih.

## Useful commands (run after completing this task)

```bash
# 0. Pastikan gateway mock berjalan
cd /home/z/my-project/mini-services/payment-gateway-mock && bun run dev > /tmp/gateway.log 2>&1 &
sleep 2

# 1. Set mode always-success
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"always-success"}'

# 2. Type check & lint
bunx tsc --noEmit
bun run lint

# 3. Quick E2E test gateway adapter (server-side script)
bun -e '
import { createPaymentGateway } from "./src/lib/payments/gateway";

const gw = createPaymentGateway({
  retryMaxAttempts: 3, retryBaseDelayMs: 200, retryMaxDelayMs: 2000, retryJitter: 0,
  gatewayTimeoutMs: 2000, breakerFailureThreshold: 5, breakerCooldownMs: 10000,
});

const r = await gw.charge({ paymentId: "demo-1", orderId: "ORD-1", amount: 100, currency: "IDR" });
console.log("always-success result:", r);
'

# 4. Test fail-first-n=2 (retry then succeed)
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"fail-first-n","n":2}'
bun -e '
import { createPaymentGateway } from "./src/lib/payments/gateway";
const gw = createPaymentGateway({
  retryMaxAttempts: 3, retryBaseDelayMs: 200, retryMaxDelayMs: 2000, retryJitter: 0,
  gatewayTimeoutMs: 2000, breakerFailureThreshold: 5, breakerCooldownMs: 10000,
});
const r = await gw.charge({ paymentId: "demo-2", orderId: "ORD-2", amount: 100, currency: "IDR" });
console.log("fail-first-n=2 result:", r);  // expected: succeeded after 3 attempts
'

# 5. Test permanent failure (client-error, NO retry)
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"client-error"}'
bun -e '
import { createPaymentGateway } from "./src/lib/payments/gateway";
const gw = createPaymentGateway({
  retryMaxAttempts: 3, retryBaseDelayMs: 200, retryMaxDelayMs: 2000, retryJitter: 0,
  gatewayTimeoutMs: 2000, breakerFailureThreshold: 5, breakerCooldownMs: 10000,
});
const r = await gw.charge({ paymentId: "demo-3", orderId: "ORD-3", amount: 100, currency: "IDR" });
console.log("client-error result:", r);  // expected: failed, errorCode invalid_card, attempts=1
'

# 6. Test rate-limited (Retry-After)
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"rate-limited","retryAfterSeconds":2}'
bun -e '
import { createPaymentGateway } from "./src/lib/payments/gateway";
const gw = createPaymentGateway({
  retryMaxAttempts: 2, retryBaseDelayMs: 100, retryMaxDelayMs: 1000, retryJitter: 0,
  gatewayTimeoutMs: 2000, breakerFailureThreshold: 5, breakerCooldownMs: 10000,
});
const r = await gw.charge({ paymentId: "demo-4", orderId: "ORD-4", amount: 100, currency: "IDR" });
console.log("rate-limited result:", r);  // expected: retryAfterMs >= 2000 (respected)
'

# 7. Reset mode ke always-success setelah test
curl -s -X PUT http://localhost:3001/admin/config -H 'Content-Type: application/json' -d '{"mode":"always-success"}'
```

## Notes

- **Server-side only**: `HttpPaymentGateway` memakai axios di server Next.js (App Router server components / API routes). Jangan pernah import di client component — axios + gateway URL adalah server-only.
- **Gateway URL**: `http://localhost:3001` langsung (server-to-server, tidak perlu Caddy/XTransformPort). `process.env.GATEWAY_URL` dari config.
- **Error normalization**: axios error bisa punya `err.response` (HTTP error) atau `err.code` (network error). Mapper harus handle dua-duanya → gunakan `classifyError` dari TASK-04.
- **Idempotency-Key**: tidak perlu hash; pakai `payment.id` langsung (plan section 9). Mock gateway menyimpan by key.
- **Replay detection**: mock return `replayed: true` bila key sudah ada di store. Adapter cukup pass-through field itu.
- Setelah task ini selesai, TASK-07 bisa pakai `createPaymentGateway(config)` di PaymentsService.
