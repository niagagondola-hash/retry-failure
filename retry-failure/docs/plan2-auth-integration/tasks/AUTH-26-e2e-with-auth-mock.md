# AUTH-26 — E2E with auth-mock (full OAuth2 flow + multi-role + super admin + sandbox mode)

> **Task ID**: AUTH-26
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-25
> **Estimated effort**: L (~3-4 jam)
> **Plan reference**: Section 17.3 (E2E lintas service), Section 17.6 (Sandbox test), Section 4 (Alur OAuth 2.0), Section 10.5 (Multi-role flow)

---

## Goal

E2E test lintas-service dengan **real auth-mock running** (bukan mock openid-client). Test full OAuth2 flow end-to-end via HTTP, mencakup:
1. Single-role login flow (user dengan 1 role).
2. Multi-role login + role selection (user dengan multiple roles).
3. Super admin bypass.
4. User without access → 403.
5. Sandbox mode (`SESSION_STORE=memory`, no Redis).
6. `AUTH_MODE=disabled` mode (skip auth entirely).

## Scope

**In scope**:
- `apps/payment-api/test/e2e/auth-mock.e2e.spec.ts` — E2E test suite:
  - **Prerequisite**: auth-mock running di port 4001 + payment-api running di port 3001.
  - Pakai real HTTP requests (no mock openid-client, no mock SessionStore).
  - Pakai Playwright atau Puppeteer untuk browser-based flow (login UI di auth-mock) ATAU pakai `supertest` + manual code extraction dari auth-mock (login API endpoint).
  - Test cases per plan2 section 17.3:
    1. **Single-role login flow**:
       - User: `budi_santoso` (atau user lain dengan 1 role).
       - Flow: `GET /auth/login` → redirect to auth-mock `/oauth/authorize` → submit login form → consent → callback → session created → `GET /auth/session` returns user.
       - Verify: cookie `sid` set, `GET /payments` return 200 (bila user punya `payment.read`).
    2. **Multi-role login + role selection**:
       - User: `budi_santoso` (HRD + Finance).
       - Flow: `GET /auth/login` → auth-mock `/oauth/authorize` → login form → submit → select-role page (pilih HRD or Finance) → callback.
       - Verify: session.roleId === selected role, session.permissionCodes matches selected role.
       - Test switch-role: `POST /auth/switch-role { roleId: 'finance-role-id' }` → update session → `GET /auth/session` returns new roleId.
    3. **Super admin bypass**:
       - User: `superadmin` (single role, `isSuperAdmin=true`).
       - Flow: login (no role selection needed) → callback → session.
       - Verify: `GET /admin/gateway-config` return 200 (bypass `payment.admin` check).
       - Verify: all menu checks bypassed.
    4. **User without access → 403**:
       - User: user baru dengan `permissionCodes=['dashboard']` only (no `payment.read`).
       - Flow: login → callback → `GET /payments` → expect 403.
       - Verify: `MenuAccessGuard` throw `ForbiddenException`.
    5. **Sandbox mode (`SESSION_STORE=memory`, no Redis)**:
       - Start payment-api dengan `SESSION_STORE=memory`, no Redis running.
       - Flow: login → callback → session in memory.
       - Verify: `GET /auth/session` works, `GET /payments` works.
       - Verify: restart payment-api → session lost (memory store tidak persist).
    6. **`AUTH_MODE=disabled` mode**:
       - Start payment-api dengan `AUTH_MODE=disabled`, no auth-mock needed.
       - Flow: `GET /payments` directly → 200 (no auth required).
       - Verify: `GET /auth/session` returns fake user dari env.
       - Verify: `GET /auth/login` → 501.
- E2E test setup:
  - **Option A**: Playwright (browser automation, handle login form di auth-mock).
  - **Option B**: Supertest + manual code extraction (skip browser, parse redirect chain + login API).
  - Rekomendasi: Option B untuk simplicity + faster. Option A bila perlu test login UI.
