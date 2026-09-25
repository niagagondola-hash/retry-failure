# AUTH-17 — payment-api integration (auth controller /auth/* + middleware wiring + config)

> **Task ID**: AUTH-17
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-09, AUTH-12, AUTH-13, AUTH-14, AUTH-15, AUTH-16
> **Estimated effort**: L (~4-6 jam)
> **Plan reference**: Section 4.2 (BFF endpoints), Section 4.3 (PKCE), Section 16 (Configuration), Section 9.3 (AUTH_MODE), Section 9.3.1 (Behavior `AUTH_MODE=disabled`), Section 9.3.2 (Guard production), Section 12.1 (Cookie sesi), Section 12.2 (CORS)

---

## Goal

Integrasikan `packages/security` ke `apps/payment-api`:
1. `AuthController` dengan 7 endpoints `/auth/*` (session, login, callback, logout, refresh, switch-role, csrf) — BFF pattern, token tidak pernah disentuh browser.
2. Wire middleware: `cookie-parser` + `HelmetMiddleware` + `CsrfMiddleware` + `LazySyncMiddleware` + CORS.
3. Config env vars (Joi validation) + bootstrap validation (reject `mock`/`disabled`/`memory` di production).
4. `SecurityModule.forRoot(...)` integration.

## Scope

**In scope**:
- `AuthController` (`apps/payment-api/src/auth/auth.controller.ts`):
  - `GET /auth/session` — cek sesi, return user ringkas (`{ userId, username, roleId, isSuperAdmin }`).
  - `GET /auth/login` — mulai OAuth2 flow: generate `code_verifier` + `code_challenge` + `state` → set temp cookie `oauth_state` (HttpOnly, 5 min TTL) → redirect ke `AUTH_BASE_URL/oauth/authorize?response_type=code&client_id=...&redirect_uri=...&scope=...&state=...&code_challenge=...&code_challenge_method=S256`.
  - `GET /auth/callback` — terima `code` + `state` dari auth → verify `state` (cookie match) → call `OAuthClientService.exchangeCode(code, verifier)` → verify JWT via `JwksVerifier` → buat sesi via `SessionService.create({ user, role, permissionCodes, accessToken, refreshToken })` → set cookie `sid` (HttpOnly + Secure + SameSite=Lax + Max-Age=28800) → redirect ke FE `/` (atau `?next=` param).
  - `POST /auth/logout` — baca cookie `sid` → `SessionService.delete(sid)` + `OAuthClientService.revoke(refreshToken)` → clear cookie `sid` → return `200 OK`.
  - `POST /auth/refresh` — internal: baca `sid` → call `OAuthClientService.refresh(refreshToken)` → update session (`accessToken`, `refreshToken`, `accessExpiresAt`, `refreshExpiresAt`) → return `200 OK`. Tidak di-expose ke FE (hanya internal call dari SessionService saat token expired).
  - `POST /auth/switch-role` — body `{ roleId }` → baca `sid` → call `OAuthClientService.switchRole(accessToken, roleId)` → verify JWT baru → update session (`roleId`, `permissionCodes`) → return `200 OK` + user ringkas.
  - `GET /auth/csrf` — return `{ csrfToken: '...' }` (CsrfMiddleware sudah set cookie via `res.locals.csrfToken`).
  - `AUTH_MODE=disabled`: `/auth/login` + `/auth/callback` → `501 Not Implemented`. `/auth/session` → return user palsu dari env. `/auth/logout` → `200 OK` (no-op). `/auth/switch-role` → `501`.
- `AuthModule` (`apps/payment-api/src/auth/auth.module.ts`):
  - Import `SecurityModule.forRoot(...)`.
  - Provide `AuthController`.
  - Export `SecurityModule` re-export (supaya module lain bisa pakai guards/decorators).
