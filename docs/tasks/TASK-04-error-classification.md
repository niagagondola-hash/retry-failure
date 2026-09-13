# TASK-04 — Error Classification & Retry-After Parsing

> **Task ID**: 2-c
> **Depends on**: 1 (scaffolding)
> **Can run in parallel with**: TASK-02, TASK-03
> **Estimated effort**: S (~45 min)
> **Plan reference**: Section 5.3 (Error classification), Section 6 (Retry-After)

---

## Goal

Implementasi pure functions (TypeScript) untuk:
1. Mengklasifikasikan HTTP/network error sebagai **retryable** atau **permanent**.
2. Mengekstrak `Retry-After` header (delta-seconds atau HTTP-date) menjadi milidetik.

Function ini adalah **application policy** (bukan Cockatiel concern), sesuai responsibility boundary plan section 2.1. Letaknya di `packages/resilience/src/errors/` agar dapat dipakai lintas apps.

## Scope

**In scope**:
- `packages/resilience/src/errors/types.ts` — `ErrorClassification` type + `ClassifiableInput` union.
- `packages/resilience/src/errors/classifier.ts` — `classifyError(input): ErrorClassification`.
- `packages/resilience/src/errors/retry-after.ts` — `parseRetryAfter(value, now?): number | null`.
- `packages/resilience/src/errors/index.ts` — barrel export.
- Jest unit tests untuk classifier & retry-after parser.

**Out of scope**:
- Integrasi dengan Cockatiel (di TASK-05).
- Integrasi dengan HTTP adapter (di TASK-06).
- Audit trail mapping (di TASK-08).

## Classification rules (plan section 5.3)

```text
5xx                  → retryable (reason: 'server_error')
429                  → retryable (reason: 'rate_limited')
timeout (ETIMEDOUT)  → retryable (reason: 'timeout')
ECONNREFUSED         → retryable (reason: 'connection_refused')
ECONNRESET           → retryable (reason: 'connection_reset')
ENOTFOUND            → retryable (reason: 'dns_failure')  // tambahan
4xx (selain 429)     → permanent (reason: 'client_error')
unknown              → permanent (reason: 'unknown')     // safe default
```

## Retry-After rules (plan section 6)

```text
Retry-After: <delta-seconds>     (integer, base 10)
Retry-After: <HTTP-date>          (RFC 7231, e.g. "Wed, 21 Oct 2015 07:28:00 GMT")

return value: milliseconds (number) | null  (jika tidak ada / invalid)

NEVER sum Retry-After + exponential backoff. Pilih salah satu:
  - jika Retry-After ada → pakai Retry-After (server-directed)
  - jika tidak ada → pakai Cockatiel backoff (default)
```

## Files to create

- `/home/z/my-project/retry-failure/packages/resilience/src/errors/types.ts`
- `/home/z/my-project/retry-failure/packages/resilience/src/errors/classifier.ts`
- `/home/z/my-project/retry-failure/packages/resilience/src/errors/retry-after.ts`
- `/home/z/my-project/retry-failure/packages/resilience/src/errors/index.ts`
- `/home/z/my-project/retry-failure/packages/resilience/test/errors/classifier.spec.ts`
- `/home/z/my-project/retry-failure/packages/resilience/test/errors/retry-after.spec.ts`
- `/home/z/my-project/retry-failure/packages/resilience/jest.config.js`

## Implementation steps

1. `errors/types.ts`:
   ```ts
   export interface ErrorClassification {
     retryable: boolean;
     reason: string;
     retryAfterMs?: number;
     errorCode?: string;
     errorMessage?: string;
     httpStatus?: number;
   }
   export type ClassifiableInput =
     | { kind: 'http'; status: number; body?: unknown; headers?: Record<string, string | string[] | undefined> }
     | { kind: 'network'; code: string; message: string }
     | { kind: 'timeout'; message: string };
   ```
2. `errors/classifier.ts`:
   - Export `classifyError(input: ClassifiableInput): ErrorClassification`.
   - `kind: 'http'`:
     - 5xx → `{ retryable: true, reason: 'server_error', httpStatus }`.
     - 429 → `{ retryable: true, reason: 'rate_limited', httpStatus, retryAfterMs: parseRetryAfter(retryAfterHeader) }`.
     - 4xx selain 429 → `{ retryable: false, reason: 'client_error', httpStatus, errorCode, errorMessage }`. Coba ekstrak `error_code` dari body jika `{ error_code: string }`.
     - 2xx/3xx → `{ retryable: false, reason: 'success', httpStatus }` (caller ignore).
   - `kind: 'network'`: cek `code`:
     - `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN` → retryable.
     - Lainnya → permanent (safe default).
   - `kind: 'timeout'` → retryable, `reason: 'timeout'`.