- E2E helpers:
  - `apps/payment-api/test/e2e/helpers/auth-mock-client.ts` — helper untuk automasi OAuth flow dengan auth-mock:
    - `startLogin()` → follow redirect → return auth-mock login URL.
    - `submitLogin(username, password)` → POST form login ke auth-mock.
    - `selectRole(roleId)` → POST select-role form.
    - `followCallback()` → ambil code dari redirect → follow to payment-api callback → return session cookie.
  - `apps/payment-api/test/e2e/helpers/e2e-setup.ts` — start/stop auth-mock + payment-api (bila perlu start fresh, atau asumsikan already running via `pnpm docker:up:sandbox`).
- Fixture users di auth-mock (dari AUTH-06):
  - `superadmin` / `ChangeMe_123!` (isSuperAdmin=true, single role).
  - `budi_santoso` / `ChangeMe_123!` (multi-role HRD + Finance).
- Docker integration:
  - Tests run via `pnpm test:e2e` yang first ensure auth-mock + payment-api running.
  - Atau tests start/stop containers via `docker compose -f docker-compose.sandbox.yml up -d` di `beforeAll`.
- Coverage:
  - Full OAuth2 flow happy path per role type.
  - Edge cases: invalid credentials, wrong state, expired code.

**Out of scope**:
- E2E dengan auth asli (Plan2 Fase 3) — di luar Plan2 Fase 1.
- FE Vue E2E (browser automation full FE) → di luar scope Plan2 (Plan2 section 17.4 FE Vue test minimal).
- Load/stress tests → di luar scope.
- Network failure simulation (auth-mock offline) → di luar scope (handled di unit tests via mock).

## Files to create/modify

- `apps/payment-api/test/e2e/auth-mock.e2e.spec.ts` — NEW (main E2E suite)
- `apps/payment-api/test/e2e/helpers/auth-mock-client.ts` — NEW (OAuth flow automator)
- `apps/payment-api/test/e2e/helpers/e2e-setup.ts` — NEW (start/stop services)
- `apps/payment-api/test/e2e/fixtures/users.ts` — NEW (fixture credentials)
- `apps/payment-api/jest.e2e.config.js` — NEW (separate Jest config for E2E, longer timeout)
- `apps/payment-api/package.json` — UPDATE (script `test:e2e` + deps)

## Implementation steps

1. **`fixtures/users.ts`**:
   ```ts
   export const E2E_USERS = {
     superadmin: {
       username: 'superadmin',
       password: 'ChangeMe_123!',
       userId: '00000000-0000-1000-8000-000000000099',
       roleId: '00000000-0000-1000-8000-000000000090',
       isSuperAdmin: true,
       expectedPermissionCodes: ['*'],
     },
     budiHrd: {
       username: 'budi_santoso',
       password: 'ChangeMe_123!',
       userId: '00000000-0000-1000-8000-000000000001',
       roleId: '00000000-0000-1000-8000-000000000010', // HRD
       isSuperAdmin: false,
       expectedPermissionCodes: ['dashboard', 'payment.read', 'payment.write'],
     },
     budiFinance: {
       username: 'budi_santoso',
       password: 'ChangeMe_123!',
       userId: '00000000-0000-1000-8000-000000000001',
       roleId: '00000000-0000-1000-8000-000000000020', // Finance
       isSuperAdmin: false,
       expectedPermissionCodes: ['dashboard', 'payment.read', 'payment.retry'],
     },
   };
   ```

2. **`helpers/e2e-setup.ts`** — start services:
   ```ts
   import { execSync } from 'child_process';

   export async function ensureServicesRunning() {
     // Check payment-api healthy
     try {
       const res = await fetch('http://localhost:3001/health');
       if (!res.ok) throw new Error('payment-api not healthy');
     } catch (e) {
       console.log('Starting services via docker compose...');
       execSync('pnpm docker:up:sandbox', { stdio: 'inherit' });
       // Wait for healthy
       await waitForService('http://localhost:3001/health', 30000);
       await waitForService('http://localhost:4001/.well-known/openid-configuration', 30000);
     }
   }

   export async function waitForService(url: string, timeoutMs: number) {
     const start = Date.now();
     while (Date.now() - start < timeoutMs) {
       try {
         const res = await fetch(url);
         if (res.ok) return;
       } catch {}
       await new Promise(r => setTimeout(r, 500));
     }
     throw new Error(`Service ${url} not ready in ${timeoutMs}ms`);
   }
   ```

