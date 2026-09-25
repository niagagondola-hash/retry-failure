# TASK-05 - Cockatiel Resilience Adapter

> **Task ID**: 3
> **Depends on**: 2-c (TASK-04 error classification)
> **Estimated effort**: M (~2-3 jam)
> **Plan reference**: Section 5 (Resilience Architecture) + Section 15 (Configuration)

---

## Goal

Membangun **policy composition Cockatiel** yang membungkus pemanggilan dependency eksternal dengan urutan `wrap(breaker, retry, timeout)`. Breaker dijadikan **singleton per dependency** agar state (CLOSED/OPEN/HALF_OPEN) dipertahankan lintas request. Helper utama `executeWithResilience<T>()` mengembalikan `ResilienceOutcome<T>` yang informatif untuk audit & metrics.

Setelah task ini selesai, TASK-06 (HTTP adapter) cukup membungkus `axios.call` dengan `executeWithResilience({ dependencyName: 'payment-gateway', fn, config })`.

## Scope

**In scope**:
- `packages/resilience/src/policies/types.ts` - `ResilienceConfig`, `ResilienceOutcome<T>`.
- `packages/resilience/src/policies/policies.ts` - `buildRetryPolicy`, `buildTimeoutPolicy`, `buildBreakerPolicy`.
- `packages/resilience/src/policies/breaker-store.ts` - singleton breaker per dependency name.
- `packages/resilience/src/policies/composition.ts` - `executeWithResilience<T>()`.
- `packages/resilience/src/policies/server-directed-backoff.ts` - custom `Backoff` untuk Retry-After override.
- `packages/resilience/src/policies/index.ts` - barrel.
- Jest unit tests di `packages/resilience/test/policies/`.

**Out of scope**:
- HTTP adapter (axios wrapper) -> TASK-06.
- Metrics emission aktual (pino logs + prom-client counters) -> TASK-11. Hooks disediakan, tapi emit di TASK-11.
- Multi-region / multi-cluster breaker (single-region only).
- Durable business retry (MAX_TOTAL_RETRIES) -> TASK-07 & TASK-10.
- Custom breaker strategy (sampling rate, error-rate based) -> pakai default Cockatiel `ConsecutiveBreaker`.

## Cockatiel API

Cockatiel v4 (sudah diinstall di TASK-01 sebagai `cockatiel@^4.0.0`). Berikut import yang dipakai di task ini (verifikasi via `node_modules/cockatiel/dist/index.d.ts`):

```ts
import {
  retry,              // policy builder untuk retry
  handleAll,          // handler yang menangkap semua error (default untuk retry)
  handleWhen,         // handler berbasis predicate (untuk klasifikasi custom)
  circuitBreaker,    // policy builder untuk circuit breaker
  ConsecutiveBreaker, // strategy: N kegagalan konsekutif -> OPEN
  ExponentialBackoff, // backoff: initialDelay * 2^attempt, capped maxDelay, +jitter
  timeout,           // policy builder untuk timeout
  wrap,              // compose multiple policies: wrap(outer, middle, inner)
  Task,              // eksekutor: policy.execute(() => Promise<T>)
  BrokenCircuitError,// throw saat breaker OPEN
  Backoff,           // abstract interface untuk custom backoff
  Policy,            // base class semua policy
} from 'cockatiel';
```

**Signature inti yang dipakai**:

```ts
// Retry
const retryPolicy = retry(handleAll, {
  maxAttempts: 3,
  backoff: new ExponentialBackoff({ initialDelay: 500, maxDelay: 8000, exponent: 2, jitter: 0.1 }),
});

// Timeout
const timeoutPolicy = timeout(2000, { strategy: 'absolute' });

// Circuit breaker
const breakerPolicy = circuitBreaker(handleAll, {
  halfOpenAfter: 10_000,
  breaker: new ConsecutiveBreaker({ threshold: 3 }),
});

// Composition: outer = breaker, middle = retry, inner = timeout
const composed = wrap(breakerPolicy, retryPolicy, timeoutPolicy);

// Execute
const result = await composed.execute((cancellationToken) => fn(cancellationToken));
```

