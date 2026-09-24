# AUTH-24 — Unit tests (PKCE + OAuth client + JWKS + guards + lazy sync + SessionStore parity + AUTH_MODE=disabled)

> **Task ID**: AUTH-24
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-14, AUTH-15
> **Estimated effort**: L (~4-5 jam)
> **Plan reference**: Section 17.1 (Unit tests), Section 9.3 (AUTH_MODE), Section 9.4 (SessionStore)

---

## Goal

Tulis unit test lengkap untuk `packages/security` mencakup semua component:
1. PKCE verifier/challenge generation (S256).
2. OAuthClientService (token exchange + refresh + revoke + switch-role) — mock `openid-client`.
3. JwksVerifier (verify RS256 + cache + kid rotation + invalid signature) — mock JWKS endpoint.
4. SessionGuard (valid + expired + revoked + AUTH_MODE=disabled).
5. MenuAccessGuard (super admin + allowed + denied + AUTH_MODE=disabled + wildcard).
6. LazySyncMiddleware (fresh + stale-bg + stale-blocking + timeout + lock held + max-stale) — sudah ada di AUTH-14, extend di sini.
7. SessionStore parity test (Redis mock vs Memory — observable same behavior).
8. AUTH_MODE=disabled end-to-end test (skip guard, fake user from env, bootstrap validation).

## Scope

**In scope**:
- `packages/security/test/pkce.spec.ts` — PKCE helper tests:
  - `code_verifier` length 43-128 chars (random alphanumeric + `-` `.` `_` `~`).
  - `code_challenge` = base64url(sha256(verifier)) — verify dengan known test vector (RFC 7636 Appendix B).
  - `code_challenge_method = 'S256'`.
  - Reject `plain` method (RFC 9700 §2.1.1).
  - `state` random 32 char (cryptographically secure).
- `packages/security/test/oauth-client.service.spec.ts` — OAuthClientService tests:
  - Mock `openid-client` v5 (`Issuer.discover`, `Client.oauthCallback`, `Client.refresh`, `Client.revoke`).
  - Test cases:
    - `generatePkce()` → return `{ verifier, challenge, state }` valid.
    - `buildAuthorizeUrl({ codeChallenge, state, scope })` → URL dengan params lengkap (`response_type=code`, `client_id`, `redirect_uri`, `scope`, `state`, `code_challenge`, `code_challenge_method=S256`).
    - `exchangeCode(code, verifier)` happy → return `TokenSet` dengan `access_token`, `refresh_token`, `expires_in`.
    - `exchangeCode` wrong verifier → throw.
    - `refresh(refreshToken)` happy → return new TokenSet.
    - `refresh` reuse detection (refresh token used twice) → throw + revoke.
    - `revoke(refreshToken)` → call `Client.revoke` (verify mock called).
    - `fetchPermissions(accessToken)` → call `/api/v1/me/permissions` → return `{ user, role, permissionCodes }`.
    - `fetchPermissions` 401 → throw.
    - `switchRole(accessToken, roleId)` → call `/api/v1/auth/switch-role` → return new TokenSet + permissionCodes.
- `packages/security/test/jwks-verifier.spec.ts` — JwksVerifier tests:
  - Mock JWKS endpoint (returns valid keys).
  - Mock JWT signed with RS256.
  - Test cases:
    - `verify(jwt)` valid → return payload `{ sub, username, roleId, iss, aud, exp, iat, jti }`.
    - `verify` wrong issuer → throw (JOSEError `JWTClaimValidationFailed`).
    - `verify` wrong audience → throw.
    - `verify` expired (`exp < now`) → throw.
    - `verify` not-yet-valid (`iat > now + clockTolerance`) → throw.
    - `verify` invalid signature → throw.
    - `verify` HS256 token (alg confusion attack) → throw (only RS256 allowed).
    - `verify` unknown `kid` → refetch JWKS + retry (verify `createRemoteJWKSet` cache + cooldown behavior).
    - `verify` JWKS endpoint 500 → throw.
    - Clock tolerance 5s → expired by 4s OK, by 6s throw.