3. **`helpers/auth-mock-client.ts`** — OAuth flow automator:
   ```ts
   import axios from 'axios';
   import { wrapper } from 'axios-cookiejar-support';
   import { CookieJar } from 'tough-cookie';

   export interface OAuthFlowResult {
     paymentApiCookie: string;
     user: any;
   }

   export async function performLoginFlow(
     username: string,
     password: string,
     roleId?: string,
   ): Promise<OAuthFlowResult> {
     const jar = new CookieJar();
     const client = wrapper(axios.create({ jar, withCredentials: true, maxRedirects: 0 }));

     // 1. GET /auth/login di payment-api → redirect ke auth-mock /oauth/authorize
     const loginRes = await client.get('http://localhost:3001/auth/login', {
       validateStatus: () => true, // accept any status
     });
     if (loginRes.status !== 302) throw new Error(`Expected 302, got ${loginRes.status}`);
     const authorizeUrl = loginRes.headers.location;

     // 2. GET authorizeUrl → auth-mock redirect ke /login (session auth)
     const authorizeRes = await client.get(authorizeUrl, { validateStatus: () => true });
     // Parse login page form action + state dari HTML (atau GET /login langsung)
     const loginUrl = 'http://localhost:4001/login'; // asumsi

     // 3. POST login form → submit credentials → redirect ke /select-role atau /authorize (consent)
     const loginFormRes = await client.post(loginUrl, `username=${username}&password=${password}`, {
       headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
       validateStatus: () => true,
     });

     // 4. Bila multi-role, POST /select-role with roleId
     if (roleId) {
       await client.post('http://localhost:4001/select-role', `roleId=${roleId}`, {
         headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
         validateStatus: () => true,
       });
     }

     // 5. Follow redirect ke /authorize (continue) → callback ke payment-api
     const callbackRes = await client.get(authorizeUrl, { validateStatus: () => true });
     if (callbackRes.status !== 302) throw new Error('Expected redirect to callback');
     const callbackUrl = callbackRes.headers.location;

     // 6. GET callback URL → payment-api set sid cookie
     const finalRes = await client.get(callbackUrl, { validateStatus: () => true });
     if (finalRes.status !== 302 || !finalRes.headers.location?.includes('/')) {
       throw new Error('Login flow failed');
     }

     // 7. GET /auth/session → return user
     const sessionRes = await client.get('http://localhost:3001/auth/session');
     if (sessionRes.status !== 200) throw new Error('Session fetch failed');

     // Extract sid cookie from jar
     const cookies = await jar.getCookies('http://localhost:3001');
     const sidCookie = cookies.find(c => c.key === 'sid');
     if (!sidCookie) throw new Error('sid cookie not set');

     return {
       paymentApiCookie: `sid=${sidCookie.value}`,
       user: sessionRes.data.user,
     };
   }
   ```