**Event hooks** (untuk observability TASK-11):

```ts
retryPolicy.onFailure((event) => { /* event.reason, event.handledReason */ });
breakerPolicy.onBreak(({ breaker }) => { /* OPEN */ });
breakerPolicy.onReset(() => { /* CLOSED */ });
breakerPolicy.onActivate(({ breaker }) => { /* HALF_OPEN */ });
breakerPolicy.onSuccess(() => { /* closed/half-open success */ });
```

## Composition order

Per plan section 5.1, urutan policy **dari luar ke dalam**:

```text
┌──────────────────────────────────┐
│  Circuit Breaker (outermost)    │  ← blokir cepat jika dependency unhealthy
│  ┌────────────────────────────┐  │
│  │  Retry                     │  │  ← ulang retryable error sampai maxAttempts
│  │  ┌──────────────────────┐ │  │
│  │  │  Timeout             │ │  │  ← batas per-attempt duration
│  │  │  ┌────────────────┐  │ │  │
│  │  │  │  HTTP call     │  │ │  │  ← innermost: actual axios request
│  │  │  └────────────────┘  │ │  │
│  │  └──────────────────────┘ │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

**Rationale**:
- Breaker paling luar -> jika OPEN, langsung throw `BrokenCircuitError` tanpa menyentuh retry/timeout/HTTP. Menghemat resource.
- Retry di tengah -> menangani transient failure (5xx, 429, timeout) dalam satu execution cycle.
- Timeout paling dalam -> membatasi **per-attempt** duration, bukan total cycle. Setiap retry attempt dapat timeout sendiri (config `GATEWAY_TIMEOUT_MS=2000`).

**Implementasi via `wrap()`**:

```ts
const composed = wrap(breakerPolicy, retryPolicy, timeoutPolicy);
// equivalen: breakerPolicy.execute(() => retryPolicy.execute(() => timeoutPolicy.execute(fn)))
```

## Config (plan section 15)

Berikut nilai default yang dipakai policy builder. Konfigurasi dilewatkan sebagai `ResilienceConfig` object (bukan env string) - env -> config mapping dilakukan di TASK-01 (`apps/payment-api/src/config/`) dan TASK-06.

| Key                         | Default | Diterapkan ke                                  |
|-----------------------------|---------|------------------------------------------------|
| `RETRY_MAX_ATTEMPTS`        | `3`     | `retry({ maxAttempts })`                       |
| `RETRY_BASE_DELAY_MS`        | `500`   | `ExponentialBackoff({ initialDelay })`         |
| `RETRY_MAX_DELAY_MS`         | `8000`  | `ExponentialBackoff({ maxDelay })`             |
| `RETRY_JITTER_RATIO`         | `0.1`   | `ExponentialBackoff({ jitter })`               |
| `GATEWAY_TIMEOUT_MS`         | `2000`  | `timeout(2000, { strategy: 'absolute' })`      |
| `BREAKER_FAILURE_THRESHOLD`  | `3`     | `new ConsecutiveBreaker({ threshold })`        |
| `BREAKER_COOLDOWN_MS`        | `10000` | `circuitBreaker({ halfOpenAfter: 10000 })`     |

## Files to create

- `/packages/resilience/src/policies/types.ts`
- `/packages/resilience/src/policies/server-directed-backoff.ts`
- `/packages/resilience/src/policies/policies.ts`
- `/packages/resilience/src/policies/breaker-store.ts`
- `/packages/resilience/src/policies/composition.ts`
- `/packages/resilience/src/policies/index.ts`
- `/packages/resilience/test/policies/policies.spec.ts`
- `/packages/resilience/test/policies/breaker-store.spec.ts`
- `/packages/resilience/test/policies/composition.spec.ts`
- `/packages/resilience/test/policies/server-directed-backoff.spec.ts`

## Implementation steps

### 1. `types.ts`

```ts
export interface ResilienceConfig {
  // Retry
  retryMaxAttempts: number;       // RETRY_MAX_ATTEMPTS=3
  retryBaseDelayMs: number;       // RETRY_BASE_DELAY_MS=500
  retryMaxDelayMs: number;       // RETRY_MAX_DELAY_MS=8000
  retryJitterRatio: number;       // RETRY_JITTER_RATIO=0.1  (range 0..1)
  // Timeout
  gatewayTimeoutMs: number;      // GATEWAY_TIMEOUT_MS=2000
  // Breaker
  breakerFailureThreshold: number; // BREAKER_FAILURE_THRESHOLD=3
  breakerCooldownMs: number;       // BREAKER_COOLDOWN_MS=10000
}

