# AUTH-27 — Contract tests (JWT claims + JWKS + permissions + error format)

> **Task ID**: AUTH-27
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-07, AUTH-17
> **Estimated effort**: M (~2-3 jam)
> **Plan reference**: Section 17.5 (Contract test), Section 25.7 (Contract Test), Section 25.8 (Kompatibilitas auth-mock vs auth asli)

---

## Goal

Tulis contract test suite yang verify `apps/auth-mock` dan auth asli (future) comply dengan `AUTH_CONTRACT.md` (v1.0.0). Coverage:
1. JWT claims match contract (sub, username, roleId, iss, aud, exp, iat, jti).
2. JWKS endpoint returns valid keys (RS256, kid, use=sig).
3. `/api/v1/me/permissions` response format match contract.
4. Error format (400/401/403/429) match contract.
5. Run against both auth-mock (port 4001) and auth asli (setelah Fase 2).

## Scope

**In scope**:
- `apps/payment-api/test/contract/auth-contract.spec.ts` — contract test suite:
  - Reads contract source: `docs/plan2-auth-integration/AUTH_CONTRACT.md` (v1.0.0).
  - Tests against auth-mock (default) + auth asli (if `AUTH_BASE_URL` points to real auth).
  - 4 test groups:
    1. **JWT Claims contract**:
       - Decode JWT (without verify) dari `/oauth/token` response.
       - Verify all 8 required claims: `sub`, `username`, `roleId`, `iss`, `aud`, `exp`, `iat`, `jti`.
       - Verify types: `sub` UUID, `username` string, `roleId` UUID, `iss` URL, `aud` string (`payment-api`), `exp`/`iat` number (unix timestamp), `jti` string.
       - Verify `exp > iat` (expiration after issued).
       - Verify `exp - iat <= 900` (15 min access token lifetime per plan2 section 5.3).
       - Verify `iss` matches `AUTH_ISSUER` env.
       - Verify `aud` matches `JWT_AUDIENCE` env (`payment-api`).
       - Verify no extra claims (beyond contract) — atau extra claims allowed (MINOR change).
    2. **JWKS endpoint contract**:
       - `GET /.well-known/jwks.json` → 200 + JSON `{ keys: [...] }`.
       - Each key: `kty: 'RSA'`, `use: 'sig'`, `alg: 'RS256'`, `kid: <string>`, `n: <base64url>`, `e: <base64url>`.
       - Verify key can verify JWT signed dengan private key matching.
       - Verify `kid` in JWT header matches one of JWKS keys.
       - Verify JWKS refetch works (rotate `kid` → new key appears).
    3. **`/api/v1/me/permissions` response format contract**:
       - GET `/api/v1/me/permissions` dengan Bearer token → 200 + JSON.
       - Response structure:
         ```json
         {
           "success": true,
           "data": {
             "user": {
               "id": "uuid",
               "username": "string",
               "email": "string | null",
               "name": "string",
               "isSuperAdmin": boolean
             },
             "role": { "id": "uuid", "name": "string" },
             "permissionCodes": ["string", ...]
           }
         }
         ```
       - Verify types match contract.
       - Verify `permissionCodes` is array of strings (non-empty).
       - Verify `user.id` is UUID.
       - Verify `role.id` is UUID.
       - Verify `success: true` for happy path.
    4. **Error format contract**:
       - 400 Bad Request: `{ statusCode: 400, message: string }`.
       - 401 Unauthorized: `{ statusCode: 401, message: string }`.
       - 403 Forbidden: `{ statusCode: 403, message: string }`.
       - 429 Too Many Requests: `{ statusCode: 429, message: string, retryAfter: number }`.
       - Trigger errors:
         - 400: POST `/oauth/token` with missing `code` → 400.
         - 401: GET `/api/v1/me/permissions` with invalid/expired Bearer → 401.
         - 403: GET `/api/v1/me/permissions` with Bearer for user without permission → 403 (atau dari payment-api `MenuAccessGuard`).
         - 429: spam login → 429 dari throttler.
- Contract test runner:
  - `apps/payment-api/test/contract/contract-runner.ts` — generic runner yang accept `baseUrl` + `clientId` + `clientSecret` + `testUserCredentials`.
  - Run via `pnpm test:contract` dengan env vars `AUTH_BASE_URL=http://localhost:4001` (auth-mock) or `AUTH_BASE_URL=https://staging.auth.example.com` (auth asli).