- `packages/security/test/session.guard.spec.ts` — SessionGuard tests:
  - Mock `SessionStore`, `Reflector`.
  - Test cases:
    - `AUTH_MODE=oauth` + cookie sid + session found → set `req.user`, return true.
    - `AUTH_MODE=oauth` + cookie sid + session not found → throw `UnauthorizedException`.
    - `AUTH_MODE=oauth` + no cookie sid → throw `UnauthorizedException`.
    - `AUTH_MODE=oauth` + `@Public()` → skip guard, return true (no user set).
    - `AUTH_MODE=disabled` → set `req.user` dari env (`AUTH_DISABLED_*`), return true.
    - `AUTH_MODE=disabled` + `@Public()` → set fake user (still), return true.
    - Verify `buildDisabledUser()` parse `AUTH_DISABLED_PERMISSION_CODES='*'` → `['*']`.
    - Verify `buildDisabledUser()` parse `'payment.read,payment.write'` → `['payment.read', 'payment.write']`.
- `packages/security/test/menu-access.guard.spec.ts` — MenuAccessGuard tests:
  - Mock `Reflector`, `SecurityOptions`.
  - Test cases:
    - `AUTH_MODE=disabled` → return true (skip all checks).
    - `@Public()` → return true.
    - No `@RequireMenu` decorator → return true (no menu required).
    - `@RequireMenu('payment.write')` + `user.permissionCodes=['payment.write']` → return true.
    - `@RequireMenu('payment.write')` + `user.permissionCodes=['payment.read']` → throw `ForbiddenException`.
    - `@RequireMenu('payment.write', 'payment.admin')` + `user.permissionCodes=['payment.read']` → throw (OR logic, neither match).
    - `@RequireMenu('payment.write', 'payment.admin')` + `user.permissionCodes=['payment.admin']` → return true (OR logic, second matches).
    - `isSuperAdmin=true` + `@RequireMenu('payment.admin')` → return true (bypass).
    - `user.permissionCodes=['*']` → return true (wildcard).
    - Verify `menu_access_denied_total` counter increment on deny (bila AUTH-19 metrics wired).
- `packages/security/test/lazy-sync.middleware.spec.ts` — EXTEND existing AUTH-14 tests (di AUTH-14 sudah ada, di sini just verify + extend):
  - Cases covered di AUTH-14: fresh, stale-bg, stale-blocking, timeout, lock held, max-stale.
  - Extend: `AUTH_MODE=disabled` → skip middleware (no session lookup).
- `packages/security/test/session-store.parity.spec.ts` — Parity test Redis vs Memory:
  - Test suite yang run terhadap BOTH `RedisSessionStore` (mock ioredis) dan `MemorySessionStore`.
  - Test cases (parameterized via `describe.each` atau loop):
    - `set(sid, session, ttlMs)` + `get(sid)` → return same session.
    - `set` + `delete(sid)` + `get(sid)` → return null.
    - `set` + wait TTL → `get(sid)` returns null (Redis: mock `PX` expiry via fake timer; Memory: real expiry via setTimeout).
    - `touch(sid)` → update `lastSeenAt` (verify via `get`).
    - `updateSync(sid, permissionCodes, lastSyncAt)` → update session.permissionCodes + lastSyncAt.
    - `listActive()` → return list (Redis: SCAN; Memory: filter by expiry).
    - `acquireLock(key, ttlSec)` → first call returns true, second call (same key, before TTL) returns false.
    - `releaseLock(key)` → release + subsequent `acquireLock` returns true.
  - Mock ioredis via `ioredis-mock` atau custom mock (sederhana: in-memory Map + TTL via setTimeout).
- `packages/security/test/auth-mode-disabled.spec.ts` — End-to-end AUTH_MODE=disabled test:
  - Setup: SecurityModule dengan `authMode='disabled'`, fake env vars.
  - Test cases:
    - SessionGuard → set `req.user` dari env, no SessionStore lookup.
    - MenuAccessGuard → return true (skip).
    - LazySyncMiddleware → `next()` immediately, no sync.
    - Bootstrap validation `validateConfig()`:
      - `NODE_ENV=production` + `AUTH_MODE=disabled` → throw.
      - `AUTH_MODE=disabled` + no `AUTH_DISABLED_USER_ID` → throw.