- `SecurityModule.forRoot` config (`apps/payment-api/src/config/security.config.ts`):
  - Baca env: `AUTH_MODE`, `AUTH_BASE_URL`, `AUTH_ISSUER`, `JWT_AUDIENCE`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `OAUTH_SCOPES`, `SESSION_STORE`, `SESSION_SECRET`, `SESSION_TTL_SEC`, `SESSION_COOKIE_NAME`, `SESSION_COOKIE_SAMESITE`, `JWT_CLOCK_TOLERANCE_SEC`, `JWKS_CACHE_TTL_SEC`, `SYNC_*`, `CSRF_ENABLED`, `REDIS_URL`.
  - Pass ke `SecurityModule.forRoot({ authMode, oauth: {...}, session: {...}, jwks: {...}, sync: {...}, csrfEnabled })`.
- Config env validation (`apps/payment-api/src/config/env.validation.ts`):
  - Joi schema untuk semua env vars (plan2 section 16).
  - Required: `AUTH_MODE`, `JWT_AUDIENCE`, `OAUTH_CLIENT_ID`, `OAUTH_REDIRECT_URI`, `SESSION_STORE`, `SESSION_SECRET`.
  - Conditional required: `AUTH_BASE_URL` + `AUTH_ISSUER` + `OAUTH_CLIENT_SECRET` (bila `AUTH_MODE != disabled`).
  - Conditional required: `REDIS_URL` (bila `SESSION_STORE=redis`).
  - Conditional required: `AUTH_DISABLED_*` (bila `AUTH_MODE=disabled`).
- Bootstrap validation (`apps/payment-api/src/main.ts`):
  - `validateConfig()` per plan2 section 16:
    - `NODE_ENV=production` + `AUTH_MODE in [mock, disabled]` → throw.
    - `NODE_ENV=production` + `SESSION_STORE=memory` → throw.
    - `SESSION_STORE=redis` + no `REDIS_URL` → throw.
  - Jalankan sebelum `NestFactory.create`.
- Middleware wiring (`apps/payment-api/src/app.module.ts`):
  - `consumer.apply(cookieParser(), HelmetMiddleware, CsrfMiddleware, LazySyncMiddleware).forRoutes('*')`.
  - CORS: `app.enableCors({ origin: process.env.CORS_ORIGIN, credentials: true })` di `main.ts`.
- `cookie-parser` install + setup.
- `@Public()` decorator di semua `/auth/*` endpoints + `/health`, `/metrics`, `/docs` (existing).
- Smoke test manual: login → callback → session → logout.

**Out of scope**:
- Full integration test suite → AUTH-25.
- E2E with auth-mock → AUTH-26.
- Observability metrics/tracing/logging → AUTH-19.
- @RequireMenu update di existing endpoints → AUTH-18.
- FE Vue axios interceptor → AUTH-20.
- Token encryption at rest → opsional, di AUTH-12 SessionService (jika di-implement, gunakan `crypto.createCipheriv`).

## Files to create/modify

- `apps/payment-api/src/auth/auth.controller.ts` — NEW (7 endpoints + AUTH_MODE=disabled handling)
- `apps/payment-api/src/auth/auth.module.ts` — NEW
- `apps/payment-api/src/auth/auth.service.ts` — NEW (orchestrate OAuth flow + SessionService + cookie)
- `apps/payment-api/src/config/security.config.ts` — NEW (SecurityOptions factory)
- `apps/payment-api/src/config/env.validation.ts` — NEW (Joi schema)
- `apps/payment-api/src/main.ts` — UPDATE (bootstrap validation + CORS + cookie-parser + helmet)
- `apps/payment-api/src/app.module.ts` — UPDATE (SecurityModule + AuthModule + middleware consumer)
- `apps/payment-api/package.json` — UPDATE (deps: `cookie-parser`, `@types/cookie-parser`, `@nestjs/throttler` already in AUTH-15)
- `apps/payment-api/.env.example` — UPDATE (full env vars per plan2 section 16)

## Implementation steps