- Contract version compatibility:
  - Test verify AUTH_CONTRACT version (read dari `AUTH_CONTRACT.md` header `> **Version**: X.Y.Z`).
  - Bila auth returns version mismatch (via custom header `X-Auth-Contract-Version`) → warn + skip tests (selama breaking change).
  - Bila version >= contract → all tests should pass.
- Coverage report:
  - Generate `contract-coverage.md` yang list semua contract clauses + pass/fail per clause.
  - Output ke `docs/plan2-auth-integration/contract-coverage.md` (atau stdout).

**Out of scope**:
- Performance tests (response time) → di luar scope.
- Load tests → di luar scope.
- Security audit (penetration tests) → di luar scope.
- Contract test untuk FE Vue (UI elements) → di luar scope.
- Contract test untuk internal behavior (e.g., refresh token rotation) → covered di unit/integration tests.

## Files to create/modify

- `apps/payment-api/test/contract/auth-contract.spec.ts` — NEW (main contract test suite)
- `apps/payment-api/test/contract/contract-runner.ts` — NEW (generic runner)
- `apps/payment-api/test/contract/contract-fixtures.ts` — NEW (expected contract values dari AUTH_CONTRACT.md)
- `apps/payment-api/test/contract/README.md` — NEW (how to run against auth-mock vs auth asli)
- `apps/payment-api/jest.contract.config.js` — NEW (separate Jest config)
- `apps/payment-api/package.json` — UPDATE (script `test:contract`)
- `docs/plan2-auth-integration/contract-coverage.md` — NEW (generated coverage report, created on first run)

## Implementation steps

1. **`contract-fixtures.ts`** — expected contract values parsed dari `AUTH_CONTRACT.md`:
   ```ts
   // Auto-generated dari AUTH_CONTRACT.md (v1.0.0)
   export const EXPECTED_CONTRACT_VERSION = '1.0.0';

   export const EXPECTED_JWT_CLAIMS = [
     { name: 'sub', type: 'string', format: 'uuid', required: true },
     { name: 'username', type: 'string', required: true },
     { name: 'roleId', type: 'string', format: 'uuid', required: true },
     { name: 'iss', type: 'string', format: 'url', required: true },
     { name: 'aud', type: 'string', required: true },
     { name: 'exp', type: 'number', required: true },
     { name: 'iat', type: 'number', required: true },
     { name: 'jti', type: 'string', required: true },
   ];

   export const EXPECTED_JWT_ALG = 'RS256';
   export const EXPECTED_ACCESS_TOKEN_LIFETIME_SEC = 900; // 15 min
   export const EXPECTED_REFRESH_TOKEN_LIFETIME_SEC = 28800; // 8 hours

   export const EXPECTED_OAUTH_ENDPOINTS = {
     authorize: '/oauth/authorize',
     token: '/oauth/token',
     revoke: '/oauth/revoke',
     jwks: '/.well-known/jwks.json',
   };

   export const EXPECTED_INTERNAL_ENDPOINTS = {
     permissions: '/api/v1/me/permissions',
     switchRole: '/api/v1/auth/switch-role',
   };

   export const EXPECTED_ERROR_FORMAT = {
     400: ['statusCode', 'message'],
     401: ['statusCode', 'message'],
     403: ['statusCode', 'message'],
     429: ['statusCode', 'message', 'retryAfter'],
   };

   // Fixture credentials untuk auth-mock (dari AUTH-06)
   export const AUTH_MOCK_TEST_USER = {
     username: 'budi_santoso',
     password: 'ChangeMe_123!',
     expectedUserId: '00000000-0000-1000-8000-000000000001',
     expectedRoleId: '00000000-0000-1000-8000-000000000010', // HRD
   };
   ```