- `packages/security/test/bootstrap-validation.spec.ts` — Unit test untuk `validateConfig()`:
  - Test cases per plan2 section 16:
    - `NODE_ENV=production` + `AUTH_MODE=mock` → throw.
    - `NODE_ENV=production` + `AUTH_MODE=disabled` → throw.
    - `NODE_ENV=production` + `SESSION_STORE=memory` → throw.
    - `SESSION_STORE=redis` + no `REDIS_URL` → throw.
    - `NODE_ENV=development` + any combination → no throw.
    - `NODE_ENV=test` + any combination → no throw.
- Test helpers:
  - `packages/security/test/helpers/mock-jwks.ts` — generate RS256 keypair + sign JWT + mock JWKS endpoint.
  - `packages/security/test/helpers/mock-openid-client.ts` — mock `openid-client` v5 with `Issuer.discover`, `Client.oauthCallback`, etc.
  - `packages/security/test/helpers/mock-session-store.ts` — in-memory SessionStore implementation for tests.
  - `packages/security/test/helpers/mock-redis.ts` — ioredis mock (use `ioredis-mock` package).
- Coverage target: ≥ 90% untuk `packages/security/src/`.

**Out of scope**:
- Integration tests (full NestJS app + DB) → AUTH-25.
- E2E tests (with auth-mock running) → AUTH-26.
- Contract tests (JWT claims vs AUTH_CONTRACT.md) → AUTH-27.
- Performance tests (throughput) → di luar scope.

## Files to create/modify

- `packages/security/test/pkce.spec.ts` — NEW
- `packages/security/test/oauth-client.service.spec.ts` — NEW
- `packages/security/test/jwks-verifier.spec.ts` — NEW
- `packages/security/test/session.guard.spec.ts` — NEW
- `packages/security/test/menu-access.guard.spec.ts` — NEW
- `packages/security/test/lazy-sync.middleware.spec.ts` — UPDATE (extend dari AUTH-14)
- `packages/security/test/session-store.parity.spec.ts` — NEW
- `packages/security/test/auth-mode-disabled.spec.ts` — NEW
- `packages/security/test/bootstrap-validation.spec.ts` — NEW
- `packages/security/test/helpers/mock-jwks.ts` — NEW
- `packages/security/test/helpers/mock-openid-client.ts` — NEW
- `packages/security/test/helpers/mock-session-store.ts` — NEW
- `packages/security/test/helpers/mock-redis.ts` — NEW
- `packages/security/jest.config.js` — UPDATE (coverage threshold 90%, test path include `test/`)
- `packages/security/package.json` — UPDATE (script `test:cov`)

## Implementation steps

1. **`helpers/mock-jwks.ts`** — generate keypair + sign JWT:
   ```ts
   import { generateKeyPairSync, sign } from 'crypto';
   import { exportJWK } from 'jose';

   export interface MockJwks {
     publicKeyJwk: any;
     privateKeyPem: string;
     kid: string;
     signJwt(payload: any): string;
     jwksEndpoint(): { keys: any[] };
   }

   export async function createMockJwks(kid = 'test-kid-1'): Promise<MockJwks> {
     const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
     const publicJwk = await exportJWK(publicKey);
     const privateJwk = await exportJWK(privateKey);
     const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

     return {
       publicKeyJwk: { ...publicJwk, kid, use: 'sig', alg: 'RS256' },
       privateKeyPem,
       kid,
       signJwt(payload: any): string {
         const header = { alg: 'RS256', typ: 'JWT', kid };
         const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
         const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
         const data = `${encodedHeader}.${encodedPayload}`;
         const signature = sign('RSA-SHA256', data, privateKeyPem).toString('base64url');
         return `${data}.${signature}`;
       },
       jwksEndpoint: () => ({ keys: [publicJwk] }),
     };
   }
   ```