1. **`env.validation.ts`** — Joi schema:
   ```ts
   import * as Joi from 'joi';

   export const envSchema = Joi.object({
     NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
     PORT: Joi.number().default(3001),

     AUTH_MODE: Joi.string().valid('oauth', 'mock', 'disabled').default('disabled'),
     AUTH_BASE_URL: Joi.string().uri().when('AUTH_MODE', {
       is: Joi.valid('oauth', 'mock'),
       then: Joi.required(),
       otherwise: Joi.optional(),
     }),
     AUTH_ISSUER: Joi.string().when('AUTH_MODE', {
       is: Joi.valid('oauth', 'mock'),
       then: Joi.required(),
       otherwise: Joi.optional(),
     }),
     JWT_AUDIENCE: Joi.string().default('payment-api'),
     OAUTH_CLIENT_ID: Joi.string().default('payment-api'),
     OAUTH_CLIENT_SECRET: Joi.string().when('AUTH_MODE', {
       is: Joi.valid('oauth', 'mock'),
       then: Joi.required(),
       otherwise: Joi.optional(),
     }),
     OAUTH_REDIRECT_URI: Joi.string().uri().when('AUTH_MODE', {
       is: Joi.valid('oauth', 'mock'),
       then: Joi.required(),
       otherwise: Joi.optional(),
     }),
     OAUTH_SCOPES: Joi.string().default('openid profile'),

     // AUTH_MODE=disabled
     AUTH_DISABLED_USER_ID: Joi.string().uuid().when('AUTH_MODE', {
       is: 'disabled', then: Joi.required(), otherwise: Joi.optional(),
     }),
     AUTH_DISABLED_USERNAME: Joi.string().when('AUTH_MODE', {
       is: 'disabled', then: Joi.required(), otherwise: Joi.optional(),
     }),
     AUTH_DISABLED_ROLE_ID: Joi.string().uuid().when('AUTH_MODE', {
       is: 'disabled', then: Joi.required(), otherwise: Joi.optional(),
     }),
     AUTH_DISABLED_IS_SUPER_ADMIN: Joi.boolean().default(true),
     AUTH_DISABLED_PERMISSION_CODES: Joi.string().default('*'),

     JWT_CLOCK_TOLERANCE_SEC: Joi.number().default(5),
     JWKS_CACHE_TTL_SEC: Joi.number().default(300),

     SESSION_STORE: Joi.string().valid('redis', 'memory', 'postgres').default('memory'),
     SESSION_SECRET: Joi.string().min(32).required(),
     SESSION_TTL_SEC: Joi.number().default(28800),
     SESSION_COOKIE_NAME: Joi.string().default('sid'),
     SESSION_COOKIE_SAMESITE: Joi.string().valid('Lax', 'None', 'Strict').default('Lax'),
     SESSION_ENCRYPTION_KEY: Joi.string().optional(), // for token at-rest encryption

     SYNC_FRESH_TTL_MS: Joi.number().default(300_000),
     SYNC_STALE_TTL_MS: Joi.number().default(1_800_000),
     SYNC_MAX_STALE_TTL_MS: Joi.number().default(7_200_000),
     SYNC_BLOCKING_TIMEOUT_MS: Joi.number().default(2_000),
     SYNC_LOCK_TTL_SEC: Joi.number().default(10),

     CORS_ORIGIN: Joi.string().default('http://localhost:5173'),
     RATE_LIMIT_LOGIN_PER_MIN: Joi.number().default(10),
     CSRF_ENABLED: Joi.boolean().default(true),
     THROTTLER_DISABLED: Joi.boolean().default(false),

     DB_HOST: Joi.string().required(),
     DB_PORT: Joi.number().default(5432),
     DB_USER: Joi.string().required(),
     DB_PASS: Joi.string().required(),
     DB_NAME: Joi.string().required(),

     REDIS_URL: Joi.string().when('SESSION_STORE', {
       is: 'redis', then: Joi.required(), otherwise: Joi.optional(),
     }),

     VITE_API_URL: Joi.string().optional(), // for FE only
   });
   ```

