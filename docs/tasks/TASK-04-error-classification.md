# TASK-04 — Error Classification & Retry-After Parsing

> **Task ID**: 2-c
> **Depends on**: 1 (scaffolding)
> **Can run in parallel with**: TASK-02, TASK-03
> **Estimated effort**: S (~30 min)
> **Plan reference**: Section 5.3 (Error classification), Section 6 (Retry-After)

---

## Goal

Implementasi pure functions untuk:
1. Mengklasifikasikan HTTP/network error sebagai **retryable** atau **permanent**.
2. Mengekstrak `Retry-After` header (delta-seconds atau HTTP-date) menjadi milidetik.

Function ini adalah **application policy** (bukan Cockatiel concern), sesuai responsibility boundary plan section 2.1.

## Scope

**In scope**:
- `src/lib/payments/errors/types.ts` — `ErrorClassification` type.
- `src/lib/payments/errors/classifier.ts` — `classifyError(input): ErrorClassification`.
- `src/lib/payments/errors/retry-after.ts` — `parseRetryAfter(headerValue: string | null, now: Date): number | null`.

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

- `/home/z/my-project/src/lib/payments/errors/types.ts`
- `/home/z/my-project/src/lib/payments/errors/classifier.ts`
- `/home/z/my-project/src/lib/payments/errors/retry-after.ts`
- `/home/z/my-project/src/lib/payments/errors/index.ts` — barrel export.

## Implementation steps

1. `errors/types.ts`:
   ```ts
   export interface ErrorClassification {
     retryable: boolean;
     reason: string;
     retryAfterMs?: number;        // jika ada Retry-After header
     errorCode?: string;           // e.g. 'invalid_card', 'ECONNREFUSED'
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
   - Untuk `kind: 'http'`:
     - Ambil `retry-after` header (case-insensitive), parse via `parseRetryAfter`.
     - 5xx → retryable, `reason: 'server_error'`.
     - 429 → retryable, `reason: 'rate_limited'`, sertakan `retryAfterMs` jika ada.
     - 4xx selain 429 → permanent, `reason: 'client_error'`. Coba ekstrak `error_code` dari body (`{ error_code: '...' }`).
     - 2xx/3xx → tidak classify (success). Return `retryable: false, reason: 'success'` (akan diabaikan caller).
   - Untuk `kind: 'network'`: cek `code`:
     - `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN` → retryable.
     - lainnya → permanent (safe default).
   - Untuk `kind: 'timeout'` → retryable, `reason: 'timeout'`.
3. `errors/retry-after.ts`:
   - Export `parseRetryAfter(value: string | null | undefined, now: Date = new Date()): number | null`.
   - Jika `value` null/empty → return null.
   - Jika `value` match `/^\d+$/` → return `parseInt(value, 10) * 1000`.
   - Jika `value` parseable sebagai `Date` (HTTP-date) → return `Math.max(0, date.getTime() - now.getTime())`.
   - Jika parse gagal → return null (bukan throw).
4. `errors/index.ts`: re-export semua.

## Acceptance criteria

- [ ] `classifyError({ kind: 'http', status: 500 })` → `{ retryable: true, reason: 'server_error' }`.
- [ ] `classifyError({ kind: 'http', status: 429, headers: { 'retry-after': '10' } })` → `{ retryable: true, reason: 'rate_limited', retryAfterMs: 10000 }`.
- [ ] `classifyError({ kind: 'http', status: 400, body: { error_code: 'invalid_card' } })` → `{ retryable: false, reason: 'client_error', errorCode: 'invalid_card' }`.
- [ ] `classifyError({ kind: 'network', code: 'ECONNREFUSED', message: '...' })` → `{ retryable: true, reason: 'connection_refused' }`.
- [ ] `classifyError({ kind: 'timeout', message: '...' })` → `{ retryable: true, reason: 'timeout' }`.
- [ ] `parseRetryAfter('10')` → `10000`.
- [ ] `parseRetryAfter('Wed, 21 Oct 2025 07:28:00 GMT', new Date('2025-10-21T07:27:50Z'))` → `10000`.
- [ ] `parseRetryAfter(null)` → `null`.
- [ ] `parseRetryAfter('garbage')` → `null` (tidak throw).
- [ ] `bun run lint` bersih.
- [ ] `bunx tsc --noEmit` bersih.

## Useful commands (run after completing this task)

```bash
# 1. Type check
bunx tsc --noEmit

# 2. Lint
bun run lint

# 3. Quick sanity check (Bun REPL / inline script)
bun -e '
import { classifyError, parseRetryAfter } from "./src/lib/payments/errors";
console.log(classifyError({ kind: "http", status: 500 }));
console.log(classifyError({ kind: "http", status: 429, headers: { "retry-after": "10" } }));
console.log(classifyError({ kind: "http", status: 400, body: { error_code: "invalid_card" } }));
console.log(classifyError({ kind: "network", code: "ECONNREFUSED", message: "x" }));
console.log(parseRetryAfter("10"));
console.log(parseRetryAfter(null));
'

# 4. Bila ingin unit test cepat (optional, no test framework install)
# Tambah file src/lib/payments/errors/__sanity__.ts dan jalankan:
# bun src/lib/payments/errors/__sanity__.ts
```

## Notes

- Pure functions, tidak boleh ada side effect atau I/O — mudah diuji & di-reuse.
- `errorCode` dari body hanya di-ekstrak jika body punya shape `{ error_code: string }` (mock gateway contract). Generic snake_case `error_code` sudah dipakai di TASK-03.
- **PENTING untuk TASK-05 & TASK-06**: classifier ini yang menentukan apakah Cockatiel retry berlanjut. Cockatiel punya `retry.handleWhen` / error filter — di TASK-05 kita sambungkan.
- Untuk HTTP-date parsing, gunakan `new Date(value)` bawaan JS — tetap handle invalid dengan try/catch.
