/**
 * TokenFactory — centralized JWT token signing (DRY refactor, CODING_STANDARDS.md compliance).
 *
 * Plan reference: CODING_STANDARDS.md §DRY, PLAN2 §5.1 (signing), §5.2 (JWT claims),
 * OIDC Core 1.0 §2 (id_token), §3.1.3.3 (token response).
 *
 * Token TTL constants:
 *   - Access token: 15 menit (900 detik) per plan2 §5.2
 *   - Refresh token: 8 jam per plan2 §5.4
 *   - ID token: 15 menit (same as access token) per OIDC Core §2
 *   - Issuer: AUTH_ISSUER env (default http://localhost:4001)
 *   - Audience: JWT_AUDIENCE env (default payment-api)
 *
 * Token types:
 *   - access_token: API access (RFC 6749 §1.4) — claims: sub, username, roleId, type, jti, scope
 *   - id_token: User identity for client (OIDC Core §2) — claims: sub, preferred_username, name, email, auth_time, roleId
 *   - refresh_token: Token refresh (plan2 §5.4) — claims: sub, username, roleId, type, client_id, jti
 */
import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { MockUser } from '../user/user.service';

import { JwtSignerService } from './jwt-signer.service';

/** Default issuer when AUTH_ISSUER env is not set (dev/sandbox). */
const DEFAULT_ISSUER = 'http://localhost:4001';

/** Default audience when JWT_AUDIENCE env is not set. */
const DEFAULT_AUDIENCE = 'payment-api';

/** Access token TTL — 15 minutes per plan2 §5.2. */
const ACCESS_TOKEN_TTL = '15m';

/** Refresh token TTL — 8 hours per plan2 §5.4. */
const REFRESH_TOKEN_TTL = '8h';

/** ID token TTL — same as access token (15 minutes) per OIDC Core §2. */
const ID_TOKEN_TTL = '15m';

/**
 * Token pair returned by issuePair(). Contains access + refresh + id tokens
 * + their jti (JWT ID) claims so callers can persist them in TokenStore for
 * rotation / reuse detection / revoke.
 *
 * id_token does NOT have a jti — it's not persisted or revoked (OIDC Core §2).
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** OIDC id_token — user identity for client (OIDC Core §2). */
  idToken: string;
  /** JWT ID of the access token — used for revoke + reuse detection. */
  accessJti: string;
  /** JWT ID of the refresh token — used for revoke + reuse detection. */
  refreshJti: string;
}

@Injectable()
export class TokenFactory {
  constructor(private readonly jwtSigner: JwtSignerService) {}

  /**
   * Issue an access token (15m TTL) per plan2 §5.2.
   *
   * Claims: { sub, username, roleId, type: 'access' }
   * + standard JWT claims: iss, aud, exp, iat, jti (auto-generated).
   *
   * @param user - User to issue token for
   * @param roleId - Active role ID
   * @param options - Optional overrides (jti, issuer, audience, expiresIn)
   * @returns Object with token string + jti
   */
  async issueAccessToken(
    user: MockUser,
    roleId: string,
    options?: {
      jti?: string;
      issuer?: string;
      audience?: string;
      expiresIn?: string;
    },
  ): Promise<{ token: string; jti: string }> {
    const issuer = options?.issuer ?? process.env.AUTH_ISSUER ?? DEFAULT_ISSUER;
    const audience =
      options?.audience ?? process.env.JWT_AUDIENCE ?? DEFAULT_AUDIENCE;
    const expiresIn = options?.expiresIn ?? ACCESS_TOKEN_TTL;
    const jti = options?.jti ?? randomUUID();

    const token = await this.jwtSigner.sign(
      {
        sub: user.id,
        username: user.username,
        roleId,
        type: 'access',
      },
      { issuer, audience, expiresIn, jti },
    );
    return { token, jti };
  }

