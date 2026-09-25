# AUTH-15 — security — CSRF middleware + security headers (helmet) + rate limiting

> **Task ID**: AUTH-15
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-13
> **Estimated effort**: M (~2-3 jam)
> **Plan reference**: Section 12.3 (CSRF), Section 12.4 (Security headers / Helmet), Section 12.5 (Rate limiting), Section 12.1 (Cookie sesi), Section 12.2 (CORS), Section 16 (env CSRF_* + RATE_LIMIT_*)

---

## Goal

Implementasi tiga lapis pertahanan keamanan di sisi BFF payment-api: (1) CSRF middleware (double-submit cookie `XSRF-TOKEN` + header `X-CSRF-Token`), (2) security headers via Helmet (HSTS, X-Content-Type-Options, X-Frame-Options, CSP, Referrer-Policy, Permissions-Policy), dan (3) rate limiting via `@nestjs/throttler` untuk endpoint `/auth/login` + `/auth/callback`. Ketiga komponen ini wajib aktif saat `AUTH_MODE` bukan `disabled`.

## Scope

**In scope**:
- `CsrfMiddleware` (`packages/security/src/middleware/csrf.middleware.ts`):
  - Implementasi double-submit cookie pattern:
    - Saat request `GET /auth/csrf` (atau saat cookie `XSRF-TOKEN` tidak ada/expired) → set cookie `XSRF-TOKEN` dengan random token (32 byte base64url), `HttpOnly=false`, `SameSite=Lax`, `Secure` (production), `Path=/`, `Max-Age=28800` (8 jam, sama dengan session cookie).
    - Saat request non-safe method (`POST`, `PUT`, `PATCH`, `DELETE`) → baca cookie `XSRF-TOKEN` + header `X-CSRF-Token`, bandingkan. Bila beda atau salah satu kosong → `403 Forbidden` dengan `{ statusCode: 403, message: 'Invalid CSRF token' }`.
  - Dikecualikan dari CSRF check: `GET`, `HEAD`, `OPTIONS`, dan path `/auth/callback` (karena redirect dari auth service, FE tidak bisa set header secara sinkron).
  - `CSRF_ENABLED=false` (env) → middleware pass-through (untuk dev/test).
  - `AUTH_MODE=disabled` → middleware skip sepenuhnya.
- `HelmetMiddleware` wiring (`packages/security/src/middleware/helmet.middleware.ts`):
  - Setup `helmet` (`@nestjs/platform-express` sudah bundled, atau `npm i helmet` di payment-api).
  - Konfigurasi default helmet + override:
    - `strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true, preload: true }` (1 tahun).
    - `contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:"], connectSrc: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'"], baseUri: ["'self'"] } }`.
    - `frameguard: { action: 'deny' }` → `X-Frame-Options: DENY`.
    - `noSniff: true` → `X-Content-Type-Options: nosniff`.
    - `referrerPolicy: { policy: 'strict-origin-when-cross-origin' }`.
    - `permissionsPolicy: { policy: { camera: [], microphone: [], geolocation: [], payment: [] } }`.
- `ThrottlerModule` wiring (di payment-api `AppModule`):
  - `@nestjs/throttler` v5+.
  - Global throttler: `TTL=60s`, `limit=100` (default untuk semua endpoint).
  - Override per-endpoint via `@Throttle` decorator:
    - `/auth/login`: `default: { limit: 10, ttl: 60_000 }` (10 req/menit/IP per plan2 section 12.5).
    - `/auth/callback`: `default: { limit: 10, ttl: 60_000 }` (sama dengan login — cegah brute-force callback).
  - Response `429 Too Many Requests` dengan header `Retry-After: <seconds>`.
  - `THROTTLER_DISABLED=true` (env, dev only) → skip throttler.
- Unit test:
  - `csrf.middleware.spec.ts` — happy path, mismatched token, missing header, missing cookie, exempted path (`GET`, `/auth/callback`), `CSRF_ENABLED=false`, `AUTH_MODE=disabled`.
  - `helmet.middleware.spec.ts` — verify header set (`X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Content-Security-Policy`, `Referrer-Policy`, `Permissions-Policy`).

