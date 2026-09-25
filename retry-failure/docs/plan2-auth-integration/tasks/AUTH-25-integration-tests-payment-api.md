# AUTH-25 — Integration tests (OAuth flow + session + protected endpoints + switch-role + disabled mode)

> **Task ID**: AUTH-25
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-17, AUTH-18
> **Estimated effort**: L (~3-4 jam)
> **Plan reference**: Section 17.2 (Integration tests), Section 4 (Alur OAuth 2.0), Section 6 (MenuAccessGuard)

---

## Goal

Tulis integration test suite untuk `apps/payment-api` yang menguji alur OAuth2 end-to-end di dalam NestJS app context (dengan real auth-mock atau mock openid-client). Coverage:
1. `/auth/login` redirect dengan PKCE.
2. `/auth/callback` set cookie + buat sesi.
3. `/auth/session` return user.
4. Protected endpoint 401 tanpa cookie.
5. Protected endpoint 200 dengan cookie valid.
6. Protected endpoint 403 tanpa permission.
7. Super admin akses semua.
8. Logout hapus sesi + revoke token.
9. Switch-role update session.
10. `AUTH_MODE=disabled` semua endpoint bekerja tanpa auth.

## Scope

**In scope**:
- `apps/payment-api/test/auth.integration.spec.ts` — full NestJS app test:
  - Bootstrap real `AppModule` via `Test.createTestingModule` + `app.init()`.
  - Mock `openid-client` v5 (atau pakai real auth-mock bila running).
  - Mock `SessionStore` (in-memory) supaya tests isolated.
  - Mock DB (`Payment`, `PaymentAttempt`) via SQLite in-memory atau TypeORM mock.
  - Use `supertest` untuk HTTP requests.
- Test cases per plan2 section 17.2:
  1. **`/auth/login` redirect dengan PKCE**:
     - `GET /auth/login` → 302 redirect ke `${AUTH_BASE_URL}/oauth/authorize?response_type=code&client_id=...&redirect_uri=...&scope=...&state=...&code_challenge=...&code_challenge_method=S256`.
     - Set cookie `oauth_state=<random>` (HttpOnly + 5 min TTL).
     - Verify `code_challenge_method=S256` (bukan `plain`).
     - Verify `state` cookie set.
  2. **`/auth/callback` cookie + session**:
     - Mock `OAuthClientService.exchangeCode` return TokenSet.
     - Mock `OAuthClientService.fetchPermissions` return `{ user, role, permissionCodes }`.
     - Mock `JwksVerifier.verify` return payload.
     - `GET /auth/callback?code=...&state=<matching>` → 302 redirect ke `/`.
     - Set cookie `sid=<sid>` (HttpOnly + 28800 Max-Age + SameSite=Lax).
     - Verify `SessionService.create` called dengan `{ userId, username, roleId, permissionCodes, accessToken, refreshToken, ... }`.
     - Verify `oauth_state` cookie cleared.
  3. **`/auth/session` return user**:
     - With cookie `sid=<valid>` → `GET /auth/session` return `{ user: { userId, username, roleId, isSuperAdmin } }`.
     - Without cookie → `{ user: null }` (atau 401, tergantung impl — butuh spec clear).
  4. **Protected 401 without cookie**:
     - `GET /payments` tanpa cookie → 401 Unauthorized.
  5. **Protected 200 with cookie valid**:
     - `GET /payments` dengan cookie `sid=<valid>` → 200 OK + body list payments.
     - Session dari mock SessionStore → return session dengan permissionCodes.
  6. **Protected 403 without permission**:
     - Session `permissionCodes = ['dashboard', 'payment.read']`.
     - `POST /payments` (requires `payment.write`) → 403 Forbidden.
     - `POST /payments/:id/retry` (requires `payment.retry`) → 403.
  7. **Super admin access all**:
     - Session `isSuperAdmin = true`.
     - `POST /payments` → 200 (bypass `payment.write` check).
     - `POST /payments/:id/retry` → 200 (bypass `payment.retry`).
     - `GET /admin/gateway-config` → 200 (bypass `payment.admin`).
  8. **Logout deletes session + revoke**:
     - `POST /auth/logout` dengan cookie `sid=<valid>`.
     - Verify `SessionService.delete(sid)` called.
     - Verify `OAuthClientService.revoke(refreshToken)` called.
     - Verify cookie `sid` cleared (Set-Cookie with `Max-Age=0`).
     - After logout, `GET /payments` dengan same cookie → 401 (session not in store).
  9. **Switch-role updates session**:
     - Initial session `roleId=role-1`, `permissionCodes=['dashboard','payment.read']`.
     - `POST /auth/switch-role` body `{ roleId: 'role-2' }` dengan cookie `sid=<valid>`.
     - Mock `OAuthClientService.switchRole` return new TokenSet + new permissionCodes.
     - Mock `JwksVerifier.verify` return new payload.
     - Verify `SessionService.updateOnSwitchRole(sid, { roleId, permissionCodes, accessToken, refreshToken })` called.
     - After switch-role, `GET /auth/session` return new `roleId`.
     - After switch-role, `POST /payments` (requires `payment.write`) → 200 (new permissionCodes includes `payment.write`).
  10. **AUTH_MODE=disabled all endpoints work**:
      - Set env `AUTH_MODE=disabled` + `AUTH_DISABLED_*`.
      - No cookie needed.
      - `GET /payments` → 200 (fake user from env).
      - `POST /payments` → 200 (super admin bypass).
      - `GET /auth/session` → return fake user.
      - `GET /auth/login` → 501 Not Implemented.
      - `POST /auth/logout` → 200 OK (no-op).