2. **`helpers/mock-openid-client.ts`** — mock `openid-client` v5:
   ```ts
   import { vi } from 'vitest';

   export function mockOpenidClient() {
     const mockClient = {
       oauthCallback: vi.fn(),
       refresh: vi.fn(),
       revoke: vi.fn(),
       userinfo: vi.fn(),
       grant: vi.fn(),
     };
     const mockIssuer = {
       Client: vi.fn(() => mockClient),
       metadata: { issuer: 'http://test-auth' },
     };
     vi.doMock('openid-client', () => ({
       Issuer: {
         discover: vi.fn().mockResolvedValue(mockIssuer),
       },
     }));
     return { mockClient, mockIssuer };
   }
   ```

3. **`pkce.spec.ts`** — test PKCE generation per RFC 7636:
   ```ts
   import { describe, it, expect } from 'vitest';
   import { generatePkce, verifyChallenge } from '../src/oauth/pkce.util';

   describe('PKCE (RFC 7636 + RFC 9700)', () => {
     it('generates verifier of 43-128 chars', () => {
       const { verifier } = generatePkce();
       expect(verifier.length).toBeGreaterThanOrEqual(43);
       expect(verifier.length).toBeLessThanOrEqual(128);
     });

     it('verifier uses only unreserved chars', () => {
       const { verifier } = generatePkce();
       expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
     });

     it('challenge = base64url(sha256(verifier))', () => {
       const { verifier, challenge } = generatePkce();
       const expected = verifyChallenge(verifier);
       expect(challenge).toBe(expected);
     });

     // Test vector dari RFC 7636 Appendix B
     it('RFC 7636 test vector: verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"', () => {
       const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
       const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
       expect(verifyChallenge(verifier)).toBe(expectedChallenge);
     });

     it('challenge method is S256', () => {
       const { method } = generatePkce();
       expect(method).toBe('S256');
     });

     it('state is 32+ chars random', () => {
       const { state } = generatePkce();
       expect(state.length).toBeGreaterThanOrEqual(32);
     });

     it('each call returns unique verifier', () => {
       const a = generatePkce();
       const b = generatePkce();
       expect(a.verifier).not.toBe(b.verifier);
     });
   });
   ```

4. **`oauth-client.service.spec.ts`** — test OAuthClientService with mocked openid-client:
   ```ts
   import { describe, it, expect, beforeEach, vi } from 'vitest';
   import { Test } from '@nestjs/testing';
   import { OAuthClientService } from '../src/oauth/oauth-client.service';
   import { mockOpenidClient } from './helpers/mock-openid-client';

   describe('OAuthClientService', () => {
     let service: OAuthClientService;
     let mockClient: any;

     beforeEach(async () => {
       const mocks = mockOpenidClient();
       mockClient = mocks.mockClient;
       const module = await Test.createTestingModule({
         providers: [
           OAuthClientService,
           { provide: 'SECURITY_OPTIONS', useValue: { oauth: { issuer: 'http://test', clientId: 'c', clientSecret: 's', redirectUri: 'http://cb', scopes: ['openid'] } } },
         ],
       }).compile();
       service = module.get(OAuthClientService);
     });

     it('exchangeCode happy path', async () => {
       mockClient.oauthCallback.mockResolvedValue({
         access_token: 'access-123',
         refresh_token: 'refresh-456',
         expires_in: 900,
         claims: () => ({ sub: 'user-1', username: 'budi', roleId: 'role-1' }),
       });
       const tokens = await service.exchangeCode('code-abc', 'verifier-xyz');
       expect(tokens.access_token).toBe('access-123');
       expect(tokens.refresh_token).toBe('refresh-456');
       expect(mockClient.oauthCallback).toHaveBeenCalledWith('http://cb', { code: 'code-abc' }, { code_verifier: 'verifier-xyz' });
     });

     it('exchangeCode wrong verifier throws', async () => {
       mockClient.oauthCallback.mockRejectedValue(new Error('PKCE verification failed'));
       await expect(service.exchangeCode('code', 'wrong-verifier')).rejects.toThrow('PKCE');
     });

     it('refresh happy path', async () => {
       mockClient.refresh.mockResolvedValue({
         access_token: 'new-access',
         refresh_token: 'new-refresh',
         expires_in: 900,
       });
       const tokens = await service.refresh('old-refresh');
       expect(tokens.access_token).toBe('new-access');
       expect(mockClient.refresh).toHaveBeenCalledWith('old-refresh');
     });

     // ... more cases
   });
   ```

