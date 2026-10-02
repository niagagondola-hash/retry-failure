/**
 * OAuth client types — option shape, token set, typed errors.
 *
 * Plan reference: PLAN2 Section 9 (oauth-client.service.ts),
 * Section 5.3 (Token Strategy — Access 15m / Refresh 8h).
 */

/** Optional shape for constructing an OAuth client (subset of SecurityOptions). */
export interface OAuthClientOptions {
  /** Auth issuer base URL, e.g. `http://localhost:4001`. openid-client will append `/.well-known/openid-configuration`. */
  authIssuer: string;
  /** OAuth2 `client_id`. */
  clientId: string;
  /** OAuth2 `client_secret` (confidential client). */
  clientSecret: string;
  /** Redirect URI registered at auth (e.g. `http://localhost:3001/auth/callback`). */
  redirectUri: string;
  /** OAuth scopes to request (e.g. `['openid', 'profile']`). */
  scopes: string[];
  /** Auth base URL for direct API calls (fetchPermissions / switchRole), e.g. `http://localhost:4001`. */
  authBaseUrl: string;
  /** HTTP timeout for axios calls to auth API (default: 5000ms). */
  httpTimeoutMs?: number;
  /** Custom User-Agent header (default: `payment-api/0.1`). */
  userAgent?: string;
}

/** Normalized token set returned by openid-client after exchange / refresh / switchRole. */
export interface TokenSet {
  /** OAuth2 access token (JWT, RS256 per plan2 §5.1). */
  accessToken: string;
  /** OAuth2 refresh token (rotated on each refresh per plan2 §5.4). */
  refreshToken?: string;
  /** OIDC id_token (JWT, RS256 per OIDC Core §2). Used for RP-initiated logout id_token_hint (AUTH-09a). */
  idToken?: string;
  /** Unix timestamp (seconds) when access token expires. */
  expiresAt: number;
  /** Token type — always `Bearer`. */
  tokenType: 'Bearer';
  /** Space-delimited scopes granted by auth (may differ from requested). */
  scope?: string;
}

/** Response shape for `GET /api/v1/me/permissions` per AUTH_CONTRACT.md. */
export interface PermissionsResponse {
  user: {
    id: string;
    username: string;
    email?: string;
    name: string;
    isSuperAdmin: boolean;
  };
  role: { id: string; name: string };
  permissionCodes: string[];
}

/** Response shape for `POST /api/v1/auth/switch-role` (auth issues new JWTs with new roleId). */
export interface SwitchRoleResponse extends TokenSet {
  role: { id: string; name: string };
}

/**
 * Typed OAuth client error. Wraps openid-client `OPError` (RFC 6749 §5.2
 * error response dari auth: `invalid_grant`, `invalid_client`, dll) dan
 * `RPError` (response parsing issue), so callers don't need to import
 * openid-client types.
 */
export class OAuthClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'OAuthClientError';
    // Restore prototype chain after Error extension (TS target ES2022 + es2022 Error cause support).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