- Test fixtures:
  - `apps/payment-api/test/fixtures/auth-mock-responses.ts` — mock responses dari auth-mock (token exchange, fetchPermissions, switchRole).
  - Sample users: `superadmin` (isSuperAdmin=true), `budi_santoso` (HRD + Finance multi-role).
- Test setup:
  - `beforeAll` → bootstrap app + mock services + insert fixture data.
  - `afterAll` → close app + cleanup.
  - `beforeEach` → reset mock calls (count + return values).
- Test helpers:
  - `apps/payment-api/test/helpers/test-app.ts` — bootstrap helper.
  - `apps/payment-api/test/helpers/test-session.ts` — create test session + return cookie.

**Out of scope**:
- E2E dengan real auth-mock running → AUTH-26.
- Contract tests (JWT claims match AUTH_CONTRACT.md) → AUTH-27.
- Performance/load tests → di luar scope.
- FE Vue integration tests → di luar scope (Vitest di AUTH-20/21/22).

## Files to create/modify

- `apps/payment-api/test/auth.integration.spec.ts` — NEW (main test suite)
- `apps/payment-api/test/fixtures/auth-mock-responses.ts` — NEW
- `apps/payment-api/test/helpers/test-app.ts` — NEW
- `apps/payment-api/test/helpers/test-session.ts` — NEW
- `apps/payment-api/jest.config.js` — UPDATE (config untuk integration tests + setup file)
- `apps/payment-api/package.json` — UPDATE (script `test:integration`)

## Implementation steps