2. **`security.config.ts`** — factory `SecurityOptions`:
   ```ts
   import { SecurityOptions } from '@retry-failure/security';

   export function buildSecurityOptions(): SecurityOptions {
     return {
       authMode: process.env.AUTH_MODE as 'oauth' | 'mock' | 'disabled',
       oauth: {
         issuer: process.env.AUTH_ISSUER!,
         clientId: process.env.OAUTH_CLIENT_ID!,
         clientSecret: process.env.OAUTH_CLIENT_SECRET!,
         redirectUri: process.env.OAUTH_REDIRECT_URI!,
         scopes: (process.env.OAUTH_SCOPES ?? 'openid profile').split(' '),
         audience: process.env.JWT_AUDIENCE!,
       },
       session: {
         store: process.env.SESSION_STORE as 'redis' | 'memory',
         secret: process.env.SESSION_SECRET!,
         ttlSec: parseInt(process.env.SESSION_TTL_SEC ?? '28800'),
         cookieName: process.env.SESSION_COOKIE_NAME ?? 'sid',
         sameSite: (process.env.SESSION_COOKIE_SAMESITE ?? 'Lax') as 'Lax' | 'None' | 'Strict',
         encryptionKey: process.env.SESSION_ENCRYPTION_KEY,
         redisUrl: process.env.REDIS_URL,
       },
       jwks: {
         issuer: process.env.AUTH_ISSUER!,
         audience: process.env.JWT_AUDIENCE!,
         clockToleranceSec: parseInt(process.env.JWT_CLOCK_TOLERANCE_SEC ?? '5'),
         cacheTtlSec: parseInt(process.env.JWKS_CACHE_TTL_SEC ?? '300'),
       },
       sync: {
         freshTtlMs: parseInt(process.env.SYNC_FRESH_TTL_MS ?? '300000'),
         staleTtlMs: parseInt(process.env.SYNC_STALE_TTL_MS ?? '1800000'),
         maxStaleTtlMs: parseInt(process.env.SYNC_MAX_STALE_TTL_MS ?? '7200000'),
         blockingTimeoutMs: parseInt(process.env.SYNC_BLOCKING_TIMEOUT_MS ?? '2000'),
         lockTtlSec: parseInt(process.env.SYNC_LOCK_TTL_SEC ?? '10'),
       },
       csrfEnabled: process.env.CSRF_ENABLED !== 'false',
       disabled: {
         userId: process.env.AUTH_DISABLED_USER_ID!,
         username: process.env.AUTH_DISABLED_USERNAME!,
         roleId: process.env.AUTH_DISABLED_ROLE_ID!,
         isSuperAdmin: process.env.AUTH_DISABLED_IS_SUPER_ADMIN === 'true',
         permissionCodes: process.env.AUTH_DISABLED_PERMISSION_CODES ?? '*',
       },
     };
   }
   ```

3. **`auth.service.ts`** — orchestration:
   ```ts
   @Injectable()
   export class AuthService {
     private readonly logger = new Logger('AuthService');

     constructor(
       private readonly oauthClient: OAuthClientService,
       private readonly sessionService: SessionService,
       private readonly jwksVerifier: JwksVerifier,
       @Inject('SECURITY_OPTIONS') private readonly options: SecurityOptions,
     ) {}

     async startLogin(): Promise<{ redirectUrl: string; stateCookie: string }> {
       const { verifier, challenge, state } = await this.oauthClient.generatePkce();
       const redirectUrl = await this.oauthClient.buildAuthorizeUrl({
         codeChallenge: challenge,
         state,
         scope: this.options.oauth.scopes.join(' '),
       });
       return { redirectUrl, stateCookie: state };
     }

     async handleCallback(code: string, state: string, expectedState: string): Promise<{ sid: string; user: AuthUser }> {
       if (state !== expectedState) {
         throw new UnauthorizedException('OAuth state mismatch');
       }
       const tokenSet = await this.oauthClient.exchangeCode(code);
       const payload = await this.jwksVerifier.verify(tokenSet.access_token);
       const perms = await this.oauthClient.fetchPermissions(tokenSet.access_token);
       const sid = await this.sessionService.create({
         userId: payload.sub,
         username: payload.username,
         roleId: payload.roleId,
         permissionCodes: perms.permissionCodes,
         accessToken: tokenSet.access_token,
         refreshToken: tokenSet.refresh_token!,
         accessExpiresAt: payload.exp * 1000,
         refreshExpiresAt: Date.now() + 8 * 60 * 60 * 1000, // 8h
       });
       return { sid, user: perms.user };
     }

     async logout(sid: string): Promise<void> {
       const session = await this.sessionService.get(sid);
       if (session) {
         try { await this.oauthClient.revoke(session.refreshToken); } catch (e) { this.logger.warn(`revoke failed: ${e.message}`); }
         await this.sessionService.delete(sid);
       }
     }

     async switchRole(sid: string, roleId: string): Promise<AuthUser> {
       const session = await this.sessionService.get(sid);
       if (!session) throw new UnauthorizedException();
       const result = await this.oauthClient.switchRole(session.accessToken, roleId);
       await this.jwksVerifier.verify(result.accessToken); // verify new JWT
       await this.sessionService.updateOnSwitchRole(sid, {
         roleId,
         permissionCodes: result.permissionCodes,
         accessToken: result.accessToken,
         refreshToken: result.refreshToken,
       });
       return { userId: session.userId, username: session.username, roleId, isSuperAdmin: false, permissionCodes: result.permissionCodes };
     }
   }
   ```

