# AUTH-19 — payment-api observability (auth metrics + tracing + logging)

> **Task ID**: AUTH-19
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-17
> **Estimated effort**: M (~2-3 jam)
> **Plan reference**: Section 13 (Observability), Section 13.1 (Logging), Section 13.2 (Metrics), Section 13.3 (Tracing)

---

## Goal

Tambah observability untuk auth flow di payment-api:
1. **Metrics** — 7 new Prometheus metrics (`oauth_token_exchange_total`, `oauth_refresh_total`, `session_active`, `auth_sync_total`, `auth_sync_duration_seconds`, `jwt_verify_total`, `menu_access_denied_total`).
2. **Tracing** — OpenTelemetry spans untuk OAuth callback, token exchange, lazy sync, guard execution.
3. **Logging** — structured logging (pino) dengan redaction (token, refresh_token, client_secret, PII).

## Scope

**In scope**:
- **Metrics** (`apps/payment-api/src/observability/auth.metrics.ts`):
  - `oauth_token_exchange_total{result}` counter — increment saat `/auth/callback` exchange code for token. Labels: `result=success|failure`.
  - `oauth_refresh_total{result}` counter — increment saat `OAuthClientService.refresh()` dipanggil. Labels: `result=success|failure`.
  - `session_active` gauge — current active sessions count. Update via `SessionStore.listActive().length` periodically (every 1 min) atau on session create/delete.
  - `auth_sync_total{result,reason}` counter — increment saat `AuthSyncService.syncSession()`. Labels: `result=success|failure`, `reason=initial|lazy_background|lazy_blocking|switch_role`.
  - `auth_sync_duration_seconds{reason}` histogram — observe duration of syncSession per reason. Buckets: `[0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]`.
  - `jwt_verify_total{result}` counter — increment saat `JwksVerifier.verify()`. Labels: `result=success|failure`.
  - `menu_access_denied_total{menu_code}` counter — increment saat `MenuAccessGuard` throw `ForbiddenException`. Labels: `menu_code` (concat bila multiple).
- Wire metrics increment:
  - Di `AuthController.callback` → `oauthTokenExchangeCounter.inc({ result })`.
  - Di `OAuthClientService.refresh` → `oauthRefreshCounter.inc({ result })`.
  - Di `AuthSyncService.syncSession` → `authSyncCounter.inc({ result, reason })` + `authSyncDurationHistogram.observe({ reason }, durationSec)`.
  - Di `JwksVerifier.verify` → `jwtVerifyCounter.inc({ result })`.
  - Di `MenuAccessGuard.canActivate` (deny branch) → `menuAccessDeniedCounter.inc({ menu_code: requiredMenus.join(',') })`.
  - Di `SessionService.create/delete` → trigger `sessionActiveGauge` update (or periodic refresh).
- **Tracing** (`apps/payment-api/src/observability/auth.tracing.ts`):
  - OpenTelemetry `trace.getTracer('payment-api')`.
  - Span untuk:
    - `auth.login` — saat `/auth/login` start.
    - `auth.callback` — saat `/auth/callback` (sub-spans: `oauth.exchange`, `jwks.verify`, `session.create`).
    - `auth.refresh` — saat refresh token exchange.
    - `auth.logout` — saat logout.
    - `auth.switch-role` — saat switch role (sub-spans: `oauth.switch`, `jwks.verify`, `session.update`).
    - `lazy.sync` — saat lazy sync middleware trigger sync (background or blocking).
    - `guard.session` — saat SessionGuard run.
    - `guard.menu-access` — saat MenuAccessGuard run.
  - Span attributes: `sid` (truncated), `userId`, `username`, `roleId`, `result`, `error` (if any).
  - Propagate `traceparent` header FE → BE → auth (already in axios interceptor di AUTH-20).