1. **`fixtures/auth-mock-responses.ts`** — mock data:
   ```ts
   export const FIXTURE_USER_BUDI = {
     user: {
       id: '00000000-0000-1000-8000-000000000001',
       username: 'budi_santoso',
       email: 'budi@perusahaan.com',
       name: 'Budi Santoso',
       isSuperAdmin: false,
     },
     role: { id: '00000000-0000-1000-8000-000000000010', name: 'HRD' },
     permissionCodes: ['dashboard', 'payment.read', 'payment.write'],
   };

   export const FIXTURE_USER_SUPERADMIN = {
     user: {
       id: '00000000-0000-1000-8000-000000000099',
       username: 'superadmin',
       email: 'admin@perusahaan.com',
       name: 'Super Admin',
       isSuperAdmin: true,
     },
     role: { id: '00000000-0000-1000-8000-000000000090', name: 'SuperAdmin' },
     permissionCodes: ['*'], // wildcard for super admin
   };

   export const FIXTURE_ROLE_HRD = {
     id: '00000000-0000-1000-8000-000000000010',
     name: 'HRD',
     permissionCodes: ['dashboard', 'payment.read', 'payment.write'],
   };

   export const FIXTURE_ROLE_FINANCE = {
     id: '00000000-0000-1000-8000-000000000020',
     name: 'Finance',
     permissionCodes: ['dashboard', 'payment.read', 'payment.retry'],
   };

   export const MOCK_TOKENSET_BUDI = {
     access_token: 'access-budi-123',
     refresh_token: 'refresh-budi-456',
     expires_in: 900,
     id_token: 'id-budi-789',
     token_type: 'Bearer',
   };

   export const MOCK_JWT_PAYLOAD_BUDI = {
     sub: '00000000-0000-1000-8000-000000000001',
     username: 'budi_santoso',
     roleId: '00000000-0000-1000-8000-000000000010',
     iss: 'http://localhost:4001',
     aud: 'payment-api',
     exp: Math.floor(Date.now() / 1000) + 900,
     iat: Math.floor(Date.now() / 1000),
     jti: 'jti-budi-1',
   };
   ```

2. **`helpers/test-app.ts`** — bootstrap helper:
   ```ts
   import { Test, TestingModule } from '@nestjs/testing';
   import { INestApplication, ValidationPipe } from '@nestjs/common';
   import * as cookieParser from 'cookie-parser';
   import { AppModule } from '../../src/app.module';
   import { OAuthClientService } from '@retry-failure/security';
   import { JwksVerifier } from '@retry-failure/security';
   import { SESSION_STORE } from '@retry-failure/security';
   import { MemorySessionStore } from '@retry-failure/security';

   export interface TestAppOptions {
     authMode?: 'oauth' | 'mock' | 'disabled';
     disabledUser?: any;
   }

   export async function createTestApp(options: TestAppOptions = {}): Promise<{
     app: INestApplication;
     mocks: {
       oauthClient: jest.Mocked<OAuthClientService>;
       jwksVerifier: jest.Mocked<JwksVerifier>;
       sessionStore: MemorySessionStore;
     };
   }> {
     process.env.AUTH_MODE = options.authMode ?? 'mock';
     process.env.NODE_ENV = 'test';
     process.env.SESSION_STORE = 'memory';
     process.env.SESSION_SECRET = 'test-secret-32-chars-min-aaaaaaaaa';
     process.env.SESSION_COOKIE_NAME = 'sid';

     if (options.authMode === 'disabled') {
       process.env.AUTH_DISABLED_USER_ID = options.disabledUser?.userId ?? '00000000-0000-0000-0000-000000000001';
       process.env.AUTH_DISABLED_USERNAME = options.disabledUser?.username ?? 'disabled-user';
       process.env.AUTH_DISABLED_ROLE_ID = options.disabledUser?.roleId ?? '00000000-0000-0000-0000-000000000002';
       process.env.AUTH_DISABLED_IS_SUPER_ADMIN = 'true';
       process.env.AUTH_DISABLED_PERMISSION_CODES = '*';
     }

     const oauthClientMock = {
       generatePkce: jest.fn(),
       buildAuthorizeUrl: jest.fn(),
       exchangeCode: jest.fn(),
       refresh: jest.fn(),
       revoke: jest.fn(),
       fetchPermissions: jest.fn(),
       switchRole: jest.fn(),
     };
     const jwksVerifierMock = { verify: jest.fn() };
     const memoryStore = new MemorySessionStore();

     const moduleFixture: TestingModule = await Test.createTestingModule({
       imports: [AppModule],
     })
       .overrideProvider(OAuthClientService)
       .useValue(oauthClientMock)
       .overrideProvider(JwksVerifier)
       .useValue(jwksVerifierMock)
       .overrideProvider(SESSION_STORE)
       .useValue(memoryStore)
       .compile();

     const app = moduleFixture.createNestApplication();
     app.use(cookieParser());
     app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
     await app.init();

     return {
       app,
       mocks: { oauthClient: oauthClientMock as any, jwksVerifier: jwksVerifierMock as any, sessionStore: memoryStore },
     };
   }
   ```