**Out of scope**:
- SameSite=None + CORS credentials (FE beda domain) → handled di CORS config task (sudah ada di plan1 atau AUTH-17).
- WAF / IP blocklist → opsional, di luar scope.
- Audit log untuk CSRF failures → handled di AUTH-19 (observability).
- Rate limit per username (5/menit/username) → di auth-mock (AUTH-03), tidak di payment-api BFF (BFF hanya proxy).

## Files to create/modify

- `packages/security/src/middleware/csrf.middleware.ts` — full implementation
- `packages/security/src/middleware/helmet.middleware.ts` — full implementation (wrap `helmet()`)
- `packages/security/src/middleware/csrf.util.ts` — `generateCsrfToken()` + `safeEqual()` constant-time comparison
- `packages/security/src/middleware/index.ts` — barrel (update, add exports)
- `packages/security/src/security.module.ts` — wire CsrfMiddleware + HelmetMiddleware sebagai providers
- `packages/security/test/csrf.middleware.spec.ts` — unit test
- `packages/security/test/helmet.middleware.spec.ts` — unit test
- `packages/security/src/index.ts` — export CsrfMiddleware + HelmetMiddleware
- `apps/payment-api/package.json` — add `helmet` + `@nestjs/throttler` deps
- `apps/payment-api/src/app.module.ts` — wire `ThrottlerModule.forRootAsync` + apply middleware (`consumer.apply(csrf, helmet, lazySync).forRoutes(...)`)
- `apps/payment-api/src/auth/auth.controller.ts` — `@Throttle` decorator di `/auth/login` + `/auth/callback` (created in AUTH-17, but throttler config here)

## Implementation steps

1. **`csrf.util.ts`** — helpers:
   ```ts
   import { randomBytes, timingSafeEqual } from 'crypto';

   export function generateCsrfToken(): string {
     return randomBytes(32).toString('base64url'); // ~43 chars, URL-safe
   }

   export function safeEqual(a: string, b: string): boolean {
     const bufA = Buffer.from(a);
     const bufB = Buffer.from(b);
     if (bufA.length !== bufB.length) return false;
     return timingSafeEqual(bufA, bufB);
   }

   export const CSRF_EXEMPT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
   export const CSRF_EXEMPT_PATHS = new Set(['/auth/callback']);
   ```

2. **`csrf.middleware.ts`**:
   ```ts
   import { Injectable, Inject, Logger, NestMiddleware } from '@nestjs/common';
   import { Request, Response, NextFunction } from 'express';
   import { generateCsrfToken, safeEqual, CSRF_EXEMPT_METHODS, CSRF_EXEMPT_PATHS } from './csrf.util';
   import { SecurityOptions } from '../security.types';

   @Injectable()
   export class CsrfMiddleware implements NestMiddleware {
     private readonly logger = new Logger('CsrfMiddleware');
     private readonly enabled: boolean;
     private readonly cookieName = 'XSRF-TOKEN';
     private readonly headerName = 'X-CSRF-Token';
     private readonly cookieTtlSec = 28800; // 8 hours, matches session

     constructor(@Inject('SECURITY_OPTIONS') options: SecurityOptions) {
       this.enabled = options.csrfEnabled !== false; // default true
     }

     async use(req: Request, res: Response, next: NextFunction): Promise<void> {
       // Issue/refresh XSRF-TOKEN cookie on every safe request (rotation per session)
       const cookieToken = this.readCookie(req, this.cookieName);
       if (!cookieToken) {
         const fresh = generateCsrfToken();
         this.setCookie(res, fresh);
         res.locals = res.locals || {};
         res.locals.csrfToken = fresh;
       }

       // AUTH_MODE=disabled or CSRF disabled → skip validation
       if (!this.enabled) return next();

       // Safe methods + exempt paths → no validation
       if (CSRF_EXEMPT_METHODS.has(req.method)) return next();
       if (CSRF_EXEMPT_PATHS.has(req.path)) return next();

       // Validate double-submit
       const headerToken = req.headers[this.headerName.toLowerCase()] as string | undefined;
       if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
         this.logger.warn(`CSRF validation failed path=${req.path} method=${req.method}`);
         return res.status(403).json({ statusCode: 403, message: 'Invalid CSRF token' });
       }

       return next();
     }

     private readCookie(req: Request, name: string): string | undefined {
       const raw = req.headers.cookie;
       if (!raw) return undefined;
       for (const part of raw.split(';')) {
         const [k, v] = part.trim().split('=');
         if (k === name) return v;
       }
       return undefined;
     }

     private setCookie(res: Response, token: string): void {
       const parts = [
         `${this.cookieName}=${token}`,
         'HttpOnly=false', // FE needs to read
         'SameSite=Lax',
         'Path=/',
         `Max-Age=${this.cookieTtlSec}`,
       ];
       if (process.env.NODE_ENV === 'production') parts.push('Secure');
       res.setHeader('Set-Cookie', parts.join('; '));
     }
   }
   ```

