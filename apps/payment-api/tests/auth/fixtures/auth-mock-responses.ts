/**
 * Mock responses for OAuthClientService + JwksVerifier + permissions API.
 *
 * Plan reference: PLAN2 Section 17.2 (Integration tests), Section 4.2 (BFF
 * endpoints), Section 5.3 (token TTL), AUTH-25 task spec §2 (fixtures).
 *
 * Single source of truth for canned OAuth responses, JWT payloads, and
 * permission payloads used across the integration test suite. Keeping these
 * in one file avoids per-test mock drift (DRY per CODING_STANDARDS.md §DRY).
 *
 * Conventions:
 *   - UUIDs use the `00000000-0000-1000-8000-...` shape so they pass Joi
 *     `.uuid()` validation.
 *   - `expiresAt` is Unix SECONDS (matches `TokenSet` interface).
 *   - `accessExpiresAt` / `refreshExpiresAt` on Session are Unix MS.
 */
import type {
  PermissionsResponse,
  SwitchRoleResponse,
  TokenSet,
} from '@retry-failure/security';

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/** Budi Santoso (HRD) — typical end user with read + write permissions. */
export const MOCK_USER_BUDI = {
  id: '00000000-0000-1000-8000-000000000001',
  username: 'budi_santoso',
  email: 'budi@perusahaan.com',
  name: 'Budi Santoso',
  isSuperAdmin: false,
} as const;

/** Super Admin — wildcard permissions, bypasses MenuAccessGuard. */
export const MOCK_USER_SUPERADMIN = {
  id: '00000000-0000-1000-8000-000000000099',
  username: 'superadmin',
  email: 'admin@perusahaan.com',
  name: 'Super Admin',
  isSuperAdmin: true,
} as const;

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** HRD role — dashboard + payment.read + payment.write (no retry). */
export const MOCK_ROLE_HRD = {
  id: '00000000-0000-1000-8000-000000000010',
  name: 'HRD',
} as const;

/** Finance role — dashboard + payment.read + payment.retry (no write). */
export const MOCK_ROLE_FINANCE = {
  id: '00000000-0000-1000-8000-000000000020',
  name: 'Finance',
} as const;

/** SuperAdmin role — placeholder role (super admin bypass via cached_users). */
export const MOCK_ROLE_SUPERADMIN = {
  id: '00000000-0000-1000-8000-000000000090',
  name: 'SuperAdmin',
} as const;

// ---------------------------------------------------------------------------
// Permissions payloads (response shape of GET /api/v1/me/permissions)
// ---------------------------------------------------------------------------

/** Budi as HRD — has dashboard + payment.read + payment.write. */
export const MOCK_PERMISSIONS_BUDI_HRD: PermissionsResponse = {
  user: { ...MOCK_USER_BUDI },
  role: { ...MOCK_ROLE_HRD },
  permissionCodes: ['dashboard', 'payment.read', 'payment.write'],
};

/** Budi as Finance — has dashboard + payment.read + payment.retry (no write). */
export const MOCK_PERMISSIONS_BUDI_FINANCE: PermissionsResponse = {
  user: { ...MOCK_USER_BUDI },
  role: { ...MOCK_ROLE_FINANCE },
  permissionCodes: ['dashboard', 'payment.read', 'payment.retry'],
};

/** Super admin — wildcard permissions. */
export const MOCK_PERMISSIONS_SUPERADMIN: PermissionsResponse = {
  user: { ...MOCK_USER_SUPERADMIN },
  role: { ...MOCK_ROLE_SUPERADMIN },
  permissionCodes: ['*'],
};

// ---------------------------------------------------------------------------
// Token sets (response shape of OAuthClientService.exchangeCode / refresh)
// ---------------------------------------------------------------------------

/**
 * Build a TokenSet for the given user. `expiresAt` is set to now + 15min
 * (per plan2 §5.3 access token TTL) so the JWT verifier mock has a valid
 * future expiry to inspect.
 */
export function buildMockTokenSet(user: {
  id: string;
  username: string;
}): TokenSet {
  const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
  return {
    accessToken: `mock-access-${user.username}-${user.id.substring(0, 8)}`,
    refreshToken: `mock-refresh-${user.username}`,
    expiresAt,
    tokenType: 'Bearer',
    scope: 'openid profile',
  };
}

/** Convenience: Budi's token set. */
export const MOCK_TOKEN_SET_BUDI: TokenSet = buildMockTokenSet(MOCK_USER_BUDI);

/** Convenience: super admin's token set. */
export const MOCK_TOKEN_SET_SUPERADMIN: TokenSet =
  buildMockTokenSet(MOCK_USER_SUPERADMIN);

// ---------------------------------------------------------------------------
// JWT payloads (response shape of JwtVerifier.verify)
// ---------------------------------------------------------------------------

/**
 * Build a JWT payload that the JwksVerifier mock returns for `verify(token)`.
 * Matches the contract in `docs/plan2-auth-integration/AUTH_CONTRACT.md` §4
 * (8 required claims: sub, username, roleId, iss, aud, exp, iat, jti).
 */
export function buildMockJwtPayload(user: {
  id: string;
  username: string;
  roleId: string;
  iss?: string;
  aud?: string;
}): {
  sub: string;
  username: string;
  roleId: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  jti: string;
} {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: user.id,
    username: user.username,
    roleId: user.roleId,
    iss: user.iss ?? 'http://localhost:4001',
    aud: user.aud ?? 'payment-api',
    iat: now,
    exp: now + 15 * 60,
    jti: `jti-${user.id.substring(0, 8)}-${now}`,
  };
}

/** Budi logged in as HRD — JWT payload. */
export const MOCK_JWT_PAYLOAD_BUDI_HRD = buildMockJwtPayload({
  id: MOCK_USER_BUDI.id,
  username: MOCK_USER_BUDI.username,
  roleId: MOCK_ROLE_HRD.id,
});

/** Budi logged in as Finance — JWT payload (after switch-role). */
export const MOCK_JWT_PAYLOAD_BUDI_FINANCE = buildMockJwtPayload({
  id: MOCK_USER_BUDI.id,
  username: MOCK_USER_BUDI.username,
  roleId: MOCK_ROLE_FINANCE.id,
});

/** Super admin JWT payload. */
export const MOCK_JWT_PAYLOAD_SUPERADMIN = buildMockJwtPayload({
  id: MOCK_USER_SUPERADMIN.id,
  username: MOCK_USER_SUPERADMIN.username,
  roleId: MOCK_ROLE_SUPERADMIN.id,
});

// ---------------------------------------------------------------------------
// Switch-role responses
// ---------------------------------------------------------------------------

/**
 * Build a SwitchRoleResponse for the given target role + user.
 * The response includes new tokens (access + refresh) + the role object.
 */
export function buildMockSwitchRoleResponse(
  user: { id: string; username: string },
  role: { id: string; name: string },
): SwitchRoleResponse {
  const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
  return {
    accessToken: `mock-access-${user.username}-${role.name.toLowerCase()}`,
    refreshToken: `mock-refresh-${user.username}-${role.name.toLowerCase()}`,
    expiresAt,
    tokenType: 'Bearer',
    scope: 'openid profile',
    role,
  };
}

/** Budi switching to Finance — response. */
export const MOCK_SWITCH_ROLE_BUDI_FINANCE: SwitchRoleResponse =
  buildMockSwitchRoleResponse(MOCK_USER_BUDI, MOCK_ROLE_FINANCE);