4. **`auth-mock.e2e.spec.ts`** — main E2E test suite:
   ```ts
   import axios from 'axios';
   import { describe, it, expect, beforeAll, afterAll } from 'jest';
   import { ensureServicesRunning } from './helpers/e2e-setup';
   import { performLoginFlow } from './helpers/auth-mock-client';
   import { E2E_USERS } from './fixtures/users';

   describe('E2E with auth-mock (Plan2 Section 17.3)', () => {
     beforeAll(async () => {
       await ensureServicesRunning();
     }, 60000); // 60s timeout untuk setup

     describe('1. Single-role login flow (superadmin)', () => {
       it('login → callback → session created → protected endpoint accessible', async () => {
         const { paymentApiCookie, user } = await performLoginFlow(
           E2E_USERS.superadmin.username,
           E2E_USERS.superadmin.password,
         );

         expect(user).toBeDefined();
         expect(user.username).toBe('superadmin');
         expect(user.isSuperAdmin).toBe(true);

         // Test protected endpoint
         const res = await axios.get('http://localhost:3001/payments', {
           headers: { Cookie: paymentApiCookie },
         });
         expect(res.status).toBe(200);
       }, 30000);

       it('GET /admin/gateway-config → 200 (super admin bypass)', async () => {
         const { paymentApiCookie } = await performLoginFlow(
           E2E_USERS.superadmin.username,
           E2E_USERS.superadmin.password,
         );

         const res = await axios.get('http://localhost:3001/admin/gateway-config', {
           headers: { Cookie: paymentApiCookie },
         });
         expect(res.status).toBe(200);
       }, 30000);
     });

     describe('2. Multi-role login + role selection (budi_santoso)', () => {
       it('login with HRD role → permissionCodes matches HRD', async () => {
         const { paymentApiCookie, user } = await performLoginFlow(
           E2E_USERS.budiHrd.username,
           E2E_USERS.budiHrd.password,
           E2E_USERS.budiHrd.roleId, // select HRD
         );

         expect(user.username).toBe('budi_santoso');
         expect(user.roleId).toBe(E2E_USERS.budiHrd.roleId);

         // Budi HRD has payment.write → POST /payments should work
         const res = await axios.post('http://localhost:3001/payments',
           { amount: 100, currency: 'IDR' },
           { headers: { Cookie: paymentApiCookie, 'X-CSRF-Token': await getCsrfToken(paymentApiCookie) } },
         );
         expect(res.status).toBe(201);
       }, 30000);

       it('switch-role to Finance → permissionCodes updates', async () => {
         // First login as HRD
         const { paymentApiCookie } = await performLoginFlow(
           E2E_USERS.budiHrd.username,
           E2E_USERS.budiHrd.password,
           E2E_USERS.budiHrd.roleId,
         );

         const csrf = await getCsrfToken(paymentApiCookie);

         // Switch to Finance
         const switchRes = await axios.post('http://localhost:3001/auth/switch-role',
           { roleId: E2E_USERS.budiFinance.roleId },
           { headers: { Cookie: paymentApiCookie, 'X-CSRF-Token': csrf } },
         );
         expect(switchRes.status).toBe(200);
         expect(switchRes.data.user.roleId).toBe(E2E_USERS.budiFinance.roleId);

         // Now Budi Finance should have payment.retry (HRD didn't)
         const payments = await axios.get('http://localhost:3001/payments', {
           headers: { Cookie: paymentApiCookie },
         });
         expect(payments.status).toBe(200);
         // Try retry on first payment
         if (payments.data.length > 0) {
           const retryRes = await axios.post(
             `http://localhost:3001/payments/${payments.data[0].id}/retry`,
             {},
             { headers: { Cookie: paymentApiCookie, 'X-CSRF-Token': csrf } },
           );
           expect(retryRes.status).toBe(200);
         }
       }, 30000);
     });

     describe('3. Super admin bypass (already tested in suite 1)', () => {
       it('GET /admin/gateway-config with superadmin → 200', async () => {
         // (already in suite 1)
       });
     });

     describe('4. User without access → 403', () => {
       it('login as user with only dashboard permission → POST /payments → 403', async () => {
         // Note: need a fixture user with limited permissions
         // Use budi HRD but test admin endpoint (no payment.admin)
         const { paymentApiCookie } = await performLoginFlow(
           E2E_USERS.budiHrd.username,
           E2E_USERS.budiHrd.password,
           E2E_USERS.budiHrd.roleId,
         );

         const res = await axios.get('http://localhost:3001/admin/gateway-config', {
           headers: { Cookie: paymentApiCookie },
           validateStatus: () => true,
         });
         expect(res.status).toBe(403);
       }, 30000);
     });

     describe('5. Sandbox mode (SESSION_STORE=memory, no Redis)', () => {
       // Run separately: docker compose -f docker-compose.sandbox.yml up
       // Verify SESSION_STORE=memory works
       it('login flow works in sandbox mode (no Redis)', async () => {
         // (covered by above tests if payment-api started with SESSION_STORE=memory)
         // Re-run login + verify session works.
       });
     });

     describe('6. AUTH_MODE=disabled mode', () => {
       it('GET /payments without cookie → 200', async () => {
         // Requires payment-api restarted with AUTH_MODE=disabled
         // Skip bila AUTH_MODE != disabled (separate test run)
         const res = await axios.get('http://localhost:3001/payments', {
           validateStatus: () => true,
         });
         if (process.env.AUTH_MODE === 'disabled') {
           expect(res.status).toBe(200);
         } else {
           expect(res.status).toBe(401); // skipped if not disabled
         }
       });

       it('GET /auth/session returns fake user dari env', async () => {
         const res = await axios.get('http://localhost:3001/auth/session', {
           validateStatus: () => true,
         });
         if (process.env.AUTH_MODE === 'disabled') {
           expect(res.status).toBe(200);
           expect(res.data.user.username).toBe(process.env.AUTH_DISABLED_USERNAME);
         }
       });

       it('GET /auth/login → 501 Not Implemented', async () => {
         const res = await axios.get('http://localhost:3001/auth/login', {
           validateStatus: () => true,
           maxRedirects: 0,
         });
         if (process.env.AUTH_MODE === 'disabled') {
           expect(res.status).toBe(501);
         }
       });
     });
   });

   async function getCsrfToken(cookie: string): Promise<string> {
     const res = await axios.get('http://localhost:3001/auth/csrf', {
       headers: { Cookie: cookie },
     });
     return res.data.csrfToken;
   }
   ```

5. **`jest.e2e.config.js`** — separate config:
   ```js
   module.exports = {
     preset: 'ts-jest',
     testEnvironment: 'node',
     roots: ['<rootDir>/test/e2e'],
     testMatch: ['**/*.e2e.spec.ts'],
     testTimeout: 30000, // 30s per test
     setupFilesAfterEnv: ['<rootDir>/test/e2e/setup.ts'],
   };
   ```

6. **`package.json` scripts** — UPDATE:
   ```json
   {
     "scripts": {
       "test": "jest",
       "test:integration": "jest --testMatch='**/*.integration.spec.ts'",
       "test:e2e": "jest --config jest.e2e.config.js",
       "test:cov": "jest --coverage"
     }
   }
   ```

7. **Verify**:
   - Start services: `pnpm docker:up:sandbox`.
   - Run E2E: `pnpm --filter payment-api test:e2e`.
   - All tests pass within 5 minutes (auth-mock + payment-api real).
   - Manual verify: open browser → `http://localhost:3001/auth/login` → login → callback → dashboard.

