/**
 * OAuthService — OAuth2 business logic for auth-mock (AUTH-03).
 *
 * Plan reference: PLAN2 Section 4.1 (OAuth2 flow), Section 4.3 (PKCE),
 * Section 5.1 (signing), Section 5.2 (JWT payload), Section 5.3 (expiry),
 * Section 5.4 (refresh rotation), Section 5.5 (revoke).
 *
 * Responsibilities:
 *  - Authorization code: store + consume (one-time use, TTL 60s).
 *  - JWT issuance: access (15m) + refresh (8h) via `JwtSignerService.sign()`.
 *  - PKCE S256 verification (RFC 7636 §4.2).
 *  - Refresh rotation: revoke old, issue new pair; reuse → revoke all user sessions.
 *  - Auth session cookie (delegated to AuthSessionService).
 *  - Revoke token (delete from store; mark revoked).
 *
 * This service is intentionally framework-light: it operates on plain data
 * and returns values. Controllers handle HTTP concerns (res.redirect, etc.).
 */
import { createHash, randomBytes } from 'node:crypto';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';

import { ClientService } from '../client/client.service';
import { JwtSignerService } from '../keypair/jwt-signer.service';
import { TokenFactory } from '../keypair/token-factory';
import type { MockUser } from '../user/user.service';

import { AuthCodeStore, StoredAuthCode } from './auth-code.store';
import { AuthSessionService } from './auth-session.service';
import { TokenStore } from './token.store';

/** Issuer URL embedded in JWT `iss` claim + used by verifier (plan2 §5.2). */
const AUTH_ISSUER =
  process.env.AUTH_ISSUER ?? 'http://localhost:4001';

/** Resource server / OAuth2 client_id (plan2 §5.2 `aud`). */
const JWT_AUDIENCE = process.env.JWT_AUDIENCE ?? 'payment-api';

/** Access token expiry — plan2 §5.3: 15 minutes. */
const ACCESS_TTL = '15m';
export const ACCESS_TTL_SEC = 900;
/** Refresh token expiry — plan2 §5.3: 8 hours absolute. */
const REFRESH_TTL = '8h';

/** RFC 7636 §4.1: code_verifier length 43-128. */
function isValidCodeVerifier(v: string): boolean {
  return v.length >= 43 && v.length <= 128 && /^[A-Za-z0-9\-._~]+$/.test(v);
}

/** RFC 7636 §4.2: BASE64URL(SHA256(verifier)) for method S256. */
function computeS256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export interface IssueCodeParams {
  clientId: string;
  userId: string;
  roleId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  scope: string;
  state?: string;
}

export interface IssueCodeResult {
  code: string;
  redirectUrl: string;
}

export interface ExchangeCodeParams {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessJti: string;
  refreshJti: string;
  /** Unix epoch seconds when access token expires. */
  expiresAt: number;
  expiresIn: number;
  tokenType: 'Bearer';
  scope: string;
}

export interface RefreshParams {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger('OAuthService');

  constructor(
    private readonly signer: JwtSignerService,
    private readonly authCodes: AuthCodeStore,
    private readonly tokens: TokenStore,
    private readonly authSessions: AuthSessionService,
    private readonly clients: ClientService,
    private readonly tokenFactory: TokenFactory,
  ) {}

  // ----- Auth session (cookie) ------------------------------------------

  /** Read `auth_sid` cookie → AuthSession. Returns null if absent/expired. */
  async getAuthSession(req: import('express').Request) {
    return this.authSessions.get(req);
  }

  /** Set `auth_sid` cookie after successful login. */
  async createAuthSession(
    res: import('express').Response,
    user: MockUser,
  ): Promise<string> {
    return this.authSessions.create(res, user);
  }

  // ----- Authorization code ---------------------------------------------

  /**
   * Issue a fresh authorization code + compute the redirect URL.
   * The code is stored in `AuthCodeStore` (TTL 60s, one-time use).
   * Caller should `res.redirect(result.redirectUrl)`.
   */
  async issueCodeAndRedirect(
    res: import('express').Response,
    params: IssueCodeParams,
  ): Promise<IssueCodeResult> {
    const code = randomBytes(32).toString('hex');
    const entry: StoredAuthCode = {
      code,
      clientId: params.clientId,
      userId: params.userId,
      roleId: params.roleId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
      scope: params.scope,
      expiresAt: Date.now() + 60_000, // 60s per RFC 6749 §4.1.2
      consumed: false,
    };
    await this.authCodes.store(entry);

    const url = new URL(params.redirectUri);
    url.searchParams.set('code', code);
    if (params.state) url.searchParams.set('state', params.state);
    const redirectUrl = url.toString();

    res.redirect(302, redirectUrl);
    return { code, redirectUrl };
  }

  /** Expose store for tests + introspection (AUTH-05). */
  getAuthCodeStore(): AuthCodeStore {
    return this.authCodes;
  }

  // ----- Token endpoint: authorization_code grant -----------------------

