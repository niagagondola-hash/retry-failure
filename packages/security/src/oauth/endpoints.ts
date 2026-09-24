/**
 * OAuth2 endpoint path constants — fixed by RFC / contract, NOT configurable.
 *
 * Plan reference: PLAN2 Section 9.1 (endpoints.ts), Section 15 (Configuration Philosophy).
 *
 * Usage:
 *   const base = process.env.AUTH_BASE_URL;
 *   const tokenUrl = `${base}${OAUTH_PATHS.token}`;
 */
export const OAUTH_PATHS = {
  authorize:   '/oauth/authorize',
  token:       '/oauth/token',
  revoke:      '/oauth/revoke',
  jwks:        '/.well-known/jwks.json',
  discovery:   '/.well-known/openid-configuration',
  permissions: '/api/v1/me/permissions',
  switchRole:  '/api/v1/auth/switch-role',
} as const;

export type OAuthPath = keyof typeof OAUTH_PATHS;