4. **`auth.controller.ts`**:
   ```ts
   @Controller('auth')
   @Public() // BFF endpoints — cookie-based, not JWT
   export class AuthController {
     constructor(private readonly authService: AuthService) {}

     @Get('session')
     @Public()
     async session(@Req() req: Request): Promise<{ user: AuthUser | null }> {
       const user = (req as any).user as AuthUser | undefined;
       return { user: user ?? null };
     }

     @Get('login')
     @Throttle({ default: { limit: 10, ttl: 60_000 } })
     async login(@Res() res: Response): Promise<void> {
       if (process.env.AUTH_MODE === 'disabled') {
         res.status(501).json({ statusCode: 501, message: 'AUTH_MODE=disabled — login not available' });
         return;
       }
       const { redirectUrl, stateCookie } = await this.authService.startLogin();
       res.cookie('oauth_state', stateCookie, {
         httpOnly: true, secure: process.env.NODE_ENV === 'production',
         sameSite: 'lax', maxAge: 5 * 60 * 1000, // 5 min
       });
       res.redirect(302, redirectUrl);
     }

     @Get('callback')
     @Throttle({ default: { limit: 10, ttl: 60_000 } })
     async callback(
       @Req() req: Request & { query: { code?: string; state?: string } },
       @Req() reqWithCookies: any,
       @Res() res: Response,
     ): Promise<void> {
       if (process.env.AUTH_MODE === 'disabled') {
         res.status(501).json({ statusCode: 501, message: 'AUTH_MODE=disabled' });
         return;
       }
       const { code, state } = req.query;
       const expectedState = reqWithCookies.cookies?.oauth_state;
       if (!code || !state || !expectedState) {
         res.status(400).json({ statusCode: 400, message: 'Missing code/state' });
         return;
       }
       try {
         const { sid, user } = await this.authService.handleCallback(code, state, expectedState);
         res.cookie('sid', sid, {
           httpOnly: true,
           secure: process.env.NODE_ENV === 'production',
           sameSite: (process.env.SESSION_COOKIE_SAMESITE ?? 'lax') as any,
           maxAge: parseInt(process.env.SESSION_TTL_SEC ?? '28800') * 1000,
           path: '/',
         });
         res.clearCookie('oauth_state');
         res.redirect(302, process.env.VITE_API_URL ? '/' : '/'); // FE origin
       } catch (err) {
         res.status(401).json({ statusCode: 401, message: (err as Error).message });
       }
     }

     @Post('logout')
     async logout(@Req() req: any, @Res() res: Response): Promise<void> {
       const sid = req.cookies?.sid;
       if (sid) await this.authService.logout(sid);
       res.clearCookie('sid', { path: '/' });
       if (process.env.AUTH_MODE === 'disabled') {
         res.status(200).json({ statusCode: 200, message: 'OK (no-op)' });
         return;
       }
       res.status(200).json({ statusCode: 200, message: 'OK' });
     }

     @Post('refresh')
     async refresh(@Req() req: any): Promise<{ ok: true }> {
       const sid = req.cookies?.sid;
       if (!sid) throw new UnauthorizedException();
       await this.authService.refresh(sid); // internal
       return { ok: true };
     }

     @Post('switch-role')
     async switchRole(@Req() req: any, @Body() body: { roleId: string }): Promise<{ user: AuthUser }> {
       if (process.env.AUTH_MODE === 'disabled') {
         return res.status(501).json({ statusCode: 501, message: 'AUTH_MODE=disabled' });
       }
       const sid = req.cookies?.sid;
       if (!sid) throw new UnauthorizedException();
       const user = await this.authService.switchRole(sid, body.roleId);
       return { user };
     }

     @Get('csrf')
     async csrf(@Res() res: Response): Promise<{ csrfToken: string }> {
       return { csrfToken: (res.locals as any).csrfToken ?? '' };
     }
   }
   ```