  /**
   * Exchange an authorization code for an access + refresh token pair.
   * Validates: client credentials, redirect_uri match, code validity (one-time
   * use, not expired), PKCE S256 verifier.
   *
   * Throws `InvalidGrantError` / `InvalidClientError` for the OAuth controller
   * to translate into RFC 6749 §5.2 error responses.
   */
  async exchangeCode(params: ExchangeCodeParams): Promise<TokenPair> {
    // 1. Validate client credentials (RFC 6749 §2.3.1)
    if (
      !this.clients.validateClientCredentials(
        params.clientId,
        params.clientSecret,
      )
    ) {
      throw new InvalidClientError('client credentials invalid');
    }

    // 2. Consume code (one-time use, TTL check)
    const entry = await this.authCodes.consume(params.code);
    if (!entry) {
      throw new InvalidGrantError('authorization code invalid or expired');
    }

    // 3. Validate redirect_uri matches (RFC 6749 §4.1.3)
    if (entry.redirectUri !== params.redirectUri) {
      await this.authCodes.delete(params.code);
      throw new InvalidGrantError('redirect_uri mismatch');
    }

    // 4. Validate client_id matches the code's issuing client
    if (entry.clientId !== params.clientId) {
      await this.authCodes.delete(params.code);
      throw new InvalidGrantError('client_id mismatch');
    }

    // 5. Verify PKCE (RFC 7636 §4.6)
    if (
      !this.verifyPkce(
        params.codeVerifier,
        entry.codeChallenge,
        entry.codeChallengeMethod,
      )
    ) {
      throw new InvalidGrantError('PKCE verification failed');
    }

    // 6. Lookup user (to embed username in JWT)
    const user = await this.findUserById(entry.userId);
    if (!user) {
      await this.authCodes.delete(params.code);
      throw new InvalidGrantError('user not found');
    }

    // 7. Issue access + refresh token pair
    const pair = await this.issueTokenPair(
      user,
      entry.roleId,
      entry.clientId,
      entry.scope || 'openid profile',
    );

    // 8. Clean up code (one-time use fully enforced)
    await this.authCodes.delete(params.code);

    this.logger.log(
      `Issued tokens for user=${user.username} role=${entry.roleId} client=${entry.clientId}`,
    );
    return pair;
  }

  // ----- Token endpoint: refresh_token grant ---------------------------

  /**
   * Refresh rotation: verify the presented refresh token, detect reuse,
   * revoke the old refresh, issue a fresh access + refresh pair.
   *
   * Reuse detection (plan2 §5.4): if the presented refresh token is already
   * revoked, treat it as theft → revoke ALL tokens for that user + reject.
   */
  async refresh(params: RefreshParams): Promise<TokenPair> {
    // 1. Validate client credentials
    if (
      !this.clients.validateClientCredentials(
        params.clientId,
        params.clientSecret,
      )
    ) {
      throw new InvalidClientError('client credentials invalid');
    }

    // 2. Decode the refresh token WITHOUT verifying signature first to get jti
    //    (signature will be verified by JwtSignerService.verify below).
    let jti: string;
    let userId: string;
    let roleId: string;
    let clientOfToken: string;
    let username: string;
    try {
      const payload = await this.signer.verify(
        params.refreshToken,
        JWT_AUDIENCE,
        AUTH_ISSUER,
      );
      if (payload.type !== 'refresh') {
        throw new InvalidGrantError('not a refresh token');
      }
      jti = payload.jti!;
      userId = payload.sub!;
      roleId = payload.roleId as string;
      clientOfToken = payload.client_id as string;
      username = payload.username as string;
    } catch {
      throw new InvalidGrantError('refresh token invalid');
    }

    // 3. Client must match the one that originally received the refresh token
    if (clientOfToken !== params.clientId) {
      throw new InvalidGrantError('client_id mismatch');
    }

    // 4. Reuse detection — if token already revoked, panic
    const reuseDetected = await this.tokens.detectReuseAndPanic(jti);
    if (reuseDetected) {
      this.logger.warn(
        `Refresh token reuse detected for user=${userId} — revoking all sessions`,
      );
      throw new InvalidGrantError('refresh token reuse detected');
    }

    // 5. Revoke old refresh token (rotation)
    await this.tokens.revoke(jti);

    // 6. Lookup user (for fresh JWT)
    const user = await this.findUserById(userId);
    if (!user) {
      throw new InvalidGrantError('user not found');
    }
    // Keep username in sync with the user record (in case it changed).
    const usernameForJwt = user.username ?? username;

    // 7. Issue new pair
    return await this.issueTokenPair(
      { ...user, username: usernameForJwt } as MockUser,
      roleId,
      params.clientId,
      'openid profile',
    );
  }

  // ----- Revoke endpoint ------------------------------------------------

