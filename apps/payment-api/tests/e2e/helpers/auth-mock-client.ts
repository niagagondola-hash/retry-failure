/**
 * OAuth flow automator — drives the full PKCE authorization-code flow against
 * a real auth-mock + payment-api BFF.
 *
 * Plan reference: PLAN2 Section 4.1 (OAuth2 flow), Section 17.3 (E2E lintas
 * service), AUTH-26 task spec §3 (helpers/auth-mock-client.ts).
 *
 * Why this helper exists (DRY):
 *   The OAuth2 web flow spans 5+ HTTP round-trips across 2 services:
 *     1. GET payment-api /auth/login → 302 to auth-mock /oauth/authorize
 *     2. GET auth-mock /oauth/authorize → 200 HTML login form (parse hidden fields)
 *     3. POST auth-mock /oauth/authorize with credentials → 302 (single-role)
 *        OR 200 HTML select-role page (multi-role — needs step 3b)
 *     3b. POST auth-mock /oauth/select-role with chosen role → 302
 *     4. GET payment-api /auth/callback?code=...&state=... → 302 (sets sid cookie)
 *     5. GET payment-api /auth/session → 200 { user: { ... } }
 *
 *   Without this helper, each E2E test would duplicate ~40 lines of HTTP
 *   orchestration. Per CODING_STANDARDS.md §DRY, >10 lines duplicated in 2+
 *   places must be extracted.
 *
 * Cookie strategy:
 *   Uses `axios-cookiejar-support` + `tough-cookie` `CookieJar` to persist
 *   cookies across redirects. Critical because:
 *     - payment-api sets `oauth_state` + `oauth_verifier` in step 1, reads
 *       them in step 4 (state must match for CSRF protection).
 *     - auth-mock sets `auth_sid` in step 3, reads it in step 3b (or in
 *       subsequent /oauth/authorize GETs — short-circuits login form).
 *     - payment-api sets `sid` in step 4 (the BFF session cookie — the goal
 *       of the entire flow).
 *
 * Test isolation:
 *   Each call to `performLoginFlow` creates a FRESH `CookieJar` so tests
 *   don't share session state. Tests that need to keep the session across
 *   multiple requests use the returned `client` (a pre-configured axios
 *   instance with the same jar).
 */

import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';

import { AUTH_MOCK_BASE_URL, PAYMENT_API_BASE_URL } from './e2e-setup';

/**
 * Shape of the user object returned by `GET /auth/session` on success.
 * Matches the controller's response in `auth.controller.ts` (CallbackResult).
 */
export interface SessionUser {
  userId: string;
  username: string;
  roleId: string;
  isSuperAdmin: boolean;
}

/**
 * Result of a successful login flow — everything a test needs to make
 * authenticated requests against payment-api.
 */
export interface OAuthFlowResult {
  /**
   * Pre-configured axios instance (cookie jar attached). Use this for any
   * follow-up requests that need to reuse the session (e.g. switch-role).
   */
  client: AxiosInstance;
  /** The `sid` cookie value (BFF session ID) — useful for raw `Cookie:` header. */
  sid: string;
  /** Cookie header string ready to attach to axios requests. */
  paymentApiCookie: string;
  /** CSRF token fetched post-login — send as `X-CSRF-Token` header on POSTs. */
  csrfToken: string;
  /** User object from `/auth/session` (userId, username, roleId, isSuperAdmin). */
  user: SessionUser;
}

/**
 * Build a fresh axios instance with a fresh CookieJar — no shared state
 * across tests. The instance is configured to NOT auto-follow redirects
 * (`maxRedirects: 0`) so we can inspect 302 + Location at each step.
 *
 * @returns `{ client, jar }` — `client` is the axios instance, `jar` is the
 *          cookie jar (useful for `jar.getCookies()` assertions in tests).
 */
export function createAuthClient(): { client: AxiosInstance; jar: CookieJar } {
  const jar = new CookieJar();
  const client = wrapper(
    axios.create({
      jar,
      withCredentials: true,
      maxRedirects: 0,
      // Accept any status code so we can inspect 3xx + 4xx + 5xx uniformly.
      validateStatus: () => true,
    }),
  );
  return { client, jar };
}

/**
 * Extract a hidden form field value from an HTML response body.
 *
 * Used to parse the 6 hidden OAuth fields (`client_id`, `redirect_uri`,
 * `state`, `code_challenge`, `code_challenge_method`, `scope`) from the
 * auth-mock login page HTML. The auth-mock renders them as
 * `<input type="hidden" name="X" value="Y">`.
 *
 * @param html - HTML response body from `/oauth/authorize` GET.
 * @param name - Form field name to extract (e.g. `'client_id'`).
 * @returns The field value, or null if not found.
 */
function extractHiddenField(html: string, name: string): string | null {
  const pattern = new RegExp(`name="${name}"\\s+value="([^"]+)"`);
  const match = html.match(pattern);
  return match ? match[1] : null;
}

