# TASK-05 — Cockatiel Resilience Adapter

> **Task ID**: 3
> **Depends on**: 2-c (error classification) + 1 (config)
> **Estimated effort**: M (~1.5 jam)
> **Plan reference**: Section 5 (Resilience Architecture), Section 15 (Configuration)

---

## Goal

Membangun **policy composition Cockatiel** untuk request-level resilience gateway call. Komposisi: `CircuitBreaker → Retry → Timeout → call`. Circuit breaker adalah **long-lived singleton per dependency** (tidak dibuat ulang per request).

## Scope

**In scope**:
- `src/lib/payments/resilience/policies.ts` — builder untuk retry + timeout + circuit breaker.
- `src/lib/payments/resilience/breaker-store.ts` — singleton breaker per dependency name.
- `src/lib/payments/resilience/composition.ts` — `wrap()` composition + helper `executeWithResilience`.
- `src/lib/payments/resilience/types.ts` — `ResilienceConfig`, `ResilienceOutcome`.
- Integrasi dengan classifier (TASK-04): `handleWhen` retryable-only.
- Integrasi dengan `Retry-After` (TASK-04): kustom delay override bila server-directed delay ada.
- Event hooks untuk observability stub (di-plug penuh di TASK-11).

**Out of scope**:
- HTTP adapter (di TASK-06).
- Metrics actual emission (stub OK, full di TASK-11).
- Multi-region / distributed breaker (out-of-scope per plan section 19).

## Cockatiel API yang dipakai