3. **`helpers/test-session.ts`** — session creator:
   ```ts
   import { SessionStore, Session } from '@retry-failure/security';

   export async function createTestSession(
     store: SessionStore,
     overrides: Partial<Session> = {},
   ): Promise<{ sid: string; cookie: string }> {
     const sid = `test-sid-${Math.random().toString(36).substring(2, 10)}`;
     const session: Session = {
       sid,
       userId: '00000000-0000-1000-8000-000000000001',
       username: 'budi_santoso',
       roleId: '00000000-0000-1000-8000-000000000010',
       permissionCodes: ['dashboard', 'payment.read', 'payment.write'],
       accessToken: 'access-token',
       refreshToken: 'refresh-token',
       accessExpiresAt: Date.now() + 900_000,
       refreshExpiresAt: Date.now() + 8 * 3600_000,
       createdAt: Date.now(),
       lastSeenAt: Date.now(),
       lastSyncAt: Date.now(),
       ...overrides,
     };
     await store.set(sid, session, 28800_000);
     return { sid, cookie: `sid=${sid}` };
   }
   ```

4. **`auth.integration.spec.ts`** — main test suite:
   ```ts
   import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'jest';
   import request from 'supertest';
   import { INestApplication } from '@nestjs/common';
   import { createTestApp } from './helpers/test-app';
   import { createTestSession } from './helpers/test-session';
   import {
     FIXTURE_USER_BUDI,
     FIXTURE_USER_SUPERADMIN,
     FIXTURE_ROLE_FINANCE,
     MOCK_TOKENSET_BUDI,
     MOCK_JWT_PAYLOAD_BUDI,
   } from './fixtures/auth-mock-responses';

   describe('Auth Integration (Plan2 Section 17.2)', () => {
     let app: INestApplication;
     let mocks: any;

     beforeAll(async () => {
       const result = await createTestApp({ authMode: 'mock' });
       app = result.app;
       mocks = result.mocks;
     });

     afterAll(async () => { await app.close(); });

     beforeEach(() => {
       jest.clearAllMocks();
       mocks.sessionStore.clear();
     });

     describe('1. /auth/login → redirect dengan PKCE', () => {
       it('302 redirect ke /oauth/authorize dengan S256', async () => {
         mocks.oauthClient.generatePkce.mockResolvedValue({
           verifier: 'verifier-123',
           challenge: 'challenge-456',
           state: 'state-789',
           method: 'S256',
         });
         mocks.oauthClient.buildAuthorizeUrl.mockReturnValue(
           'http://localhost:4001/oauth/authorize?response_type=code&client_id=payment-api&redirect_uri=...&state=state-789&code_challenge=challenge-456&code_challenge_method=S256',
         );

         const res = await request(app.getHttpServer()).get('/auth/login');

         expect(res.status).toBe(302);
         expect(res.headers.location).toContain('/oauth/authorize');
         expect(res.headers.location).toContain('code_challenge_method=S256');
         expect(res.headers.location).toContain('state=state-789');
         const setCookie = res.headers['set-cookie'];
         expect(setCookie).toBeDefined();
         expect(setCookie.some((c: string) => c.startsWith('oauth_state=state-789'))).toBe(true);
       });
     });

     describe('2. /auth/callback → cookie + session', () => {
       it('302 redirect ke /, set sid cookie, create session', async () => {
         mocks.oauthClient.exchangeCode.mockResolvedValue(MOCK_TOKENSET_BUDI);
         mocks.jwksVerifier.verify.mockResolvedValue(MOCK_JWT_PAYLOAD_BUDI);
         mocks.oauthClient.fetchPermissions.mockResolvedValue(FIXTURE_USER_BUDI);

         const res = await request(app.getHttpServer())
           .get('/auth/callback?code=code-abc&state=state-789')
           .set('Cookie', 'oauth_state=state-789');

         expect(res.status).toBe(302);
         expect(res.headers.location).toBe('/');
         const setCookie = res.headers['set-cookie'];
         expect(setCookie.some((c: string) => c.startsWith('sid='))).toBe(true);
         expect(mocks.sessionStore.size()).toBeGreaterThan(0);
       });

       it('400 bila state mismatch', async () => {
         const res = await request(app.getHttpServer())
           .get('/auth/callback?code=code&state=wrong')
           .set('Cookie', 'oauth_state=expected');

         expect(res.status).toBe(400);
       });

       it('401 bila exchangeCode throws', async () => {
         mocks.oauthClient.exchangeCode.mockRejectedValue(new Error('exchange failed'));
         const res = await request(app.getHttpServer())
           .get('/auth/callback?code=bad-code&state=state-789')
           .set('Cookie', 'oauth_state=state-789');

         expect(res.status).toBe(401);
       });
     });

     describe('3. /auth/session → user', () => {
       it('200 + user object dengan valid session', async () => {
         const { cookie } = await createTestSession(mocks.sessionStore);
         const res = await request(app.getHttpServer())
           .get('/auth/session')
           .set('Cookie', cookie);

         expect(res.status).toBe(200);
         expect(res.body.user).toBeDefined();
         expect(res.body.user.username).toBe('budi_santoso');
       });

       it('return null user bila no session', async () => {
         const res = await request(app.getHttpServer()).get('/auth/session');
         expect(res.status).toBe(200);
         expect(res.body.user).toBeNull();
       });
     });

     describe('4. Protected 401 tanpa cookie', () => {
       it('GET /payments → 401', async () => {
         const res = await request(app.getHttpServer()).get('/payments');
         expect(res.status).toBe(401);
       });

       it('POST /payments → 401', async () => {
         const res = await request(app.getHttpServer()).post('/payments').send({});
         expect(res.status).toBe(401);
       });
     });

     describe('5. Protected 200 dengan cookie valid', () => {
       it('GET /payments → 200 dengan session HRD', async () => {
         const { cookie } = await createTestSession(mocks.sessionStore, {
           permissionCodes: ['dashboard', 'payment.read'],
         });
         const res = await request(app.getHttpServer())
           .get('/payments')
           .set('Cookie', cookie);

         expect(res.status).toBe(200);
         expect(Array.isArray(res.body)).toBe(true);
       });
     });

     describe('6. Protected 403 tanpa permission', () => {
       it('POST /payments (payment.write) → 403 bila user hanya payment.read', async () => {
         const { cookie } = await createTestSession(mocks.sessionStore, {
           permissionCodes: ['dashboard', 'payment.read'], // no payment.write
         });
         const res = await request(app.getHttpServer())
           .post('/payments')
           .set('Cookie', cookie)
           .set('X-CSRF-Token', 'test-csrf') // bypass CSRF check in test
           .send({ amount: 100, currency: 'IDR' });

         expect(res.status).toBe(403);
       });

       it('POST /payments/:id/retry (payment.retry) → 403 bila user tidak punya retry', async () => {
         const { cookie } = await createTestSession(mocks.sessionStore, {
           permissionCodes: ['dashboard', 'payment.read', 'payment.write'],
         });
         const res = await request(app.getHttpServer())
           .post('/payments/abc-123/retry')
           .set('Cookie', cookie)
           .set('X-CSRF-Token', 'test-csrf');

         expect(res.status).toBe(403);
       });
     });

     describe('7. Super admin access all', () => {
       it('GET /admin/gateway-config (payment.admin) → 200 bila isSuperAdmin', async () => {
         const { cookie } = await createTestSession(mocks.sessionStore, {
           userId: FIXTURE_USER_SUPERADMIN.user.id,
           username: 'superadmin',
           permissionCodes: ['*'],
         });
         // Set cached_users entry bila MenuAccessGuard lookup super admin flag
         const res = await request(app.getHttpServer())
           .get('/admin/gateway-config')
           .set('Cookie', cookie);

         expect(res.status).toBe(200);
       });
     });

     describe('8. Logout deletes session + revoke', () => {
       it('POST /auth/logout → delete session + revoke token + clear cookie', async () => {
         const { cookie, sid } = await createTestSession(mocks.sessionStore);
         mocks.oauthClient.revoke.mockResolvedValue(undefined);

         const res = await request(app.getHttpServer())
           .post('/auth/logout')
           .set('Cookie', cookie)
           .set('X-CSRF-Token', 'test-csrf');

         expect(res.status).toBe(200);
         expect(mocks.oauthClient.revoke).toHaveBeenCalledWith('refresh-token');
         expect(await mocks.sessionStore.get(sid)).toBeNull();

         // Cookie cleared
         const setCookie = res.headers['set-cookie'];
         expect(setCookie.some((c: string) => c.includes('Max-Age=0') || c.includes('sid=;'))).toBe(true);
       });

       it('After logout, GET /payments dengan old cookie → 401', async () => {
         const { cookie } = await createTestSession(mocks.sessionStore);
         await request(app.getHttpServer())
           .post('/auth/logout')
           .set('Cookie', cookie)
           .set('X-CSRF-Token', 'test-csrf');

         const res = await request(app.getHttpServer())
           .get('/payments')
           .set('Cookie', cookie);

         expect(res.status).toBe(401);
       });
     });

     describe('9. Switch-role updates session', () => {
       it('POST /auth/switch-role → update session roleId + permissionCodes', async () => {
         const { cookie } = await createTestSession(mocks.sessionStore, {
           roleId: '00000000-0000-1000-8000-000000000010', // HRD
           permissionCodes: ['dashboard', 'payment.read', 'payment.write'],
         });

         mocks.oauthClient.switchRole.mockResolvedValue({
           accessToken: 'new-access',
           refreshToken: 'new-refresh',
           permissionCodes: ['dashboard', 'payment.read', 'payment.retry'], // Finance
         });
         mocks.jwksVerifier.verify.mockResolvedValue({
           sub: '00000000-0000-1000-8000-000000000001',
           username: 'budi_santoso',
           roleId: '00000000-0000-1000-8000-000000000020', // Finance role
         });

         const res = await request(app.getHttpServer())
           .post('/auth/switch-role')
           .set('Cookie', cookie)
           .set('X-CSRF-Token', 'test-csrf')
           .send({ roleId: '00000000-0000-1000-8000-000000000020' });

         expect(res.status).toBe(200);
         expect(mocks.oauthClient.switchRole).toHaveBeenCalledWith('access-token', '00000000-0000-1000-8000-000000000020');

         // Verify session updated
         const session = await mocks.sessionStore.get(sid);
         // ... (sid harus di-capture di atas)
       });

       it('After switch-role, POST /payments → 200 bila new permissionCodes includes payment.write', async () => {
         // similar setup
       });

       it('After switch-role to Finance, POST /payments/:id/retry → 200', async () => {
         // similar setup with payment.retry permission
       });
     });

     describe('10. AUTH_MODE=disabled all endpoints work', () => {
       let disabledApp: INestApplication;

       beforeAll(async () => {
         const result = await createTestApp({ authMode: 'disabled' });
         disabledApp = result.app;
       });

       afterAll(async () => { await disabledApp.close(); });

       it('GET /payments → 200 tanpa cookie', async () => {
         const res = await request(disabledApp.getHttpServer()).get('/payments');
         expect(res.status).toBe(200);
       });

       it('POST /payments → 200 (super admin bypass via AUTH_DISABLED_IS_SUPER_ADMIN=true)', async () => {
         const res = await request(disabledApp.getHttpServer())
           .post('/payments')
           .send({ amount: 100, currency: 'IDR' });

         expect(res.status).toBe(201);
       });

       it('GET /admin/gateway-config → 200', async () => {
         const res = await request(disabledApp.getHttpServer()).get('/admin/gateway-config');
         expect(res.status).toBe(200);
       });

       it('GET /auth/session → return fake user dari env', async () => {
         const res = await request(disabledApp.getHttpServer()).get('/auth/session');
         expect(res.status).toBe(200);
         expect(res.body.user).toBeDefined();
         expect(res.body.user.username).toBe('disabled-user');
         expect(res.body.user.isSuperAdmin).toBe(true);
       });

       it('GET /auth/login → 501 Not Implemented', async () => {
         const res = await request(disabledApp.getHttpServer()).get('/auth/login');
         expect(res.status).toBe(501);
       });

       it('POST /auth/logout → 200 OK (no-op)', async () => {
         const res = await request(disabledApp.getHttpServer())
           .post('/auth/logout')
           .set('X-CSRF-Token', 'test-csrf');

         expect(res.status).toBe(200);
       });
     });
   });
   ```