5. **`auth.module.ts`**:
   ```ts
   @Module({
     imports: [
       SecurityModule.forRoot(buildSecurityOptions()),
       JwtModule.register({}), // for any internal JWT needs
     ],
     controllers: [AuthController],
     providers: [AuthService],
     exports: [AuthService, SecurityModule],
   })
   export class AuthModule {}
   ```

6. **`main.ts`** — bootstrap validation + CORS + cookie-parser + helmet:
   ```ts
   import { NestFactory } from '@nestjs/core';
   import { ValidationPipe } from '@nestjs/common';
   import * as cookieParser from 'cookie-parser';
   import { AppModule } from './app.module';

   function validateConfig() {
     const { NODE_ENV, AUTH_MODE, SESSION_STORE } = process.env;
     if (NODE_ENV === 'production') {
       if (AUTH_MODE === 'mock') throw new Error('AUTH_MODE=mock tidak boleh di production');
       if (AUTH_MODE === 'disabled') throw new Error('AUTH_MODE=disabled tidak boleh di production');
       if (SESSION_STORE === 'memory') throw new Error('SESSION_STORE=memory tidak boleh di production');
     }
     if (SESSION_STORE === 'redis' && !process.env.REDIS_URL) {
       throw new Error('REDIS_URL wajib diisi kalau SESSION_STORE=redis');
     }
   }

   async function bootstrap() {
     validateConfig();
     const app = await NestFactory.create(AppModule);
     app.use(cookieParser());
     app.enableCors({
       origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
       credentials: true,
     });
     app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
     await app.listen(process.env.PORT ?? 3001);
   }
   bootstrap();
   ```

7. **`app.module.ts`** — wire middleware + SecurityModule + AuthModule:
   ```ts
   @Module({
     imports: [
       ConfigModule.forRoot({ validationSchema: envSchema }),
       TypeOrmModule.forRootAsync({ /* ... */ }),
       ThrottlerModule.forRootAsync({ /* ... per AUTH-15 */ }),
       AuthModule,
       // ... existing PaymentModule, HealthModule, etc.
     ],
     providers: [
       { provide: APP_GUARD, useClass: SessionGuard }, // global
       { provide: APP_GUARD, useClass: MenuAccessGuard }, // global
       { provide: APP_GUARD, useClass: ThrottlerGuard }, // global
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

8. **`.env.example`** (full per plan2 section 16):
   - Copy semua env vars dari plan2 section 16 + tambah `SESSION_ENCRYPTION_KEY` (optional).

9. **Smoke test manual**:
   - Start auth-mock (port 4001).
   - Start payment-api (port 3001) with `AUTH_MODE=mock`.
   - Browser: `http://localhost:3001/auth/login` → redirect ke `http://localhost:4001/oauth/authorize?...`.
   - Login di auth-mock (username `budi_santoso` + password `ChangeMe_123!`).
   - Select role.
   - Redirect back ke `http://localhost:3001/auth/callback?code=...&state=...`.
   - Verify cookie `sid` set di browser.
   - `curl -b cookies.txt http://localhost:3001/auth/session` → return user.
   - `curl -b cookies.txt -X POST http://localhost:3001/auth/logout` → return 200.
   - Verify cookie `sid` cleared.

## Acceptance criteria