/**
 * Build the OAuth authorize form payload from the auth-mock login page HTML.
 *
 * Extracts all 6 hidden fields + adds username/password. Used as the body
 * of `POST /oauth/authorize` (the login submit step).
 *
 * @param html - HTML response body from `GET /oauth/authorize`.
 * @param username - Fixture username.
 * @param password - Fixture password.
 * @returns Form payload (string-string map) — caller serializes via
 *          `new URLSearchParams(payload).toString()`.
 */
function buildAuthorizeForm(
  html: string,
  username: string,
  password: string,
): Record<string, string> {
  return {
    response_type: 'code',
    client_id: extractHiddenField(html, 'client_id') ?? '',
    redirect_uri: extractHiddenField(html, 'redirect_uri') ?? '',
    state: extractHiddenField(html, 'state') ?? '',
    code_challenge: extractHiddenField(html, 'code_challenge') ?? '',
    code_challenge_method:
      extractHiddenField(html, 'code_challenge_method') ?? 'S256',
    scope: 'openid profile',
    username,
    password,
  };
}

/**
 * Build the select-role form payload from the select-role page HTML.
 *
 * Multi-role users see this page after submitting credentials — it lists
 * their roles as radio buttons + re-emits the 6 hidden OAuth fields.
 *
 * @param html - HTML response body from the multi-role select-role page.
 * @param roleId - The role UUID the user picked.
 */
function buildSelectRoleForm(
  html: string,
  roleId: string,
): Record<string, string> {
  return {
    response_type: 'code',
    client_id: extractHiddenField(html, 'client_id') ?? '',
    redirect_uri: extractHiddenField(html, 'redirect_uri') ?? '',
    state: extractHiddenField(html, 'state') ?? '',
    code_challenge: extractHiddenField(html, 'code_challenge') ?? '',
    code_challenge_method:
      extractHiddenField(html, 'code_challenge_method') ?? 'S256',
    scope: 'openid profile',
    user_id: extractHiddenField(html, 'user_id') ?? '',
    role_id: roleId,
  };
}

/** Serialize a form payload as `application/x-www-form-urlencoded` body. */
function encodeForm(form: Record<string, string>): string {
  return new URLSearchParams(form).toString();
}

/** Content-Type header for form-encoded POSTs (DRY — used by 2 submit calls). */
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

/**
 * Drive the full OAuth2 authorization-code flow end-to-end.
 *
 * Flow:
 *   1. `GET /auth/login` (payment-api) → 302 with Location to auth-mock
 *      `/oauth/authorize?...`. Captures `oauth_state` + `oauth_verifier`
 *      cookies (5min TTL, HttpOnly — needed by step 5 callback).
 *   2. `GET /oauth/authorize` (auth-mock) → 200 HTML login form. Parse the
 *      6 hidden OAuth fields for the next step.
 *   3. `POST /oauth/authorize` (auth-mock) with username+password + the
 *      hidden fields → either:
 *        - 302 (single-role user): code in Location, go to step 5.
 *        - 200 (multi-role user): render select-role page. Go to step 4.
 *        - 401 (invalid creds): re-render login with error. Throw.
 *   4. `POST /oauth/select-role` (auth-mock) with chosen roleId → 302 with
 *      code in Location.
 *   5. `GET /auth/callback?code=...&state=...` (payment-api) → 302 to FRONTEND_URL
 *      (default localhost:5173, atau env override) + `Set-Cookie: sid=...`.
 *      The `sid` cookie is the BFF session ID — the goal of the entire flow.
 *   6. `GET /auth/session` (payment-api) → 200 `{ user: { ... } }`. Confirms
 *      the session was created + user info is available.
 *   7. `GET /auth/csrf` (payment-api) → 200 `{ csrfToken: '...' }`. CSRF
 *      token for subsequent POST requests.
 *
 * @param username - Fixture username (e.g. 'superadmin', 'budi_santoso').
 * @param password - Fixture password (e.g. 'ChangeMe_123!').
 * @param roleId - Optional role UUID — required for multi-role users.
 *                 Single-role users omit this (auth-mock auto-issues code).
 * @returns `OAuthFlowResult` with `client`, `sid`, `paymentApiCookie`,
 *          `csrfToken`, and `user`. Use the `client` for follow-up
 *          authenticated requests (it has the cookie jar attached).
 * @throws Error if any step returns an unexpected status (with details
 *         about which step failed for debugging).
 */