3. `errors/retry-after.ts`:
   ```ts
   export function parseRetryAfter(value: string | null | undefined, now: Date = new Date()): number | null {
     if (!value) return null;
     const trimmed = value.trim();
     // Try delta-seconds
     if (/^\d+$/.test(trimmed)) {
       const seconds = parseInt(trimmed, 10);
       return seconds * 1000;
     }
     // Try HTTP-date
     const date = new Date(trimmed);
     if (!isNaN(date.getTime())) {
       const diff = date.getTime() - now.getTime();
       return Math.max(0, diff);
     }
     return null;  // invalid
   }
   ```
4. `errors/index.ts`: barrel export.
5. Jest tests:
   - `classifier.spec.ts`: cover semua case di acceptance criteria.
   - `retry-after.spec.ts`: delta-seconds, HTTP-date, null, invalid.
6. `jest.config.js` di `packages/resilience` — preset `ts-jest`.

## Acceptance criteria

- [ ] `classifyError({ kind: 'http', status: 500 })` → `{ retryable: true, reason: 'server_error', httpStatus: 500 }`.
- [ ] `classifyError({ kind: 'http', status: 429, headers: { 'retry-after': '10' } })` → `{ retryable: true, reason: 'rate_limited', httpStatus: 429, retryAfterMs: 10000 }`.
- [ ] `classifyError({ kind: 'http', status: 400, body: { error_code: 'invalid_card' } })` → `{ retryable: false, reason: 'client_error', httpStatus: 400, errorCode: 'invalid_card' }`.
- [ ] `classifyError({ kind: 'network', code: 'ECONNREFUSED', message: 'x' })` → `{ retryable: true, reason: 'connection_refused' }`.
- [ ] `classifyError({ kind: 'timeout', message: 'x' })` → `{ retryable: true, reason: 'timeout' }`.
- [ ] `parseRetryAfter('10')` → `10000`.
- [ ] `parseRetryAfter('Wed, 21 Oct 2025 07:28:00 GMT', new Date('2025-10-21T07:27:50Z'))` → `10000`.
- [ ] `parseRetryAfter(null)` → `null`.
- [ ] `parseRetryAfter('garbage')` → `null` (tidak throw).
- [ ] `pnpm test` di `packages/resilience` lulus semua.
- [ ] `pnpm lint` & `pnpm typecheck` lulus.

## Useful commands (run after completing this task)

```bash
# 1. Install deps untuk packages/resilience
cd /home/z/my-project/retry-failure
pnpm install

# 2. Run Jest tests
pnpm --filter @retry-failure/resilience test

# 3. Lint & typecheck
pnpm --filter @retry-failure/resilience lint
pnpm --filter @retry-failure/resilience typecheck

# 4. Quick sanity check via ts-node (bila mau cek manual)
cd /home/z/my-project/retry-failure/packages/resilience
pnpm exec ts-node -e '
import { classifyError, parseRetryAfter } from "./src/errors";
console.log(classifyError({ kind: "http", status: 500 }));
console.log(classifyError({ kind: "http", status: 429, headers: { "retry-after": "10" } }));
console.log(classifyError({ kind: "network", code: "ECONNREFUSED", message: "x" }));
console.log(parseRetryAfter("10"));
console.log(parseRetryAfter(null));
'
```

## Notes

- **Pure functions**: tidak ada side effect atau I/O — mudah diuji & di-reuse.
- **No framework dependency**: package ini tidak import NestJS — bisa dipakai di apps manapun.
- **Error code dari body**: hanya diekstrak bila body punya shape `{ error_code: string }` (mock gateway contract dari TASK-03). Generic snake_case dipakai.
- **HTTP-date parsing**: gunakan `new Date(value)` bawaan JS. Handle invalid dengan cek `isNaN(date.getTime())`.
- **Jest config**: `packages/resilience/jest.config.js` pakai `preset: 'ts-jest'`, `testEnvironment: 'node'`, `roots: ['<rootDir>/test']`.
- Setelah task ini selesai, TASK-05 bisa import `classifyError` & `parseRetryAfter` dari `@retry-failure/resilience`.
