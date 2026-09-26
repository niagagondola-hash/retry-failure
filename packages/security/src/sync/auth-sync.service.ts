/**
 * AuthSyncService — fetch fresh permissions + update cache + session (AUTH-14).
 *
 * Plan reference: PLAN2 Section 8.1 (lazy sync trigger), Section 8.2 (alur),
 * Section 7.1 (cached_users), Section 9.4 (session store).
 *
 * Single Responsibility: synchronize the local view of a single session with
 * the auth server. Called by `LazySyncMiddleware.doSync` after acquiring the
 * per-session lock.
 *
 * Sequence:
 *   1. `OAuthClientService.fetchPermissions(accessToken)` → fresh
 *      `{ user, role, permissionCodes }` from auth `/api/v1/me/permissions`.
 *   2. `CacheRepository.upsertCachedUser(...)` → persist stable user fields
 *      (used by `SessionGuard` for `is_super_admin` lookup).
 *   3. `SessionStore.updateSync(sid, permissionCodes, Date.now())` → persist
 *      fresh permission codes + bump `lastSyncAt` on the session.
 *
 * Error handling: throws whatever `OAuthClientError` / repo error bubbles up;
 * the caller (`LazySyncMiddleware`) catches + logs + falls back to stale cache.
 *
 * DIP note: `SessionStore` is injected via `@Inject(SESSION_STORE)` because
 * it has >1 implementation (Redis | Memory). `OAuthClientService` and
 * `CacheRepository` are single-implementation concrete deps — acceptable per
 * CODING_STANDARDS DIP exception for mock/dev context.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';

import { CacheRepository } from '../cache/cache.repository';
import { OAuthClientService } from '../oauth/oauth-client.service';
import type { PermissionsResponse } from '../oauth/oauth-client.types';
import { SESSION_STORE, Session, SessionStore } from '../session-store';

/** Result of a successful sync — fresh permissionCodes + user snapshot. */
export interface SyncSessionResult {
  permissionCodes: string[];
  user: PermissionsResponse['user'];
}

@Injectable()
export class AuthSyncService {
  private readonly logger = new Logger('AuthSyncService');

  constructor(
    private readonly oauthClient: OAuthClientService,
    private readonly cache: CacheRepository,
    @Inject(SESSION_STORE) private readonly sessionStore: SessionStore,
  ) {}

  /**
   * Sync a single session with the auth server.
   *
   * @param session - current session record (must have `accessToken` + `sid`)
   * @returns fresh permissionCodes + user snapshot
   * @throws {OAuthClientError} if auth server is unreachable / returns error
   * @throws if `CacheRepository.upsertCachedUser` or `SessionStore.updateSync` fails
   */
  async syncSession(session: Session): Promise<SyncSessionResult> {
    const sidShort = session.sid.substring(0, 8);
    this.logger.log(
      `Syncing session sid=${sidShort}... userId=${session.userId}`,
    );

    // 1. Fetch fresh permissions from auth
    const data = await this.oauthClient.fetchPermissions(
      session.accessToken,
    );

    // 2. Upsert stable user fields into cached_users
    await this.cache.upsertCachedUser({
      user_id: data.user.id,
      username: data.user.username,
      email: data.user.email,
      name: data.user.name,
      is_super_admin: data.user.isSuperAdmin,
    });

    // 3. Persist fresh permissionCodes + bump lastSyncAt on the session
    await this.sessionStore.updateSync(
      session.sid,
      data.permissionCodes,
      Date.now(),
    );

    this.logger.log(
      `Synced session sid=${sidShort}... permissionCodes=${data.permissionCodes.length}`,
    );
    return { permissionCodes: data.permissionCodes, user: data.user };
  }
}