5. **`jest.config.js`** — UPDATE untuk integration tests:
   ```js
   module.exports = {
     preset: 'ts-jest',
     testEnvironment: 'node',
     roots: ['<rootDir>/test', '<rootDir>/src'],
     testMatch: ['**/*.integration.spec.ts', '**/*.spec.ts'],
     setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
     collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
     coverageThreshold: { global: { lines: 70, functions: 70 } }, // lower for integration
   };
   ```

6. **`package.json` scripts** — UPDATE:
   ```json
   {
     "scripts": {
       "test": "jest",
       "test:integration": "jest --testMatch='**/*.integration.spec.ts'",
       "test:cov": "jest --coverage"
     }
   }
   ```

## Acceptance criteria

- [ ] `auth.integration.spec.ts` berisi 10 describe blocks per plan2 section 17.2.
- [ ] Test 1: `/auth/login` redirect 302 ke `/oauth/authorize` dengan `code_challenge_method=S256` + `state` cookie set.
- [ ] Test 2: `/auth/callback` set `sid` cookie + create session via `SessionService.create` + clear `oauth_state` cookie.
- [ ] Test 3: `/auth/session` return user bila valid cookie, null bila no cookie.
- [ ] Test 4: Protected endpoints (`GET /payments`, `POST /payments`) return 401 tanpa cookie.
- [ ] Test 5: `GET /payments` return 200 dengan valid session (permissionCodes includes `payment.read`).
- [ ] Test 6: `POST /payments` return 403 bila user tidak punya `payment.write` permission.
- [ ] Test 7: Super admin (`isSuperAdmin=true` or `permissionCodes=['*']`) bypass all menu checks → 200.
- [ ] Test 8: `POST /auth/logout` calls `SessionService.delete` + `OAuthClientService.revoke` + clears `sid` cookie. After logout, same cookie → 401.
- [ ] Test 9: `POST /auth/switch-role` calls `OAuthClientService.switchRole` + `JwksVerifier.verify` + `SessionService.updateOnSwitchRole`. After switch, session has new `roleId` + `permissionCodes`.
- [ ] Test 10: `AUTH_MODE=disabled` → all endpoints return 200 (fake user from env, super admin bypass). `/auth/login` → 501, `/auth/logout` → 200 no-op.
- [ ] Test fixtures (`auth-mock-responses.ts`) berisi data Budi + Superadmin + Roles.
- [ ] Test helpers (`test-app.ts`, `test-session.ts`) tersedia + reusable.
- [ ] Mock strategy: `OAuthClientService` + `JwksVerifier` mocked, `SessionStore` pakai real `MemorySessionStore`, `Payment` entity pakai SQLite in-memory (atau mock repository).
- [ ] `pnpm --filter payment-api test:integration` lulus dengan 30+ test cases passing.
- [ ] `pnpm --filter payment-api typecheck` + `lint` lulus.