  /**
   * Issue a refresh token (8h TTL) per plan2 §5.4.
   *
   * Claims: { sub, username, roleId, type: 'refresh', client_id }
   * + standard JWT claims: iss, aud, exp, iat, jti (auto-generated).
   *
   * @param user - User to issue token for
   * @param roleId - Active role ID
   * @param clientId - OAuth client ID (for client binding)
   * @param options - Optional overrides (jti, issuer, audience, expiresIn)
   * @returns Object with token string + jti
   */
  async issueRefreshToken(
    user: MockUser,
    roleId: string,
    clientId: string,
    options?: {
      jti?: string;
      issuer?: string;
      audience?: string;
      expiresIn?: string;
    },
  ): Promise<{ token: string; jti: string }> {
    const issuer = options?.issuer ?? process.env.AUTH_ISSUER ?? DEFAULT_ISSUER;
    const audience =
      options?.audience ?? process.env.JWT_AUDIENCE ?? DEFAULT_AUDIENCE;
    const expiresIn = options?.expiresIn ?? REFRESH_TOKEN_TTL;
    const jti = options?.jti ?? randomUUID();

    const token = await this.jwtSigner.sign(
      {
        sub: user.id,
        username: user.username,
        roleId,
        type: 'refresh',
        client_id: clientId,
      },
      { issuer, audience, expiresIn, jti },
    );
    return { token, jti };
  }

  /**
   * Issue an ID token (15m TTL) per OIDC Core 1.0 §2.
   *
   * ID token is the user identity token for the client (BFF).
   * It is NOT an API access token — should not be sent as Bearer to APIs.
   * After client verifies + extracts claims, id_token is not stored or reused.
   *
   * Claims (OIDC Core §2 + §5.1):
   *   - iss: issuer (auth-mock URL)
   *   - sub: user ID
   *   - aud: client_id (who requested the token — BFF)
   *   - exp: expiration (15 min)
   *   - iat: issued at
   *   - auth_time: when user authenticated (Unix seconds)
   *   - preferred_username: user.username (OIDC §5.1 standard claim)
   *   - name: user.name (OIDC §5.1 standard claim)
   *   - email: user.email (OIDC §5.1 standard claim, if present)
   *   - roleId: active role ID (plan2 §5.2 custom claim)
   *
   * Difference from access_token:
   *   - No `jti` (id_token not revoked/tracked)
   *   - No `scope` claim
   *   - No `type` marker
   *   - Uses `preferred_username` instead of `username` (OIDC standard)
   *   - Has `auth_time` (OIDC §2 required)
   *   - Has `name` + `email` (OIDC §5.1 standard claims)
   *
   * @param user - User to issue token for
   * @param roleId - Active role ID
   * @param clientId - OAuth client_id (audience for id_token — who requested)
   * @param authTime - Unix seconds when user authenticated (default: now)
   * @returns id_token string
   */
  async issueIdToken(
    user: MockUser,
    roleId: string,
    clientId: string,
    authTime?: number,
  ): Promise<string> {
    const issuer = process.env.AUTH_ISSUER ?? DEFAULT_ISSUER;
    const audience = clientId; // id_token aud = client_id (OIDC §2)
    const expiresIn = ID_TOKEN_TTL;
    const now = Math.floor(Date.now() / 1000);

    const claims: Record<string, unknown> = {
      sub: user.id,
      // OIDC §5.1 standard claims
      preferred_username: user.username,
      name: user.name,
      auth_time: authTime ?? now,
      // plan2 §5.2 custom claim
      roleId,
    };

    // email is optional in MockUser
    if (user.email) {
      claims.email = user.email;
    }

    const token = await this.jwtSigner.sign(claims, {
      issuer,
      audience,
      expiresIn,
      // No jti — id_token is not revoked/tracked (OIDC §2)
    });
    return token;
  }

  /**
   * Issue all 3 tokens: access + refresh + id (convenience method).
   *
   * Callers that need to persist tokens (oauth.service for rotation/reuse
   * detection) should use this + persist access + refresh jtis to TokenStore.
   * id_token is NOT persisted (OIDC Core §2 — not revoked).
   *
   * @param user - User to issue tokens for
   * @param roleId - Active role ID
   * @param clientId - OAuth client ID (for refresh + id token audience)
   * @returns TokenPair with all 3 tokens + their jtis
   */
  async issuePair(
    user: MockUser,
    roleId: string,
    clientId: string,
  ): Promise<TokenPair> {
    const access = await this.issueAccessToken(user, roleId);
    const refresh = await this.issueRefreshToken(user, roleId, clientId);
    const idToken = await this.issueIdToken(user, roleId, clientId);
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      idToken,
      accessJti: access.jti,
      refreshJti: refresh.jti,
    };
  }
}