- **Logging redaction** (`apps/payment-api/src/observability/logger.config.ts`):
  - `pino-http` atau `nestjs-pino` dengan redaction paths:
    - `req.headers.authorization` → `"***REDACTED***"`.
    - `req.headers.cookie` → `"***REDACTED***"`.
    - `req.headers['x-csrf-token']` → `"***REDACTED***"`.
    - `res.headers['set-cookie']` → `"***REDACTED***"`.
    - `accessToken`, `refreshToken`, `client_secret`, `clientSecret` (any depth).
    - `password`, `email`, `phone` (PII redaction bila ada di log payload).
  - Log levels: `debug` (dev), `info` (default), `warn` (sync timeout, denied access), `error` (OAuth failure, JWT verify failure).
- **Logging hook** di auth flow:
  - `OAuthClientService.exchangeCode` → log `info` "OAuth code exchanged" dengan `userId, username, roleId` (no token).
  - `OAuthClientService.refresh` → log `info` "OAuth refresh success" dengan `userId`.
  - `OAuthClientService.revoke` → log `info` "Token revoked" dengan `userId`.
  - `JwksVerifier.verify` → log `debug` "JWT verified" dengan `sub, iss, aud, exp`.
  - `SessionService.create` → log `info` "Session created" dengan `sid (truncated), userId, username, roleId`.
  - `SessionService.delete` → log `info` "Session deleted" dengan `sid (truncated)`.
  - `AuthSyncService.syncSession` → log `info` "Sync success" + `warn` "Sync timeout" / "Sync failure".
  - `MenuAccessGuard` deny → log `warn` "Access denied" dengan `userId, menuCodes, requiredMenus`.
- **Prometheus scrape** update:
  - `/metrics` endpoint expose new metrics (already `@Public()` from AUTH-18).
  - Test: `curl http://localhost:3001/metrics | grep -E "oauth_token_exchange_total|oauth_refresh_total|session_active|auth_sync_total|jwt_verify_total|menu_access_denied_total"`.
- **Grafana dashboard** (opsional, di luar scope utama):
  - JSON dashboard config bisa di-task terpisah. Basic: 4 panels (OAuth flow, Session active, Sync success rate, JWT verify).

**Out of scope**:
- Grafana dashboard JSON config → opsional, bisa di task terpisah.
- Alert rules (Prometheus alertmanager) → opsional, di luar scope.
- Distributed tracing UI (Jaeger) → already in docker-compose, but dashboard config out of scope.
- PII redaction untuk audit log table → di luar scope (audit log tidak ada di Plan2).
- Log aggregation (Loki/ELK) → di luar scope.

## Files to create/modify

- `apps/payment-api/src/observability/auth.metrics.ts` — NEW (7 Prometheus metrics via prom-client)
- `apps/payment-api/src/observability/auth.tracing.ts` — NEW (OTel tracer + span helpers)
- `apps/payment-api/src/observability/logger.config.ts` — NEW (pino config + redaction paths)
- `apps/payment-api/src/observability/observability.module.ts` — NEW (NestJS module)
- `apps/payment-api/src/auth/auth.controller.ts` — UPDATE: add `tracer.startSpan('auth.callback')` + `oauthTokenExchangeCounter.inc(...)`
- `apps/payment-api/src/auth/auth.service.ts` — UPDATE: add tracing + metrics
- `packages/security/src/oauth/oauth-client.service.ts` — UPDATE: add metrics + tracing instrumentation
- `packages/security/src/verifiers/jwks-verifier.ts` — UPDATE: add `jwtVerifyCounter` + tracing
- `packages/security/src/sync/auth-sync.service.ts` — UPDATE: add `authSyncCounter` + `authSyncDurationHistogram` + tracing
- `packages/security/src/session/session.service.ts` — UPDATE: add `sessionActiveGauge` + log hooks
- `packages/security/src/guards/menu-access.guard.ts` — UPDATE: add `menuAccessDeniedCounter.inc(...)` di deny branch
- `apps/payment-api/src/main.ts` — UPDATE: register `nestjs-pino` + OTel SDK init
- `apps/payment-api/src/app.module.ts` — UPDATE: import `ObservabilityModule` + `LoggerModule`
- `apps/payment-api/package.json` — UPDATE: add deps `nestjs-pino`, `pino-http`, `pino-pretty`, `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`

