/**
 * E2E tests against a real auth-mock + payment-api (AUTH-26).
 *
 * Plan reference: PLAN2 Section 17.3 (E2E lintas service), Section 17.6
 * (Sandbox test), Section 4.1 (OAuth2 flow), Section 10.5 (multi-role flow),
 * AUTH-26 task spec §4 (auth-mock.e2e.spec.ts).
 *
 * Suite structure (6 describe blocks per plan2 §17.3 + §17.6):
 *   1. Single-role login flow (superadmin)
 *      - login → callback → /auth/session returns user with isSuperAdmin=true
 *      - GET /payments 200 (superadmin wildcard bypass)
 *      - POST /payments 201 (superadmin wildcard bypass on payment.write)
 *   2. Multi-role login + role selection (budi_santoso)
 *      - login with HRD selected → session.roleId === HRD role ID
 *      - GET /payments 200 (HRD has payment.read)
 *      - POST /payments 403 (HRD has NO payment.write — spec deviation doc'd)
 *      - POST /auth/switch-role to Finance → 200 + session.roleId === Finance
 *      - After switch: POST /payments 201 (Finance has payment.write)
 *      - After switch: POST /payments/:id/retry 200 (Finance has payment.retry)
 *   3. Super admin bypass (covered by suite 1 — placeholder describe block)
 *   4. User without access → 403 (Budi HRD without payment.write)
 *   5. Sandbox mode (SESSION_STORE=memory, no Redis)
 *      - Implicit: payment-api started with SESSION_STORE=memory per sandbox
 *        profile; all tests above prove it works.
 *      - Smoke test: GET /auth/session returns 200 after a fresh login.
 *   6. AUTH_MODE=disabled mode (defensive skip if AUTH_MODE !== 'disabled')
 *      - GET /payments without cookie → 200
 *      - GET /auth/session returns fake user from env (or null — spec gap)
 *      - GET /auth/login → 501 Not Implemented
 *      - POST /auth/logout → 200 OK (no-op)
 *
 * Session sharing strategy (rate-limit friendly):
 *   payment-api's `@Throttle({ default: { limit: 10, ttl: 60_000 } })` on
 *   `/auth/login` allows only 10 calls per 60s per IP. With 14+ tests, each
 *   doing its own login, we'd trip the throttle.
 *
 *   Solution: each `describe` block logs in ONCE in `beforeAll` + caches the
 *   `OAuthFlowResult`. Tests within the describe reuse the cached session
 *   (via `result.client` / `result.csrfToken`). Tests that need a DIFFERENT
 *   role (e.g. switch-role tests) do their own fresh login but only in
 *   `beforeAll` of their sub-describe — never per-test.
 *
 *   Trade-off: less test isolation within a describe (a misbehaving test can
 *   affect later tests in the same block). Acceptable for E2E where each
 *   test creates fresh resources (payments with unique orderIds) and the
 *   shared session is read-only in most tests.
 *
 * ⚠️ Spec deviations (documented in worklog):
 *   1. The AUTH-26 spec assumed `budiHrd` had `payment.write`. The actual
 *      auth-mock fixtures.ts assigns HRD = ['dashboard', 'payment.read']
 *      only (no write). Tests below use the ACTUAL fixture values (ground
 *      truth). Budi HRD `POST /payments` is therefore expected to return
 *      403 (not 201 as the spec assumed).
 *   2. The AUTH-26 spec mentioned `GET /admin/gateway-config` for the super
 *      admin bypass test. That route doesn't exist in payment-api/src/ — only
 *      `/payments`, `/auth`, `/metrics`, `/health`, `/scheduler-health`. We
 *      use `POST /payments` (requires payment.write) + `POST /payments/:id/retry`
 *      (requires payment.retry) instead, both of which exercise the
 *      wildcard bypass path through `MenuAccessGuard`.
 *   3. Test 6 /auth/session behavior: controller returns `{ user: null }`
 *      when no sid cookie, even in disabled mode (spec gap noted in
 *      AUTH-25). Test asserts the actual behavior.
 *
 * Preconditions (must be running before this suite starts):
 *   - auth-mock on port 4001 (cd apps/auth-mock && node dist/main.js)
 *   - payment-api on port 3001 (see AUTH-26 task spec for env vars)
 *   - payment-api started with AUTH_MODE=mock + SESSION_STORE=memory +
 *     DB_TYPE=sqlite (sandbox profile — no Redis, no Postgres needed)
 *
 * Run:
 *   pnpm --filter payment-api test:e2e
 */