export const DEFAULT_RESILIENCE_CONFIG: ResilienceConfig = {
  retryMaxAttempts: 3,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 8000,
  retryJitterRatio: 0.1,
  gatewayTimeoutMs: 2000,
  breakerFailureThreshold: 3,
  breakerCooldownMs: 10000,
};

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface ResilienceOutcome<T> {
  result?: T;              // hadir jika success
  error?: unknown;         // hadir jika failure (error terakhir yang ditangkap)
  attempts: number;        // total attempt (minimum 1)
  breakerState: BreakerState;
  exhausted: boolean;      // true jika retry habis tanpa success
  breakerTripped: boolean; // true jika BrokenCircuitError ditangkap
  durationMs: number;      // wall-clock total execution
}
```

### 2. `server-directed-backoff.ts`

Cockatiel v4 mengekspos interface `Backoff` dengan method `next()`. Implementasi ini mengecek server-directed delay (dari `Retry-After` header) terlebih dahulu, lalu fallback ke `ExponentialBackoff`.

```ts
import { Backoff, ExponentialBackoff } from 'cockatiel';

export interface ServerDirectedBackoffOptions {
  initialDelay: number;
  maxDelay: number;
  exponent?: number;
  jitter?: number;
  /** Closure yang return server-directed delay (ms) atau null. Di-set oleh composition layer. */
  getServerDelay?: () => number | null;
}

export class ServerDirectedOrExponentialBackoff implements Backoff {
  private readonly delegate: ExponentialBackoff;
  private readonly getServerDelay: () => number | null;

  constructor(opts: ServerDirectedBackoffOptions) {
    this.delegate = new ExponentialBackoff({
      initialDelay: opts.initialDelay,
      maxDelay: opts.maxDelay,
      exponent: opts.exponent ?? 2,
      jitter: opts.jitter ?? 0,
    });
    this.getServerDelay = opts.getServerDelay ?? (() => null);
  }

  next(): number {
    const serverDelay = this.getServerDelay();
    if (serverDelay !== null && serverDelay >= 0) {
      // Jangan campur dengan exponential. Server-directed menang.
      return serverDelay;
    }
    return this.delegate.next();
  }

  reset(): void {
    this.delegate.reset();
  }
}
```

**Cara `getServerDelay` di-set**: composition layer menampung variable mutable `let serverDelay: number | null = null`. Setiap `retryPolicy.onFailure` callback, composition membaca error dari event; jika error membawa `retryAfterMs` (dari `classifyError` TASK-04), set `serverDelay = retryAfterMs`. Backoff instance selalu membaca nilai terbaru.

### 3. `policies.ts`

```ts
import {
  retry, handleAll, circuitBreaker, ConsecutiveBreaker,
  ExponentialBackoff, timeout, Policy,
} from 'cockatiel';
import { ResilienceConfig } from './types';
import { ServerDirectedOrExponentialBackoff } from './server-directed-backoff';

export interface BuiltRetryPolicy {
  policy: ReturnType<typeof retry>;
  backoff: ServerDirectedOrExponentialBackoff;
}

export function buildRetryPolicy(
  config: ResilienceConfig,
  getServerDelay: () => number | null,
): BuiltRetryPolicy {
  const backoff = new ServerDirectedOrExponentialBackoff({
    initialDelay: config.retryBaseDelayMs,
    maxDelay: config.retryMaxDelayMs,
    exponent: 2,
    jitter: config.retryJitterRatio,
    getServerDelay,
  });
  const policy = retry(handleAll, {
    maxAttempts: config.retryMaxAttempts,
    backoff,
  });
  return { policy, backoff };
}