- [ ] `AuthController` punya 7 endpoints per plan2 section 4.2: `GET /auth/session`, `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`, `POST /auth/refresh`, `POST /auth/switch-role`, `GET /auth/csrf`.
- [ ] `/auth/login` generate PKCE (`code_verifier` 43-128 char, `code_challenge` = base64url(sha256(verifier)), `state` random) + set cookie `oauth_state` (HttpOnly, 5 min TTL) + redirect 302 ke auth `/oauth/authorize` dengan params lengkap.
- [ ] `/auth/callback` verify `state` cookie match → exchange code → verify JWT via JwksVerifier → create session → set cookie `sid` (HttpOnly + Secure[prod] + SameSite=Lax + Max-Age=28800 + Path=/) → redirect 302 ke `/`.
- [ ] Cookie `sid` attribute: `HttpOnly; Secure (prod); SameSite=Lax; Path=/; Max-Age=28800` per plan2 section 12.1.
- [ ] `/auth/session` return `{ user: { userId, username, roleId, isSuperAdmin } | null }`.
- [ ] `/auth/logout` call `SessionService.delete(sid)` + `OAuthClientService.revoke(refreshToken)` + clear cookie `sid`.
- [ ] `/auth/switch-role` body `{ roleId }` → call `OAuthClientService.switchRole` → verify JWT baru → update session (`roleId`, `permissionCodes`, `accessToken`, `refreshToken`).
- [ ] `/auth/csrf` return `{ csrfToken: '...' }` (dari `res.locals.csrfToken` yang di-set CsrfMiddleware).
- [ ] `AUTH_MODE=disabled`: `/auth/login` + `/auth/callback` + `/auth/switch-role` → `501 Not Implemented`. `/auth/session` → return user palsu dari env. `/auth/logout` → `200 OK` (no-op).
- [ ] Bootstrap validation `validateConfig()` reject `mock`/`disabled`/`memory` di production.
- [ ] Bootstrap validation reject `SESSION_STORE=redis` tanpa `REDIS_URL`.
- [ ] Env validation via Joi: required + conditional required (per `AUTH_MODE`).
- [ ] `cookie-parser` registered.
- [ ] `HelmetMiddleware` + `CsrfMiddleware` + `LazySyncMiddleware` applied global via `consumer.apply(...)`.
- [ ] CORS enabled with `credentials: true` + origin dari env `CORS_ORIGIN`.
- [ ] `SecurityModule.forRoot(buildSecurityOptions())` integrated di `AuthModule`.
- [ ] `SessionGuard` + `MenuAccessGuard` + `ThrottlerGuard` registered sebagai `APP_GUARD` (global).
- [ ] `@Public()` di semua `/auth/*` endpoints + `/health`, `/metrics`, `/docs` (existing).
- [ ] `@Throttle({ default: { limit: 10, ttl: 60_000 } })` di `/auth/login` + `/auth/callback`.
- [ ] Smoke test manual (login → callback → session → logout) lulus dengan auth-mock running.
- [ ] `pnpm --filter payment-api typecheck` + `lint` lulus.
- [ ] `pnpm --filter payment-api build` lulus.

## Useful commands

```bash
# Install deps
cd  && pnpm --filter payment-api add cookie-parser @nestjs/throttler helmet joi
cd  && pnpm --filter payment-api add -D @types/cookie-parser

# Typecheck + lint
cd  && pnpm --filter payment-api typecheck
cd  && pnpm --filter payment-api lint

# Run payment-api (AUTH_MODE=mock)
cd  && pnpm --filter auth-mock start:dev &  # port 4001
cd  && pnpm --filter payment-api start:dev  # port 3001

# Manual smoke test (browser-based)
# 1. Browser: http://localhost:3001/auth/login
# 2. Should redirect to http://localhost:4001/oauth/authorize?...
# 3. Login form: budi_santoso / ChangeMe_123!
# 4. Select role (HRD or Finance)
# 5. Should redirect back to http://localhost:3001/auth/callback?code=...&state=...
# 6. Should redirect to http://localhost:3001/ (FE) — sid cookie set.

# Manual via curl
curl -sI http://localhost:3001/auth/login -c /tmp/cookies.txt
# Expect: 302 redirect, Set-Cookie: oauth_state=...

# After browser login (manual code extraction), test session:
curl -s -b /tmp/cookies.txt http://localhost:3001/auth/session
# Expect: { "user": { "userId": "...", "username": "budi_santoso", "roleId": "...", "isSuperAdmin": false } }

# Test logout
curl -s -X POST -b /tmp/cookies.txt http://localhost:3001/auth/logout -H "X-CSRF-Token: $TOKEN"
# Expect: { "statusCode": 200, "message": "OK" }

# Test AUTH_MODE=disabled
AUTH_MODE=disabled AUTH_DISABLED_USER_ID=00000000-0000-0000-0000-000000000001 \
  AUTH_DISABLED_USERNAME=disabled-user AUTH_DISABLED_ROLE_ID=00000000-0000-0000-0000-000000000002 \
  SESSION_STORE=memory SESSION_SECRET=$(openssl rand -hex 32) \
  pnpm --filter payment-api start:dev

curl -s http://localhost:3001/auth/session
# Expect: { "user": { "userId": "00000000-0000-0000-0000-000000000001", "username": "disabled-user", "isSuperAdmin": true } }

curl -sI http://localhost:3001/auth/login
# Expect: 501 Not Implemented

# Test bootstrap validation (production should reject)
NODE_ENV=production AUTH_MODE=mock pnpm --filter payment-api start:dev
# Expect: throw "AUTH_MODE=mock tidak boleh di production"
```

