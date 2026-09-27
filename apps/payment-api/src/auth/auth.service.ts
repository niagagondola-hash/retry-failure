/**
 * AuthService — orchestrate OAuth2 flow + session management (AUTH-17).
 *
 * Plan reference: PLAN2 Section 4.2 (BFF endpoints), Section 5.3 (token TTL),
 * Section 5.6 (switch-role), AUTH-17 task spec §3.
 *
 * Business logic for:
 *   - startLogin: generate PKCE + build authorize URL
 *   - handleCallback: exchange code → verify JWT → fetch permissions → create session
 *   - logout: revoke token + delete session
 *   - refresh: refresh access token + update session
 *   - switchRole: switch role + update session
 *
 * Single Responsibility: orchestration only.
 * OAuth2 calls delegated to OAuthClientService.
 * Session persistence delegated to SessionService.
 * JWT verification delegated to JwtVerifier (JwksVerifier).
 * Cookie concerns delegated to controller (uses cookie.util from security).
 */
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import {
  JwtVerifier,
  JWT_VERIFIER,
  OAuthClientService,
  SECURITY_OPTIONS,
  SecurityOptions,
  SessionService,
  AuthUser,
} from '@retry-failure/security';

/** Result of startLogin — controller uses this to set cookie + redirect. */
export interface LoginStartResult {
  /** Full authorize URL to redirect browser to (auth-mock /oauth/authorize). */
  redirectUrl: string;
  /** OAuth state value — set in `oauth_state` cookie for CSRF protection. */
  state: string;
  /** PKCE code_verifier — set in `oauth_verifier` cookie for callback step. */
  codeVerifier: string;
}

/** Result of handleCallback — controller uses sid to set session cookie. */
export interface CallbackResult {
  /** Session ID to set in `sid` cookie. */
  sid: string;
  /** User info for response. */
  user: {
    userId: string;
    username: string;
    roleId: string;
    isSuperAdmin: boolean;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    private readonly oauthClient: OAuthClientService,
    private readonly sessionService: SessionService,
    @Inject(JWT_VERIFIER) private readonly jwksVerifier: JwtVerifier,
    @Inject(SECURITY_OPTIONS) private readonly options: SecurityOptions,
  ) {}

  /**
   * Step 1 — generate PKCE + build authorize URL.
   *
   * Controller sets `oauth_state` + `oauth_verifier` cookies (5 min TTL, HttpOnly)
   * then redirects browser to `redirectUrl`.
   */
  async startLogin(): Promise<LoginStartResult> {
    const result = await this.oauthClient.getAuthorizationUrl(
      this.generateState(),
    );
    return {
      redirectUrl: result.url,
      state: result.state,
      codeVerifier: result.codeVerifier,
    };
  }

  /**
   * Step 2 — handle OAuth2 callback.
   *
   * Flow:
   *   1. Verify `state` matches `oauth_state` cookie (CSRF protection).
   *   2. Exchange code for tokens via OAuthClientService.
   *   3. Verify access token JWT via JwksVerifier.
   *   4. Fetch permissions via OAuthClientService.fetchPermissions.
   *   5. Create session via SessionService.create.
   *
   * @returns sid + user info for response.
   */
  async handleCallback(
    code: string,
    state: string,
    expectedState: string,
    codeVerifier: string,
  ): Promise<CallbackResult> {
    // 1. Verify state (CSRF protection)
    if (state !== expectedState) {
      throw new UnauthorizedException('OAuth state mismatch');
    }

    // 2. Exchange code for tokens
    const tokenSet = await this.oauthClient.exchangeCode(code, codeVerifier);

    // 3. Verify access token JWT
    const payload = await this.jwksVerifier.verify(tokenSet.accessToken);

    // 4. Fetch permissions (user info + role + permissionCodes)
    const perms = await this.oauthClient.fetchPermissions(
      tokenSet.accessToken,
    );

    // 5. Create session
    const { sid, session } = await this.sessionService.create({
      userId: payload.sub!,
      username: payload.username as string,
      roleId: payload.roleId as string,
      permissionCodes: perms.permissionCodes,
      tokens: tokenSet,
    });

    this.logger.log(
      `Login success sid=${sid.substring(0, 8)}... user=${session.username}`,
    );

    return {
      sid,
      user: {
        userId: perms.user.id,
        username: perms.user.username,
        roleId: perms.role.id,
        isSuperAdmin: perms.user.isSuperAdmin,
      },
    };
  }

  /**
   * Logout — revoke refresh token + delete session.
   *
   * Errors from revoke are logged + swallowed (don't block logout).
   */
  async logout(sid: string): Promise<void> {
    const session = await this.sessionService.get(sid);
    if (!session) {
      this.logger.debug(
        `Logout: session not found sid=${sid.substring(0, 8)}...`,
      );
      return;
    }

    // Best-effort revoke refresh token — don't fail logout if revoke fails
    try {
      if (session.refreshToken) {
        await this.oauthClient.revoke(
          session.refreshToken,
          'refresh_token',
        );
      }
    } catch (err) {
      this.logger.warn(
        `Revoke failed (continuing logout): ${(err as Error).message}`,
      );
    }

    await this.sessionService.delete(sid);
    this.logger.log(`Logout success sid=${sid.substring(0, 8)}...`);
  }

  /**
   * Refresh access token + update session.
   *
   * Called when access token expired but session (refresh token) still valid.
   */
  async refresh(sid: string): Promise<void> {
    const session = await this.sessionService.get(sid);
    if (!session) {
      throw new UnauthorizedException('Session not found');
    }

    const newTokens = await this.oauthClient.refresh(session.refreshToken);

    // Verify new access token
    await this.jwksVerifier.verify(newTokens.accessToken);

    // Update session in-place (keep same sid, update tokens)
    await this.sessionService.updateOnSwitchRole(
      sid,
      session.roleId,
      newTokens,
      session.permissionCodes,
    );
  }

  /**
   * Switch role — call auth switch-role endpoint + update session.
   *
   * Flow:
   *   1. Call OAuthClientService.switchRole → get new tokens + role
   *   2. Verify new access token JWT via JwksVerifier
   *   3. Fetch permissions via OAuthClientService.fetchPermissions (new role's codes)
   *   4. Update session in-place (roleId + tokens + permissionCodes)
   *
   * @returns Updated AuthUser with new roleId + permissionCodes.
   */
  async switchRole(sid: string, roleId: string): Promise<AuthUser> {
    const session = await this.sessionService.get(sid);
    if (!session) {
      throw new UnauthorizedException('Session not found');
    }

    // 1. Call auth /api/v1/auth/switch-role
    const result = await this.oauthClient.switchRole(
      session.accessToken,
      roleId,
    );

    // 2. Verify new access token
    await this.jwksVerifier.verify(result.accessToken);

    // 3. Fetch permissions for new role (SwitchRoleResponse doesn't include permissionCodes)
    const perms = await this.oauthClient.fetchPermissions(result.accessToken);

    // 4. Update session in-place
    await this.sessionService.updateOnSwitchRole(
      sid,
      roleId,
      {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
        tokenType: result.tokenType,
        scope: result.scope,
      },
      perms.permissionCodes,
    );

    return {
      userId: session.userId,
      username: session.username,
      roleId,
      isSuperAdmin: false,
      permissionCodes: perms.permissionCodes,
    };
  }

  /** Generate random state for OAuth2 CSRF protection. */
  private generateState(): string {
    return randomBytes(32).toString('hex');
  }
}