5. **`jwks-verifier.spec.ts`** — test RS256 verification:
   ```ts
   import { describe, it, expect, beforeAll, afterAll } from 'vitest';
   import { JwksVerifier } from '../src/verifiers/jwks-verifier';
   import { createMockJwks, MockJwks } from './helpers/mock-jwks';
   import { setupServer } from 'msw/node';
   import { http, HttpResponse } from 'msw';

   describe('JwksVerifier', () => {
     let verifier: JwksVerifier;
     let mockJwks: MockJwks;
     let server: any;

     beforeAll(async () => {
       mockJwks = await createMockJwks('kid-1');
       server = setupServer(
         http.get('http://test-auth/.well-known/jwks.json', () =>
           HttpResponse.json(mockJwks.jwksEndpoint()),
         ),
       );
       server.listen();
       verifier = new JwksVerifier({
         issuer: 'http://test-auth',
         audience: 'payment-api',
         clockToleranceSec: 5,
         cacheTtlSec: 300,
       });
     });

     afterAll(() => server.close());

     it('verify valid RS256 JWT', async () => {
       const jwt = mockJwks.signJwt({
         sub: 'user-1',
         username: 'budi',
         roleId: 'role-1',
         iss: 'http://test-auth',
         aud: 'payment-api',
         exp: Math.floor(Date.now() / 1000) + 900,
         iat: Math.floor(Date.now() / 1000),
         jti: 'jti-1',
       });
       const payload = await verifier.verify(jwt);
       expect(payload.sub).toBe('user-1');
       expect(payload.username).toBe('budi');
     });

     it('verify wrong issuer throws', async () => {
       const jwt = mockJwks.signJwt({
         sub: 'user-1', iss: 'http://wrong-issuer', aud: 'payment-api',
         exp: Math.floor(Date.now() / 1000) + 900,
       });
       await expect(verifier.verify(jwt)).rejects.toThrow();
     });

     it('verify expired throws', async () => {
       const jwt = mockJwks.signJwt({
         sub: 'user-1', iss: 'http://test-auth', aud: 'payment-api',
         exp: Math.floor(Date.now() / 1000) - 100, // expired 100s ago
       });
       await expect(verifier.verify(jwt)).rejects.toThrow();
     });

     it('verify HS256 alg confusion attack throws', async () => {
       // Sign dengan HS256 (atau alg=none) — jose harus reject karena JWKS hanya berisi RS256 keys
       const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEifQ.invalid-signature';
       await expect(verifier.verify(jwt)).rejects.toThrow();
     });

     // ... more cases
   });
   ```

6. **`session.guard.spec.ts`** — test guard logic:
   ```ts
   describe('SessionGuard', () => {
     it('AUTH_MODE=oauth + valid session → req.user set, return true', async () => {
       // Setup mocks, run guard, assert
     });

     it('AUTH_MODE=disabled → set fake user from env, return true', async () => {
       const module = await Test.createTestingModule({
         providers: [
           SessionGuard,
           { provide: 'SECURITY_OPTIONS', useValue: { authMode: 'disabled', disabled: {
             userId: '00000000-0000-0000-0000-000000000001',
             username: 'disabled-user',
             roleId: '00000000-0000-0000-0000-000000000002',
             isSuperAdmin: true,
             permissionCodes: '*',
           } } },
           { provide: SESSION_STORE, useValue: { get: vi.fn() } },
           Reflector,
         ],
       }).compile();
       const guard = module.get(SessionGuard);
       const req = { cookies: {} };
       const ctx = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => ({}), getClass: () => ({}) };
       const result = await guard.canActivate(ctx as any);
       expect(result).toBe(true);
       expect(req.user.userId).toBe('00000000-0000-0000-0000-000000000001');
       expect(req.user.isSuperAdmin).toBe(true);
       expect(req.user.permissionCodes).toEqual(['*']);
     });

     // ... more cases
   });
   ```