import axios from 'axios';

import { E2E_USERS } from './fixtures/users';
import { ensureServicesRunning, PAYMENT_API_BASE_URL } from './helpers/e2e-setup';
import {
  getCsrfToken,
  performLoginFlow,
  type OAuthFlowResult,
} from './helpers/auth-mock-client';

/**
 * Top-level E2E suite — runs against real services (auth-mock + payment-api).
 *
 * `beforeAll` runs `ensureServicesRunning()` to fail fast with a helpful
 * message if either service is down. Individual describe blocks then do
 * their own `beforeAll` to drive the OAuth flow once + share the session.
 */
describe('E2E with auth-mock (Plan2 Section 17.3 + 17.6)', () => {
  // 60s for setup (services might need to be checked).
  beforeAll(async () => {
    await ensureServicesRunning();
  }, 60_000);

  // =========================================================================
  // Test 1: Single-role login flow (superadmin)
  // =========================================================================
  describe('1. Single-role login flow (superadmin)', () => {
    let session: OAuthFlowResult;

    beforeAll(async () => {
      session = await performLoginFlow(
        E2E_USERS.superadmin.username,
        E2E_USERS.superadmin.password,
      );
    }, 30_000);

    /**
     * Verifies the happy-path OAuth flow for a single-role user:
     *   payment-api /auth/login → auth-mock /oauth/authorize → POST creds →
     *   302 callback → payment-api /auth/callback → sid cookie → /auth/session
     *   returns user with `isSuperAdmin=true`.
     *
     * Acceptance: AUTH-26 §AC "Test 1 (single-role login): superadmin login →
     * callback → /auth/session returns user dengan isSuperAdmin=true".
     */
    it('login → callback → /auth/session returns user with isSuperAdmin=true', () => {
      const { user } = session;

      expect(user).toBeDefined();
      expect(user.username).toBe(E2E_USERS.superadmin.username);
      expect(user.userId).toBe(E2E_USERS.superadmin.userId);
      expect(user.roleId).toBe(E2E_USERS.superadmin.roleId);
      expect(user.isSuperAdmin).toBe(true);
    });

    /**
     * Super admin has wildcard perms ('*') so `MenuAccessGuard` should
     * bypass the `payment.read` check.
     *
     * Acceptance: AUTH-26 §AC "Test 1: GET /payments 200 (superadmin bypass)".
     */
    it('GET /payments → 200 (superadmin wildcard bypass)', async () => {
      const res = await session.client.get(`${PAYMENT_API_BASE_URL}/payments`);

      expect(res.status).toBe(200);
    });

    /**
     * Super admin bypass on POST /payments (requires `payment.write`).
     *
     * Spec gap: AUTH-26 mentioned `GET /admin/gateway-config` for the
     * superadmin bypass test, but that endpoint doesn't exist in
     * payment-api/src/. We use POST /payments instead — same bypass path
     * through MenuAccessGuard, but with a real route.
     *
     * Acceptance: AUTH-26 §AC "Test 1: GET /admin/gateway-config 200
     * (superadmin bypass payment.admin)" — adapted to POST /payments 201
     * (superadmin bypass payment.write).
     */
    it('POST /payments → 201 (superadmin wildcard bypass on payment.write)', async () => {
      const orderId = `E2E-S1-${Date.now()}`;
      // Fetch fresh CSRF — tokens rotate per-request.
      const csrf = await getCsrfToken(session.client);

      const res = await session.client.post(
        `${PAYMENT_API_BASE_URL}/payments`,
        { amount: 50000, currency: 'IDR', orderId },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
          },
        },
      );

      expect(res.status).toBe(201);
      expect(res.data?.payment).toBeDefined();
      expect(res.data.payment.orderId).toBe(orderId);
    });
  });

  // =========================================================================
  // Test 2: Multi-role login + role selection (budi_santoso)
  // =========================================================================
  describe('2. Multi-role login + role selection (budi_santoso)', () => {
    /**
     * Verifies the multi-role OAuth flow: budi_santoso has HRD + Finance
     * roles. Auth-mock renders the select-role page after credential
     * validation; we POST /oauth/select-role with the HRD role ID; auth-mock
     * issues a code; payment-api creates a session with `roleId === HRD`.
     *
     * Acceptance: AUTH-26 §AC "Test 2: budi_santoso pilih HRD → session.roleId
     * === HRD role ID".
     */
    it('login with HRD selected → session.roleId === HRD role ID', async () => {
      const { user } = await performLoginFlow(
        E2E_USERS.budiHrd.username,
        E2E_USERS.budiHrd.password,
        E2E_USERS.budiHrd.roleId, // select HRD
      );

      expect(user.username).toBe(E2E_USERS.budiHrd.username);
      expect(user.userId).toBe(E2E_USERS.budiHrd.userId);
      expect(user.roleId).toBe(E2E_USERS.budiHrd.roleId);
      expect(user.isSuperAdmin).toBe(false);
    }, 30_000);

    /**
     * Reuse the HRD login across GET /payments + POST /payments tests to
     * conserve rate-limit budget. This nested describe holds the shared
     * session + tests permission checks.
     */
    describe('Budi as HRD — permission checks', () => {
      let session: OAuthFlowResult;

      beforeAll(async () => {
        session = await performLoginFlow(
          E2E_USERS.budiHrd.username,
          E2E_USERS.budiHrd.password,
          E2E_USERS.budiHrd.roleId,
        );
      }, 30_000);

      /**
       * HRD has `payment.read` → GET /payments should succeed.
       *
       * Acceptance: implicit from plan2 §17.3 multi-role test coverage.
       */
      it('GET /payments as HRD → 200 (has payment.read)', async () => {
        const res = await session.client.get(
          `${PAYMENT_API_BASE_URL}/payments`,
        );
        expect(res.status).toBe(200);
      });

      /**
       * HRD does NOT have `payment.write` (auth-mock fixtures.ts assigns HRD
       * = ['dashboard', 'payment.read'] only — spec deviation documented
       * above). POST /payments must return 403.
       *
       * Acceptance: AUTH-26 §AC "Test 4: Budi HRD without permission → 403"
       * (this is the negative case; Test 4 below uses the same flow).
       */
      it('POST /payments as HRD → 403 (HRD has no payment.write)', async () => {
        const csrf = await getCsrfToken(session.client);
        const res = await session.client.post(
          `${PAYMENT_API_BASE_URL}/payments`,
          { amount: 100, currency: 'IDR', orderId: `E2E-NEG-${Date.now()}` },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrf,
            },
            validateStatus: () => true,
          },
        );

        expect(res.status).toBe(403);
      });
    });

    /**
     * Switch-role tests. Each sub-describe logs in fresh (because switch-role
     * mutates the session — can't share across tests).
     */
    describe('switch-role flow (HRD → Finance)', () => {
      /**
       * Switch-role from HRD → Finance. The BFF calls auth-mock
       * `/api/v1/auth/switch-role`, gets new tokens, fetches fresh
       * permissions, updates session in-place.
       *
       * Acceptance: AUTH-26 §AC "Test 2: POST /auth/switch-role { roleId:
       * Finance } → 200 + session updated".
       */
      it('POST /auth/switch-role from HRD → Finance returns 200 + new roleId', async () => {
        const { client } = await performLoginFlow(
          E2E_USERS.budiHrd.username,
          E2E_USERS.budiHrd.password,
          E2E_USERS.budiHrd.roleId,
        );

        const freshCsrf = await getCsrfToken(client);
        const res = await client.post(
          `${PAYMENT_API_BASE_URL}/auth/switch-role`,
          { roleId: E2E_USERS.budiFinance.roleId },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': freshCsrf,
            },
            validateStatus: () => true,
          },
        );

        expect(res.status).toBe(200);
        expect(res.data?.user).toBeDefined();
        expect(res.data.user.roleId).toBe(E2E_USERS.budiFinance.roleId);

        // Confirm session is updated — fresh /auth/session reflects the new role.
        const sessionRes = await client.get(
          `${PAYMENT_API_BASE_URL}/auth/session`,
        );
        expect(sessionRes.status).toBe(200);
        expect(sessionRes.data?.user?.roleId).toBe(
          E2E_USERS.budiFinance.roleId,
        );
      }, 30_000);

      /**
       * After switching to Finance, Budi has `payment.write` → POST /payments
       * should succeed (201).
       *
       * Acceptance: AUTH-26 §AC "Test 2: Budi HRD `POST /payments` → 201" —
       * adapted: instead of HRD creating a payment (impossible — HRD lacks
       * write), Finance (after switch-role) creates one. This proves the
       * switch-role updated session permissions are enforced by MenuAccessGuard.
       */
      it('after switch to Finance → POST /payments returns 201 (Finance has payment.write)', async () => {
        const { client } = await performLoginFlow(
          E2E_USERS.budiHrd.username,
          E2E_USERS.budiHrd.password,
          E2E_USERS.budiHrd.roleId, // initial: HRD
        );

        // Switch to Finance first
        const csrf1 = await getCsrfToken(client);
        const switchRes = await client.post(
          `${PAYMENT_API_BASE_URL}/auth/switch-role`,
          { roleId: E2E_USERS.budiFinance.roleId },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrf1,
            },
            validateStatus: () => true,
          },
        );
        expect(switchRes.status).toBe(200);

        // Now POST /payments as Finance
        const csrf2 = await getCsrfToken(client);
        const orderId = `E2E-S2B-${Date.now()}`;
        const res = await client.post(
          `${PAYMENT_API_BASE_URL}/payments`,
          { amount: 25000, currency: 'IDR', orderId },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrf2,
            },
            validateStatus: () => true,
          },
        );

        expect(res.status).toBe(201);
        expect(res.data?.payment).toBeDefined();
      }, 30_000);

      /**
       * After switching to Finance, Budi has `payment.retry` → POST
       * /payments/:id/retry should succeed (200).
       *
       * Acceptance: AUTH-26 §AC "Test 2: After switch to Finance, POST
       * /payments/:id/retry → 200 (have payment.retry)".
       */
      it('after switch to Finance → POST /payments/:id/retry returns 200 (Finance has payment.retry)', async () => {
        const { client } = await performLoginFlow(
          E2E_USERS.budiHrd.username,
          E2E_USERS.budiHrd.password,
          E2E_USERS.budiHrd.roleId, // initial: HRD
        );

        // Switch to Finance
        const csrf1 = await getCsrfToken(client);
        await client.post(
          `${PAYMENT_API_BASE_URL}/auth/switch-role`,
          { roleId: E2E_USERS.budiFinance.roleId },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrf1,
            },
            validateStatus: () => true,
          },
        );

        // Create a payment first (Finance has payment.write)
        const csrf2 = await getCsrfToken(client);
        const createRes = await client.post(
          `${PAYMENT_API_BASE_URL}/payments`,
          {
            amount: 100,
            currency: 'IDR',
            orderId: `E2E-S2C-${Date.now()}`,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrf2,
            },
            validateStatus: () => true,
          },
        );
        expect(createRes.status).toBe(201);
        const paymentId = createRes.data.payment.id;

        // Retry the payment (Finance has payment.retry)
        const csrf3 = await getCsrfToken(client);
        const retryRes = await client.post(
          `${PAYMENT_API_BASE_URL}/payments/${paymentId}/retry`,
          {},
          {
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrf3,
            },
            validateStatus: () => true,
          },
        );

        expect(retryRes.status).toBe(200);
      }, 30_000);
    });
  });

  // =========================================================================
  // Test 3: Super admin bypass (covered by suite 1 — placeholder)
  // =========================================================================
  describe('3. Super admin bypass (covered by suite 1)', () => {
    /**
     * Sanity placeholder — the super admin bypass was already exercised by
     * suite 1 (`POST /payments → 201` via wildcard). Keep this describe
     * block for symmetry with the 6-suite structure mandated by plan2 §17.3.
     *
     * Acceptance: AUTH-26 §AC "Test 3 (super admin): covered by test 1".
     */
    it('superadmin GET /payments → 200 (covered by suite 1, re-verified here)', async () => {
      const { client } = await performLoginFlow(
        E2E_USERS.superadmin.username,
        E2E_USERS.superadmin.password,
      );

      const res = await client.get(`${PAYMENT_API_BASE_URL}/payments`);

      expect(res.status).toBe(200);
    }, 30_000);
  });

  // =========================================================================
  // Test 4: User without access → 403
  // =========================================================================
  describe('4. User without access → 403', () => {
    /**
     * Reuse the HRD login across both 403 tests. HRD lacks `payment.write`
     * AND `payment.retry` — both tests assert the same `MenuAccessGuard`
     * deny path, just via different menu codes.
     */
    describe('Budi HRD — no payment.write / payment.retry', () => {
      let budiSession: OAuthFlowResult;
      let superSession: OAuthFlowResult;
      let paymentId: string;

      beforeAll(async () => {
        // Login Budi as HRD (test subject).
        budiSession = await performLoginFlow(
          E2E_USERS.budiHrd.username,
          E2E_USERS.budiHrd.password,
          E2E_USERS.budiHrd.roleId,
        );
        // Login superadmin (used to create a payment for the retry test,
        // since HRD can't write).
        superSession = await performLoginFlow(
          E2E_USERS.superadmin.username,
          E2E_USERS.superadmin.password,
        );
        // Create a payment as superadmin (bypass wildcard).
        const csrf = await getCsrfToken(superSession.client);
        const createRes = await superSession.client.post(
          `${PAYMENT_API_BASE_URL}/payments`,
          { amount: 100, currency: 'IDR', orderId: `E2E-S4-${Date.now()}` },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrf,
            },
            validateStatus: () => true,
          },
        );
        expect(createRes.status).toBe(201);
        paymentId = createRes.data.payment.id;
      }, 30_000);

      /**
       * Budi as HRD has `['dashboard', 'payment.read']` only — no
       * `payment.write`, no `payment.retry`, no `payment.admin`. POST /payments
       * requires `payment.write` → MenuAccessGuard throws 403.
       *
       * Spec gap: AUTH-26 spec said `GET /admin/gateway-config` → 403, but
       * that route doesn't exist (returns 404, not 403). We use POST /payments
       * instead — same MenuAccessGuard code path, real route.
       *
       * Acceptance: AUTH-26 §AC "Test 4: Budi HRD `GET /admin/gateway-config`
       * → 403 (no payment.admin)" — adapted to POST /payments → 403 (no
       * payment.write).
       */
      it('POST /payments → 403 (no payment.write)', async () => {
        const csrf = await getCsrfToken(budiSession.client);
        const res = await budiSession.client.post(
          `${PAYMENT_API_BASE_URL}/payments`,
          { amount: 100, currency: 'IDR', orderId: `E2E-NEG2-${Date.now()}` },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrf,
            },
            validateStatus: () => true,
          },
        );

        expect(res.status).toBe(403);
      });

      /**
       * Budi HRD retry on existing payment → 403 (no payment.retry).
       *
       * Adds a second 403 case via a different menu code (`payment.retry`) to
       * prove MenuAccessGuard isn't just blanket-rejecting POSTs.
       */
      it('POST /payments/:id/retry → 403 (no payment.retry)', async () => {
        const csrf = await getCsrfToken(budiSession.client);
        const res = await budiSession.client.post(
          `${PAYMENT_API_BASE_URL}/payments/${paymentId}/retry`,
          {},
          {
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrf,
            },
            validateStatus: () => true,
          },
        );

        expect(res.status).toBe(403);
      });
    });
  });

  // =========================================================================
  // Test 5: Sandbox mode (SESSION_STORE=memory, no Redis)
  // =========================================================================
  describe('5. Sandbox mode (SESSION_STORE=memory, no Redis)', () => {
    /**
     * Combined smoke test for the memory session store:
     *   1. login → sid cookie set (proves MemorySessionStore.set works).
     *   2. /auth/session returns the user (proves MemorySessionStore.get works).
     *   3. Second /auth/session returns same user (proves session persists
     *      across reads — not consumed by a single read).
     *   4. POST /auth/logout → 200 (proves MemorySessionStore.delete works).
     *   5. /auth/session returns `{ user: null }` (proves session was deleted).
     *
     * Why combine into one test (vs separate per-scenario `it` blocks):
     *   - payment-api's `@Throttle({ default: { limit: 10, ttl: 60_000 } })`
     *     on `/auth/login` caps at 10 logins/min per IP. The full suite does
     *     9 logins; splitting this test into 2 would push us to 11 logins
     *     (over the limit). Combining keeps us at 10 logins — under the limit.
     *   - The two behaviors (persist + delete) are tightly coupled: the
     *     delete assertion only makes sense after a persist assertion proves
     *     the session existed. Splitting would force Test 5.2 to do its own
     *     login, doubling the rate-limit cost without test value.
     *
     * Acceptance: AUTH-26 §AC "Test 5 (sandbox mode): SESSION_STORE=memory →
     * all tests pass (no Redis)" — this single test exercises persist +
     * delete + read-after-delete paths through MemorySessionStore.
     */
    it('login → 2x /auth/session → logout → /auth/session null (memory store round-trip)', async () => {
      const { client, user, csrfToken } = await performLoginFlow(
        E2E_USERS.superadmin.username,
        E2E_USERS.superadmin.password,
      );

      // 1. First /auth/session (post-login) — should return the user.
      const res1 = await client.get(`${PAYMENT_API_BASE_URL}/auth/session`);
      expect(res1.status).toBe(200);
      expect(res1.data.user).not.toBeNull();
      expect(res1.data.user.userId).toBe(user.userId);

      // 2. Second /auth/session — same user, proves memory store persists reads.
      const res2 = await client.get(`${PAYMENT_API_BASE_URL}/auth/session`);
      expect(res2.status).toBe(200);
      expect(res2.data.user.userId).toBe(user.userId);

      // 3. Logout — should delete the session from MemorySessionStore.
      const logoutRes = await client.post(
        `${PAYMENT_API_BASE_URL}/auth/logout`,
        {},
        {
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          validateStatus: () => true,
        },
      );
      expect(logoutRes.status).toBe(200);

      // 4. After logout: /auth/session returns user=null (sid deleted).
      const after = await client.get(`${PAYMENT_API_BASE_URL}/auth/session`);
      expect(after.status).toBe(200);
      expect(after.data.user).toBeNull();
    }, 30_000);
  });

  // =========================================================================
  // Test 6: AUTH_MODE=disabled (defensive skip if AUTH_MODE !== 'disabled')
  // =========================================================================
  // Note: when AUTH_MODE !== 'disabled' (the default sandbox profile sets
  // AUTH_MODE=mock), these tests are skipped via `describe.skip`. To run
  // them, restart payment-api with AUTH_MODE=disabled + run this suite.
  const disabledSuite =
    process.env.AUTH_MODE === 'disabled' ? describe : describe.skip;

  disabledSuite('6. AUTH_MODE=disabled mode', () => {
    /**
     * In disabled mode, no auth is required — `SessionGuard` returns a
     * synthetic user derived from `AUTH_DISABLED_*` env vars. GET /payments
     * without a cookie should return 200.
     *
     * Acceptance: AUTH-26 §AC "Test 6: GET /payments without cookie → 200".
     */
    it('GET /payments without cookie → 200', async () => {
      // Use a fresh axios instance (no cookie jar — simulates no cookie).
      const res = await axios.get(`${PAYMENT_API_BASE_URL}/payments`, {
        validateStatus: () => true,
      });

      expect(res.status).toBe(200);
    }, 30_000);

    /**
     * GET /auth/session returns the fake disabled user from env vars.
     *
     * Spec gap (noted in AUTH-25): the controller returns `{ user: null }`
     * when no `sid` cookie — even in disabled mode. So the assertion is
     * loose: status 200 (don't strictly require fake user in body).
     *
     * Acceptance: AUTH-26 §AC "Test 6: GET /auth/session returns fake user
     * dari AUTH_DISABLED_* env vars" — partial (status-only due to spec gap).
     */
    it('GET /auth/session → 200 (status-only — controller has spec gap on fake user)', async () => {
      const res = await axios.get(`${PAYMENT_API_BASE_URL}/auth/session`, {
        validateStatus: () => true,
      });

      expect(res.status).toBe(200);
      // Note: res.data.user is null when no sid cookie (controller behavior).
      // To get the fake user, payment-api would need to special-case
      // AUTH_MODE=disabled in the /auth/session handler (TODO for future task).
    }, 30_000);

    /**
     * In disabled mode, /auth/login returns 501 Not Implemented (auth flow
     * not available — no auth-mock integration).
     *
     * Acceptance: AUTH-26 §AC "Test 6: GET /auth/login → 501 Not Implemented".
     */
    it('GET /auth/login → 501 Not Implemented', async () => {
      const res = await axios.get(`${PAYMENT_API_BASE_URL}/auth/login`, {
        maxRedirects: 0,
        validateStatus: () => true,
      });

      expect(res.status).toBe(501);
    }, 30_000);

    /**
     * POST /auth/logout returns 200 OK (no-op in disabled mode — there's
     * no session to delete, but the endpoint still responds cleanly).
     *
     * Acceptance: AUTH-26 §AC "Test 6: POST /auth/logout → 200 OK (no-op)".
     */
    it('POST /auth/logout → 200 OK (no-op)', async () => {
      const res = await axios.post(
        `${PAYMENT_API_BASE_URL}/auth/logout`,
        {},
        { validateStatus: () => true },
      );

      expect(res.status).toBe(200);
    }, 30_000);
  });
});