## Useful commands

```bash
# Install test deps
cd  && pnpm --filter payment-api add -D supertest @types/supertest

# Run all tests (unit + integration)
cd  && pnpm --filter payment-api test

# Run integration tests only
cd  && pnpm --filter payment-api test:integration

# Run specific integration test
cd  && pnpm --filter payment-api test -- --testNamePattern="auth.callback"

# Run with coverage
cd  && pnpm --filter payment-api test:cov

# Debug failing test (verbose)
cd  && pnpm --filter payment-api test -- --verbose --testNamePattern="auth"

# Watch mode
cd  && pnpm --filter payment-api test -- --watch

# Typecheck + lint after changes
cd  && pnpm --filter payment-api typecheck
cd  && pnpm --filter payment-api lint
```

## Notes

- **Plan2 section 17.2 integration tests** mencakup 9 skenario (lihat list di atas). Plus `AUTH_MODE=disabled` end-to-end.
- **Mock strategy** (penting):
  - **`OAuthClientService`** → mock semua method (`exchangeCode`, `refresh`, `revoke`, `fetchPermissions`, `switchRole`, `generatePkce`, `buildAuthorizeUrl`). Tidak pakai real openid-client.
  - **`JwksVerifier`** → mock `verify()` supaya return payload yang ditentukan. Tidak hit real JWKS endpoint.
  - **`SessionStore`** → pakai real `MemorySessionStore` (dari AUTH-11) supaya session persistence testable.
  - **DB (`Payment`, `PaymentAttempt`)** → pakai SQLite in-memory (`TypeOrmModule.forRoot({ type: 'sqlite', database: ':memory:' })`) atau mock repository. SQLite in-memory lebih reliable untuk integration test.