## Implementation steps

1. **`auth.metrics.ts`** — Prometheus metrics:
   ```ts
   import { Registry, Counter, Gauge, Histogram } from 'prom-client';

   export interface AuthMetrics {
     oauthTokenExchange: Counter<string>;
     oauthRefresh: Counter<string>;
     sessionActive: Gauge<string>;
     authSync: Counter<string>;
     authSyncDuration: Histogram<string>;
     jwtVerify: Counter<string>;
     menuAccessDenied: Counter<string>;
   }

   export function registerAuthMetrics(registry: Registry): AuthMetrics {
     return {
       oauthTokenExchange: new Counter({
         name: 'oauth_token_exchange_total',
         help: 'OAuth2 token exchange count',
         labelNames: ['result'] as const,
         registers: [registry],
       }),
       oauthRefresh: new Counter({
         name: 'oauth_refresh_total',
         help: 'OAuth2 refresh token exchange count',
         labelNames: ['result'] as const,
         registers: [registry],
       }),
       sessionActive: new Gauge({
         name: 'session_active',
         help: 'Currently active sessions count',
         registers: [registry],
       }),
       authSync: new Counter({
         name: 'auth_sync_total',
         help: 'Auth sync (lazy sync) count',
         labelNames: ['result', 'reason'] as const,
         registers: [registry],
       }),
       authSyncDuration: new Histogram({
         name: 'auth_sync_duration_seconds',
         help: 'Auth sync duration in seconds',
         labelNames: ['reason'] as const,
         buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
         registers: [registry],
       }),
       jwtVerify: new Counter({
         name: 'jwt_verify_total',
         help: 'JWT verification count',
         labelNames: ['result'] as const,
         registers: [registry],
       }),
       menuAccessDenied: new Counter({
         name: 'menu_access_denied_total',
         help: 'Menu access denied count',
         labelNames: ['menu_code'] as const,
         registers: [registry],
       }),
     };
   }
   ```

2. **`auth.tracing.ts`** — OTel spans:
   ```ts
   import { trace, Span, context, Context, SpanStatusCode, SpanKind } from '@opentelemetry/api';

   const tracer = trace.getTracer('payment-api', '1.0.0');

   export interface SpanOptions {
     kind?: SpanKind;
     attributes?: Record<string, string | number | boolean>;
   }

   export function startAuthSpan(name: string, options: SpanOptions = {}): Span {
     return tracer.startSpan(name, {
       kind: options.kind ?? SpanKind.INTERNAL,
       attributes: options.attributes,
     });
   }

   export function withAuthSpan<T>(name: string, fn: (span: Span) => Promise<T>, options: SpanOptions = {}): Promise<T> {
     return tracer.startActiveSpan(name, {
       kind: options.kind ?? SpanKind.INTERNAL,
       attributes: options.attributes,
     }, async (span) => {
       try {
         const result = await fn(span);
         span.setStatus({ code: SpanStatusCode.OK });
         return result;
       } catch (err) {
         span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
         span.recordException(err as Error);
         throw err;
       } finally {
         span.end();
       }
     });
   }

   // Helper untuk redact sensitive fields dari span attributes
   export function redactForSpan(obj: Record<string, any>): Record<string, any> {
     const redacted = { ...obj };
     for (const key of Object.keys(redacted)) {
       if (['accessToken', 'refreshToken', 'clientSecret', 'client_secret', 'password', 'sid'].includes(key)) {
         redacted[key] = '***REDACTED***';
       }
     }
     return redacted;
   }
   ```