export function buildTimeoutPolicy(config: ResilienceConfig) {
  // strategy: 'absolute' -> total deadline per-attempt = gatewayTimeoutMs
  return timeout(config.gatewayTimeoutMs, { strategy: 'absolute' });
}

export function buildBreakerPolicy(config: ResilienceConfig) {
  return circuitBreaker(handleAll, {
    halfOpenAfter: config.breakerCooldownMs,
    breaker: new ConsecutiveBreaker({ threshold: config.breakerFailureThreshold }),
  });
}
```

> **Catatan**: bila ingin retry hanya untuk error tertentu (mis. skip 4xx non-429), gunakan `handleWhen` alih-alih `handleAll`. Tapi karena classifier sudah berjalan di application layer (TASK-06 akan melempar non-retryable sebagai non-retryable exception yang TIDAK ditangkap retry), default `handleAll` cukup. Document trade-off ini di file sebagai comment.

### 4. `breaker-store.ts`

Singleton breaker per dependency name (plan section 5.2). Menggunakan module-level `Map`.

```ts
import { circuitBreaker, CircuitBreakerPolicy } from 'cockatiel';
import { ResilienceConfig, BreakerState } from './types';

const store = new Map<string, CircuitBreakerPolicy>();
const configs = new Map<string, ResilienceConfig>();

export function getBreaker(
  dependencyName: string,
  config: ResilienceConfig,
): CircuitBreakerPolicy {
  let breaker = store.get(dependencyName);
  if (!breaker) {
    breaker = circuitBreaker(handleAll, {
      halfOpenAfter: config.breakerCooldownMs,
      breaker: new ConsecutiveBreaker({ threshold: config.breakerFailureThreshold }),
    });
    store.set(dependencyName, breaker);
    configs.set(dependencyName, config);
  }
  return breaker;
}

export function getBreakerState(dependencyName: string): BreakerState | undefined {
  const breaker = store.get(dependencyName);
  if (!breaker) return undefined;
  // Cockatiel v4: inspection via reflection; untuk testing gunakan onBreak/onReset hooks.
  // Implementation catatan: simpan state internal di module-level Map juga.
  return internalStates.get(dependencyName) ?? 'CLOSED';
}

export function resetBreakerStore(): void {
  store.clear();
  configs.clear();
  internalStates.clear();
}

// Internal observability map (updated by onBreak/onReset/onActivate hooks dari composition.ts)
const internalStates = new Map<string, BreakerState>();
export function _setBreakerState(name: string, state: BreakerState): void {
  internalStates.set(name, state);
}
```

> **Catatan**: di Cockatiel v4, `CircuitBreakerPolicy` tidak expose state public. Untuk observability, kita attach `onBreak` / `onReset` / `onActivate` listener di composition layer yang update `internalStates` Map.

### 5. `composition.ts`

```ts
import { wrap, BrokenCircuitError, Task } from 'cockatiel';
import { ResilienceConfig, ResilienceOutcome, BreakerState } from './types';
import { buildRetryPolicy, buildTimeoutPolicy, buildBreakerPolicy } from './policies';
import { getBreaker, _setBreakerState } from './breaker-store';

export interface ExecuteOptions<T> {
  dependencyName: string;
  fn: () => Promise<T>;
  config?: Partial<ResilienceConfig>;
}