7. **`session-store.parity.spec.ts`** — parameterized test Redis vs Memory:
   ```ts
   import { describe, it, expect, beforeEach, afterEach } from 'vitest';
   import { RedisSessionStore } from '../src/session-store/redis-session.store';
   import { MemorySessionStore } from '../src/session-store/memory-session.store';

   const sampleSession = {
     sid: 'sid-1', userId: 'u1', username: 'budi', roleId: 'r1',
     permissionCodes: ['dashboard', 'payment.read'], accessToken: 'a', refreshToken: 'r',
     accessExpiresAt: Date.now() + 900_000, refreshExpiresAt: Date.now() + 8 * 3600_000,
     createdAt: Date.now(), lastSeenAt: Date.now(), lastSyncAt: Date.now(),
   };

   describe.each([
     ['RedisSessionStore', () => new RedisSessionStore(mockRedisClient())],
     ['MemorySessionStore', () => new MemorySessionStore()],
   ])('SessionStore parity: %s', (name, factory) => {
     let store: any;
     beforeEach(() => { store = factory(); });
     afterEach(async () => { await store.clear?.(); });

     it('set + get returns same session', async () => {
       await store.set('sid-1', sampleSession, 28800_000);
       const got = await store.get('sid-1');
       expect(got).toMatchObject({ sid: 'sid-1', username: 'budi' });
     });

     it('set + delete + get returns null', async () => {
       await store.set('sid-1', sampleSession, 28800_000);
       await store.delete('sid-1');
       expect(await store.get('sid-1')).toBeNull();
     });

     it('touch updates lastSeenAt', async () => {
       await store.set('sid-1', sampleSession, 28800_000);
       await new Promise(r => setTimeout(r, 10));
       await store.touch('sid-1');
       const got = await store.get('sid-1');
       expect(got.lastSeenAt).toBeGreaterThan(sampleSession.lastSeenAt);
     });

     it('updateSync updates permissionCodes + lastSyncAt', async () => {
       await store.set('sid-1', sampleSession, 28800_000);
       await store.updateSync('sid-1', ['dashboard', 'payment.read', 'payment.write'], Date.now());
       const got = await store.get('sid-1');
       expect(got.permissionCodes).toContain('payment.write');
     });

     it('acquireLock first call true, second false (before TTL)', async () => {
       const acquired1 = await store.acquireLock('lock-key-1', 10);
       expect(acquired1).toBe(true);
       const acquired2 = await store.acquireLock('lock-key-1', 10);
       expect(acquired2).toBe(false);
     });

     it('releaseLock + acquireLock returns true', async () => {
       await store.acquireLock('lock-key-2', 10);
       await store.releaseLock('lock-key-2');
       const acquired = await store.acquireLock('lock-key-2', 10);
       expect(acquired).toBe(true);
     });

     // ... more cases: listActive, TTL expiry, etc.
   });
   ```

