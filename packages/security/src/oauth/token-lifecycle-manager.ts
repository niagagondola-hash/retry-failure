/**
 * TokenLifecycleManager — manage full access token lifecycle (AUTH-09b).
 *
 * Plan reference: PLAN2 Section 5.3 (Token Strategy — Access 15m / Refresh 8h),
 * Section 5.4 (refresh rotation), Section 8.2 (lazy sync), AUTH-09b task spec.
 *
 * Single Responsibility: ensure callers always have a valid access token when
 * calling auth-mock APIs (fetchPermissions, switchRole).
 *
 * Features:
 *   1. Pre-check: accessExpiresAt - buffer > now → skip refresh (fast path)
 *   2. Auto-refresh: if pre-check expired → call oauthClient.refresh(refreshToken)
 *   3. Single-flight: concurrent requests share 1 refresh per session (anti reuse detection)
 *   4. Retry on 401: if auth server returns 401 despite pre-check pass → force refresh + retry 1x
 *   5. Failure handling: if refresh fails → delete session + throw TokenRefreshError
 *
 * Usage:
 *   ```typescript
 *   const result = await tokenManager.executeWithToken(
 *     session,
 *     (token) => oauthClient.fetchPermissions(token),
 *   );
 *   ```
 */
import { Injectable, Logger } from '@nestjs/common';

import { type Session } from '../session-store';

import { OAuthClientService } from './oauth-client.service';
import { OAuthClientError, type TokenSet } from './oauth-client.types';
import { SessionService } from './session.service';
import { REFRESH_BUFFER_MS, TokenRefreshError } from './token-lifecycle-manager.types';

@Injectable()
export class TokenLifecycleManager {
  private readonly logger = new Logger('TokenLifecycleManager');

  /**
   * Single-flight: per-session refresh promise.
   *
   * Key = session.sid. Value = in-flight refresh Promise.
   * Concurrent callers for the same session await the same promise —
   * prevents multiple refresh calls that would trigger reuse detection
   * in auth-mock (plan2 §5.4: refresh token rotation, reuse → revoke all).
   */
  private readonly refreshInFlight = new Map<string, Promise<TokenSet>>();