export async function executeWithResilience<T>(
  opts: ExecuteOptions<T>,
): Promise<ResilienceOutcome<T>> {
  const config: ResilienceConfig = { ...DEFAULT_RESILIENCE_CONFIG, ...opts.config };

  // Server-directed delay state (mutable, dibaca oleh backoff)
  let serverDelay: number | null = null;
  const getServerDelay = () => serverDelay;

  // Singleton breaker
  const breakerPolicy = getBreaker(opts.dependencyName, config);
  // Attach listeners (idempotent - guard via Set agar tidak dobel saat reuse)
  attachBreakerListenersOnce(opts.dependencyName, breakerPolicy);

  // Retry + timeout: fresh setiap call (tidak singleton)
  const { policy: retryPolicy } = buildRetryPolicy(config, getServerDelay);
  const timeoutPolicy = buildTimeoutPolicy(config);

  let attempts = 0;
  retryPolicy.onFailure((event) => {
    attempts++;
    // Bila error membawa retryAfterMs (dari classifier TASK-04), set serverDelay
    const retryAfterMs = extractRetryAfterMs(event);
    if (retryAfterMs !== null) {
      serverDelay = retryAfterMs;
    }
    // Log hook untuk TASK-11 (pino)
    if (logHook) logHook({ dependencyName: opts.dependencyName, attempt: attempts, event });
  });

  const composed = wrap(breakerPolicy, retryPolicy, timeoutPolicy);
  const startedAt = Date.now();
  let result: T | undefined;
  let error: unknown;
  let exhausted = false;
  let breakerTripped = false;

  try {
    result = await composed.execute(() => opts.fn());
    attempts = Math.max(attempts, 1); // success path: onFailure tidak ter-fire
  } catch (e) {
    error = e;
    if (e instanceof BrokenCircuitError) {
      breakerTripped = true;
    } else {
      // Retry exhausted (maxAttempts tercapai tanpa success) -> Cockatiel melempar error terakhir
      exhausted = true;
    }
  }

  return {
    result,
    error,
    attempts,
    breakerState: getBreakerState(opts.dependencyName) ?? 'CLOSED',
    exhausted,
    breakerTripped,
    durationMs: Date.now() - startedAt,
  };
}

// Hook injection points (dipasang oleh TASK-11)
export type LogHook = (e: { dependencyName: string; attempt: number; event: unknown }) => void;
let logHook: LogHook | null = null;
export function setLogHook(hook: LogHook | null): void { logHook = hook; }