> Referensi: [cockatiel npm](https://www.npmjs.com/package/cockatiel)

```ts
import { retry, handleAll, handleWhen, circuitBreaker, ConsecutiveBreaker, ExponentialBackoff, timeout, wrap, Task } from 'cockatiel';
```

- `retry({ maxAttempts, backoff: new ExponentialBackoff({ initialDelay, maxDelay, exponent, jitter }) })`
- `retry.handleAll` vs `retry.handleWhen(result => ...)` — kita pakai `handleWhen` dengan classifier.
- `circuitBreaker({ halfOpenAfter, breaker: new ConsecutiveBreaker(threshold) })`
- `timeout(duration, { strategy: 'absolute' })`
- `wrap(breakerPolicy, retryPolicy, timeoutPolicy)` — composition outer-to-inner.

## Composition order (plan section 5.1)

```text
request
  ↓
Circuit Breaker  (outermost — block fast when unhealthy)
  ↓
Retry            (retry attempts within one execution cycle)
  ↓
Timeout          (per-attempt execution time cap)
  ↓
Gateway HTTP call (innermost)
```

> **PENTING**: wrapper order memengaruhi semantics. Cockatiel `wrap(a, b, c)` akan eksekusi a paling luar. Verifikasi via test di TASK-13.

## Config (plan section 15, diadaptasi via TASK-01 config.ts)

```text
RETRY_MAX_ATTEMPTS=3
RETRY_BASE_DELAY_MS=500
RETRY_MAX_DELAY_MS=8000
RETRY_JITTER_RATIO=0.1        # Cockatiel ExponentialBackoff jitter

GATEWAY_TIMEOUT_MS=2000

BREAKER_FAILURE_THRESHOLD=3
BREAKER_COOLDOWN_MS=10000
```

## Files to create

- `/home/z/my-project/src/lib/payments/resilience/types.ts`
- `/home/z/my-project/src/lib/payments/resilience/policies.ts`
- `/home/z/my-project/src/lib/payments/resilience/breaker-store.ts`
- `/home/z/my-project/src/lib/payments/resilience/composition.ts`
- `/home/z/my-project/src/lib/payments/resilience/index.ts` — barrel.

## Implementation steps

1. `types.ts`:
   ```ts
   export interface ResilienceConfig {
     retryMaxAttempts: number;
     retryBaseDelayMs: number;
     retryMaxDelayMs: number;
     retryJitter: number;        // ratio 0..1 → Cockatiel expects jitter (number)
     gatewayTimeoutMs: number;
     breakerFailureThreshold: number;
     breakerCooldownMs: number;
   }

   export interface ResilienceOutcome<T> {
     result?: T;
     error?: unknown;
     attempts: number;
     breakerState: 'closed' | 'open' | 'half_open';
     exhausted: boolean;          // retry exhausted
     breakerTripped: boolean;     // circuit opened during this cycle
   }
   ```
2. `policies.ts`:
   - `buildRetryPolicy(config)`: `retry({ maxAttempts: config.retryMaxAttempts, backoff: new ExponentialBackoff({ initialDelay: config.retryBaseDelayMs, maxDelay: config.retryMaxDelayMs, exponent: 2, jitter: config.retryJitter }) })`.
   - `buildTimeoutPolicy(config)`: `timeout(config.gatewayTimeoutMs)`.
   - `buildBreakerPolicy(config, onStateChange?)`: `circuitBreaker({ halfOpenAfter: config.breakerCooldownMs, breaker: new ConsecutiveBreaker(config.breakerFailureThreshold) })`. Daftarkan `onHalfOpen`, `onOpen`, `onClose` listeners (stub → call optional callback).
3. `breaker-store.ts`:
   - `Map<string, BreakerPolicy>` singleton per `dependencyName`.
   - `getBreaker(name, config): BreakerPolicy` — buat sekali, reuse selamanya.
   - Export `getBreakerState(name): 'closed' | 'open' | 'half_open'` untuk observability.
4. `composition.ts`:
   - `executeWithResilience<T>({ dependencyName, fn, config }): Promise<ResilienceOutcome<T>>`.
   - Dapatkan breaker singleton.
   - Build retry + timeout (bisa fresh per call — murah).
   - `const policy = wrap(breakerPolicy, retryPolicy, timeoutPolicy)`.
   - Set `retryPolicy.onFailure(...)` → log + increment attempt counter.
   - Untuk `Retry-After` handling: cockatiel retry delay berasal dari backoff. Untuk override dengan `Retry-After`, gunakan **custom backoff strategy** atau **reject + propagate** ke caller yang kemudian schedule ulang via durable retry. **Approach yang dipilih**: bila classifier menemukan `retryAfterMs`, kita buat retry delay = `retryAfterMs` dengan `retry.handleResult` + custom `getNextDelay` — bila cockatiel API tidak mendukung dynamic delay per-attempt secara mudah, fallback: lempar error yang menyertakan `retryAfterMs` ke caller, dan retry akan memakai backoff default. **Dokumentasikan trade-off ini**.
   - Track attempts via counter dalam closure.
   - Catch `BrokenCircuitError` → return `breakerTripped: true`.
   - Catch retry exhausted → return `exhausted: true`.
5. `index.ts`: barrel export.

## Retry-After handling approach (PILIH & DOKUMENTASIKAN)

Cockatiel v4 mendukung custom backoff via `Backoff` interface. Implementasi:

```ts
import { Backoff, BackoffContext } from 'cockatiel';

class ServerDirectedOrExponentialBackoff implements Backoff {
  constructor(private opts: { base: ExponentialBackoff; getServerDelay: () => number | null }) {}
  next(ctx: BackoffContext, attempt: number) {
    const server = this.opts.getServerDelay();
    if (server != null) return server;       // server-directed wins
    return this.opts.base.next(ctx, attempt);  // fallback to exponential
  }
}
```

- `getServerDelay` adalah closure yang dibaca dari last error context (diset via `onFailure`).
- **Test**: bila gateway return 429 + `Retry-After: 10`, delay yang dipakai harus >= 10s (lihat TASK-13 scenario 5).

## Acceptance criteria

- [ ] `executeWithResilience` dapat dipanggil dengan dependency name `'payment-gateway'` dan function `() => Promise<T>`.
- [ ] Bila `fn` throw retryable 3x lalu sukses → outcome.result ter-set, attempts=3, exhausted=false.
- [ ] Bila `fn` throw retryable 3x dan maxAttempts=3 → outcome.exhausted=true, outcome.error ter-set.
- [ ] Bila `fn` throw permanent error (4xx non-429) → outcome.error ter-set, attempts=1, exhausted=false (no retry).
- [ ] Bila `fn` timeout (slow) → outcome.error = timeout, retryable → di-retry sampai exhausted.
- [ ] Setelah 3 failure beruntun → breaker OPEN; call berikutnya langsung `breakerTripped: true` tanpa call `fn`.
- [ ] Breaker singleton: dua call `getBreaker('payment-gateway')` return instance yang sama.
- [ ] `Retry-After` 10s → delay actual >= 10s (verified via unit/script).
- [ ] `bun run lint` bersih.
- [ ] `bunx tsc --noEmit` bersih.

## Useful commands (run after completing this task)

```bash
# 1. Type check
bunx tsc --noEmit

# 2. Lint
bun run lint

# 3. Quick sanity check (mock function yang gagal 2x lalu sukses)
bun -e '
import { executeWithResilience } from "./src/lib/payments/resilience";
import { config } from "./src/lib/config";

let calls = 0;
const fn = async () => {
  calls++;
  if (calls < 3) {
    const err = new Error("server down") as any;
    err.response = { status: 500 };
    err.code = "ERR_BAD_RESPONSE";
    throw err;
  }
  return { ok: true, attempt: calls };
};

const outcome = await executeWithResilience({
  dependencyName: "payment-gateway",
  fn,
  config: {
    retryMaxAttempts: 3,
    retryBaseDelayMs: 100,
    retryMaxDelayMs: 1000,
    retryJitter: 0.1,
    gatewayTimeoutMs: 2000,
    breakerFailureThreshold: 5,
    breakerCooldownMs: 10000,
  },
});
console.log("OUTCOME:", JSON.stringify(outcome, null, 2));
console.log("TOTAL CALLS:", calls);
'

# 4. Quick sanity check (breaker trip)
bun -e '
import { executeWithResilience, getBreakerState } from "./src/lib/payments/resilience";

const fn = async () => { throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); };
for (let i = 0; i < 5; i++) {
  await executeWithResilience({
    dependencyName: "test-breaker",
    fn,
    config: { retryMaxAttempts: 1, retryBaseDelayMs: 50, retryMaxDelayMs: 500, retryJitter: 0, gatewayTimeoutMs: 2000, breakerFailureThreshold: 3, breakerCooldownMs: 10000 },
  });
  console.log("after attempt", i + 1, "breaker:", getBreakerState("test-breaker"));
}
'
```

## Notes

- **Cockatiel API verifikasi**: sebelum implementasi, cek `node_modules/cockatiel/dist/index.d.ts` untuk memastikan signature `Backoff` interface dan `circuitBreaker` options masih sesuai plan. Cockatiel v4 API kadang berubah minor antar versi.
- **Singleton breaker**: gunakan module-level `Map` di `breaker-store.ts`. Tidak boleh dibuat baru per request — itu akan menghilangkan state OPEN.
- **Event hooks**: simpan callback interface agar TASK-11 bisa plug pino logger + prom-client tanpa mengubah policy.
- **Jitter**: Cockatiel `ExponentialBackoff` menerima `jitter` sebagai number (0..1) atau implementasi custom `Backoff`. Cek docs.
- **Error throwing di composition**: bila breaker OPEN, Cockatiel melempar `BrokenCircuitError`. Tangkap eksplisit dan map ke `breakerTripped: true`.
- Setelah task ini selesai, TASK-06 bisa wrap HTTP call dengan `executeWithResilience`.