## Notes

- **BFF pattern** (plan2 section 2.1): token (`access_token`, `refresh_token`) hanya ada di server (session store + DB), tidak pernah ke browser. FE hanya dapat cookie `sid` (opaque) + cookie `XSRF-TOKEN` (FE bisa baca untuk set header).
- **OAuth flow** (plan2 section 4.1):
  - FE → `GET /auth/login` → BE generate PKCE + state → 302 redirect ke auth `/oauth/authorize`.
  - Auth → user login → consent → 302 redirect ke BE `/auth/callback?code=...&state=...`.
  - BE → verify state → exchange code for token → verify JWT → create session → 302 redirect ke FE `/`.
  - FE → `GET /auth/session` → BE return user ringkas.
- **PKCE wajib** (RFC 9700 §2.1.1) meski `client_secret` di server (confidential client). `code_verifier` 43-128 char, `code_challenge_method=S256`.
- **State cookie**: 5 min TTL, HttpOnly, SameSite=Lax. Verifikasi di callback → cegah CSRF redirect attack.
- **Cookie `sid` Max-Age=28800** (8 jam) = refresh token lifetime (plan2 section 5.3). Setelah expire → user harus re-login.
- **`SameSite=Lax` default** (plan2 section 12.1). Bila FE + BE beda domain → `SameSite=None; Secure` + CORS credentials. Untuk local dev (same origin via Vite proxy atau `localhost:3001` served directly), Lax cukup.
- **`AUTH_MODE=disabled` endpoints** (plan2 section 9.3.1):
  - `/auth/session` → return user palsu dari env (`AUTH_DISABLED_*`).
  - `/auth/login` + `/auth/callback` + `/auth/switch-role` → `501 Not Implemented`.
  - `/auth/logout` → `200 OK` (no-op).
- **`/auth/refresh`** — internal endpoint. Tidak di-call FE langsung. Dipakai SessionService saat access token expired (misal di lazy sync, plan2 section 8 — bisa auto-refresh). Bisa di-protect dengan `@Public()` + internal-only IP whitelist.
- **Order guards**: `ThrottlerGuard` → `SessionGuard` → `MenuAccessGuard`. NestJS run APP_GUARDs in order registered. Pastikan Throttler first (cegah brute force sebelum auth check).
- **`@Public()` di `/auth/*`** supaya `SessionGuard` skip (BFF manage session sendiri). Tapi `/auth/session`, `/auth/logout`, `/auth/refresh`, `/auth/switch-role` butuh session cookie → SessionGuard harus jalan. Solusi: `SessionGuard` harus check cookie manual di `/auth/*` (atau pakai custom guard untuk BFF).
  - **Approach**: `@Public()` skip SessionGuard, tapi `AuthController` manually read cookie `sid` + call `SessionService.get(sid)` untuk set `req.user`. Lebih clean separation.
- Setelah task ini selesai, **Plan 2 Fase 1 langkah 5** (integrate guard + middleware) tercapai. Selanjutnya: AUTH-18 (existing endpoints `@RequireMenu` + AUTH_MODE=disabled behavior di existing endpoints).