let metricsHook: ((e: unknown) => void) | null = null;
export function setMetricsHook(hook: ((e: unknown) => void) | null): void { metricsHook = hook; }
```

Helper `extractRetryAfterMs(event)`: introspeksi `event.reason` atau `event.handledReason` untuk mencari object dengan properti `retryAfterMs` (dari `classifyError` TASK-04 yang dilempar sebagai error property). Implementasi eksak bergantung pada shape yang dilempar TASK-06 - di-scaffold di sini, finalize saat TASK-06.

### 6. `index.ts`

```ts
export * from './types';
export * from './policies';
export * from './breaker-store';
export * from './composition';
export * from './server-directed-backoff';
```

### 7. Jest tests

#### `policies.spec.ts`
- `buildRetryPolicy` menghasilkan policy dengan `maxAttempts` sesuai config.
- `buildTimeoutPolicy` menghasilkan policy yang melempar setelah `gatewayTimeoutMs`.
- `buildBreakerPolicy` menghasilkan policy yang OPEN setelah N failure konsekutif.

#### `breaker-store.spec.ts`
- `getBreaker('foo', config)` dua kali -> instance referensi sama (`===`).
- `getBreaker('foo')` dan `getBreaker('bar')` -> instance berbeda.
- `resetBreakerStore()` menghapus semua.
- `getBreakerState('foo')` awal -> `'CLOSED'`.

#### `composition.spec.ts`
- **Retry success after 2 failures**: fn mock yang gagal 2x lalu sukses -> outcome `result` ter-set, `attempts === 3`, `exhausted === false`, `breakerTripped === false`.
- **Retry exhausted**: fn selalu throw retryable error -> `exhausted === true`, `error` ter-set, `attempts === retryMaxAttempts`.
- **Permanent error no retry**: fn throw custom `PermanentError` (yang tidak ditangkap `handleAll` karena `handleWhen` filter) -> `attempts === 1`. *Catatan: bila pakai `handleAll`, test ini menjadi: error terakhir tetap dilempar dan `exhausted=true`, `attempts===maxAttempts`. Trade-off di dokumentasikan.*
- **Breaker OPEN after N failures**: jalankan N+1 call yang gagal konsekutif -> call ke-N+1 langsung `breakerTripped === true` dan `durationMs < 50ms` (cepat, tidak menyentuh fn).
- **Breaker singleton reuse**: dua `executeWithResilience({ dependencyName: 'x' })` memakai breaker yang sama -> setelah trip di call pertama, call kedua juga `breakerTripped === true`.
- **Retry-After respected**: fn throw error dengan `retryAfterMs: 10000`, lalu sukses -> total delay ≥ 10s (gunakan fake timer Jest).

#### `server-directed-backoff.spec.ts`
- `next()` dengan `getServerDelay() === 10000` -> return `10000`.
- `getServerDelay() === null` -> delegate ke `ExponentialBackoff` (return initialDelay untuk attempt pertama).
- `getServerDelay()` berubah dari `null` ke `10000` di tengah -> `next()` mengikuti nilai terbaru.
- `reset()` mengembalikan delegate ke state awal.

## Acceptance criteria

- [ ] `types.ts` mengekspor `ResilienceConfig`, `ResilienceOutcome<T>`, `BreakerState`, `DEFAULT_RESILIENCE_CONFIG`.
- [ ] `policies.ts` mengekspor `buildRetryPolicy`, `buildTimeoutPolicy`, `buildBreakerPolicy`.
- [ ] `breaker-store.ts` mengekspor `getBreaker`, `getBreakerState`, `resetBreakerStore`.
- [ ] `composition.ts` mengekspor `executeWithResilience`, `setLogHook`, `setMetricsHook`.
- [ ] Retry: fn yang gagal 2x lalu sukses -> `attempts === 3`, `result` ter-set, `exhausted === false`.
- [ ] Retry exhausted: fn selalu gagal -> `exhausted === true`, `attempts === retryMaxAttempts`.
- [ ] Permanent error: throw pada call pertama, outcome menunjukkan tidak ada retry sukses.
- [ ] Breaker OPEN setelah `BREAKER_FAILURE_THRESHOLD` failure konsekutif -> call berikutnya `breakerTripped === true` dan **cepat** (durationMs < 50ms).
- [ ] Breaker singleton: 2 call dengan `dependencyName` sama -> instance breaker identik (uji via `getBreaker(name) === getBreaker(name)`).
- [ ] `ServerDirectedOrExponentialBackoff` mengembalikan server delay (≥10s) ketika `Retry-After: 10` hadir, lalu fallback ke exponential setelah clear.
- [ ] `BrokenCircuitError` ditangkap eksplisit -> `breakerTripped === true` (tidak propagate ke caller sebagai exception).
- [ ] Semua event hook (`onFailure`, `onBreak`, `onReset`, `onActivate`) dapat di-attach tanpa throw.
- [ ] `pnpm --filter @retry-failure/resilience test` lulus semua.
- [ ] `pnpm --filter @retry-failure/resilience lint` lulus.
- [ ] `pnpm --filter @retry-failure/resilience typecheck` lulus.

## Useful commands (run after completing this task)

### Pre-flight Check

> **WAJIB BACA**: sebelum menjalankan command di bawah, cek kondisi lingkungan Anda via [`SANDBOX_NOTES.md`](../../SANDBOX_NOTES.md) section 1 (Pre-flight Check).
>
> Ringkasan keyword:
> - `pnpm --version` ada -> KONDISI LOCAL. Tidak ada -> KONDISI SANDBOX -> jalankan `corepack enable pnpm && corepack prepare pnpm@9.12.0 --activate` dulu (lihat [`SANDBOX_NOTES.md`](../../SANDBOX_NOTES.md) section 2.1).
>
> Tidak ada port-specific atau Docker-dependent command di task ini (pure TypeScript package, Jest unit test + ts-node sanity check). Command di bawah sama untuk kedua kondisi (LOCAL & SANDBOX).

---

```bash
# 1. Install dependencies monorepo (sekali saja bila belum)
# KONDISI LOCAL (pnpm sudah terinstall) & KONDISI SANDBOX (pnpm via corepack):
cd 
# Bila pnpm belum terinstall (KONDISI SANDBOX), jalankan `corepack enable pnpm` dulu
# (lihat SANDBOX_NOTES.md section 2.1). Setelah root package.json dipin ke
# `packageManager: "pnpm@9.12.0"` (TASK-01), corepack akan otomatis activate versi yang sama.
corepack enable pnpm  # hanya bila belum di-enable; no-op bila sudah
pnpm install