3. **`logger.config.ts`** — pino redaction:
   ```ts
   export const loggerConfig = {
     pinoHttp: {
       transport: process.env.NODE_ENV !== 'production'
         ? { target: 'pino-pretty', options: { colorize: true } }
         : undefined,
       redact: {
         paths: [
           'req.headers.authorization',
           'req.headers.cookie',
           'req.headers["x-csrf-token"]',
           'res.headers["set-cookie"]',
           'accessToken',
           'refreshToken',
           'access_token',
           'refresh_token',
           'client_secret',
           'clientSecret',
           'password',
           'email',
           'phone',
         ],
         censor: '***REDACTED***',
       },
       level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
       serializers: {
         req: (req: any) => ({
           method: req.method,
           url: req.url,
           // Do not log headers (contains cookies)
         }),
         res: (res: any) => ({ statusCode: res.statusCode }),
       },
     },
   };
   ```

4. **Instrument `OAuthClientService.exchangeCode`** (UPDATE dari AUTH-09):
   ```ts
   async exchangeCode(code: string, verifier: string): Promise<TokenSet> {
     return withAuthSpan('oauth.exchange', async (span) => {
       span.setAttribute('oauth.code_length', code.length);
       try {
         const tokenSet = await this.client.oauthCallback(this.redirectUri, { code }, { code_verifier: verifier });
         this.metrics.oauthTokenExchange.inc({ result: 'success' });
         span.setAttribute('oauth.user_id', tokenSet.claims().sub);
         span.setAttribute('oauth.username', tokenSet.claims().username as string);
         this.logger.info({ msg: 'OAuth code exchanged', userId: tokenSet.claims().sub, username: tokenSet.claims().username });
         return tokenSet;
       } catch (err) {
         this.metrics.oauthTokenExchange.inc({ result: 'failure' });
         span.recordException(err as Error);
         this.logger.error({ msg: 'OAuth exchange failed', error: (err as Error).message });
         throw err;
       }
     });
   }
   ```

5. **Instrument `JwksVerifier.verify`** (UPDATE dari AUTH-10):
   ```ts
   async verify(jwt: string): Promise<JWTVerifyResult> {
     return withAuthSpan('jwks.verify', async (span) => {
       try {
         const { payload } = await jwtVerify(jwt, this.remoteKeySet, {
           issuer: this.issuer,
           audience: this.audience,
           clockTolerance: this.clockToleranceSec,
         });
         this.metrics.jwtVerify.inc({ result: 'success' });
         span.setAttribute('jwt.sub', payload.sub as string);
         span.setAttribute('jwt.iss', payload.iss as string);
         span.setAttribute('jwt.aud', payload.aud as string);
         this.logger.debug({ msg: 'JWT verified', sub: payload.sub, iss: payload.iss, aud: payload.aud });
         return payload;
       } catch (err) {
         this.metrics.jwtVerify.inc({ result: 'failure' });
         span.recordException(err as Error);
         this.logger.warn({ msg: 'JWT verify failed', error: (err as Error).message });
         throw err;
       }
     });
   }
   ```

6. **Instrument `AuthSyncService.syncSession`** (UPDATE dari AUTH-14):
   ```ts
   async syncSession(session: Session, reason: 'initial' | 'lazy_background' | 'lazy_blocking' | 'switch_role' = 'lazy_background'): Promise<void> {
     const start = Date.now();
     return withAuthSpan('lazy.sync', async (span) => {
       span.setAttribute('sync.reason', reason);
       span.setAttribute('sync.sid', session.sid.substring(0, 8));
       span.setAttribute('sync.user_id', session.userId);
       try {
         const data = await this.oauthClient.fetchPermissions(session.accessToken);
         await this.cache.upsertCachedUser({ /* ... */ });
         await this.sessionStore.updateSync(session.sid, data.permissionCodes, Date.now());
         this.metrics.authSync.inc({ result: 'success', reason });
         this.metrics.authSyncDuration.observe({ reason }, (Date.now() - start) / 1000);
         this.logger.info({ msg: 'Sync success', sid: session.sid.substring(0, 8), userId: session.userId, reason, permissionCount: data.permissionCodes.length });
       } catch (err) {
         this.metrics.authSync.inc({ result: 'failure', reason });
         this.metrics.authSyncDuration.observe({ reason }, (Date.now() - start) / 1000);
         span.recordException(err as Error);
         this.logger.warn({ msg: 'Sync failure', sid: session.sid.substring(0, 8), reason, error: (err as Error).message });
         throw err;
       }
     });
   }
   ```