  constructor(
    private readonly oauthClient: OAuthClientService,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * Ensure session has a valid access token.
   *
   * Pre-check: `accessExpiresAt - 30s buffer > now` → still valid, return session.
   * If expired: refresh via `oauthClient.refresh(refreshToken)` → update session.
   * Single-flight: concurrent calls for same session share 1 refresh promise.
   *
   * @param session - Current session (must have accessToken + refreshToken + accessExpiresAt)
   * @returns Session with valid access token (may be updated if refresh occurred)
   * @throws {TokenRefreshError} if refresh fails (refreshToken expired/revoked/network error)
   */
  async ensureValidToken(session: Session): Promise<Session> {
    // Pre-check: token still valid with 30s buffer
    if (Date.now() < session.accessExpiresAt - REFRESH_BUFFER_MS) {
      return session;
    }

    // Token expired (or will expire within 30s) → refresh
    return this.doRefresh(session);
  }

  /**
   * Execute function with valid access token.
   *
   * Flow:
   *   1. `ensureValidToken(session)` → session with valid token
   *   2. Try `fn(session.accessToken)` — execute original request
   *   3. Catch 401 from auth server → force refresh → retry 1x
   *   4. If still fails → throw TokenRefreshError
   *
   * @param session - Current session
   * @param fn - Function that takes accessToken and returns a Promise<T>
   * @returns Result of fn(accessToken)
   * @throws {TokenRefreshError} if refresh fails or token still invalid after retry
   */
  async executeWithToken<T>(
    session: Session,
    fn: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    // Step 1: ensure valid token
    const validSession = await this.ensureValidToken(session);

    // Step 2: try execute
    try {
      return await fn(validSession.accessToken);
    } catch (err) {
      // Step 3: catch 401 → force refresh + retry
      if (!this.isUnauthorizedError(err)) throw err;

      this.logger.warn(
        `executeWithToken: got 401, forcing refresh sid=${session.sid.substring(0, 8)}...`,
      );

      // Force refresh (ignore pre-check, ignore single-flight lock)
      const refreshedSession = await this.forceRefresh(session);

      // Retry 1x with new token
      try {
        return await fn(refreshedSession.accessToken);
      } catch (retryErr) {
        // Step 4: still fails after refresh → throw
        if (this.isUnauthorizedError(retryErr)) {
          throw new TokenRefreshError(
            'Token still invalid after refresh + retry',
            'retry_401',
            retryErr,
          );
        }
        throw retryErr;
      }
    }
  }

  /**
   * Single-flight refresh — only 1 refresh per session at a time.
   *
   * Concurrent callers for the same session await the same promise,
   * preventing multiple refresh calls that could trigger auth-mock's
   * reuse detection (plan2 §5.4: refresh token reuse → revoke all sessions).
   *
   * @param session - Session with expired access token
   * @returns Updated session with fresh tokens
   * @throws {TokenRefreshError} if refresh fails
   */
  private async doRefresh(session: Session): Promise<Session> {
    const sid = session.sid;

    // Check if refresh already in-flight for this session
    const existing = this.refreshInFlight.get(sid);
    if (existing) {
      this.logger.debug(
        `doRefresh: waiting for in-flight refresh sid=${sid.substring(0, 8)}...`,
      );
      const newTokens = await existing;
      return this.applyTokens(session, newTokens);
    }

    // Start new refresh
    const refreshPromise = this.oauthClient.refresh(session.refreshToken);
    this.refreshInFlight.set(sid, refreshPromise);

    try {
      const newTokens = await refreshPromise;
      this.logger.debug(
        `doRefresh: refresh success sid=${sid.substring(0, 8)}... access_token len=${newTokens.accessToken.length}`,
      );
      return await this.applyTokens(session, newTokens);
    } catch (err) {
      // Refresh failed — delete session (force re-login)
      this.logger.warn(
        `doRefresh: refresh failed sid=${sid.substring(0, 8)}...: ${(err as Error).message} — deleting session`,
      );
      await this.sessionService.delete(sid);
      throw new TokenRefreshError(
        'Refresh token expired or revoked',
        'refresh_token_expired',
        err,
      );
    } finally {
      this.refreshInFlight.delete(sid);
    }
  }

  /**
   * Force refresh — ignore single-flight lock.
   *
   * Used when 401 is received from auth server (token invalid despite
   * pre-check passing). This bypasses the single-flight Map because
   * the original in-flight refresh may have already completed (with a
   * token that auth server still rejects).
   *
   * @param session - Session whose token was rejected by auth server
   * @returns Updated session with fresh tokens
   * @throws {TokenRefreshError} if refresh fails
   */
  private async forceRefresh(session: Session): Promise<Session> {
    this.logger.warn(
      `forceRefresh: 401 received, forcing refresh sid=${session.sid.substring(0, 8)}...`,
    );

    try {
      const newTokens = await this.oauthClient.refresh(session.refreshToken);
      this.logger.debug(
        `forceRefresh: refresh success sid=${session.sid.substring(0, 8)}...`,
      );
      return await this.applyTokens(session, newTokens);
    } catch (err) {
      // Refresh also failed — delete session
      this.logger.warn(
        `forceRefresh: refresh also failed — deleting session sid=${session.sid.substring(0, 8)}...`,
      );
      await this.sessionService.delete(session.sid);
      throw new TokenRefreshError(
        'Refresh token expired or revoked',
        'refresh_token_expired',
        err,
      );
    }
  }

  /**
   * Apply new tokens to session + persist to store.
   *
   * Delegates to `SessionService.updateTokens()` which handles:
   *   - Update accessToken, refreshToken, accessExpiresAt, idToken, lastSyncAt
   *   - Persist to store with refreshed TTL
   *
   * @param session - Current session (for sid)
   * @param tokens - New TokenSet from refresh
   * @returns Updated session
   * @throws {TokenRefreshError} if session disappeared during refresh
   */
  private async applyTokens(
    session: Session,
    tokens: TokenSet,
  ): Promise<Session> {
    const updated = await this.sessionService.updateTokens(session.sid, tokens);
    if (!updated) {
      throw new TokenRefreshError(
        'Session disappeared during token refresh',
        'refresh_failed',
      );
    }
    return updated;
  }

  /**
   * Check if error is 401 Unauthorized from auth server.
   *
   * Handles both `OAuthClientError` (our wrapper) and raw axios errors
   * (in case caller doesn't wrap).
   */
  private isUnauthorizedError(err: unknown): boolean {
    if (err instanceof OAuthClientError) {
      return err.status === 401;
    }
    if (typeof err === 'object' && err !== null && 'response' in err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      return status === 401;
    }
    return false;
  }
}