# 2. Run Jest tests untuk packages/resilience - sama kedua kondisi
cd 
pnpm --filter @retry-failure/resilience test

# 3. Lint & typecheck - sama kedua kondisi
pnpm --filter @retry-failure/resilience lint
pnpm --filter @retry-failure/resilience typecheck

# 4. Quick sanity check via ts-node - mock fn yang gagal 2x lalu sukses (sama kedua kondisi, pure TS, no port)
cd /packages/resilience
pnpm exec ts-node -e '
import { executeWithResilience } from "./src/policies";
(async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls < 3) throw new Error("simulated transient failure");
    return { ok: true, attempt: calls };
  };
  const outcome = await executeWithResilience({
    dependencyName: "sanity-check",
    fn,
    config: { retryMaxAttempts: 3, retryBaseDelayMs: 50, retryMaxDelayMs: 200, retryJitterRatio: 0, gatewayTimeoutMs: 2000, breakerFailureThreshold: 3, breakerCooldownMs: 10000 },
  });
  console.log(JSON.stringify(outcome, null, 2));
})();
'

# 5. Quick breaker trip test via ts-node (sama kedua kondisi, pure TS, no port)
cd /packages/resilience
pnpm exec ts-node -e '
import { executeWithResilience, resetBreakerStore } from "./src/policies";
(async () => {
  resetBreakerStore();
  const alwaysFail = async () => { throw new Error("gateway down"); };
  for (let i = 1; i <= 4; i++) {
    const start = Date.now();
    const outcome = await executeWithResilience({
      dependencyName: "breaker-demo",
      fn: alwaysFail,
      config: { retryMaxAttempts: 1, retryBaseDelayMs: 10, retryMaxDelayMs: 10, retryJitterRatio: 0, gatewayTimeoutMs: 2000, breakerFailureThreshold: 3, breakerCooldownMs: 60000 },
    });
    console.log(`call #${i}: duration=${outcome.durationMs}ms exhausted=${outcome.exhausted} breakerTripped=${outcome.breakerTripped} state=${outcome.breakerState}`);
  }
})();
'
# Expected: call #1, #2, #3 -> exhausted=true (breaker still CLOSED)
#           call #4 -> breakerTripped=true, duration < 50ms (breaker OPEN, fast-fail)