- **`supertest`** library — de-facto standard untuk HTTP integration testing NestJS. Compatible dengan `app.getHttpServer()`.
- **CSRF in tests**: integration test akan trigger CSRF check di `POST` endpoints. Solusi:
  - Option 1: Set `CSRF_ENABLED=false` di test env → skip CSRF check.
  - Option 2: Set cookie `XSRF-TOKEN=test-csrf` + header `X-CSRF-Token=test-csrf` di setiap POST request.
  - Rekomendasi: Option 2 — test real CSRF flow (defense-in-depth).
- **`createTestApp` helper** — override `OAuthClientService` + `JwksVerifier` + `SESSION_STORE` providers dengan mock/real implementation. Bisa reuse untuk multiple test suites.
- **`createTestSession` helper** — buat session langsung di SessionStore (skip OAuth flow), return cookie string. Useful untuk test protected endpoints tanpa repeat OAuth flow.
- **Test isolation**:
  - `beforeEach` clear SessionStore (`memoryStore.clear()`).
  - `beforeEach` clear mock calls (`jest.clearAllMocks()`).
  - `afterAll` close app (`app.close()`).
- **`AUTH_MODE=disabled` test**: bootstrap app baru dengan `authMode='disabled'` — tidak bisa pakai app yang sama (env vars set di startup, tidak mutable runtime).
- **Coverage threshold**: integration test coverage lebih rendah (70% lines) dibanding unit test (90% lines) — fokus pada behavior end-to-end, bukan branch coverage.
- Setelah task ini selesai, payment-api punya integration test suite lengkap. Selanjutnya: AUTH-26 (E2E dengan auth-mock running), AUTH-27 (contract tests).