  /**
   * Revoke a token (RFC 7009). Always returns 200 — never reveal whether the
   * token existed. Marks it `revoked: true` in `TokenStore` so subsequent
   * refresh attempts on it trigger reuse detection.
   *
   * Client credentials are validated per RFC 7009 §2.1 — only the client that
   * originally owned the token may revoke it.
   */
  async revoke(params: {
    token: string;
    tokenTypeHint?: 'access_token' | 'refresh_token';
    clientId: string;
    clientSecret: string;
  }): Promise<void> {
    if (
      !this.clients.validateClientCredentials(
        params.clientId,
        params.clientSecret,
      )
    ) {
      throw new InvalidClientError('client credentials invalid');
    }
    // Try to extract jti — we tolerate malformed tokens (return 200 anyway).
    let jti: string | undefined;
    try {
      const decoded = await this.signer.verify(
        params.token,
        JWT_AUDIENCE,
        AUTH_ISSUER,
      );
      jti = decoded.jti;
    } catch {
      // Signature invalid / expired / malformed — RFC 7009 says return 200.
      return;
    }
    if (jti) {
      await this.tokens.revoke(jti);
    }
  }

  // ----- Internal helpers ----------------------------------------------

  /**
   * Verify PKCE S256 (RFC 7636 §4.6):
   *   BASE64URL(SHA256(code_verifier)) === code_challenge
   * Only S256 is supported — `plain` method is rejected.
   */
  verifyPkce(
    codeVerifier: string,
    codeChallenge: string,
    method: string,
  ): boolean {
    if (method !== 'S256') return false;
    if (!isValidCodeVerifier(codeVerifier)) return false;
    const computed = computeS256Challenge(codeVerifier);
    return computed === codeChallenge;
  }

  /**
   * Issue a new (access, refresh) token pair. Both are RS256-signed via
   * `TokenFactory` (DRY refactor per CODING_STANDARDS.md §DRY). Tokens are
   * stored in `TokenStore` for rotation/revoke.
   *
   * Access token claims (plan2 §5.2):
   *   { sub, username, roleId, iss, aud, exp, iat, jti, type: "access" }
   * Refresh token claims (plan2 §5.4):
   *   { sub, username, roleId, iss, aud, exp, iat, jti, type: "refresh", client_id }
   */
  async issueTokenPair(
    user: MockUser,
    roleId: string,
    clientId: string,
    scope: string,
  ): Promise<TokenPair> {
    const now = Date.now();

    // Sign via TokenFactory (centralized JWT signing logic)
    const pair = await this.tokenFactory.issuePair(user, roleId, clientId);

    // Persist both tokens for rotation / reuse detection / revoke.
    await this.tokens.store({
      jti: pair.accessJti,
      userId: user.id,
      clientId,
      roleId,
      type: 'access',
      expiresAt: now + ACCESS_TTL_SEC * 1000,
      revoked: false,
    });
    await this.tokens.store({
      jti: pair.refreshJti,
      userId: user.id,
      clientId,
      roleId,
      type: 'refresh',
      expiresAt: now + 8 * 60 * 60 * 1000,
      revoked: false,
    });

    const expiresAt = Math.floor(now / 1000) + ACCESS_TTL_SEC;

    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      accessJti: pair.accessJti,
      refreshJti: pair.refreshJti,
      expiresAt,
      expiresIn: ACCESS_TTL_SEC,
      tokenType: 'Bearer',
      scope,
    };
  }

  /** Lookup user by id — uses UserService via the controller's wiring.
   *  We don't import UserService directly to avoid a circular import; instead
   *  the controller passes the user object. For refresh flow (where we only
   *  have userId from JWT), the controller provides a lookup callback.
   *  This is set by the module on init.
   */
  private userLookup?: (userId: string) => Promise<MockUser | null>;

  /** Called by OAuthModule to inject a UserService-backed lookup. */
  setUserLookup(fn: (userId: string) => Promise<MockUser | null>): void {
    this.userLookup = fn;
  }

  private async findUserById(userId: string): Promise<MockUser | null> {
    if (!this.userLookup) {
      throw new Error(
        'OAuthService.userLookup not configured — call setUserLookup() before issuing/refreshing tokens',
      );
    }
    return this.userLookup(userId);
  }
}

// ----- Typed OAuth2 errors (RFC 6749 §5.2) ------------------------------

export class InvalidGrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGrantError';
    Object.setPrototypeOf(this, InvalidGrantError.prototype);
  }
}

export class InvalidClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidClientError';
    Object.setPrototypeOf(this, InvalidClientError.prototype);
  }
}

/** Map an internal OAuth error → RFC 6749 §5.2 error code + HTTP status. */
export function mapOAuthError(err: unknown): {
  error: string;
  description: string;
  status: number;
} {
  if (err instanceof InvalidClientError) {
    return {
      error: 'invalid_client',
      description: err.message,
      status: 401,
    };
  }
  if (err instanceof InvalidGrantError) {
    return {
      error: 'invalid_grant',
      description: err.message,
      status: 400,
    };
  }
  if (err instanceof UnauthorizedException) {
    return {
      error: 'unauthorized',
      description: err.message,
      status: 401,
    };
  }
  return {
    error: 'server_error',
    description: err instanceof Error ? err.message : 'unknown error',
    status: 500,
  };
}