2. **`contract-runner.ts`** — generic runner:
   ```ts
   import axios, { AxiosInstance } from 'axios';

   export interface ContractRunnerConfig {
     baseUrl: string;       // http://localhost:4001 (auth-mock) or https://staging.auth.example.com (auth asli)
     clientId: string;
     clientSecret: string;
     redirectUri: string;
     testUser: { username: string; password: string; };
   }

   export interface ContractResult {
     name: string;
     passed: boolean;
     error?: string;
     actual?: any;
     expected?: any;
   }

   export class ContractRunner {
     private client: AxiosInstance;

     constructor(private config: ContractRunnerConfig) {
       this.client = axios.create({ baseURL: config.baseUrl, validateStatus: () => true });
     }

     async runOAuthFlow(): Promise<{ accessToken: string; refreshToken: string; idToken: string }> {
       // 1. Generate PKCE + state
       const verifier = 'test-verifier-43-chars-min-aaaaaaaaaaaaa';
       const state = 'test-state';

       // 2. GET /oauth/authorize → expect 302 redirect to /login (auth-mock) or 200 with login form
       // ... manual flow via axios + cookie jar
       // Simplified: assume token via dev/token endpoint untuk contract test
       const res = await this.client.post('/dev/token', {
         username: this.config.testUser.username,
         password: this.config.testUser.password,
       });
       return res.data;
     }

     async getPermissions(accessToken: string): Promise<any> {
       const res = await this.client.get('/api/v1/me/permissions', {
         headers: { Authorization: `Bearer ${accessToken}` },
       });
       return { status: res.status, body: res.data };
     }

     async getJwks(): Promise<any> {
       const res = await this.client.get('/.well-known/jwks.json');
       return { status: res.status, body: res.data };
     }
   }
   ```

