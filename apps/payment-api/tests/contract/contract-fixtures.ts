/**
 * Contract fixtures — expected values parsed from AUTH_CONTRACT.md v1.0.0.
 *
 * Plan reference: PLAN2 Section 17.5 (contract test), Section 25.7 (contract test),
 * Section 25.8 (auth-mock vs auth asli compatibility), AUTH-27 task spec §4.
 *
 * Source of truth: `docs/plan2-auth-integration/AUTH_CONTRACT.md`.
 * When the contract is updated:
 *   1. Bump `EXPECTED_CONTRACT_VERSION`.
 *   2. Update the relevant `EXPECTED_*` constant below.
 *   3. Re-run `pnpm test:contract` — failures flag contract drift.
 *
 * Coding standards: English comments, constants in UPPER_SNAKE_CASE per
 * CODING_STANDARDS.md §Naming.
 */

/** AUTH_CONTRACT.md SemVer version (header `> **Version**: X.Y.Z`). */
export const EXPECTED_CONTRACT_VERSION = '1.0.0';

/**
 * Required JWT claims per AUTH_CONTRACT.md §4.
 *
 * Field `format` is a hint for the test runner:
 *   - `uuid`  → match `/^[0-9a-f-]{36}$/i`
 *   - `url`   → must parse as URL
 *   - `string`/`number` → typeof check
 */
export interface ExpectedClaim {
  name: string;
  type: 'string' | 'number';
  format?: 'uuid' | 'url';
  required: true;
}

export const EXPECTED_JWT_CLAIMS: readonly ExpectedClaim[] = [
  { name: 'sub', type: 'string', format: 'uuid', required: true },
  { name: 'username', type: 'string', required: true },
  { name: 'roleId', type: 'string', format: 'uuid', required: true },
  { name: 'iss', type: 'string', format: 'url', required: true },
  { name: 'aud', type: 'string', required: true },
  { name: 'exp', type: 'number', required: true },
  { name: 'iat', type: 'number', required: true },
  { name: 'jti', type: 'string', required: true },
] as const;

/** Signing algorithm per AUTH_CONTRACT.md §5. */
export const EXPECTED_JWT_ALG = 'RS256' as const;

/** Access token TTL in seconds (15 minutes, plan2 §5.3). */
export const EXPECTED_ACCESS_TOKEN_LIFETIME_SEC = 900;

/** Refresh token TTL in seconds (8 hours, plan2 §5.4). */
export const EXPECTED_REFRESH_TOKEN_LIFETIME_SEC = 28800;

/**
 * OAuth2 endpoint paths per AUTH_CONTRACT.md §2.
 *
 * Used by endpoint-paths describe block to verify the routes exist.
 */
export const EXPECTED_OAUTH_ENDPOINTS = {
  authorize: '/oauth/authorize',
  token: '/oauth/token',
  revoke: '/oauth/revoke',
  jwks: '/.well-known/jwks.json',
  discovery: '/.well-known/openid-configuration',
} as const;

/** Internal endpoint paths per AUTH_CONTRACT.md §3. */
export const EXPECTED_INTERNAL_ENDPOINTS = {
  permissions: '/api/v1/me/permissions',
  switchRole: '/api/v1/auth/switch-role',
} as const;

/**
 * Required fields per error status code per AUTH_CONTRACT.md §7.
 *
 * The contract specifies `{statusCode, message}` for 400/401/403 and
 * `{statusCode, message, retryAfter}` for 429. Extra fields (e.g. NestJS
 * adds `error: "Bad Request"`) are allowed — contract tests only verify
 * required fields are present.
 */
export const EXPECTED_ERROR_FORMAT: Readonly<
  Record<number, readonly string[]>
> = {
  400: ['statusCode', 'message'],
  401: ['statusCode', 'message'],
  403: ['statusCode', 'message'],
  429: ['statusCode', 'message', 'retryAfter'],
} as const;

/**
 * Fixture test user for auth-mock (from AUTH-06 fixtures.ts).
 *
 * `budi_santoso` has multi-role (HRD + Finance) — exercises the more
 * complex code path. The expected role ID is HRD (first role) because
 * `/dev/token` picks the first role when `roleId` is omitted.
 *
 * For real auth (staging/production), override via env vars:
 *   - AUTH_TEST_USERNAME
 *   - AUTH_TEST_PASSWORD
 *   - AUTH_TEST_USER_ID    (optional — used only for assertion)
 *   - AUTH_TEST_ROLE_ID    (optional — used only for assertion)
 */
export const AUTH_MOCK_TEST_USER = {
  username: 'budi_santoso',
  password: 'ChangeMe_123!',
  expectedUserId: '00000000-0000-1000-8000-000000000002',
  expectedRoleId: '00000000-0000-1000-8000-000000000102', // HRD
} as const;

/** Default OAuth client config per AUTH_CONTRACT.md §10. */
export const DEFAULT_OAUTH_CLIENT = {
  clientId: 'payment-api',
  redirectUri: 'http://localhost:3000/auth/callback',
} as const;

/** UUID v4 regex (case-insensitive). */
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
