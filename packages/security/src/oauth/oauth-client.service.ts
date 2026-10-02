/**
 * OAuthClientService — openid-client v5 wrapper for OAuth2 + PKCE + token lifecycle.
 *
 * Plan reference: PLAN2 Section 9 (oauth-client.service.ts), Section 4.1 (OAuth2 flow diagram),
 * Section 4.3 (PKCE), Section 5.3 (expiry), Section 5.4 (refresh rotation),
 * Section 5.5 (revoke), Section 5.6 (switch-role flow).
 *
 * Responsibilities:
 * 1. Lazy discovery via `Issuer.discover(AUTH_ISSUER)` → cache `Client` singleton.
 * 2. Build authorization URL with PKCE S256 + `state`.
 * 3. Exchange authorization code → `{ access_token, refresh_token, expires_at }`.
 * 4. Refresh token (rotation — old refresh revoked by auth).
 * 5. Revoke access / refresh token (RFC 7009).
 * 6. Proxy `/api/v1/auth/switch-role` to auth (axios) → new tokens + new role.
 * 7. Fetch `/api/v1/me/permissions` (axios) → `{ user, role, permissionCodes }` for lazy sync.
 *
 * Error handling: openid-client throws `errors.OPError` (RFC 6749 error response)
 * and `errors.RPError` (response parsing). All wrapped into `OAuthClientError`.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  Client,
  Issuer,
  TokenSet as OidcTokenSet,
  errors as oidcErrors,
} from 'openid-client';

import type { SecurityOptions } from '../security.module';

import { OAUTH_PATHS } from './endpoints';
import {
  OAuthClientError,
  PermissionsResponse,
  SwitchRoleResponse,
  TokenSet,
} from './oauth-client.types';
import { generatePkcePair } from './pkce.util';

export const SECURITY_OPTIONS = 'SECURITY_OPTIONS';

/**
 * Result of `getAuthorizationUrl` — caller persists `codeVerifier` (e.g. in
 * short-lived signed cookie keyed by `state`) and redirects user to `url`.
 */
export interface AuthorizationUrlResult {
  url: string;
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

@Injectable()
export class OAuthClientService {
  private readonly logger = new Logger('OAuthClientService');
  private client?: Client;
  private readonly httpClient: AxiosInstance;

  /** Default access token TTL fallback (15m per plan2 §5.3) — used if auth omits `expires_in`. */
  private static readonly DEFAULT_ACCESS_TTL_SEC = 15 * 60;

  constructor(
    @Inject(SECURITY_OPTIONS) private readonly options: SecurityOptions,
  ) {
    const baseURL = this.options.authBaseUrl;
    const timeout = 5_000;
    this.httpClient = axios.create({
      baseURL,
      timeout,
      headers: { 'User-Agent': 'payment-api/0.1' },
    });
  }

  /**
   * Lazy discovery — `Issuer.discover(AUTH_ISSUER)` (openid-client v5) fetches
   * `/.well-known/openid-configuration` and returns an `Issuer`. We then
   * construct a `Client` once and cache it.
   *
   * Lazy (vs OnModuleInit) is more resilient: auth can come up after payment-api.
   */
  private async getClient(): Promise<Client> {
    if (this.client) return this.client;
    const issuerUrl = this.options.authIssuer;
    if (!issuerUrl) {
      throw new OAuthClientError(
        'authIssuer is not configured (SecurityOptions.authIssuer missing)',
        'config_missing',
      );
    }
    const clientId = this.options.oauthClientId;
    const clientSecret = this.options.oauthClientSecret;
    const redirectUri = this.options.oauthRedirectUri;
    if (!clientId || !clientSecret || !redirectUri) {
      throw new OAuthClientError(
        'OAuth client config incomplete (clientId/clientSecret/redirectUri missing)',
        'config_missing',
      );
    }
    try {
      const issuer = await Issuer.discover(issuerUrl);
      this.client = new issuer.Client({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uris: [redirectUri],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
      });
      this.logger.log(
        `Discovered issuer: ${issuer.metadata.issuer as string} (client_id=${clientId})`,
      );
      return this.client;
    } catch (err) {
      throw new OAuthClientError(
        `Discovery failed for ${issuerUrl}`,
        'discovery_failed',
        undefined,
        err,
      );
    }
  }