3. **`helmet.middleware.ts`**:
   ```ts
   import { Injectable, NestMiddleware } from '@nestjs/common';
   import { Request, Response, NextFunction } from 'express';
   import helmet from 'helmet';

   @Injectable()
   export class HelmetMiddleware implements NestMiddleware {
     private readonly handler: ReturnType<typeof helmet>;

     constructor() {
       this.handler = helmet({
         strictTransportSecurity: {
           maxAge: 31536000, // 1 year
           includeSubDomains: true,
           preload: true,
         },
         contentSecurityPolicy: {
           directives: {
             defaultSrc: ["'self'"],
             scriptSrc: ["'self'"],
             styleSrc: ["'self'", "'unsafe-inline'"],
             imgSrc: ["'self'", 'data:'],
             connectSrc: ["'self'"],
             frameAncestors: ["'none'"],
             formAction: ["'self'"],
             baseUri: ["'self'"],
           },
         },
         frameguard: { action: 'deny' },
         noSniff: true,
         referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
         permissionsPolicy: {
           policy: { camera: [], microphone: [], geolocation: [], payment: [] },
         },
         crossOriginEmbedderPolicy: false, // disable COEP — can break OAuth redirect
       });
     }

     use(req: Request, res: Response, next: NextFunction): void {
       this.handler(req, res, next);
     }
   }
   ```

4. **Wire ke `SecurityModule`**:
   ```ts
   providers: [
     // ... existing
     CsrfMiddleware,
     HelmetMiddleware,
   ],
   exports: [CsrfMiddleware, HelmetMiddleware],
   ```
   Add `csrfEnabled` field ke `SecurityOptions` interface:
   ```ts
   export interface SecurityOptions {
     // ... existing
     csrfEnabled?: boolean; // default true; false skips validation
   }
   ```

5. **`ThrottlerModule` di payment-api `AppModule`**:
   ```ts
   import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
   import { APP_GUARD } from '@nestjs/core';

   @Module({
     imports: [
       ThrottlerModule.forRootAsync({
         useFactory: () => ({
           throttlers: [{ ttl: 60_000, limit: 100 }], // global default
           // Skip in disabled mode
           skipIf: () => process.env.AUTH_MODE === 'disabled' || process.env.THROTTLER_DISABLED === 'true',
         }),
       }),
       // ... other modules
     ],
     providers: [
       { provide: APP_GUARD, useClass: ThrottlerGuard },
     ],
   })
   export class AppModule implements NestModule {
     configure(consumer: MiddlewareConsumer) {
       consumer
         .apply(HelmetMiddleware, CsrfMiddleware, LazySyncMiddleware)
         .forRoutes({ path: '*', method: RequestMethod.ALL });
     }
   }
   ```

6. **`@Throttle` di AuthController** (di AUTH-17, note untuk impl):
   ```ts
   @Throttle({ default: { limit: 10, ttl: 60_000 } }) // 10/min/IP per plan2 section 12.5
   @Get('login')
   login() { ... }

   @Throttle({ default: { limit: 10, ttl: 60_000 } })
   @Get('callback')
   callback() { ... }
   ```