# 6. Verifikasi signature Cockatiel di node_modules - sama kedua kondisi
cat /node_modules/cockatiel/dist/index.d.ts | head -200
```

## Notes

- **Cockatiel API verification**: sebelum menulis kode, **wajib** membaca `/node_modules/cockatiel/dist/index.d.ts` untuk konfirmasi:
  - Signature `retry(handler, options)` - `options.maxAttempts`, `options.backoff`.
  - Signature `circuitBreaker(handler, options)` - `options.halfOpenAfter`, `options.breaker` (instance dari `ConsecutiveBreaker` / `SampledBreaker`).
  - Signature `timeout(durationMs, options)` - `options.strategy: 'absolute' | 'aggressive'`.
  - Signature `wrap(...policies)` -> `Policy` yang `.execute(fn)`.
  - `BrokenCircuitError` export tersedia.
  - `Backoff` interface (`next(): number`, `reset(): void`).
  - `ExponentialBackoff` options: `{ initialDelay, maxDelay, exponent, jitter }` (jitter = number 0..1).
  - Bila ada perubahan API minor (mis. v4.x vs v4.y), sesuaikan import tanpa mengubah semantics task.

- **Singleton breaker via module-level `Map`**: `breaker-store.ts` memakai module-scoped `Map<string, CircuitBreakerPolicy>`. Ini bekerja selama modul tidak di-reload. Untuk testing, ekspor `resetBreakerStore()` dan panggil di `beforeEach`.

- **Event hooks untuk TASK-11**: `retryPolicy.onFailure`, `breakerPolicy.onBreak`, `breakerPolicy.onReset`, `breakerPolicy.onActivate` sudah disediakan Cockatiel. Composition layer meng-attach listener tapi **emit aktual** (pino log + prom-client counter increment) dilakukan di TASK-11 via injection `setLogHook` / `setMetricsHook`. Jangan import `pino` / `prom-client` di package ini (jaga package tetap framework-agnostic).

- **Jitter ratio**: `ExponentialBackoff({ jitter })` menerima number `0..1` (default 0). `0.1` berarti delay dapat diacak ±10%. Konfirmasi di `index.d.ts` Cockatiel.

- **`BrokenCircuitError` catch eksplisit**: jangan biarkan error ini propagate ke caller sebagai exception. `executeWithResilience` mengkonversinya menjadi `outcome.breakerTripped = true` + `outcome.error` (instance error tetap disimpan untuk audit). Caller (TASK-06) dapat memeriksa `outcome.breakerTripped` untuk mengembalikan response 503.

- **Retry-After override trade-offs**:
  - **Pendekatan yang dipilih**: custom `Backoff` class yang membaca closure `getServerDelay()` setiap `next()` call. Delay server menang jika tersedia, exponential backoff sebaliknya.
  - **Kelebihan**: tidak mengubah domain semantics Cockatiel; backoff tetap satu sumber kebenaran; reset otomatis saat retry cycle selesai.
  - **Kekurangan**: closure mutable state per-call - harus di-reset antar `executeWithResilience` call (sudah ditangani karena closure dibuat fresh setiap call di composition layer).
  - **Alternatif yang ditolak**: (a) post-retry sleep manual -> bypass Cockatiel entirely, hilangkan observability hooks. (b) two-policy composition dengan conditional retry -> lebih kompleks, testing lebih sulit.
  - **Trade-off accept**: tidak ada pengecekan bahwa `Retry-After` tidak ekstrem (mis. 1 jam). Production harus clamp `retryAfterMs` ke `RETRY_MAX_DELAY_MS`. Document di TASK-15.

- **`handleAll` vs `handleWhen`**: default `handleAll` menangkap semua exception -> semua di-retry sampai `maxAttempts`. Untuk payment case, classifier sudah berjalan di TASK-06 (HTTP adapter) yang melempar `PermanentError` TIDAK ditangkap retry - tetapi ini butuh `handleWhen`. Trade-off:
  - **Pakai `handleAll` (recommended awal)**: sederhana; classifier meng-throw `PermanentError` yang **tidak retryable** dengan marker (mis. `error.permanent = true`); composition mengecek marker di `onFailure` untuk membatalkan retry cycle via `throw` dari dalam callback.
  - **Pakai `handleWhen`**: lebih idiomatic Cockatiel; classifier dipanggil di predicate. Tapi classifier butuh akses ke HTTP response shape -> leak abstraction ke package ini.
  - **Decision untuk TASK-05**: scaffold `buildRetryPolicy` dengan `handleAll` + comment bahwa TASK-06 dapat meng-override dengan `handleWhen` bila perlu.

- **Setelah task ini selesai**: TASK-06 bisa langsung `import { executeWithResilience } from '@retry-failure/resilience'` dan membungkus `axios.post()` ke gateway. Tidak ada perubahan API breaking yang diharapkan di TASK-05 saat TASK-06/11 berjalan - hanya penambahan hook emit.

- **Logging di composition**: pakai `console` SEMENTARA untuk debug. TASK-11 akan meng-inject pino via `setLogHook`. Jangan import `nestjs-pino` di package ini.