  /** Parse scopes from space-delimited string (SecurityOptions stores `oauthScopes` as string). */
  private get scopes(): string[] {
    const raw = this.options.oauthScopes ?? '';
    return raw.split(/\s+/).filter(Boolean);
  }

  /**
   * Step 1 — build authorization URL with PKCE S256.
   * Caller must persist `codeVerifier` keyed by `state` (short-lived cookie)
   * so the callback handler can complete the code exchange.
   */
  async getAuthorizationUrl(state: string): Promise<AuthorizationUrlResult> {
    const client = await this.getClient();
    const pkce = generatePkcePair();
    const url = client.authorizationUrl({
      redirect_uri: this.options.oauthRedirectUri,
      scope: this.scopes.join(' ') || 'openid profile',
      state,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: pkce.codeChallengeMethod,
    });
    return {
      url,
      codeVerifier: pkce.codeVerifier,
      codeChallenge: pkce.codeChallenge,
      state,
    };
  }

  /**
   * Step 2 — exchange authorization code for tokens.
   * openid-client verifies PKCE + state internally via `client.callback`.
   */
  async exchangeCode(code: string, codeVerifier: string): Promise<TokenSet> {
    const client = await this.getClient();
    try {
      const ts: OidcTokenSet = await client.callback(
        this.options.oauthRedirectUri,
        { code },
        { code_verifier: codeVerifier },
      );
      return this.toTokenSet(ts);
    } catch (err) {
      throw this.wrapOidcError(err, 'Token exchange failed');
    }
  }

  /**
   * Step 3 — refresh token (rotation).
   * Per plan2 §5.4, auth revokes the old refresh token. Reuse of an
   * already-rotated refresh token is treated as theft → auth revokes
   * the entire session.
   */
  async refresh(refreshToken: string): Promise<TokenSet> {
    const client = await this.getClient();
    try {
      const ts = await client.refresh(refreshToken);
      return this.toTokenSet(ts);
    } catch (err) {
      throw this.wrapOidcError(err, 'Refresh failed');
    }
  }

  /**
   * Step 4 — revoke token (RFC 7009).
   * Revoke returns 200 even if token is unknown; errors here indicate
   * transport / auth-outage, not "token already gone".
   */
  async revoke(
    token: string,
    tokenTypeHint?: 'access_token' | 'refresh_token',
  ): Promise<void> {
    const client = await this.getClient();
    try {
      await client.revoke(token, tokenTypeHint);
    } catch (err) {
      throw this.wrapOidcError(err, 'Revoke failed');
    }
  }