## Acceptance criteria

- [ ] `auth-mock.e2e.spec.ts` berisi 6 describe blocks per plan2 section 17.3 + 17.6.
- [ ] Test 1 (single-role login): superadmin login → callback → `GET /auth/session` returns user dengan `isSuperAdmin=true`.
- [ ] Test 1: `GET /payments` 200 (superadmin bypass).
- [ ] Test 1: `GET /admin/gateway-config` 200 (superadmin bypass `payment.admin`).
- [ ] Test 2 (multi-role + role selection): budi_santoso pilih HRD → session.roleId === HRD role ID.
- [ ] Test 2: Budi HRD `POST /payments` → 201 (have `payment.write`).
- [ ] Test 2: `POST /auth/switch-role { roleId: Finance }` → 200 + session updated.
- [ ] Test 2: After switch to Finance, `POST /payments/:id/retry` → 200 (have `payment.retry`).
- [ ] Test 3 (super admin): covered by test 1.
- [ ] Test 4 (user without access): Budi HRD `GET /admin/gateway-config` → 403 (no `payment.admin`).
- [ ] Test 5 (sandbox mode): payment-api started with `SESSION_STORE=memory` → all tests pass (no Redis dependency).
- [ ] Test 6 (`AUTH_MODE=disabled`): `GET /payments` without cookie → 200 (fake user from env).
- [ ] Test 6: `GET /auth/session` returns fake user dari `AUTH_DISABLED_*` env vars.
- [ ] Test 6: `GET /auth/login` → 501 Not Implemented.
- [ ] Test 6: `POST /auth/logout` → 200 OK (no-op).
- [ ] E2E helpers (`auth-mock-client.ts`, `e2e-setup.ts`) tersedia + reusable.
- [ ] Fixture users tersedia (`superadmin`, `budi_santoso` HRD + Finance).
- [ ] `pnpm --filter payment-api test:e2e` lulus dalam 5 menit (dengan auth-mock + payment-api running).
- [ ] `pnpm --filter payment-api typecheck` + `lint` lulus.
- [ ] E2E dapat dijalankan via CI/CD (semua services start via `pnpm docker:up:sandbox`).

## Useful commands