8. **`bootstrap-validation.spec.ts`** — test `validateConfig()`:
   ```ts
   import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
   import { validateConfig } from '../src/config/bootstrap-validation';

   describe('validateConfig (bootstrap validation)', () => {
     const originalEnv = process.env;

     beforeEach(() => {
       process.env = { ...originalEnv };
     });
     afterEach(() => {
       process.env = originalEnv;
     });

     it('NODE_ENV=production + AUTH_MODE=mock throws', () => {
       process.env.NODE_ENV = 'production';
       process.env.AUTH_MODE = 'mock';
       expect(() => validateConfig()).toThrow('AUTH_MODE=mock tidak boleh di production');
     });

     it('NODE_ENV=production + AUTH_MODE=disabled throws', () => {
       process.env.NODE_ENV = 'production';
       process.env.AUTH_MODE = 'disabled';
       expect(() => validateConfig()).toThrow('AUTH_MODE=disabled tidak boleh di production');
     });

     it('NODE_ENV=production + SESSION_STORE=memory throws', () => {
       process.env.NODE_ENV = 'production';
       process.env.AUTH_MODE = 'oauth';
       process.env.SESSION_STORE = 'memory';
       expect(() => validateConfig()).toThrow('SESSION_STORE=memory tidak boleh di production');
     });

     it('SESSION_STORE=redis + no REDIS_URL throws', () => {
       process.env.NODE_ENV = 'development';
       process.env.AUTH_MODE = 'oauth';
       process.env.SESSION_STORE = 'redis';
       delete process.env.REDIS_URL;
       expect(() => validateConfig()).toThrow('REDIS_URL wajib diisi kalau SESSION_STORE=redis');
     });

     it('AUTH_MODE=disabled + no AUTH_DISABLED_USER_ID throws', () => {
       process.env.NODE_ENV = 'development';
       process.env.AUTH_MODE = 'disabled';
       process.env.SESSION_STORE = 'memory';
       delete process.env.AUTH_DISABLED_USER_ID;
       expect(() => validateConfig()).toThrow('AUTH_DISABLED_USER_ID wajib kalau AUTH_MODE=disabled');
     });

     it('NODE_ENV=development + AUTH_MODE=mock passes', () => {
       process.env.NODE_ENV = 'development';
       process.env.AUTH_MODE = 'mock';
       process.env.SESSION_STORE = 'redis';
       process.env.REDIS_URL = 'redis://localhost:6379';
       expect(() => validateConfig()).not.toThrow();
     });

     it('NODE_ENV=development + AUTH_MODE=disabled + all AUTH_DISABLED_* set passes', () => {
       process.env.NODE_ENV = 'development';
       process.env.AUTH_MODE = 'disabled';
       process.env.SESSION_STORE = 'memory';
       process.env.AUTH_DISABLED_USER_ID = '00000000-0000-0000-0000-000000000001';
       process.env.AUTH_DISABLED_USERNAME = 'disabled-user';
       process.env.AUTH_DISABLED_ROLE_ID = '00000000-0000-0000-0000-000000000002';
       expect(() => validateConfig()).not.toThrow();
     });
   });
   ```

9. **`jest.config.js`** — UPDATE coverage threshold:
   ```js
   module.exports = {
     preset: 'ts-jest',
     testEnvironment: 'node',
     roots: ['<rootDir>/test', '<rootDir>/src'],
     collectCoverageFrom: ['src/**/*.ts', '!src/index.ts', '!src/**/*.module.ts'],
     coverageThreshold: {
       global: { branches: 80, functions: 90, lines: 90, statements: 90 },
     },
     setupFiles: ['<rootDir>/test/setup.ts'],
   };
   ```

## Acceptance criteria

- [ ] `packages/security/test/pkce.spec.ts` lulus — verifier length 43-128, S256 challenge, RFC 7636 test vector match.
- [ ] `packages/security/test/oauth-client.service.spec.ts` lulus — exchangeCode, refresh, revoke, fetchPermissions, switchRole (mock openid-client).
- [ ] `packages/security/test/jwks-verifier.spec.ts` lulus — valid + wrong issuer/aud + expired + invalid sig + alg confusion attack + kid rotation + clock tolerance.
- [ ] `packages/security/test/session.guard.spec.ts` lulus — AUTH_MODE=oauth + AUTH_MODE=disabled + @Public + no cookie + session not found.
- [ ] `packages/security/test/menu-access.guard.spec.ts` lulus — AUTH_MODE=disabled + @Public + no decorator + OR logic + super admin bypass + wildcard + deny throw.
- [ ] `packages/security/test/lazy-sync.middleware.spec.ts` lulus — fresh + stale-bg + stale-blocking + timeout + lock held + max-stale + AUTH_MODE=disabled (extend dari AUTH-14).
- [ ] `packages/security/test/session-store.parity.spec.ts` lulus — same behavior untuk Redis (mock) + Memory across all 8 interface methods.
- [ ] `packages/security/test/auth-mode-disabled.spec.ts` lulus — end-to-end behavior (skip guard, fake user).
- [ ] `packages/security/test/bootstrap-validation.spec.ts` lulus — all 4 production throws + development passes.
- [ ] Test helpers (`mock-jwks`, `mock-openid-client`, `mock-session-store`, `mock-redis`) tersedia + reusable.
- [ ] Coverage ≥ 90% (lines, functions, statements), ≥ 80% (branches).
- [ ] `pnpm --filter @retry-failure/security test` lulus.
- [ ] `pnpm --filter @retry-failure/security test:cov` lulus dengan coverage threshold.