7. **Instrument `MenuAccessGuard`** (UPDATE dari AUTH-13/18):
   ```ts
   canActivate(context: ExecutionContext): boolean {
     // ... existing logic ...
     if (!hasAny) {
       const menuCodeLabel = requiredMenus.join(',');
       this.metrics.menuAccessDenied.inc({ menu_code: menuCodeLabel });
       this.logger.warn({
         msg: 'Menu access denied',
         userId: user.userId,
         username: user.username,
         requiredMenus,
         userPermissions: user.permissionCodes,
       });
       throw new ForbiddenException(`Missing required menu: ${requiredMenus.join(' or ')}`);
     }
     // ...
   }
   ```

8. **Instrument `SessionService`** (UPDATE dari AUTH-12):
   ```ts
   async create(data): Promise<string> {
     const sid = await this.sessionStore.set(/* ... */);
     await this.updateSessionActiveGauge();
     this.logger.info({ msg: 'Session created', sid: sid.substring(0, 8), userId: data.userId, username: data.username, roleId: data.roleId });
     return sid;
   }

   async delete(sid: string): Promise<void> {
     await this.sessionStore.delete(sid);
     await this.updateSessionActiveGauge();
     this.logger.info({ msg: 'Session deleted', sid: sid.substring(0, 8) });
   }

   private async updateSessionActiveGauge(): Promise<void> {
     // Throttle — only update every 5s (avoid hammering store on every create/delete)
     const now = Date.now();
     if (this.lastGaugeUpdate && now - this.lastGaugeUpdate < 5000) return;
     this.lastGaugeUpdate = now;
     const active = await this.sessionStore.listActive();
     this.metrics.sessionActive.set(active.length);
   }
   ```

9. **`main.ts`** — init OTel SDK + pino:
   ```ts
   import { NestFactory } from '@nestjs/core';
   import { Logger } from 'nestjs-pino';
   import { otelSDK } from './observability/otel.sdk';

   async function bootstrap() {
     await otelSDK.start();
     const app = await NestFactory.create(AppModule, { bufferLogs: true });
     app.useLogger(app.get(Logger));
     // ... CORS, cookie-parser, helmet ...
     await app.listen(process.env.PORT ?? 3001);
     app.enableShutdownHooks();
   }
   bootstrap();
   ```

10. **`otel.sdk.ts`** (NEW):
    ```ts
    import { NodeSDK } from '@opentelemetry/sdk-node';
    import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
    import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
    import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
    import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

    export const otelSDK = new NodeSDK({
      serviceName: 'payment-api',
      traceExporter: new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
      }),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/metrics',
        }),
        exportIntervalMillis: 10000,
      }),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    ```

11. **`observability.module.ts`**:
    ```ts
    @Global()
    @Module({
      imports: [
        LoggerModule.forRoot(loggerConfig),
      ],
      providers: [
        {
          provide: 'AUTH_METRICS',
          useFactory: (registry: Registry) => registerAuthMetrics(registry),
          inject: ['PROM_REGISTRY'],
        },
      ],
      exports: ['AUTH_METRICS'],
    })
    export class ObservabilityModule {}
    ```

## Acceptance criteria

- [ ] 7 new metrics registered di Prometheus registry:
  - `oauth_token_exchange_total{result}` counter.
  - `oauth_refresh_total{result}` counter.
  - `session_active` gauge.
  - `auth_sync_total{result,reason}` counter.
  - `auth_sync_duration_seconds{reason}` histogram (buckets: 0.05-10s).
  - `jwt_verify_total{result}` counter.
  - `menu_access_denied_total{menu_code}` counter.