3. **`auth-contract.spec.ts`** — main contract test suite:
   ```ts
   import { describe, it, expect, beforeAll } from 'jest';
   import { ContractRunner } from './contract-runner';
   import {
     EXPECTED_CONTRACT_VERSION,
     EXPECTED_JWT_CLAIMS,
     EXPECTED_JWT_ALG,
     EXPECTED_ACCESS_TOKEN_LIFETIME_SEC,
     AUTH_MOCK_TEST_USER,
   } from './contract-fixtures';

   const baseUrl = process.env.AUTH_BASE_URL ?? 'http://localhost:4001';
   const clientId = process.env.OAUTH_CLIENT_ID ?? 'payment-api';
   const clientSecret = process.env.OAUTH_CLIENT_SECRET ?? 'dev-client-secret';
   const redirectUri = process.env.OAUTH_REDIRECT_URI ?? 'http://localhost:3001/auth/callback';

   describe('AUTH_CONTRACT.md v1.0.0 contract test', () => {
     let runner: ContractRunner;
     let tokens: { accessToken: string; refreshToken: string; idToken: string };

     beforeAll(async () => {
       runner = new ContractRunner({
         baseUrl, clientId, clientSecret, redirectUri,
         testUser: AUTH_MOCK_TEST_USER,
       });
       tokens = await runner.runOAuthFlow();
     }, 30000);

     describe('1. JWT Claims contract (Section 4)', () => {
       it('JWT contains all 8 required claims', () => {
         const [, payloadB64] = tokens.accessToken.split('.');
         const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

         for (const claim of EXPECTED_JWT_CLAIMS) {
           expect(payload).toHaveProperty(claim.name);
         }
       });

       it('sub is UUID', () => {
         const payload = decodeJwt(tokens.accessToken);
         expect(payload.sub).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
       });

       it('roleId is UUID', () => {
         const payload = decodeJwt(tokens.accessToken);
         expect(payload.roleId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
       });

       it('iss matches AUTH_ISSUER env', () => {
         const payload = decodeJwt(tokens.accessToken);
         expect(payload.iss).toBe(baseUrl);
       });

       it('aud matches JWT_AUDIENCE (payment-api)', () => {
         const payload = decodeJwt(tokens.accessToken);
         expect(payload.aud).toBe('payment-api');
       });

       it('exp is number (unix timestamp)', () => {
         const payload = decodeJwt(tokens.accessToken);
         expect(typeof payload.exp).toBe('number');
         expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
       });

       it('iat is number, before exp', () => {
         const payload = decodeJwt(tokens.accessToken);
         expect(typeof payload.iat).toBe('number');
         expect(payload.iat).toBeLessThan(payload.exp);
       });

       it('exp - iat <= 900s (15 min access token lifetime)', () => {
         const payload = decodeJwt(tokens.accessToken);
         expect(payload.exp - payload.iat).toBeLessThanOrEqual(EXPECTED_ACCESS_TOKEN_LIFETIME_SEC);
       });

       it('jti is non-empty string', () => {
         const payload = decodeJwt(tokens.accessToken);
         expect(typeof payload.jti).toBe('string');
         expect(payload.jti.length).toBeGreaterThan(0);
       });

       it('JWT header alg = RS256', () => {
         const headerB64 = tokens.accessToken.split('.')[0];
         const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
         expect(header.alg).toBe(EXPECTED_JWT_ALG);
       });

       it('JWT header kid present + matches JWKS', async () => {
         const header = decodeJwtHeader(tokens.accessToken);
         expect(header.kid).toBeDefined();

         const jwks = await runner.getJwks();
         const matchingKey = jwks.body.keys.find((k: any) => k.kid === header.kid);
         expect(matchingKey).toBeDefined();
       });
     });

     describe('2. JWKS endpoint contract (Section 5)', () => {
       it('GET /.well-known/jwks.json → 200 + JSON', async () => {
         const res = await runner.getJwks();
         expect(res.status).toBe(200);
         expect(res.body).toHaveProperty('keys');
         expect(Array.isArray(res.body.keys)).toBe(true);
         expect(res.body.keys.length).toBeGreaterThan(0);
       });

       it('JWKS keys have required properties', async () => {
         const res = await runner.getJwks();
         for (const key of res.body.keys) {
           expect(key.kty).toBe('RSA');
           expect(key.use).toBe('sig');
           expect(key.alg).toBe('RS256');
           expect(key.kid).toBeDefined();
           expect(key.n).toBeDefined(); // RSA modulus
           expect(key.e).toBeDefined(); // RSA exponent
         }
       });
     });

     describe('3. /api/v1/me/permissions response format contract (Section 6)', () => {
       it('GET /api/v1/me/permissions → 200 + { success, data }', async () => {
         const res = await runner.getPermissions(tokens.accessToken);
         expect(res.status).toBe(200);
         expect(res.body).toHaveProperty('success', true);
         expect(res.body).toHaveProperty('data');
       });

       it('data.user has correct fields', async () => {
         const res = await runner.getPermissions(tokens.accessToken);
         const user = res.body.data.user;
         expect(user.id).toMatch(/^[0-9a-f-]+$/); // UUID
         expect(typeof user.username).toBe('string');
         expect(typeof user.name).toBe('string');
         expect(typeof user.isSuperAdmin).toBe('boolean');
       });

       it('data.role has correct fields', async () => {
         const res = await runner.getPermissions(tokens.accessToken);
         const role = res.body.data.role;
         expect(role.id).toMatch(/^[0-9a-f-]+$/);
         expect(typeof role.name).toBe('string');
       });

       it('data.permissionCodes is array of strings', async () => {
         const res = await runner.getPermissions(tokens.accessToken);
         const codes = res.body.data.permissionCodes;
         expect(Array.isArray(codes)).toBe(true);
         expect(codes.length).toBeGreaterThan(0);
         for (const code of codes) {
           expect(typeof code).toBe('string');
         }
       });
     });

     describe('4. Error format contract (Section 7)', () => {
       it('400 Bad Request: { statusCode: 400, message }', async () => {
         // POST /oauth/token dengan missing code → 400
         const res = await axios.post(`${baseUrl}/oauth/token`, {
           grant_type: 'authorization_code',
           // missing code, code_verifier
         }, { validateStatus: () => true });

         expect(res.status).toBe(400);
         expect(res.body).toHaveProperty('statusCode', 400);
         expect(res.body).toHaveProperty('message');
       });

       it('401 Unauthorized: { statusCode: 401, message }', async () => {
         // GET /api/v1/me/permissions dengan invalid Bearer
         const res = await axios.get(`${baseUrl}/api/v1/me/permissions`, {
           headers: { Authorization: 'Bearer invalid-token' },
           validateStatus: () => true,
         });

         expect(res.status).toBe(401);
         expect(res.body).toHaveProperty('statusCode', 401);
         expect(res.body).toHaveProperty('message');
       });

       it('429 Too Many Requests: { statusCode: 429, message, retryAfter }', async () => {
         // Spam login (10+ requests in 1 min) → 429 dari throttler
         // Note: rate limit may be di payment-api, bukan auth-mock. Tergantung konfigurasi.
         const results = [];
         for (let i = 0; i < 15; i++) {
           const res = await axios.post(`${baseUrl}/oauth/token`, {
             // ... valid request
           }, { validateStatus: () => true });
           results.push(res.status);
         }
         expect(results).toContain(429);

         const rateLimited = results.find((_, i) => results[i] === 429);
         // ... find the 429 response + verify body
       });
     });

     describe('5. Endpoint paths contract (Section 2 + 3)', () => {
       it('GET /oauth/authorize exists', async () => {
         const res = await axios.get(`${baseUrl}/oauth/authorize`, {
           params: { response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'openid profile' },
           validateStatus: () => true,
           maxRedirects: 0,
         });
         expect([200, 302]).toContain(res.status);
       });

       it('POST /oauth/token exists', async () => {
         const res = await axios.post(`${baseUrl}/oauth/token`, {}, { validateStatus: () => true });
         expect(res.status).not.toBe(404);
       });

       it('POST /oauth/revoke exists', async () => {
         const res = await axios.post(`${baseUrl}/oauth/revoke`, {}, { validateStatus: () => true });
         expect(res.status).not.toBe(404);
       });

       it('GET /.well-known/jwks.json exists', async () => {
         const res = await axios.get(`${baseUrl}/.well-known/jwks.json`, { validateStatus: () => true });
         expect(res.status).toBe(200);
       });

       it('GET /.well-known/openid-configuration exists (OIDC discovery)', async () => {
         const res = await axios.get(`${baseUrl}/.well-known/openid-configuration`, { validateStatus: () => true });
         expect(res.status).toBe(200);
       });

       it('GET /api/v1/me/permissions exists', async () => {
         const res = await axios.get(`${baseUrl}/api/v1/me/permissions`, {
           headers: { Authorization: `Bearer ${tokens.accessToken}` },
           validateStatus: () => true,
         });
         expect([200, 401]).toContain(res.status); // 401 bila token expired, 200 valid
       });
     });
   });

   function decodeJwt(jwt: string): any {
     const [, payloadB64] = jwt.split('.');
     return JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
   }
   function decodeJwtHeader(jwt: string): any {
     const [headerB64] = jwt.split('.');
     return JSON.parse(Buffer.from(headerB64, 'base64url').toString());
   }
   ```