7. **Unit test `csrf.middleware.spec.ts`**:
   - Test cases:
     - `GET /auth/csrf` (no cookie) → Set-Cookie `XSRF-TOKEN` set, `next()` called.
     - `GET /payments` (cookie present) → no new cookie set, `next()` called.
     - `POST /payments` (cookie + header match) → `next()` called.
     - `POST /payments` (cookie + header mismatch) → `res.status(403).json({ statusCode: 403, message: 'Invalid CSRF token' })`, `next()` NOT called.
     - `POST /payments` (no header) → 403.
     - `POST /payments` (no cookie) → 403.
     - `POST /auth/callback` → exempt, `next()` called without check.
     - `OPTIONS /payments` → exempt, `next()` called.
     - `CSRF_ENABLED=false` → no validation, but cookie still issued on GET.
     - Cookie attributes: `HttpOnly=false`, `SameSite=Lax`, `Path=/`, `Max-Age=28800`. Di production (`NODE_ENV=production`) → `Secure` added.
     - `safeEqual` constant-time: timing-safe comparison, tidak short-circuit.

8. **Unit test `helmet.middleware.spec.ts`**:
   - Apply middleware via Express `app.get('/', (req, res) => res.send('ok'))`.
   - Hit `/`, assert headers:
     - `x-frame-options: DENY`.
     - `x-content-type-options: nosniff`.
     - `strict-transport-security: max-age=31536000; includeSubDomains; preload`.
     - `content-security-policy` berisi `default-src 'self'; frame-ancestors 'none'; ...`.
     - `referrer-policy: strict-origin-when-cross-origin`.
     - `permissions-policy: camera=(), microphone=(), geolocation=(), payment=()`.

## Acceptance criteria

- [ ] `CsrfMiddleware` implementasi double-submit cookie pattern per plan2 section 12.3.
- [ ] Cookie `XSRF-TOKEN` di-set saat tidak ada (rotasi per session bisa di task AUTH-17, di sini cukup set kalau kosong).
- [ ] Header `X-CSRF-Token` dibandingkan dengan cookie menggunakan `timingSafeEqual` (constant-time).
- [ ] Safe methods (`GET`, `HEAD`, `OPTIONS`) dikecualikan dari validation.
- [ ] Path `/auth/callback` dikecualikan dari validation (exempt list).
- [ ] `CSRF_ENABLED=false` → validation skip, tapi cookie tetap di-issue.
- [ ] Mismatch/missing → `403 Forbidden` dengan body `{ statusCode: 403, message: 'Invalid CSRF token' }`.
- [ ] `HelmetMiddleware` set 6 headers: HSTS, X-Content-Type-Options, X-Frame-Options, CSP, Referrer-Policy, Permissions-Policy.
- [ ] HSTS `max-age=31536000` (1 tahun) + `includeSubDomains` + `preload`.
- [ ] CSP restrict `default-src 'self'`, `frame-ancestors 'none'`, `form-action 'self'`, `base-uri 'self'`.
- [ ] `@nestjs/throttler` global default: 100 req/menit/IP.
- [ ] `/auth/login` + `/auth/callback` override: 10 req/menit/IP via `@Throttle`.
- [ ] Response `429` + header `Retry-After` (default throttler behavior).
- [ ] `THROTTLER_DISABLED=true` (env) → throttler skip (dev).
- [ ] `AUTH_MODE=disabled` → throttler skip + csrf skip.
- [ ] Unit test `csrf.middleware.spec.ts` + `helmet.middleware.spec.ts` lulus.
- [ ] `pnpm --filter @retry-failure/security typecheck` + `lint` lulus.
- [ ] `pnpm --filter payment-api typecheck` + `lint` lulus (setelah `app.module.ts` + `auth.controller.ts` update di AUTH-17).

## Useful commands