- [ ] `GET /metrics` expose semua 7 metrics + existing Plan1 metrics.
- [ ] Metric increment wired:
  - `oauthTokenExchange.inc({result})` di `OAuthClientService.exchangeCode`.
  - `oauthRefresh.inc({result})` di `OAuthClientService.refresh`.
  - `authSync.inc({result, reason})` di `AuthSyncService.syncSession`.
  - `authSyncDuration.observe({reason}, durationSec)` di `AuthSyncService.syncSession`.
  - `jwtVerify.inc({result})` di `JwksVerifier.verify`.
  - `menuAccessDenied.inc({menu_code})` di `MenuAccessGuard` deny branch.
  - `sessionActive.set(count)` di `SessionService.create/delete` (throttled 5s).
- [ ] Tracing spans untuk: `auth.login`, `auth.callback`, `oauth.exchange`, `jwks.verify`, `session.create`, `auth.refresh`, `auth.logout`, `auth.switch-role`, `oauth.switch`, `session.update`, `lazy.sync`, `guard.session`, `guard.menu-access`.
- [ ] Span attributes: `sid` (truncated 8 char), `userId`, `username`, `roleId`, `result`, `error`.
- [ ] Sensitive fields redacted dari span attributes: `accessToken`, `refreshToken`, `clientSecret`, `client_secret`, `password`, `sid` (full), `email`, `phone`.
- [ ] Pino logging dengan redaction paths: `req.headers.authorization`, `req.headers.cookie`, `req.headers["x-csrf-token"]`, `res.headers["set-cookie"]`, `accessToken`, `refreshToken`, `client_secret`, `password`, `email`.
- [ ] Log levels: `debug` (dev), `info` (default), `warn` (sync timeout, denied access, OAuth failure), `error` (JWT verify failure, sync error).
- [ ] Structured log fields: `msg`, `sid` (truncated), `userId`, `username`, `roleId`, `reason`, `result`, `error`, `durationMs`.
- [ ] OTel SDK init di `main.ts` via `otelSDK.start()`.
- [ ] `GET /metrics` berisi line seperti:
  ```
  oauth_token_exchange_total{result="success"} 5
  oauth_token_exchange_total{result="failure"} 1
  session_active 3
  auth_sync_total{result="success",reason="lazy_background"} 12
  auth_sync_duration_seconds_bucket{reason="lazy_background",le="0.5"} 11
  auth_sync_duration_seconds_bucket{reason="lazy_blocking",le="2"} 1
  jwt_verify_total{result="success"} 17
  menu_access_denied_total{menu_code="payment.write,payment.admin"} 2
  ```
- [ ] Manual verify tracing di Jaeger UI (`http://localhost:16686`): service `payment-api` muncul, span `auth.callback` dengan sub-spans `oauth.exchange` + `jwks.verify` + `session.create`.
- [ ] `pnpm --filter payment-api typecheck` + `lint` lulus.
- [ ] `pnpm --filter @retry-failure/security typecheck` + `lint` lulus.

## Useful commands