4. **`README.md`** (contract test):
   - How to run against auth-mock: `pnpm test:contract` (default `AUTH_BASE_URL=http://localhost:4001`).
   - How to run against auth asli staging: `AUTH_BASE_URL=https://staging.auth.example.com OAUTH_CLIENT_SECRET=real-secret pnpm test:contract`.
   - How to update `contract-fixtures.ts` bila `AUTH_CONTRACT.md` updated (increment version, add new expected values).

5. **`jest.contract.config.js`**:
   ```js
   module.exports = {
     preset: 'ts-jest',
     testEnvironment: 'node',
     roots: ['<rootDir>/test/contract'],
     testMatch: ['**/*.contract.spec.ts'],
     testTimeout: 30000,
   };
   ```

6. **`package.json` scripts** — UPDATE:
   ```json
   {
     "scripts": {
       "test:contract": "jest --config jest.contract.config.js"
     }
   }
   ```

7. **Coverage report generation** (opsional):
   - Setelah test run, generate `docs/plan2-auth-integration/contract-coverage.md`:
     ```md
     # Contract Coverage Report — AUTH_CONTRACT.md v1.0.0
     > Generated: <date>
     > Target: <AUTH_BASE_URL>

     ## Pass/Fail Summary
     - Total clauses: 25
     - Passed: 23
     - Failed: 2 (clause X.Y, clause Z.W)

     ## Details
     | Section | Clause | Status | Notes |
     |---|---|---|---|
     | 4 | JWT contains 8 claims | PASS | - |
     | 4 | sub is UUID | PASS | - |
     | 4 | roleId is UUID | PASS | - |
     ...
     | 7 | 429 has retryAfter | FAIL | Actual: missing retryAfter field |
     ```
   - Implementasi: hook di `afterAll` untuk write report.

## Acceptance criteria