  /**
   * Proxy switch-role to auth `POST /api/v1/auth/switch-role`.
   * Auth issues a new JWT with `roleId` claim set to the requested role.
   * Returns new access + refresh tokens + the new role object.
   */
  async switchRole(
    accessToken: string,
    roleId: string,
  ): Promise<SwitchRoleResponse> {
    try {
      const res = await this.httpClient.post(
        OAUTH_PATHS.switchRole,
        { roleId },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const data = res.data?.data;
      if (!data || !data.accessToken) {
        throw new OAuthClientError(
          'Invalid switch-role response: missing accessToken',
          'invalid_response',
          res.status,
        );
      }
      const expiresAt =
        typeof data.expiresAt === 'number'
          ? data.expiresAt
          : Math.floor(Date.now() / 1000) +
            OAuthClientService.DEFAULT_ACCESS_TTL_SEC;
      return {
        accessToken: data.accessToken as string,
        refreshToken: data.refreshToken as string | undefined,
        expiresAt,
        tokenType: 'Bearer',
        scope: this.scopes.join(' '),
        role: data.role ?? { id: roleId, name: roleId },
      };
    } catch (err) {
      throw this.wrapAxiosError(err, 'Switch role failed', 'switch_role_failed');
    }
  }

  /**
   * Fetch user + role + permissionCodes from `/api/v1/me/permissions`.
   * Used by lazy sync middleware (AUTH-14) and on session creation.
   */
  async fetchPermissions(accessToken: string): Promise<PermissionsResponse> {
    try {
      const res = await this.httpClient.get(OAUTH_PATHS.permissions, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = res.data?.data;
      if (!data || !data.user || !data.role || !Array.isArray(data.permissionCodes)) {
        throw new OAuthClientError(
          'Invalid permissions response: missing user/role/permissionCodes',
          'invalid_response',
          res.status,
        );
      }
      return data as PermissionsResponse;
    } catch (err) {
      if (err instanceof OAuthClientError) throw err;
      throw this.wrapAxiosError(
        err,
        'Fetch permissions failed',
        'fetch_permissions_failed',
      );
    }
  }

  /** Convert openid-client TokenSet to internal TokenSet shape. */
  private toTokenSet(ts: OidcTokenSet): TokenSet {
    const expiresIn = typeof ts.expires_in === 'number' ? ts.expires_in : undefined;
    const expiresAt =
      typeof ts.expires_at === 'number'
        ? ts.expires_at
        : Math.floor(Date.now() / 1000) +
          (expiresIn ?? OAuthClientService.DEFAULT_ACCESS_TTL_SEC);
    return {
      accessToken: ts.access_token as string,
      refreshToken: ts.refresh_token,
      idToken: ts.id_token,
      expiresAt,
      tokenType: 'Bearer',
      scope: ts.scope,
    };
  }

  /**
   * Generate RP-initiated logout URL (OIDC Session Management 1.0 — AUTH-09a).
   *
   * Uses openid-client v5 native `client.endSessionUrl()` to build the URL
   * with the following parameters:
   *   - id_token_hint: JWT id_token from the login session (NOT access_token).
   *     Auth-mock verifies signature + extracts sub (userId).
   *   - post_logout_redirect_uri: URL to redirect browser after logout.
   *     Must match auth-mock whitelist (anti open-redirect).
   *   - state: Auto-generated random string for anti-CSRF. Forwarded as-is
   *     to post_logout_redirect_uri as ?state=...
   *   - client_id: Auto-added by openid-client.
   *
   * @param params.idTokenHint - JWT id_token (string) from the login TokenSet.
   * @param params.postLogoutRedirectUri - URL target setelah logout (default FE).
   * @param params.state - Optional state string (auto-generate if undefined).
   * @returns Full URL string for browser redirect to auth-mock /oauth/logout.
   */
  async getEndSessionUrl(params: {
    idTokenHint: string;
    postLogoutRedirectUri: string;
    state?: string;
  }): Promise<string> {
    const client = await this.getClient();
    try {
      return client.endSessionUrl({
        id_token_hint: params.idTokenHint,
        post_logout_redirect_uri: params.postLogoutRedirectUri,
        state: params.state,
      });
    } catch (err) {
      throw this.wrapOidcError(err, 'endSessionUrl generation failed');
    }
  }

  /** Wrap openid-client `OPError` / `RPError` into typed `OAuthClientError`. */
  private wrapOidcError(err: unknown, fallbackMessage: string): OAuthClientError {
    if (err instanceof oidcErrors.OPError) {
      const code = err.error ?? 'op_error';
      const status = err.response?.statusCode;
      const message = err.error_description ?? fallbackMessage;
      return new OAuthClientError(message, code, status, err);
    }
    if (err instanceof oidcErrors.RPError) {
      return new OAuthClientError(
        'Response parsing failed',
        'rp_error',
        err.response?.statusCode,
        err,
      );
    }
    if (err instanceof OAuthClientError) return err;
    return new OAuthClientError(fallbackMessage, 'unknown', undefined, err);
  }

  /** Wrap axios error into typed `OAuthClientError`. */
  private wrapAxiosError(
    err: unknown,
    fallbackMessage: string,
    code: string,
  ): OAuthClientError {
    if (err instanceof OAuthClientError) return err;
    if (err instanceof AxiosError) {
      const status = err.response?.status;
      const authErr = err.response?.data?.error as string | undefined;
      const authDesc = err.response?.data?.error_description as string | undefined;
      return new OAuthClientError(
        authDesc ?? fallbackMessage,
        authErr ?? code,
        status,
        err,
      );
    }
    return new OAuthClientError(fallbackMessage, code, undefined, err);
  }
}
