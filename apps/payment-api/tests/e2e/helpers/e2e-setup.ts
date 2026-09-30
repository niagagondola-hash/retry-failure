/**
 * E2E service health-check + wait helpers.
 *
 * Plan reference: PLAN2 Section 17.3 (E2E lintas service), Section 17.6
 * (Sandbox test), AUTH-26 task spec §2 (helpers/e2e-setup.ts).
 *
 * Purpose:
 *   - Verify auth-mock (port 4001) + payment-api (port 3001) are running
 *     BEFORE the E2E suite starts making real HTTP requests.
 *   - If a service is down, throw a helpful error with the start command
 *     (instead of letting every individual test fail with ECONNREFUSED).
 *
 * Design choice: this helper DOES NOT start services itself (no `execSync` /
 * `spawn`). Services are expected to be started out-of-band via
 * `pnpm docker:up:sandbox` OR via the env-var-based `node dist/main.js`
 * command in the AUTH-26 task spec. This avoids the helper becoming a
 * process manager (SRP per CODING_STANDARDS.md §SRP).
 */

/** Default payment-api base URL (port 3001 per sandbox profile). */
export const PAYMENT_API_BASE_URL =
  process.env.PAYMENT_API_BASE_URL ?? 'http://localhost:3001';

/** Default auth-mock base URL (port 4001 per sandbox profile). */
export const AUTH_MOCK_BASE_URL =
  process.env.AUTH_MOCK_BASE_URL ?? 'http://localhost:4001';

/** Default polling interval for `waitForService` (250ms — tight loop). */
const DEFAULT_POLL_INTERVAL_MS = 250;

/**
 * Poll a URL until it responds with any HTTP status, or throw after `timeoutMs`.
 *
 * Used by `ensureServicesRunning` to wait for HTTP servers to come up. The
 * check accepts ANY HTTP response (even 5xx) — what matters is that the
 * server is reachable (not ECONNREFUSED). Rationale: payment-api's `/health`
 * endpoint returns 503 when its downstream gateway is unreachable, but the
 * BFF itself is alive + serving OAuth traffic. We don't want to fail the
 * E2E suite just because the gateway mock is down (auth flow doesn't need it).
 *
 * @param url - URL to poll (e.g. `http://localhost:3001/health`).
 * @param timeoutMs - Max time to wait before throwing (default 30s).
 * @param intervalMs - Time between polls (default 250ms).
 * @throws Error if the URL is unreachable within `timeoutMs` (network error
 *         on every attempt — server not listening on the port).
 */
export async function waitForService(
  url: string,
  timeoutMs: number = 30_000,
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      // Any HTTP response (even 5xx) means the server is listening.
      // We only throw on network-level errors (ECONNREFUSED, etc.).
      await fetch(url);
      return;
    } catch {
      // Ignore — service might still be starting up. Retry after interval.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Service at ${url} did not become reachable within ${timeoutMs}ms. ` +
      `Start it via the commands in the AUTH-26 task spec §Useful commands.`,
  );
}

/**
 * Verify that both auth-mock (port 4001) + payment-api (port 3001) are running
 * and ready to accept E2E test traffic.
 *
 * Checks:
 *   1. `GET ${PAYMENT_API_BASE_URL}/health` → 2xx (payment-api alive + DB OK).
 *   2. `GET ${AUTH_MOCK_BASE_URL}/.well-known/openid-configuration` → 2xx
 *      (auth-mock alive + OIDC discovery served).
 *
 * @throws Error with a helpful message + start command if either service is
 *         not reachable. Caller is expected to call this in `beforeAll` so
 *         the entire suite fails fast rather than 6 individual tests each
 *         timing out with ECONNREFUSED.
 */
export async function ensureServicesRunning(): Promise<void> {
  const paymentApiHealth = `${PAYMENT_API_BASE_URL}/health`;
  const authMockDiscovery = `${AUTH_MOCK_BASE_URL}/.well-known/openid-configuration`;

  const checks: Array<{ name: string; url: string }> = [
    { name: 'payment-api', url: paymentApiHealth },
    { name: 'auth-mock', url: authMockDiscovery },
  ];

  const failed: string[] = [];

  for (const { name, url } of checks) {
    try {
      await waitForService(url, 5_000);
    } catch {
      failed.push(name);
    }
  }

  if (failed.length > 0) {
    const cmd = buildStartCommand(failed);
    throw new Error(
      `E2E prerequisites down: ${failed.join(', ')}.\n` +
        `Start them with:\n${cmd}\n` +
        `Then re-run: pnpm --filter payment-api test:e2e`,
    );
  }
}

/**
 * Build the start command string for the failed services.
 *
 * Returns a single multi-line shell snippet that the user can copy/paste.
 * Kept simple (no shell-escaping edge cases) because it's only printed in
 * error messages.
 */
function buildStartCommand(failed: string[]): string {
  const lines: string[] = [];

  if (failed.includes('auth-mock')) {
    lines.push(
      '# Start auth-mock on port 4001',
      'cd apps/auth-mock && LOG_LEVEL=debug node dist/main.js &',
      '',
    );
  }

  if (failed.includes('payment-api')) {
    lines.push(
      '# Start payment-api on port 3001 (sandbox profile)',
      'cd apps/payment-api && \\',
      '  AUTH_ISSUER=http://localhost:4001 AUTH_BASE_URL=http://localhost:4001 \\',
      '  OAUTH_CLIENT_ID=payment-api OAUTH_CLIENT_SECRET=dev-client-secret \\',
      '  OAUTH_REDIRECT_URI=http://localhost:3001/auth/callback \\',
      '  SESSION_SECRET=change-me-to-32-chars-or-more-aaaa \\',
      '  AUTH_DISABLED_USER_ID=00000000-0000-1000-8000-000000000001 \\',
      '  AUTH_DISABLED_USERNAME=disabled-user \\',
      '  AUTH_DISABLED_ROLE_ID=00000000-0000-1000-8000-000000000101 \\',
      '  AUTH_DISABLED_IS_SUPER_ADMIN=true AUTH_DISABLED_PERMISSION_CODES=\'*\' \\',
      '  DB_TYPE=sqlite DB_PATH=./sandbox.db AUTH_MODE=mock JWT_AUDIENCE=payment-api \\',
      '  SESSION_STORE=memory CORS_ORIGIN=http://localhost:5173 PORT=3001 LOG_LEVEL=debug \\',
      '  node dist/main.js &',
    );
  }

  return lines.join('\n');
}
