/**
 * TokenFactory — centralized JWT token signing (DRY refactor, CODING_STANDARDS.md compliance).
 *
 * Plan reference: CODING_STANDARDS.md §DRY, PLAN2 §5.1 (signing), §5.2 (JWT claims).
 *
 * Sebelum refactor: JWT signing logic duplikat di 3 tempat:
 *   - oauth.service.ts issueTokenPair() — sign + persist ke TokenStore
 *   - internal.service.ts switchRole() — sign tanpa persist
 *   - dev.controller.ts devToken() — sign tanpa persist
 *
 * Setelah refactor: TokenFactory handle sign logic, caller handle persist
 * (atau tidak) sesuai kebutuhan.
 *
 * Token TTL constants:
 *   - Access token: 15 menit (900 detik) per plan2 §5.2
 *   - Refresh token: 8 jam per plan2 §5.4
 *   - Issuer: AUTH_ISSUER env (default http://localhost:4001)
 *   - Audience: JWT_AUDIENCE env (default payment-api)
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

/**
 * Token pair returned by issuePair(). Contains both tokens + their jti
 * (JWT ID) claims so callers can persist them in TokenStore for
 * rotation / reuse detection / revoke.
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
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
   * Issue both access + refresh tokens (convenience method).
   *
   * Callers that need to persist tokens (oauth.service for rotation/reuse
   * detection) should use this + persist the returned jtis to TokenStore.
   *
   * Callers that don't need persistence (dev.controller /dev/token,
   * internal.service switch-role) can use the returned tokens directly.
   *
   * @param user - User to issue tokens for
   * @param roleId - Active role ID
   * @param clientId - OAuth client ID (for refresh token binding)
   * @returns TokenPair with both tokens + their jtis
   */
  async issuePair(
    user: MockUser,
    roleId: string,
    clientId: string,
  ): Promise<TokenPair> {
    const access = await this.issueAccessToken(user, roleId);
    const refresh = await this.issueRefreshToken(user, roleId, clientId);
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      accessJti: access.jti,
      refreshJti: refresh.jti,
    };
  }
}