## Useful commands

```bash
# Install test deps
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security add -D vitest @types/jest msw ioredis-mock @vitest/ui

# Or use Jest (if NestJS prefers Jest)
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security add -D @types/jest jest ts-jest msw ioredis-mock

# Run all tests
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security test

# Run with coverage
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security test:cov

# Run specific test file
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security test -- pkce.spec
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security test -- jwks-verifier
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security test -- session-store.parity

# Watch mode (dev)
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security test -- --watch

# UI mode (Vitest)
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security test -- --ui

# Coverage report (open in browser)
cd /home/z/my-project/retry-failure/packages/security/coverage && python3 -m http.server 8080
# Open http://localhost:8080/lcov-report/index.html

# Lint + typecheck after test changes
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security typecheck
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security lint
```

## Notes

- **Plan2 section 17.1 unit tests** mencakup:
  - PKCE: verifier/challenge, S256.
  - OAuth client: token exchange, refresh, revoke, switch-role.
  - JWKS verifier: cache, rotation, invalid signature.
  - Session guard: valid, expired, revoked.
  - MenuAccessGuard: super admin, allowed, denied.
  - Lazy sync middleware: fresh, stale (background), very stale (blocking), timeout, lock.
  - SessionStore: Redis + Memory (parity test).
  - `AUTH_MODE=disabled`: skip guard, user palsu, guard production.
- **Vitest vs Jest**: NestJS default Jest, tapi Vitest lebih cepat + ESM-friendly. Pilih salah satu — konsisten di monorepo. Rekomendasi: Jest (kompatibel dengan NestJS test utilities seperti `Test.createTestingModule`).
- **Mock strategy**:
  - `openid-client` v5 → mock via `vi.doMock` atau Jest `jest.mock('openid-client', ...)`.
  - `jose` → real (tidak di-mock — pakai real RS256 signing + verification). JWKS endpoint pakai MSW (`msw` library).
  - `ioredis` → pakai `ioredis-mock` (in-memory implementation).
  - `Reflector` (NestJS) → real (just `new Reflector()`).
- **RFC 7636 test vector** (Appendix B):
  - verifier: `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk`
  - challenge: `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`
- **Coverage threshold**:
  - Global ≥ 90% lines/functions/statements.
  - Branches ≥ 80% (branch coverage lebih sulit karena banyak edge cases).
  - Bila tidak capai, tambah test untuk missing branches.
- **`mock-jwks.ts`** pakai `crypto.generateKeyPairSync('rsa')` (Node.js built-in) + `jose.exportJWK` (dari jose v5). Real RSA keypair, real signing. Tidak mock crypto — lebih reliable.
- **Parity test** (`session-store.parity.spec.ts`) menggunakan `describe.each` (Jest) atau loop (Vitest) untuk run same test suite terhadap kedua implementation. Catch bug bila Redis + Memory behavior drift.
- Setelah task ini selesai, `packages/security` punya unit test coverage ≥ 90%. Selanjutnya: AUTH-25 (integration tests payment-api), AUTH-26 (E2E with auth-mock), AUTH-27 (contract tests).