```bash
# Install deps
cd /home/z/my-project/retry-failure && pnpm --filter payment-api add nestjs-pino pino-http pino-pretty prom-client
cd /home/z/my-project/retry-failure && pnpm --filter payment-api add @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http @opentelemetry/sdk-metrics
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security add @opentelemetry/api prom-client

# Typecheck + lint
cd /home/z/my-project/retry-failure && pnpm --filter payment-api typecheck
cd /home/z/my-project/retry-failure && pnpm --filter payment-api lint
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security typecheck

# Run payment-api + auth-mock + Jaeger
cd /home/z/my-project/retry-failure && pnpm docker:up  # or pnpm dev
# Or manually:
pnpm --filter auth-mock start:dev &
pnpm --filter payment-api start:dev &

# Manual verify metrics
curl -s http://localhost:3001/metrics | grep -E "oauth_token_exchange_total|oauth_refresh_total|session_active|auth_sync_total|auth_sync_duration_seconds|jwt_verify_total|menu_access_denied_total"

# Trigger metric increments (manual flow)
# 1. GET /auth/login → redirect to auth-mock
# 2. Login as budi_santoso / ChangeMe_123!
# 3. GET /auth/callback → triggers oauth.exchange + jwks.verify + session.create
# 4. GET /auth/session → triggers guard.session (span)
# 5. POST /payments (no permission) → triggers menu_access_denied counter

# Verify trace in Jaeger
# 1. Open http://localhost:16686
# 2. Select service: "payment-api"
# 3. Find trace with operation "auth.callback"
# 4. Verify sub-spans: oauth.exchange, jwks.verify, session.create

# Verify redaction in logs
# 1. Trigger login flow
# 2. Check pino logs in console / file
# 3. Verify: req.headers.cookie = "***REDACTED***"
# 4. Verify: accessToken = "***REDACTED***"
# 5. Verify: refreshToken = "***REDACTED***"

# Run any unit tests if added
cd /home/z/my-project/retry-failure && pnpm --filter payment-api test -- --testPathPattern="observability"
```

## Notes

- **Plan2 section 13 metrics** (7 metrics):
  | Metric | Type | Labels |
  |---|---|---|
  | `oauth_token_exchange_total` | counter | result |
  | `oauth_refresh_total` | counter | result |
  | `session_active` | gauge | none |
  | `auth_sync_total` | counter | result, reason |
  | `auth_sync_duration_seconds` | histogram | reason |
  | `jwt_verify_total` | counter | result |
  | `menu_access_denied_total` | counter | menu_code |
- **Plan2 section 13.3 tracing** — propagate `traceparent` FE → BE → auth. Span untuk OAuth callback, token exchange, lazy sync, guard.
- **Plan2 section 13.1 logging** — redact: token, refresh token, client secret, PII.
- **`session_active` gauge**: bukan push (counter-like), melainkan pull. Update via `SessionStore.listActive().length`. Untuk Redis: `SCAN session:* COUNT 1000` (di AUTH-11). Untuk Memory: `Map.size`. Throttle update (5s) supaya tidak hammer store di traffic tinggi.
- **Histogram buckets** untuk `auth_sync_duration_seconds`: 50ms (sync cepat), 100ms, 250ms, 500ms, 1s, 2s (lazy sync timeout), 5s, 10s (p99 max). Sesuai plan2 sync timeout 2s + margin.
- **OTel SDK `getNodeAutoInstrumentations()`** auto-instrument HTTP, Express, pg, ioredis, etc. Tidak perlu manual span untuk HTTP layer — cukup custom span untuk auth flow.
- **`traceparent` propagation**: axios interceptor (di AUTH-20) auto-set `traceparent` header. `@opentelemetry/auto-instrumentations-node` auto-extract dari incoming request. Tidak perlu manual.
- **Pino vs Winston**: pino dipilih (plan2 section 13.1 implicit — "structured logging" tanpa specify). `nestjs-pino` provide `Logger` service yang injectable.
- **Redaction censor**: default `'***REDACTED***'`. Bisa custom per-path bila perlu (misal `'***REDACTED_COOKIE***'`).
- **PII redaction**: `email` + `phone` di-redact di log payload. Tapi `username` tidak (dianggap semi-public — dipakai untuk trace user tanpa expose PII). Bila lebih ketat, redact juga `username`.
- **Log structured format**: JSON (`{ msg, sid, userId, ... }`). `pino-pretty` untuk dev (colorized). Production raw JSON (untuk Loki/ELK ingestion).
- Setelah task ini selesai, **Plan 2 Fase 1 langkah 9** (observability) tercapai. Selanjutnya: AUTH-20 (FE Vue axios), AUTH-23 (Docker), AUTH-24-26 (tests).