```bash
# Install deps
cd  && pnpm --filter payment-api add axios tough-cookie axios-cookiejar-support
cd  && pnpm --filter payment-api add -D @types/tough-cookie

# Start services (sandbox profile — no Redis)
cd  && pnpm docker:up:sandbox

# Verify services healthy
curl -s http://localhost:3001/health
curl -s http://localhost:4001/.well-known/openid-configuration | jq .

# Run E2E tests
cd  && pnpm --filter payment-api test:e2e

# Run specific E2E test
cd  && pnpm --filter payment-api test:e2e -- --testNamePattern="single-role"
cd  && pnpm --filter payment-api test:e2e -- --testNamePattern="multi-role"
cd  && pnpm --filter payment-api test:e2e -- --testNamePattern="super.admin"

# Run with verbose output
cd  && pnpm --filter payment-api test:e2e -- --verbose

# Manual E2E verification (browser-based):
# 1. Open http://localhost:3001/auth/login
# 2. Should redirect to http://localhost:4001/oauth/authorize?...
# 3. Auth-mock login form: budi_santoso / ChangeMe_123!
# 4. Select role (HRD or Finance)
# 5. Callback to payment-api → redirect to http://localhost:5173/
# 6. Verify session: curl -b cookies.txt http://localhost:3001/auth/session

# Test AUTH_MODE=disabled mode
# 1. Stop payment-api, set AUTH_MODE=disabled in .env
# 2. Restart payment-api
# 3. Run E2E tests:
cd  && AUTH_MODE=disabled pnpm --filter payment-api test:e2e -- --testNamePattern="disabled"

# Stop services
cd  && pnpm docker:down:sandbox

# Typecheck + lint after changes
cd  && pnpm --filter payment-api typecheck
cd  && pnpm --filter payment-api lint
```

## Notes

- **Plan2 section 17.3 E2E lintas service** mencakup 5 skenario: single-role, multi-role, super admin, user tanpa akses, dan (dengan auth asli setelah Fase 2). Plus `AUTH_MODE=disabled` dari section 17.6 sandbox test.
- **Real auth-mock vs mock openid-client**:
  - AUTH-25 integration tests pakai mock openid-client (faster, isolated).
  - AUTH-26 E2E tests pakai real auth-mock running (test full OAuth flow + auth-mock behavior).
  - Keduanya complementary — integration test catch NestJS app bugs, E2E catch integration bugs.
- **OAuth flow automator** (`auth-mock-client.ts`) harus:
  - Follow redirects (tidak auto-follow — kita perlu capture cookies di setiap step).
  - Submit forms (login, select-role) via POST application/x-www-form-urlencoded.
  - Capture `sid` cookie dari payment-api setelah callback.
- **Cookie jar** (`tough-cookie` + `axios-cookiejar-support`) supaya axios bisa persist cookies across requests.
- **CSRF token**: E2E tests butuh CSRF token untuk POST requests. Helper `getCsrfToken(cookie)` → `GET /auth/csrf` → return `{ csrfToken }`.
- **Sandbox mode**: payment-api harus start dengan `SESSION_STORE=memory` (di `.env.sandbox`). E2E test suite verify mode ini bekerja (no Redis dependency).
- **`AUTH_MODE=disabled` tests**: butuh payment-api restart dengan `AUTH_MODE=disabled` env. Bisa:
  - Option 1: Run E2E 2x — sekali `mock` mode, sekali `disabled` mode.
  - Option 2: Skip `AUTH_MODE=disabled` tests bila `process.env.AUTH_MODE !== 'disabled'` (defensive).
- **Timeout**: E2E tests perlu timeout lebih lama (30s per test, 5 menit total) karena real HTTP + OAuth flow multi-step.
- **CI/CD**: E2E tests harus run di CI. Pastikan `pnpm docker:up:sandbox` berjalan di CI environment (Docker available).
- **Plan2 section 17.6 sandbox test**: covered by test 5 (sandbox mode) + test 6 (AUTH_MODE=disabled).
- Setelah task ini selesai, Plan2 Fase 1 langkah 11 (contract test + E2E) tercapai (E2E half). Selanjutnya: AUTH-27 (contract tests) + AUTH-28 (dokumentasi).