- [ ] `auth-contract.spec.ts` berisi 5 describe blocks per AUTH_CONTRACT.md v1.0.0 (Section 4 + 5 + 6 + 7 + endpoint paths).
- [ ] Test 1 (JWT Claims): 10+ assertions — all 8 required claims present + types correct + `iss`/`aud` match env + `exp - iat <= 900s` + `jti` non-empty.
- [ ] Test 2 (JWKS): 200 + JSON `{ keys: [...] }` + each key has `kty='RSA'`, `use='sig'`, `alg='RS256'`, `kid`, `n`, `e`.
- [ ] Test 3 (`/api/v1/me/permissions`): response match contract `{ success: true, data: { user, role, permissionCodes } }` + types correct.
- [ ] Test 4 (Error format): 400/401/403/429 return `{ statusCode, message }` (+ `retryAfter` for 429).
- [ ] Test 5 (Endpoint paths): all 6 endpoints exist (`/oauth/authorize`, `/oauth/token`, `/oauth/revoke`, `/.well-known/jwks.json`, `/.well-known/openid-configuration`, `/api/v1/me/permissions`).
- [ ] Test berjalan baik terhadap auth-mock (`AUTH_BASE_URL=http://localhost:4001`).
- [ ] Test berjalan baik terhadap auth asli (setelah Fase 2 — `AUTH_BASE_URL=https://staging.auth.example.com`).
- [ ] `contract-fixtures.ts` berisi EXPECTED_CONTRACT_VERSION + EXPECTED_JWT_CLAIMS + EXPECTED_JWT_ALG + EXPECTED_OAUTH_ENDPOINTS + EXPECTED_INTERNAL_ENDPOINTS + EXPECTED_ERROR_FORMAT.
- [ ] `contract-runner.ts` generic — accept `baseUrl` + credentials + test user.
- [ ] `README.md` document cara run terhadap auth-mock + auth asli.
- [ ] `pnpm --filter payment-api test:contract` lulus dengan auth-mock running.
- [ ] `pnpm --filter payment-api typecheck` + `lint` lulus.
- [ ] Contract coverage report (opsional): `docs/plan2-auth-integration/contract-coverage.md` generated dengan pass/fail summary.

## Useful commands

```bash
# Install deps (jika belum)
cd  && pnpm --filter payment-api add axios
cd  && pnpm --filter payment-api add -D @types/jest

# Start auth-mock
cd  && pnpm --filter auth-mock start:dev &

# Run contract tests against auth-mock (default)
cd  && pnpm --filter payment-api test:contract

# Run against auth asli (setelah Fase 2)
cd  && \
  AUTH_BASE_URL=https://staging.auth.example.com \
  OAUTH_CLIENT_ID=payment-api \
  OAUTH_CLIENT_SECRET=real-secret-from-vault \
  OAUTH_REDIRECT_URI=https://staging.payment.example.com/auth/callback \
  pnpm --filter payment-api test:contract

# Run specific contract test
cd  && pnpm --filter payment-api test:contract -- --testNamePattern="JWT"

# Run with verbose output
cd  && pnpm --filter payment-api test:contract -- --verbose

# Generate coverage report (opsional)
cd  && pnpm --filter payment-api test:contract -- --json --outputFile=test-results.json
# Parse + generate docs/plan2-auth-integration/contract-coverage.md

# Typecheck + lint after changes
cd  && pnpm --filter payment-api typecheck
cd  && pnpm --filter payment-api lint
```

## Notes

- **Plan2 section 17.5 contract test** — test JWT claims, JWKS, `/api/v1/me/permissions`, error format. Alarm saat auth update.
- **Plan2 section 25.7 contract test** — same content, di-refer di Roadmap OAuth2 Server.
- **Plan2 section 25.8 kompatibilitas** — auth-mock dan auth asli harus:
  - Kontrak sama (JWT claims, endpoints, error format).
  - JWT klaim sama.
  - Path sama.
  - Error format sama.
  - Perbedaan diperbolehkan: implementasi internal, skala, fitur tambahan.
- **Contract test approach**:
  - Tests verify actual HTTP responses match contract specification.
  - Tests run against BOTH auth-mock (dev) + auth asli (staging/production).
  - Bila auth-mock passes but auth asli fails → contract drift detected → alarm CI.
  - Bila AUTH_CONTRACT updated → contract-fixtures.ts harus update → tests re-run.
- **Contract versioning** (plan2 section 18.2):
  - AUTH_CONTRACT.md pakai SemVer.
  - Perubahan breaking → MAJOR.
  - Payment-api mendukung N dan N-1.
  - Contract test should detect MAJOR changes (fail bila expected vs actual mismatch).
- **`/dev/token` endpoint** di auth-mock (AUTH-05) — shortcut untuk dev: return token langsung tanpa OAuth flow. Pakai di contract test supaya faster (skip browser flow). Untuk auth asli, harus pakai full OAuth flow.
- **Rate limit test (429)** bisa tricky di contract test karena throttler state shared across tests. Solusi:
  - Run di isolated instance (fresh restart between tests).
  - Atau reset throttler state bila ada admin endpoint.
  - Atau skip 429 test bila tidak reliable.
- **`X-Auth-Contract-Version` header** (opsional): auth dapat return version contract yang di-support. Contract test verify compatibility (N and N-1 per plan2 section 18.2).
- Setelah task ini selesai, Plan2 Fase 1 langkah 11 (contract test + E2E) lengkap. Selanjutnya: AUTH-28 (dokumentasi final).