export async function performLoginFlow(
  username: string,
  password: string,
  roleId?: string,
): Promise<OAuthFlowResult> {
  const { client, jar } = createAuthClient();

  // Step 1: GET /auth/login (payment-api) → 302 to auth-mock
  const loginRes = await client.get(`${PAYMENT_API_BASE_URL}/auth/login`);
  if (loginRes.status !== 302) {
    throw new Error(
      `Step 1 (GET /auth/login) failed: expected 302, got ${loginRes.status}` +
        ` — body: ${JSON.stringify(loginRes.data).substring(0, 200)}`,
    );
  }
  const authorizeUrl = loginRes.headers.location as string;

  // Step 2: GET /oauth/authorize (auth-mock) → 200 HTML login form
  const authorizeRes = await client.get(authorizeUrl);
  if (authorizeRes.status !== 200) {
    throw new Error(
      `Step 2 (GET /oauth/authorize) failed: expected 200, got ${authorizeRes.status}`,
    );
  }
  const authorizeHtml = String(authorizeRes.data);

  // Step 3: POST /oauth/authorize (auth-mock) with credentials
  const submitRes = await client.post(
    `${AUTH_MOCK_BASE_URL}/oauth/authorize`,
    encodeForm(buildAuthorizeForm(authorizeHtml, username, password)),
    { headers: { 'Content-Type': FORM_CONTENT_TYPE } },
  );

  let callbackUrl: string;

  if (submitRes.status === 302) {
    // Single-role: auth-mock issued code, redirect URL is in Location
    callbackUrl = submitRes.headers.location as string;
  } else if (submitRes.status === 200) {
    // Multi-role: render select-role page → must POST /oauth/select-role
    if (!roleId) {
      throw new Error(
        `Step 3 (POST /oauth/authorize): multi-role user requires 'roleId' ` +
          `parameter to select a role, but none was provided.`,
      );
    }
    const selectRoleHtml = String(submitRes.data);
    const selectRes = await client.post(
      `${AUTH_MOCK_BASE_URL}/oauth/select-role`,
      encodeForm(buildSelectRoleForm(selectRoleHtml, roleId)),
      { headers: { 'Content-Type': FORM_CONTENT_TYPE } },
    );
    if (selectRes.status !== 302) {
      throw new Error(
        `Step 4 (POST /oauth/select-role) failed: expected 302, got ${selectRes.status}` +
          ` — body: ${String(selectRes.data).substring(0, 200)}`,
      );
    }
    callbackUrl = selectRes.headers.location as string;
  } else if (submitRes.status === 401) {
    throw new Error(
      `Step 3 (POST /oauth/authorize): invalid credentials for username='${username}'`,
    );
  } else {
    throw new Error(
      `Step 3 (POST /oauth/authorize) failed: unexpected status ${submitRes.status}` +
        ` — body: ${String(submitRes.data).substring(0, 200)}`,
    );
  }

  // Step 5: GET /auth/callback (payment-api) → 302 to '/' + Set-Cookie sid
  const callbackRes: AxiosResponse = await client.get(callbackUrl);
  if (callbackRes.status !== 302) {
    throw new Error(
      `Step 5 (GET /auth/callback) failed: expected 302, got ${callbackRes.status}` +
        ` — body: ${JSON.stringify(callbackRes.data).substring(0, 200)}`,
    );
  }

  // Extract sid cookie from jar (the goal of the entire flow)
  const cookies = await jar.getCookies(PAYMENT_API_BASE_URL);
  const sidCookie = cookies.find((c) => c.key === 'sid');
  if (!sidCookie) {
    throw new Error(
      'Step 5: /auth/callback did not set the `sid` cookie — login flow incomplete',
    );
  }

  // Step 6: GET /auth/session → 200 { user: { ... } }
  const sessionRes = await client.get(`${PAYMENT_API_BASE_URL}/auth/session`);
  if (sessionRes.status !== 200) {
    throw new Error(
      `Step 6 (GET /auth/session) failed: expected 200, got ${sessionRes.status}`,
    );
  }
  const user = sessionRes.data?.user as SessionUser | null;
  if (!user) {
    throw new Error(
      `Step 6: /auth/session returned 200 but \`user\` is null/missing — ` +
        `session might not have been created. Body: ${JSON.stringify(sessionRes.data)}`,
    );
  }

  // Step 7: GET /auth/csrf → 200 { csrfToken }
  const csrfRes = await client.get(`${PAYMENT_API_BASE_URL}/auth/csrf`);
  if (csrfRes.status !== 200) {
    throw new Error(
      `Step 7 (GET /auth/csrf) failed: expected 200, got ${csrfRes.status}`,
    );
  }
  const csrfToken = csrfRes.data?.csrfToken as string;

  return {
    client,
    sid: sidCookie.value,
    paymentApiCookie: `sid=${sidCookie.value}`,
    csrfToken,
    user,
  };
}

/**
 * Fetch a fresh CSRF token for the given authenticated client.
 *
 * Useful when a test needs a CSRF token AFTER an initial flow (e.g. after
 * switch-role). The token rotates per-request (CsrfMiddleware), so a
 * stale token from `performLoginFlow`'s result may be rejected by POSTs.
 *
 * @param client - axios instance (with cookie jar containing `sid` + `XSRF-TOKEN`).
 * @returns The fresh CSRF token string.
 */
export async function getCsrfToken(client: AxiosInstance): Promise<string> {
  const res = await client.get(`${PAYMENT_API_BASE_URL}/auth/csrf`);
  if (res.status !== 200) {
    throw new Error(
      `getCsrfToken: GET /auth/csrf failed with status ${res.status}`,
    );
  }
  return res.data?.csrfToken as string;
}