```bash
# Install deps di payment-api
cd /home/z/my-project/retry-failure && pnpm --filter payment-api add helmet @nestjs/throttler

# Typecheck security + payment-api
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security typecheck
cd /home/z/my-project/retry-failure && pnpm --filter payment-api typecheck

# Lint
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security lint
cd /home/z/my-project/retry-failure && pnpm --filter payment-api lint

# Run CSRF + Helmet tests
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security test -- --testPathPattern="(csrf|helmet)"

# Manual verify headers (after payment-api running)
curl -sI http://localhost:3001/health | grep -E "(X-Frame-Options|X-Content-Type-Options|Strict-Transport-Security|Content-Security-Policy|Referrer-Policy|Permissions-Policy)"

# Manual verify CSRF flow
# 1. GET /auth/csrf → check Set-Cookie: XSRF-TOKEN=...
curl -sI -c /tmp/cookies.txt http://localhost:3001/auth/csrf

# 2. POST /payments WITHOUT X-CSRF-Token header → expect 403
curl -s -b /tmp/cookies.txt -X POST http://localhost:3001/payments -H "Content-Type: application/json" -d '{"amount":100}'
# Expected: {"statusCode":403,"message":"Invalid CSRF token"}

# 3. POST /payments WITH matching X-CSRF-Token → expect 201 (or 401 if not logged in)
TOKEN=$(grep XSRF-TOKEN /tmp/cookies.txt | awk '{print $7}')
curl -s -b /tmp/cookies.txt -X POST http://localhost:3001/payments \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $TOKEN" \
  -d '{"amount":100}'

# Manual verify rate limit (10 req → 429)
for i in {1..12}; do
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/auth/login
done
# Expected: 302, 302, 302, 302, 302, 302, 302, 302, 302, 302, 429, 429
```

## Notes

- **Double-submit cookie pattern** (OWASP CSRF Prevention Cheat Sheet):
  - Cookie + header, keduanya berisi token yang sama.
  - Server bandingkan keduanya — bila match → request valid.
  - Token tidak perlu server-side state (tidak seperti synchronizer token).
  - Kelemahan: rentan subdomain takeover (XSS di subdomain bisa set cookie). Mitigasi: `SameSite=Lax` + `Secure`.
- **`SameSite=Lax` default** (plan2 section 12.1) sudah melindungi CSRF untuk sebagian besar case (browser tidak kirim cookie cross-site untuk non-safe method). CSRF middleware sebagai defense-in-depth.
- **`/auth/callback` exempt** karena:
  - Browser redirect dari auth service → FE tidak bisa inject header `X-CSRF-Token` saat redirect.
  - Callback sudah dilindungi via `state` parameter (PKCE flow) — anti-CSRF via state binding.
- **HSTS preload**: hanya aktif bila `NODE_ENV=production` + HTTPS. Helmet set header regardless, tapi browser hanya honor HSTS via HTTPS. Dev (HTTP) → header ignored tapi tidak breaking.
- **CSP `style-src 'unsafe-inline'`** diperlukan untuk PrimeVue (inline styles). Bila lebih ketat, pindah ke nonce-based CSP (future improvement).
- **Throttler `skipIf`**: bila `AUTH_MODE=disabled`, throttler global skip. Tapi throttler per-endpoint masih bisa aktif via `@Throttle` — pastikan AuthController tidak apply `@Throttle` bila disabled. Atau pakai `ThrottlerGuard` custom yang check `AUTH_MODE`.
- **`Retry-After` header**: `@nestjs/throttler` v5 otomatis set `Retry-After` di response `429`. FE Vue bisa baca header untuk tampilkan countdown.
- **Rate limit per username** (5/menit/username per plan2 section 12.5) di-handle di auth-mock (AUTH-03), bukan di payment-api BFF — karena BFF tidak tahu username sampai token exchange. BFF hanya limit per IP.
- Setelah task ini selesai, **Plan 2 Fase 1 langkah 8** (CSRF + headers + rate limit) tercapai. Selanjutnya: AUTH-16 (DB migration), AUTH-17 (BFF controller integration).
